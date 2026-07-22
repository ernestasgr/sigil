import { describe, expect, it } from 'vitest';

import { compileGraph } from './compile.js';
import {
    createNodeCatalog,
    createNodeCatalogFromManifests,
    createPluginNodeCatalogEntry,
} from './node-catalog.js';

describe('compileGraph', () => {
    it('rejects an empty graph with a structured topology diagnostic', () => {
        const result = compileGraph([], [], { id: 'pipeline-1', workflowId: 'workflow-1' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'empty_pipeline',
                        target: { kind: 'pipeline' },
                    }),
                ]),
            );
        }
    });

    it('compiles a manual-trigger -> log graph with an out port edge', () => {
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/dl/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/dl',
                        },
                    },
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'hi' } } },
        ];
        const edges = [{ id: 'e1', source: 'trigger', target: 'log', sourceHandle: 'out' }];

        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.nodes).toHaveLength(2);
            expect(result.value.edges).toEqual([
                { id: 'e1', source: 'trigger', target: 'log', sourcePort: 'out' },
            ]);
            expect(result.executable.triggerId).toBe('trigger');
        }
    });

    it('maps the sourceHandle to sourcePort for an if-else true branch', () => {
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/dl/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/dl',
                        },
                    },
                },
            },
            {
                id: 'branch',
                data: {
                    type: 'if-else',
                    config: {
                        condition: {
                            target: 'payload',
                            field: 'ext',
                            operator: 'equals',
                            value: 'pdf',
                        },
                    },
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'x' } } },
        ];
        const edges = [
            { id: 'e0', source: 'trigger', target: 'branch', sourceHandle: 'out' },
            { id: 'e1', source: 'branch', target: 'log', sourceHandle: 'true' },
        ];

        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.edges[1].sourcePort).toBe('true');
        }
    });

    it('returns a clear error when a config is invalid', () => {
        const nodes = [{ id: 'log', data: { type: 'log', config: { message: '' } } }];

        const result = compileGraph(nodes, [], { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/message/);
        }
    });

    it('returns a clear error when an edge uses an invalid source port', () => {
        const nodes = [
            { id: 'log', data: { type: 'log', config: { message: 'x' } } },
            { id: 'log2', data: { type: 'log', config: { message: 'y' } } },
        ];
        const edges = [{ id: 'e1', source: 'log', target: 'log2', sourceHandle: 'bogus' }];

        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toMatch(/invalid sourcePort "bogus"/);
        }
    });

    it('drops edges with a null sourceHandle rather than failing to compile', () => {
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/dl/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/dl',
                        },
                    },
                },
            },
        ];

        const result = compileGraph(
            nodes,
            [{ id: 'e1', source: 'trigger', target: 'trigger', sourceHandle: null }],
            { id: 'p', workflowId: 'w' },
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.edges).toEqual([]);
            expect(result.diagnostics).toEqual([
                expect.objectContaining({
                    severity: 'warning',
                    code: 'invalid_edge',
                    target: { kind: 'edge', edgeId: 'e1' },
                }),
            ]);
            expect(result.diagnostics[0]?.message).toMatch(/reconnect/i);
        }
    });

    it('round-trips a plugin trigger node with pluginId preserved', () => {
        const nodes = [
            {
                id: 'plugin-trigger',
                data: {
                    type: 'tick-trigger',
                    pluginId: 'com.example.tick',
                    config: {},
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'hi' } } },
        ];
        const edges = [{ id: 'e1', source: 'plugin-trigger', target: 'log', sourceHandle: 'out' }];

        const nodeCatalog = createNodeCatalogFromManifests([
            {
                id: 'com.example.tick',
                nodeType: 'tick-trigger',
                nodeContract: {
                    identity: {
                        namespace: 'plugin',
                        pluginId: 'com.example.tick',
                        type: 'tick-trigger',
                    },
                    version: 1,
                    role: 'trigger',
                    defaultConfig: {},
                    outputPorts: {
                        kind: 'fixed',
                        ports: [{ id: 'out', label: 'Output' }],
                    },
                    display: {
                        label: 'Tick Trigger',
                        description: 'Starts a Workflow on a tick.',
                        category: 'trigger',
                    },
                },
            },
        ]);
        const result = compileGraph(nodes, edges, { id: 'p', workflowId: 'w' }, { nodeCatalog });

        expect(result.ok).toBe(true);
        if (result.ok) {
            const pluginNode = result.value.nodes.find((n) => n.id === 'plugin-trigger');
            expect(pluginNode).toBeDefined();
            if (pluginNode && 'pluginId' in pluginNode) {
                expect(pluginNode.pluginId).toBe('com.example.tick');
            }
        }
    });

    it('compiles a bundled Plugin Node as a trigger through its manifest contract', () => {
        const nodes = [
            {
                id: 'file-trigger',
                data: {
                    type: 'file-watcher',
                    pluginId: 'com.sigil.file-watcher',
                    config: {
                        path: '/tmp',
                        recursive: true,
                        events: ['file.created'],
                    },
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'hi' } } },
        ];

        const nodeCatalog = createNodeCatalogFromManifests([
            {
                id: 'com.sigil.file-watcher',
                nodeType: 'file-watcher',
                nodeContract: {
                    identity: {
                        namespace: 'plugin',
                        pluginId: 'com.sigil.file-watcher',
                        type: 'file-watcher',
                    },
                    version: 1,
                    role: 'trigger',
                    defaultConfig: {
                        path: '/',
                        recursive: true,
                        events: ['file.created'],
                    },
                    outputPorts: {
                        kind: 'fixed',
                        ports: [{ id: 'out', label: 'Output' }],
                    },
                    display: {
                        label: 'File Watcher',
                        description: 'Watches a path for file events.',
                        category: 'trigger',
                    },
                },
            },
        ]);
        const result = compileGraph(
            nodes,
            [{ id: 'e1', source: 'file-trigger', target: 'log', sourceHandle: 'out' }],
            { id: 'p', workflowId: 'w' },
            { nodeCatalog },
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.executable.triggerId).toBe('file-trigger');
            expect(result.value.nodes[0]).toMatchObject({
                id: 'file-trigger',
                type: 'file-watcher',
                pluginId: 'com.sigil.file-watcher',
            });
            expect(result.diagnostics).toEqual([]);
        }
    });

    it('round-trips an unsupported Plugin Node with an explicit read-only diagnostic', () => {
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/tmp/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/tmp',
                        },
                    },
                },
            },
            {
                id: 'plugin-action',
                data: {
                    type: 'third-party.action',
                    pluginId: 'com.example.third-party',
                    config: { destination: '/tmp' },
                },
            },
        ];

        const result = compileGraph(
            nodes,
            [{ id: 'e1', source: 'trigger', target: 'plugin-action', sourceHandle: 'out' }],
            { id: 'p', workflowId: 'w' },
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.nodes[1]).toMatchObject({
                type: 'third-party.action',
                pluginId: 'com.example.third-party',
                config: { destination: '/tmp' },
            });
            expect(result.diagnostics).toEqual([
                expect.objectContaining({
                    severity: 'warning',
                    code: 'unsupported_plugin_authoring',
                    nodeId: 'plugin-action',
                }),
            ]);
        }
    });

    it('does not infer a Plugin trigger or ports from an adapter without a contract', () => {
        const nodes = [
            {
                id: 'plugin-trigger',
                data: {
                    type: 'tick-trigger',
                    pluginId: 'com.example.tick',
                    config: {},
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'hi' } } },
        ];
        const edges = [{ id: 'e1', source: 'plugin-trigger', target: 'log', sourceHandle: 'out' }];

        const adapter = createPluginNodeCatalogEntry({
            pluginId: 'com.example.tick',
            type: 'tick-trigger',
            label: 'Tick Trigger',
            category: 'trigger',
            description: 'Starts a Workflow on a tick.',
            defaultConfig: {},
            isTrigger: true,
            outputPorts: () => ['out'],
        });
        const result = compileGraph(
            nodes,
            edges,
            { id: 'p', workflowId: 'w' },
            { nodeCatalog: createNodeCatalog([adapter]) },
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ code: 'missing_trigger' }),
                    expect.objectContaining({
                        code: 'invalid_output_port',
                        edgeId: 'e1',
                        nodeId: 'plugin-trigger',
                    }),
                ]),
            );
        }
    });

    it('reports missing_trigger for a plugin trigger without topology options', () => {
        const nodes = [
            {
                id: 'plugin-trigger',
                data: {
                    type: 'tick-trigger',
                    pluginId: 'com.example.tick',
                    config: {},
                },
            },
        ];

        const result = compileGraph(nodes, [], { id: 'p', workflowId: 'w' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.diagnostics).toEqual(
                expect.arrayContaining([expect.objectContaining({ code: 'missing_trigger' })]),
            );
        }
    });

    it('keeps compiler and topology admission in parity for derived Plugin ports', () => {
        const nodeCatalog = createNodeCatalogFromManifests([
            {
                id: 'com.example.router',
                nodeType: 'router-node',
                nodeContract: {
                    identity: {
                        namespace: 'plugin',
                        pluginId: 'com.example.router',
                        type: 'router-node',
                    },
                    version: 1,
                    role: 'action',
                    defaultConfig: {
                        target: 'event',
                        cases: [{ id: 'ready', value: 'ready' }],
                    },
                    outputPorts: {
                        kind: 'config-derived',
                        strategy: 'switch-cases',
                        defaultPort: { id: 'default', label: 'Fallback' },
                    },
                    display: {
                        label: 'Router Node',
                        description: 'Routes by event name.',
                        category: 'logic',
                    },
                },
            },
        ]);
        const nodes = [
            {
                id: 'trigger',
                data: {
                    type: 'manual-trigger',
                    config: {
                        eventName: 'file.created',
                        payload: {
                            path: '/tmp/a.txt',
                            name: 'a.txt',
                            ext: 'txt',
                            size: 1,
                            dir: '/tmp',
                        },
                    },
                },
            },
            {
                id: 'router',
                data: {
                    type: 'router-node',
                    pluginId: 'com.example.router',
                    config: {
                        target: 'event',
                        cases: [
                            { id: 'ready', value: 'ready' },
                            { id: 'failed', value: 'failed' },
                        ],
                    },
                },
            },
            { id: 'log', data: { type: 'log', config: { message: 'done' } } },
        ];
        const edges = [
            { id: 'trigger-router', source: 'trigger', target: 'router', sourceHandle: 'out' },
            { id: 'router-log', source: 'router', target: 'log', sourceHandle: 'failed' },
        ];

        const valid = compileGraph(
            nodes,
            edges,
            { id: 'derived-pipeline', workflowId: 'derived-workflow' },
            { nodeCatalog },
        );
        expect(valid.ok).toBe(true);

        const changed = compileGraph(
            nodes.map((node) =>
                node.id === 'router'
                    ? {
                          ...node,
                          data: {
                              ...node.data,
                              config: {
                                  target: 'event',
                                  cases: [{ id: 'cancelled', value: 'cancelled' }],
                              },
                          },
                      }
                    : node,
            ),
            edges,
            { id: 'derived-pipeline-changed', workflowId: 'derived-workflow' },
            { nodeCatalog },
        );
        expect(changed.ok).toBe(false);
        if (!changed.ok) {
            expect(changed.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'invalid_output_port',
                        edgeId: 'router-log',
                        nodeId: 'router',
                    }),
                ]),
            );
        }
    });
});
