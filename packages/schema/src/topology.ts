import { z } from 'zod';
import type { PipelineEdge } from './edges.js';
import {
    type NodeOutputPortId,
    type PipelineEdgeId,
    PipelineEdgeIdSchema,
    type PipelineNodeId,
    PipelineNodeIdSchema,
} from './ids.js';
import {
    formatNodeIdentity,
    type NodeContractRegistry,
    type NodeContractResolution,
    resolveNodeContract,
} from './node-contract.js';
import { createBuiltinNodeContractRegistry } from './nodes/catalog.js';
import { type PipelineNode, SWITCH_DIAGNOSTIC_CODES } from './nodes/index.js';
import type { AdmittedNodeContract, WorkflowDocument } from './pipeline.js';

const TOPOLOGY_DIAGNOSTIC_CODES = [
    'invalid_pipeline',
    'unsupported_document_version',
    'empty_pipeline',
    'missing_trigger',
    'multiple_triggers',
    'multiple_roots',
    'unsupported_root',
    'trigger_not_root',
    'cycle',
    'disconnected_node',
    'implicit_join',
    'invalid_output_port',
    'invalid_edge',
    'duplicate_node_id',
    'duplicate_edge_id',
    'unsupported_node_handler',
    'unavailable_node_contract',
    'unsupported_plugin_authoring',
    'invalid_plugin_config',
    'invalid_node_contract',
    ...SWITCH_DIAGNOSTIC_CODES,
] as const;

export const TopologyDiagnosticSeveritySchema = z.enum(['error', 'warning']);
export type TopologyDiagnosticSeverity = z.infer<typeof TopologyDiagnosticSeveritySchema>;

export const TopologyDiagnosticCodeSchema = z.enum(TOPOLOGY_DIAGNOSTIC_CODES);
export type TopologyDiagnosticCode = z.infer<typeof TopologyDiagnosticCodeSchema>;

const TopologyDiagnosticTargetSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('pipeline') }).strict(),
    z.object({ kind: z.literal('node'), nodeId: PipelineNodeIdSchema }).strict(),
    z.object({ kind: z.literal('edge'), edgeId: PipelineEdgeIdSchema }).strict(),
]);

export const TopologyDiagnosticSchema = z
    .object({
        severity: TopologyDiagnosticSeveritySchema,
        code: TopologyDiagnosticCodeSchema,
        target: TopologyDiagnosticTargetSchema,
        nodeId: PipelineNodeIdSchema.optional(),
        edgeId: PipelineEdgeIdSchema.optional(),
        caseId: z.string().min(1).optional(),
        fieldPath: z.string().min(1).optional(),
        message: z.string().min(1),
        repairHint: z.string().min(1).optional(),
    })
    .strict()
    .readonly();

export type TopologyDiagnostic = z.infer<typeof TopologyDiagnosticSchema>;

export type TopologyOutputPorts = readonly NodeOutputPortId[] | 'dynamic';

export interface WorkflowTopologyOptions {
    /** Shared Node Contract Registry used for built-in and registered Plugin Nodes. */
    readonly contractRegistry?: NodeContractRegistry;
    /** Require every Node to have a registered, valid contract for execution. */
    readonly requireNodeContracts?: boolean;
    /**
     * Supplies runtime support knowledge for Nodes. The topology module does
     * not know which handlers are available in a particular Engine process.
     */
    readonly isNodeSupported?: (node: PipelineNode) => boolean;
}

export interface WorkflowTopologyAdmission {
    readonly triggerId: PipelineNodeId;
    readonly executionOrder: readonly PipelineNodeId[];
    readonly admittedNodeContracts: readonly AdmittedNodeContract[];
}

export type WorkflowTopologyResult =
    | { readonly ok: true; readonly value: WorkflowTopologyAdmission }
    | { readonly ok: false; readonly diagnostics: readonly TopologyDiagnostic[] };

function pipelineDiagnostic(code: TopologyDiagnosticCode, message: string): TopologyDiagnostic {
    return {
        severity: 'error',
        code,
        target: { kind: 'pipeline' },
        message,
    };
}

function nodeDiagnostic(
    code: TopologyDiagnosticCode,
    nodeId: PipelineNodeId,
    message: string,
): TopologyDiagnostic {
    return {
        severity: 'error',
        code,
        target: { kind: 'node', nodeId },
        nodeId,
        message,
    };
}

