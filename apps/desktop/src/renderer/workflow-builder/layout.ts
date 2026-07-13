import type { NodePosition } from '../../shared/workflow.js';

export interface LayoutNode {
    readonly id: string;
}

export interface LayoutEdge {
    readonly source: string;
    readonly target: string;
}

const LAYOUT_ORIGIN = { x: 40, y: 40 } as const;
const COLUMN_GAP = 280;
const ROW_GAP = 160;
const PALETTE_COLUMNS = 3;

function isFinitePosition(value: unknown): value is NodePosition {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    if (!('x' in value) || !('y' in value)) return false;
    return (
        typeof value.x === 'number' &&
        Number.isFinite(value.x) &&
        typeof value.y === 'number' &&
        Number.isFinite(value.y)
    );
}

function positionKey(position: NodePosition): string {
    return `${position.x}:${position.y}`;
}

function stableNodeIds(nodes: readonly LayoutNode[]): readonly string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        ids.push(node.id);
    }
    return ids;
}

function stableTopologicalOrder(
    nodeIds: readonly string[],
    edges: readonly LayoutEdge[],
): { readonly order: readonly string[]; readonly depth: ReadonlyMap<string, number> } {
    const nodeIndex = new Map(nodeIds.map((id, index) => [id, index]));
    const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
    const incomingCount = new Map(nodeIds.map((id) => [id, 0]));

    for (const edge of edges) {
        if (!nodeIndex.has(edge.source) || !nodeIndex.has(edge.target)) continue;
        outgoing.get(edge.source)?.push(edge.target);
        incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    }

    const depth = new Map(nodeIds.map((id) => [id, 0]));
    const queue = nodeIds.filter((id) => incomingCount.get(id) === 0);
    const order: string[] = [];

    const sortBySourceOrder = (left: string, right: string): number =>
        (nodeIndex.get(left) ?? 0) - (nodeIndex.get(right) ?? 0);

    while (queue.length > 0) {
        queue.sort(sortBySourceOrder);
        const nodeId = queue.shift();
        if (nodeId === undefined) continue;
        order.push(nodeId);

        for (const target of outgoing.get(nodeId) ?? []) {
            depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(nodeId) ?? 0) + 1));
            const remaining = (incomingCount.get(target) ?? 1) - 1;
            incomingCount.set(target, remaining);
            if (remaining === 0) queue.push(target);
        }
    }

    // A partially authored Workflow can contain a cycle. Keep the fallback
    // readable and deterministic by appending the unresolved Nodes in source
    // order after the valid topology rather than placing them all at origin.
    const unresolved = nodeIds.filter((id) => !order.includes(id));
    let nextDepth = Math.max(0, ...depth.values()) + 1;
    for (const nodeId of unresolved) {
        order.push(nodeId);
        depth.set(nodeId, nextDepth);
        nextDepth += 1;
    }

    return { order, depth };
}

function fallbackPositions(
    nodeIds: readonly string[],
    edges: readonly LayoutEdge[],
): ReadonlyMap<string, NodePosition> {
    const { order, depth } = stableTopologicalOrder(nodeIds, edges);
    const groups = new Map<number, string[]>();
    for (const nodeId of order) {
        const level = depth.get(nodeId) ?? 0;
        const group = groups.get(level) ?? [];
        group.push(nodeId);
        groups.set(level, group);
    }

    const positions = new Map<string, NodePosition>();
    for (const [level, group] of groups) {
        group.forEach((nodeId, row) => {
            positions.set(nodeId, {
                x: LAYOUT_ORIGIN.x + level * COLUMN_GAP,
                y: LAYOUT_ORIGIN.y + row * ROW_GAP,
            });
        });
    }
    return positions;
}

/**
 * Keep valid persisted positions and fill missing or malformed positions from
 * the Workflow topology. The result is stable for the same Node and Edge
 * ordering, including while an invalid draft is being repaired.
 */
export function resolveWorkflowPositions(
    nodes: readonly LayoutNode[],
    edges: readonly LayoutEdge[],
    persisted?: Readonly<Record<string, NodePosition>>,
): Readonly<Record<string, NodePosition>> {
    const nodeIds = stableNodeIds(nodes);
    const fallback = fallbackPositions(nodeIds, edges);
    const resolved: Record<string, NodePosition> = {};
    const occupied = new Set<string>();

    for (const nodeId of nodeIds) {
        const saved = persisted?.[nodeId];
        if (!isFinitePosition(saved)) continue;
        const position = { x: saved.x, y: saved.y };
        resolved[nodeId] = position;
        occupied.add(positionKey(position));
    }

    for (const nodeId of nodeIds) {
        if (resolved[nodeId]) continue;
        const fallbackPosition = fallback.get(nodeId) ?? LAYOUT_ORIGIN;
        let position = fallbackPosition;
        while (occupied.has(positionKey(position))) {
            position = { x: position.x, y: position.y + ROW_GAP };
        }
        resolved[nodeId] = position;
        occupied.add(positionKey(position));
    }

    return resolved;
}

/** Return the next readable grid position used by keyboard palette authoring. */
export function nextPaletteNodePosition(
    nodes: readonly { readonly position: NodePosition }[],
): NodePosition {
    const occupied = new Set(
        nodes
            .filter((node) => isFinitePosition(node.position))
            .map((node) => positionKey(node.position)),
    );
    let index = 0;
    while (true) {
        const position = {
            x: LAYOUT_ORIGIN.x + (index % PALETTE_COLUMNS) * COLUMN_GAP,
            y: LAYOUT_ORIGIN.y + Math.floor(index / PALETTE_COLUMNS) * ROW_GAP,
        };
        if (!occupied.has(positionKey(position))) return position;
        index += 1;
    }
}
