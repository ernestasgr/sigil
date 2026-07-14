/**
 * Compatibility facade for older Builder imports.
 *
 * Node authoring data has one source of truth in node-catalog.ts. Keeping
 * these re-exports avoids making every caller move in the same change while
 * preventing a second metadata registry from growing here.
 */

export type {
    BuilderNodeSpec,
    BuiltinNodeCatalogEntry,
    BuiltinNodeSpec,
    CategoryMeta,
    NodeCatalog,
    NodeCatalogEntry,
    NodeCategory,
    NodeConfigForm,
    NodeConfigValidation,
    NodeSpec,
    NodeType,
    NodeTypeDef,
    PluginNodeCatalogAdapter,
    PluginNodeCatalogEntry,
    PluginNodeSpec,
    ResolvedNodeCatalogEntry,
} from './node-catalog.js';
export {
    BUILTIN_NODE_CATALOG,
    BUILTIN_PLUGIN_NODE_CATALOG,
    CATEGORIES,
    CATEGORY_TEXT,
    CATEGORY_TOP_ACCENT,
    createNodeCatalog,
    createNodeConfigForm,
    createPluginNodeCatalogEntry,
    defaultNodeSpec,
    defaultNodeSpecForCatalogEntry,
    isNodeType,
    isPluginNodeSpec,
    NODE_TYPES,
    nodeOutputPortLabel,
    nodeOutputPorts,
    nodeSpecData,
    nodeSpecWithConfig,
    nodeTypeDef,
    pipelineNodeToSpec,
    resolveNodeCatalogEntry,
} from './node-catalog.js';