function edgeDiagnostic(
    code: TopologyDiagnosticCode,
    edgeId: PipelineEdgeId,
    message: string,
    nodeId?: PipelineNodeId,
): TopologyDiagnostic {
    return {
        severity: 'error',
        code,
        target: { kind: 'edge', edgeId },
        edgeId,
        ...(nodeId ? { nodeId } : {}),
        message,
    };
}

function outputPortsForResolution(resolution: NodeContractResolution): TopologyOutputPorts {
    if (resolution.status === 'available') {
        return resolution.outputPorts === 'dynamic'
            ? 'dynamic'
            : resolution.outputPorts.map((port) => port.id);
    }
    if (resolution.status === 'invalid' && resolution.outputPorts !== undefined) {
        return resolution.outputPorts === 'dynamic'
            ? 'dynamic'
            : resolution.outputPorts.map((port) => port.id);
    }
    return [];
}

function contractIssueFieldPath(path: string): string {
    const normalized = path.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
    return `config.${normalized}`;
}

function appendInvalidContractDiagnostics(
    diagnostics: TopologyDiagnostic[],
    node: PipelineNode,
    resolution: Extract<NodeContractResolution, { readonly status: 'invalid' }>,
): void {
    for (const issue of resolution.issues) {
        const mappedCode = issue.diagnosticCode
            ? TopologyDiagnosticCodeSchema.safeParse(issue.diagnosticCode)
            : undefined;
        appendUnique(diagnostics, {
            severity: 'error',
            code: mappedCode?.success ? mappedCode.data : 'invalid_node_contract',
            target: { kind: 'node', nodeId: node.id },
            nodeId: node.id,
            ...(issue.caseId === undefined ? {} : { caseId: issue.caseId }),
            fieldPath: contractIssueFieldPath(issue.path),
            message:
                issue.diagnosticCode === undefined
                    ? `Node "${node.id}" (${formatNodeIdentity(resolution.identity)}) has invalid ` +
                      `configuration for its output-port contract: ${issue.message}`
                    : issue.message,
            ...(issue.repairHint === undefined ? {} : { repairHint: issue.repairHint }),
        });
    }
}

function appendUnique(diagnostics: TopologyDiagnostic[], diagnostic: TopologyDiagnostic): void {
    const duplicate = diagnostics.some(
        (existing) =>
            existing.code === diagnostic.code &&
            existing.target.kind === diagnostic.target.kind &&
            existing.nodeId === diagnostic.nodeId &&
            existing.edgeId === diagnostic.edgeId &&
            existing.caseId === diagnostic.caseId &&
            existing.fieldPath === diagnostic.fieldPath,
    );
    if (!duplicate) diagnostics.push(diagnostic);
}

function stableExecutionOrder(
    nodes: readonly PipelineNode[],
    incoming: ReadonlyMap<PipelineNodeId, readonly PipelineEdgeId[]>,
    outgoing: ReadonlyMap<PipelineNodeId, readonly PipelineNodeId[]>,
): readonly PipelineNodeId[] {
    const remaining = new Map<PipelineNodeId, number>(
        nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]),
    );
    const queue = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
    const order: PipelineNodeId[] = [];

    while (queue.length > 0) {
        const nodeId = queue.shift();
        if (nodeId === undefined) continue;
        order.push(nodeId);

        for (const targetId of outgoing.get(nodeId) ?? []) {
            const count = (remaining.get(targetId) ?? 1) - 1;
            remaining.set(targetId, count);
            if (count === 0) queue.push(targetId);
        }
    }

    return order;
}

interface StronglyConnectedComponents {
    readonly componentByNode: ReadonlyMap<PipelineNodeId, number>;
    readonly componentSizes: readonly number[];
}

interface DepthFirstSearchFrame {
    readonly nodeId: PipelineNodeId;
    nextNeighborIndex: number;
}

