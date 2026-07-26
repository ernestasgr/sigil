import type { NodeContractRegistration } from '../node-contract.js';
import { DelayContractRegistration, DelayDescriptor } from './delay.js';
import { FileManagerContractRegistration, FileManagerDescriptor } from './file-manager.js';
import { FileWatcherContractRegistration, FileWatcherDescriptor } from './file-watcher.js';
import { IfElseContractRegistration, IfElseDescriptor } from './if-else.js';
import { LogContractRegistration, LogDescriptor } from './log.js';
import { ManualTriggerContractRegistration, ManualTriggerDescriptor } from './manual-trigger.js';
import { NotificationContractRegistration, NotificationDescriptor } from './notification.js';
import { StateGetContractRegistration, StateGetDescriptor } from './state-get.js';
import { StateSetContractRegistration, StateSetDescriptor } from './state-set.js';
import { SwitchContractRegistration, SwitchDescriptor } from './switch.js';

export const BUILTIN_NODE_TYPE_VALUES = [
    'file-watcher',
    'manual-trigger',
    'if-else',
    'switch',
    'file-manager',
    'notification',
    'log',
    'delay',
    'state-get',
    'state-set',
] as const;

export type NodeType = (typeof BUILTIN_NODE_TYPE_VALUES)[number];

export const BUILTIN_NODE_DESCRIPTORS = {
    'file-watcher': FileWatcherDescriptor,
    'manual-trigger': ManualTriggerDescriptor,
    'if-else': IfElseDescriptor,
    switch: SwitchDescriptor,
    'file-manager': FileManagerDescriptor,
    notification: NotificationDescriptor,
    log: LogDescriptor,
    delay: DelayDescriptor,
    'state-get': StateGetDescriptor,
    'state-set': StateSetDescriptor,
} as const satisfies { readonly [K in NodeType]: { readonly type: K } };

export const BUILTIN_NODE_CONTRACT_REGISTRATIONS: readonly NodeContractRegistration[] = [
    FileWatcherContractRegistration,
    ManualTriggerContractRegistration,
    IfElseContractRegistration,
    SwitchContractRegistration,
    FileManagerContractRegistration,
    NotificationContractRegistration,
    StateGetContractRegistration,
    StateSetContractRegistration,
    LogContractRegistration,
    DelayContractRegistration,
];
