import { z } from 'zod';
import {
    BUILTIN_NODE_CONTRACT_REGISTRY,
    formatNodeIdentity,
    type NodeContractRegistry,
    type NodeContractResolution,
    resolveNodeContract,
} from './node-contract.js';
import {
    isPluginNode,
    type PipelineNode,
    SWITCH_DIAGNOSTIC_CODES,
    validateSwitchConfig,
} from './nodes/index.js';
import { SwitchConfigSchema } from './nodes/switch.js';
import type { CompiledPipeline } from './pipeline.js';

const TOPOLOGY_DIAGNOSTIC_CODES = [
    'invalid_pipeline',
    'unsupported_schema_version',
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
    z.object({ kind: z.literal('pipeline') }),
    z.object({ kind: z.literal('node'), nodeId: z.string().min(1) }),
    z.object({ kind: z.literal('edge'), edgeId: z.string().min(1) }),
]);

export const TopologyDiagnosticSchema = z
    .object({
        severity: TopologyDiagnosticSeveritySchema,
        code: TopologyDiagnosticCodeSchema,
        target: TopologyDiagnosticTargetSchema,
        nodeId: z.string().min(1).optional(),
        edgeId: z.string().min(1).optional(),
        caseId: z.string().min(1).optional(),
        fieldPath: z.string().min(1).optional(),
        message: z.string().min(1),
        repairHint: z.string().min(1).optional(),
    })
    .readonly();

export type TopologyDiagnostic = z.infer<typeof TopologyDiagnosticSchema>;

export type TopologyOutputPorts = readonly string[] | 'dynamic';

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

export interface ExecutableWorkflow {
    readonly pipeline: CompiledPipeline;
    readonly triggerId: string;
    readonly executionOrder: readonly string[];
}

export type WorkflowTopologyResult =
    | { readonly ok: true; readonly value: ExecutableWorkflow }
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
    nodeId: string,
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
    edgeId: string,
    message: string,
    nodeId?: string,
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
        appendUnique(diagnostics, {
            severity: 'error',
            code: 'invalid_node_contract',
            target: { kind: 'node', nodeId: node.id },
            nodeId: node.id,
            fieldPath: contractIssueFieldPath(issue.path),
            message:
                `Node "${node.id}" (${formatNodeIdentity(resolution.identity)}) has invalid ` +
                `configuration for its output-port contract: ${issue.message}`,
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
    incoming: ReadonlyMap<string, readonly string[]>,
    outgoing: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
    const remaining = new Map<string, number>(
        nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]),
    );
    const queue = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
    const order: string[] = [];

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

function reachableFrom(
    seeds: readonly string[],
    outgoing: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
    const reachable = new Set<string>();
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
    pipeline: CompiledPipeline,
    options: WorkflowTopologyOptions = {},
): WorkflowTopologyResult {
    if (pipeline.nodes.length === 0) {
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
    const nodeById = new Map<string, PipelineNode>();
    for (const node of pipeline.nodes) {
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
    const contractRegistry = options.contractRegistry ?? BUILTIN_NODE_CONTRACT_REGISTRY;
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
        if (!isPluginNode(node) && node.type === 'switch') {
            const parsedConfig = SwitchConfigSchema.safeParse(node.config);
            if (!parsedConfig.success) {
                if (resolution.status === 'invalid') {
                    appendInvalidContractDiagnostics(diagnostics, node, resolution);
                }
                continue;
            }

            for (const diagnostic of validateSwitchConfig(parsedConfig.data)) {
                const fieldPath =
                    diagnostic.code === 'duplicate_case_id' ||
                    diagnostic.code === 'reserved_case_id'
                        ? `config.cases[${diagnostic.caseIndex}].id`
                        : `config.cases[${diagnostic.caseIndex}].value`;
                appendUnique(diagnostics, {
                    severity: 'error',
                    code: diagnostic.code,
                    target: { kind: 'node', nodeId: node.id },
                    nodeId: node.id,
                    caseId: diagnostic.caseId,
                    fieldPath,
                    message: diagnostic.message,
                    repairHint: diagnostic.repairHint,
                });
            }
            continue;
        }

        if (resolution.status === 'invalid') {
            appendInvalidContractDiagnostics(diagnostics, node, resolution);
        }
    }

    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    for (const node of nodeById.values()) {
        incoming.set(node.id, []);
        outgoing.set(node.id, []);
    }

    const edgeIds = new Set<string>();
    for (const edge of pipeline.edges) {
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
        const ordered = new Set(executionOrder);
        const cycleEdges = pipeline.edges.filter(
            (edge) =>
                nodeById.has(edge.source) &&
                nodeById.has(edge.target) &&
                !ordered.has(edge.source) &&
                !ordered.has(edge.target),
        );

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
            pipeline,
            triggerId: trigger.id,
            executionOrder,
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