function stronglyConnectedComponents(
    nodes: readonly PipelineNode[],
    outgoing: ReadonlyMap<PipelineNodeId, readonly PipelineNodeId[]>,
): StronglyConnectedComponents {
    const nodeIds = nodes.map((node) => node.id);
    const reverse = new Map<PipelineNodeId, PipelineNodeId[]>(
        nodeIds.map((nodeId) => [nodeId, []]),
    );

    for (const sourceId of nodeIds) {
        for (const targetId of outgoing.get(sourceId) ?? []) {
            reverse.get(targetId)?.push(sourceId);
        }
    }

    const visited = new Set<PipelineNodeId>();
    const finishOrder: PipelineNodeId[] = [];
    for (const startId of nodeIds) {
        if (visited.has(startId)) continue;

        visited.add(startId);
        const stack: DepthFirstSearchFrame[] = [{ nodeId: startId, nextNeighborIndex: 0 }];
        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            if (frame === undefined) break;

            const neighborId = (outgoing.get(frame.nodeId) ?? [])[frame.nextNeighborIndex];
            if (neighborId === undefined) {
                finishOrder.push(frame.nodeId);
                stack.pop();
                continue;
            }

            frame.nextNeighborIndex += 1;
            if (visited.has(neighborId)) continue;

            visited.add(neighborId);
            stack.push({ nodeId: neighborId, nextNeighborIndex: 0 });
        }
    }

    const componentByNode = new Map<PipelineNodeId, number>();
    const componentSizes: number[] = [];
    for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
        const startId = finishOrder[index];
        if (startId === undefined || componentByNode.has(startId)) continue;

        const componentId = componentSizes.length;
        componentByNode.set(startId, componentId);
        const stack: PipelineNodeId[] = [startId];
        let componentSize = 0;

        while (stack.length > 0) {
            const nodeId = stack.pop();
            if (nodeId === undefined) continue;
            componentSize += 1;

            for (const sourceId of reverse.get(nodeId) ?? []) {
                if (componentByNode.has(sourceId)) continue;
                componentByNode.set(sourceId, componentId);
                stack.push(sourceId);
            }
        }

        componentSizes.push(componentSize);
    }

    return { componentByNode, componentSizes };
}

function cyclicEdges(
    edges: readonly PipelineEdge[],
    nodes: readonly PipelineNode[],
    outgoing: ReadonlyMap<PipelineNodeId, readonly PipelineNodeId[]>,
): readonly PipelineEdge[] {
    const { componentByNode, componentSizes } = stronglyConnectedComponents(nodes, outgoing);

    return edges.filter((edge) => {
        if (!componentByNode.has(edge.source) || !componentByNode.has(edge.target)) {
            return false;
        }
        if (edge.source === edge.target) return true;

        const sourceComponent = componentByNode.get(edge.source);
        const targetComponent = componentByNode.get(edge.target);
        return (
            sourceComponent !== undefined &&
            sourceComponent === targetComponent &&
            (componentSizes[sourceComponent] ?? 0) > 1
        );
    });
}

function reachableFrom(
    seeds: readonly PipelineNodeId[],
    outgoing: ReadonlyMap<PipelineNodeId, readonly PipelineNodeId[]>,
): ReadonlySet<PipelineNodeId> {
    const reachable = new Set<PipelineNodeId>();
    const queue = [...seeds];

    while (queue.length > 0) {
        const nodeId = queue.shift();
        if (nodeId === undefined || reachable.has(nodeId)) continue;
        reachable.add(nodeId);
        queue.push(...(outgoing.get(nodeId) ?? []));
    }

    return reachable;
}

export function validateWorkflowTopology(
    document: WorkflowDocument,
    options: WorkflowTopologyOptions = {},
): WorkflowTopologyResult {
    if (document.nodes.length === 0) {
        return {
            ok: false,
            diagnostics: [
                pipelineDiagnostic(
                    'empty_pipeline',
                    'Workflow has no Nodes; add exactly one Trigger and connect its work to downstream Nodes before saving.',
                ),
            ],
        };
    }

    const diagnostics: TopologyDiagnostic[] = [];
    const nodeById = new Map<PipelineNodeId, PipelineNode>();
    for (const node of document.nodes) {
        if (nodeById.has(node.id)) {
            appendUnique(
                diagnostics,
                nodeDiagnostic(
                    'duplicate_node_id',
                    node.id,
                    `Node "${node.id}" appears more than once; give every Node a unique id before saving.`,
                ),
            );
            continue;
        }
        nodeById.set(node.id, node);
    }

    const nodes = [...nodeById.values()];
    const contractRegistry = options.contractRegistry ?? createBuiltinNodeContractRegistry();
    const contractResolutions = new Map(
        nodes.map((node) => [node.id, resolveNodeContract(node, contractRegistry)] as const),
    );
    for (const node of nodes) {
        const resolution = contractResolutions.get(node.id);
        if (!resolution) continue;
        if (resolution.status === 'unavailable' && options.requireNodeContracts) {
            appendUnique(diagnostics, {
                severity: 'error',
                code: 'unavailable_node_contract',
                target: { kind: 'node', nodeId: node.id },
                nodeId: node.id,
                message:
                    `Node "${node.id}" (${formatNodeIdentity(resolution.identity)}) has no registered ` +
                    'Node Contract; load the Plugin that declares it before running the Workflow.',
                repairHint:
                    'Load the Plugin contract or remove the unavailable Plugin Node from the Workflow.',
            });
        }
        if (resolution.status === 'invalid') {
            appendInvalidContractDiagnostics(diagnostics, node, resolution);
        }
    }

    const incoming = new Map<PipelineNodeId, PipelineEdgeId[]>();
    const outgoing = new Map<PipelineNodeId, PipelineNodeId[]>();
    for (const node of nodeById.values()) {
        incoming.set(node.id, []);
        outgoing.set(node.id, []);
    }

    const edgeIds = new Set<PipelineEdgeId>();
    for (const edge of document.edges) {
        if (edgeIds.has(edge.id)) {
            appendUnique(
                diagnostics,
                edgeDiagnostic(
                    'duplicate_edge_id',
                    edge.id,
                    `Edge "${edge.id}" appears more than once; give every Edge a unique id before saving.`,
                ),
            );
        }
        edgeIds.add(edge.id);

        const sourceNode = nodeById.get(edge.source);
        const targetNode = nodeById.get(edge.target);
        if (!sourceNode || !targetNode) {
            appendUnique(
                diagnostics,
                edgeDiagnostic(
                    'invalid_edge',
                    edge.id,
                    `Edge "${edge.id}" must reference existing source and target Nodes; repair the missing connection before saving.`,
                ),
            );
            continue;
        }

        const sourceResolution = contractResolutions.get(sourceNode.id);
        if (!sourceResolution) continue;
        const outputPorts = outputPortsForResolution(sourceResolution);
        if (outputPorts !== 'dynamic' && !outputPorts.includes(edge.sourcePort)) {
            appendUnique(
                diagnostics,
                edgeDiagnostic(
                    'invalid_output_port',
                    edge.id,
                    `Edge "${edge.id}" uses output port "${edge.sourcePort}" on Node "${sourceNode.id}", but that Node exposes ${outputPorts.join(', ') || 'no'}; reconnect the Edge to a declared output port.`,
                    sourceNode.id,
                ),
            );
        }

        incoming.get(targetNode.id)?.push(edge.id);
        outgoing.get(sourceNode.id)?.push(targetNode.id);
    }

    if (options.isNodeSupported) {
        for (const node of nodes) {
            if (!options.isNodeSupported(node)) {
                appendUnique(
                    diagnostics,
                    nodeDiagnostic(
                        'unsupported_node_handler',
                        node.id,
                        `Node "${node.id}" (${node.type}) has no registered handler; install or enable its Node Plugin before saving or running the Workflow.`,
                    ),
                );
            }
        }
    }

    const triggers = nodes.filter((node) => {
        const resolution = contractResolutions.get(node.id);
        return resolution?.status === 'available' && resolution.contract.role === 'trigger';
    });
    const roots = nodes.filter((node) => (incoming.get(node.id)?.length ?? 0) === 0);

    if (triggers.length === 0) {
        appendUnique(
            diagnostics,
            pipelineDiagnostic(
                'missing_trigger',
                'Workflow must have exactly one Trigger root; add a Manual Trigger or File Watcher as the starting Node.',
            ),
        );
    } else if (triggers.length > 1) {
        appendUnique(
            diagnostics,
            pipelineDiagnostic(
                'multiple_triggers',
                `Workflow has multiple Trigger Nodes (${triggers.map((node) => node.id).join(', ')}); keep one Trigger root and remove or connect the others.`,
            ),
        );
    }

    if (roots.length > 1) {
        appendUnique(
            diagnostics,
            pipelineDiagnostic(
                'multiple_roots',
                `Workflow has multiple root Nodes (${roots.map((node) => node.id).join(', ')}); connect every Node beneath one Trigger root.`,
            ),
        );
    }

    for (const root of roots) {
        if (!triggers.some((triggerNode) => triggerNode.id === root.id)) {
            appendUnique(
                diagnostics,
                nodeDiagnostic(
                    'unsupported_root',
                    root.id,
                    `Node "${root.id}" (${root.type}) is an unsupported root; replace it with a Trigger or connect it downstream of the Trigger.`,
                ),
            );
        }
    }

    if (triggers.length === 1 && roots.length === 1 && roots[0]?.id !== triggers[0]?.id) {
        const trigger = triggers[0];
        if (trigger) {
            appendUnique(
                diagnostics,
                nodeDiagnostic(
                    'trigger_not_root',
                    trigger.id,
                    `Trigger Node "${trigger.id}" has an incoming Edge; remove that Edge so the Trigger is the sole root.`,
                ),
            );
        }
    }

    for (const node of nodes) {
        const incomingEdges = incoming.get(node.id) ?? [];
        if (incomingEdges.length > 1) {
            appendUnique(
                diagnostics,
                nodeDiagnostic(
                    'implicit_join',
                    node.id,
                    `Node "${node.id}" has multiple incoming Edges (${incomingEdges.join(', ')}); implicit joins can merge arbitrary Workflow Contexts, so remove all but one incoming Edge.`,
                ),
            );
        }
    }

    const executionOrder = stableExecutionOrder(nodes, incoming, outgoing);
    if (executionOrder.length !== nodes.length) {
        const cycleEdges = cyclicEdges(document.edges, nodes, outgoing);

        if (cycleEdges.length === 0) {
            appendUnique(
                diagnostics,
                pipelineDiagnostic(
                    'cycle',
                    'Workflow contains a cycle; remove a connection so every Node can be reached in a finite order.',
                ),
            );
        } else {
            for (const edge of cycleEdges) {
                appendUnique(
                    diagnostics,
                    edgeDiagnostic(
                        'cycle',
                        edge.id,
                        edge.source === edge.target
                            ? `Edge "${edge.id}" is a self-loop on Node "${edge.source}"; remove the Edge to make the Workflow acyclic.`
                            : `Edge "${edge.id}" participates in a cycle; remove the Edge or reconnect it to a downstream Node.`,
                        edge.source,
                    ),
                );
            }
        }
    }

    if (triggers.length > 0) {
        const reachable = reachableFrom(
            triggers.map((node) => node.id),
            outgoing,
        );
        for (const node of nodes) {
            if (!reachable.has(node.id)) {
                appendUnique(
                    diagnostics,
                    nodeDiagnostic(
                        'disconnected_node',
                        node.id,
                        `Node "${node.id}" is not reachable from a Trigger; connect it to the Trigger-rooted Workflow or remove it.`,
                    ),
                );
            }
        }
    }

    if (diagnostics.length > 0) {
        return { ok: false, diagnostics };
    }

    const trigger = triggers[0];
    if (!trigger) {
        return {
            ok: false,
            diagnostics: [
                pipelineDiagnostic(
                    'missing_trigger',
                    'Workflow must have exactly one Trigger root; add a Manual Trigger or File Watcher as the starting Node.',
                ),
            ],
        };
    }

    return {
        ok: true,
        value: {
            triggerId: trigger.id,
            executionOrder,
            admittedNodeContracts: nodes.flatMap((node) => {
                const resolution = contractResolutions.get(node.id);
                if (resolution?.status !== 'available') return [];
                return [
                    {
                        nodeId: node.id,
                        identity: resolution.identity,
                        version: resolution.contract.version,
                        role: resolution.contract.role,
                        outputPorts: resolution.outputPorts,
                    },
                ];
            }),
        },
    };
}

export function formatTopologyDiagnostics(diagnostics: readonly TopologyDiagnostic[]): string {
    return diagnostics
        .map((diagnostic) => {
            const field = diagnostic.fieldPath ? ` (${diagnostic.fieldPath})` : '';
            const repair = diagnostic.repairHint ? ` Repair: ${diagnostic.repairHint}` : '';
            return `[${diagnostic.code}]${field} ${diagnostic.message}${repair}`;
        })
        .join('\n');
}
