import type {
    DelayConfig,
    FileManagerConfig,
    FileWatcherConfig,
    IfElseConfig,
    LogConfig,
    ManualTriggerConfig,
    NotificationConfig,
    StateGetConfig,
    StateSetConfig,
    SwitchConfig,
} from '@sigil/schema/nodes';
import type { FileEventPayload } from '@sigil/schema/file-event-payload';
import type { PipelineCondition } from '@sigil/schema/conditions';
import {
    BooleanOperatorSchema,
    type BooleanOperator,
    type NumberOperator,
    NumberOperatorSchema,
    type StringOperator,
    StringOperatorSchema,
} from '@sigil/schema/operators';
import type { ReactElement } from 'react';

import { Button } from '../../components/ui/button.js';
import { useSigil } from '../../lib/sigil-context.js';
import { Checkbox, NumberInput, SelectInput, StringList, TextInput } from './form-fields.js';

type FieldValueKind = 'string' | 'number' | 'boolean';

const EVENT_NAME_OPTIONS: {
    readonly value: ManualTriggerConfig['eventName'];
    readonly label: string;
}[] = [
    { value: 'file.created', label: 'file.created' },
    { value: 'file.modified', label: 'file.modified' },
    { value: 'file.deleted', label: 'file.deleted' },
];

const TARGET_OPTIONS: { readonly value: 'event' | 'payload' | 'vars'; readonly label: string }[] = [
    { value: 'event', label: 'Event name' },
    { value: 'payload', label: 'Payload field' },
    { value: 'vars', label: 'Variable' },
];

const VALUE_KIND_OPTIONS: { readonly value: FieldValueKind; readonly label: string }[] = [
    { value: 'string', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Boolean' },
];

const STRING_OP_OPTIONS = StringOperatorSchema.options.map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
}));
const NUMBER_OP_OPTIONS = NumberOperatorSchema.options.map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
}));
const BOOLEAN_OP_OPTIONS = BooleanOperatorSchema.options.map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
}));

function valueKindForCondition(condition: FieldCondition): FieldValueKind {
    if (isNumberField(condition)) return 'number';
    if (isBooleanField(condition)) return 'boolean';
    return 'string';
}

export interface ConfigFormProps<T> {
    readonly config: T;
    readonly onChange: (next: T) => void;
}

export function FileWatcherConfigForm({
    config,
    onChange,
}: ConfigFormProps<FileWatcherConfig>): ReactElement {
    const ignorePatterns = config.ignorePatterns ?? [];
    return (
        <>
            <TextInput
                label="Path"
                value={config.path}
                placeholder="/path/to/watch"
                onChange={(path) => onChange({ ...config, path })}
            />
            <Checkbox
                label="Recursive"
                checked={config.recursive}
                onChange={(recursive) => onChange({ ...config, recursive })}
            />
            <div className="flex flex-col gap-1.5">
                <span className="font-ui text-[11px] tracking-widest text-veil uppercase">
                    Events
                </span>
                {EVENT_NAME_OPTIONS.map((option) => (
                    <Checkbox
                        key={option.value}
                        label={option.label}
                        checked={config.events.includes(option.value)}
                        onChange={(checked) => {
                            const events = checked
                                ? [...config.events, option.value]
                                : config.events.filter((event) => event !== option.value);
                            onChange({ ...config, events });
                        }}
                    />
                ))}
            </div>
            <StringList
                label="Ignore patterns"
                values={ignorePatterns}
                placeholder="*.tmp"
                onChange={(next) => onChange({ ...config, ignorePatterns: next })}
            />
        </>
    );
}

export function ManualTriggerConfigForm({
    config,
    onChange,
}: ConfigFormProps<ManualTriggerConfig>): ReactElement {
    const { payload } = config;
    const sigil = useSigil();

    const handleBrowse = async (): Promise<void> => {
        const fileInfo: FileEventPayload | null = await sigil.openFileDialog();
        if (fileInfo) {
            onChange({ ...config, payload: { ...payload, ...fileInfo } });
        }
    };

    return (
        <>
            <SelectInput
                label="Event name"
                value={config.eventName}
                options={EVENT_NAME_OPTIONS}
                onChange={(eventName) => onChange({ ...config, eventName })}
            />
            <div className="flex items-end gap-2">
                <div className="flex-1">
                    <TextInput
                        label="Payload · path"
                        value={payload.path}
                        onChange={(path) => onChange({ ...config, payload: { ...payload, path } })}
                    />
                </div>
                <Button size="sm" variant="default" onClick={handleBrowse}>
                    Browse
                </Button>
            </div>
            <TextInput
                label="Payload · name"
                value={payload.name}
                onChange={(name) => onChange({ ...config, payload: { ...payload, name } })}
            />
            <TextInput
                label="Payload · ext"
                value={payload.ext}
                onChange={(ext) => onChange({ ...config, payload: { ...payload, ext } })}
            />
            <NumberInput
                label="Payload · size"
                value={payload.size}
                min={0}
                onChange={(size) => onChange({ ...config, payload: { ...payload, size } })}
            />
            <TextInput
                label="Payload · dir"
                value={payload.dir}
                onChange={(dir) => onChange({ ...config, payload: { ...payload, dir } })}
            />
        </>
    );
}

export function IfElseConfigForm({
    config,
    onChange,
}: ConfigFormProps<IfElseConfig>): ReactElement {
    return (
        <ConditionForm
            condition={config.condition}
            onChange={(condition) => onChange({ ...config, condition })}
        />
    );
}

function ConditionForm({
    condition,
    onChange,
}: {
    readonly condition: PipelineCondition;
    readonly onChange: (next: PipelineCondition) => void;
}): ReactElement {
    return (
        <>
            <SelectInput
                label="Target"
                value={condition.target}
                options={TARGET_OPTIONS}
                onChange={(target) => {
                    if (target === 'event') {
                        onChange({ target: 'event', operator: 'equals', value: '' });
                    } else {
                        onChange({ target, field: '', operator: 'equals', value: '' });
                    }
                }}
            />
            {condition.target === 'event' ? (
                <>
                    <SelectInput
                        label="Operator"
                        value={condition.operator}
                        options={STRING_OP_OPTIONS}
                        onChange={(operator) => onChange({ ...condition, operator })}
                    />
                    <TextInput
                        label="Value"
                        value={condition.value}
                        placeholder="file.created"
                        onChange={(value) => onChange({ ...condition, value })}
                    />
                </>
            ) : (
                <FieldConditionFields condition={condition} onChange={onChange} />
            )}
        </>
    );
}

type FieldCondition = Extract<PipelineCondition, { target: 'payload' | 'vars' }>;

interface StringFieldCondition {
    readonly target: 'payload' | 'vars';
    readonly field: string;
    readonly operator: StringOperator;
    readonly value: string;
}

interface NumberFieldCondition {
    readonly target: 'payload' | 'vars';
    readonly field: string;
    readonly operator: NumberOperator;
    readonly value: number;
}

interface BooleanFieldCondition {
    readonly target: 'payload' | 'vars';
    readonly field: string;
    readonly operator: BooleanOperator;
    readonly value: boolean;
}

function isStringField(condition: FieldCondition): condition is StringFieldCondition {
    return typeof condition.value === 'string';
}

function isNumberField(condition: FieldCondition): condition is NumberFieldCondition {
    return typeof condition.value === 'number';
}

function isBooleanField(condition: FieldCondition): condition is BooleanFieldCondition {
    return typeof condition.value === 'boolean';
}

function FieldConditionFields({
    condition,
    onChange,
}: {
    readonly condition: FieldCondition;
    readonly onChange: (next: PipelineCondition) => void;
}): ReactElement {
    const valueKind = valueKindForCondition(condition);
    return (
        <>
            <TextInput
                label="Field"
                value={condition.field}
                placeholder="ext"
                onChange={(field) => onChange({ ...condition, field })}
            />
            <SelectInput
                label="Value type"
                value={valueKind}
                options={VALUE_KIND_OPTIONS}
                onChange={(kind) => {
                    if (kind === 'number') {
                        onChange({ ...condition, operator: 'equals', value: 0 });
                    } else if (kind === 'boolean') {
                        onChange({ ...condition, operator: 'equals', value: false });
                    } else {
                        onChange({ ...condition, operator: 'equals', value: '' });
                    }
                }}
            />
            {isStringField(condition) ? (
                <>
                    <SelectInput
                        label="Operator"
                        value={condition.operator}
                        options={STRING_OP_OPTIONS}
                        onChange={(operator) => onChange({ ...condition, operator })}
                    />
                    <TextInput
                        label="Value"
                        value={condition.value}
                        onChange={(value) => onChange({ ...condition, value })}
                    />
                </>
            ) : isNumberField(condition) ? (
                <>
                    <SelectInput
                        label="Operator"
                        value={condition.operator}
                        options={NUMBER_OP_OPTIONS}
                        onChange={(operator) => onChange({ ...condition, operator })}
                    />
                    <NumberInput
                        label="Value"
                        value={condition.value}
                        onChange={(value) => onChange({ ...condition, value })}
                    />
                </>
            ) : isBooleanField(condition) ? (
                <>
                    <SelectInput
                        label="Operator"
                        value={condition.operator}
                        options={BOOLEAN_OP_OPTIONS}
                        onChange={(operator) => onChange({ ...condition, operator })}
                    />
                    <Checkbox
                        label="Value"
                        checked={condition.value}
                        onChange={(value) => onChange({ ...condition, value })}
                    />
                </>
            ) : null}
        </>
    );
}

export function SwitchConfigForm({
    config,
    onChange,
}: ConfigFormProps<SwitchConfig>): ReactElement {
    return (
        <>
            <SelectInput
                label="Target"
                value={config.target}
                options={TARGET_OPTIONS}
                onChange={(target) => {
                    if (target === 'event') {
                        onChange({ target: 'event', cases: config.cases });
                    } else {
                        onChange({
                            target,
                            field: 'field' in config ? config.field : '',
                            cases: config.cases,
                        });
                    }
                }}
            />
            {config.target !== 'event' ? (
                <TextInput
                    label="Field"
                    value={config.field}
                    placeholder="ext"
                    onChange={(field) => onChange({ ...config, field })}
                />
            ) : null}
            <StringList
                label="Cases"
                values={config.cases}
                placeholder="pdf"
                onChange={(cases) => onChange({ ...config, cases })}
            />
        </>
    );
}

export function FileManagerConfigForm({
    config,
    onChange,
}: ConfigFormProps<FileManagerConfig>): ReactElement {
    const ACTION_OPTIONS: {
        readonly value: FileManagerConfig['action'];
        readonly label: string;
    }[] = [
        { value: 'move', label: 'Move' },
        { value: 'rename', label: 'Rename' },
        { value: 'copy', label: 'Copy' },
    ];
    const CONFLICT_OPTIONS: {
        readonly value: FileManagerConfig['onConflict'];
        readonly label: string;
    }[] = [
        { value: 'skip', label: 'Skip' },
        { value: 'overwrite', label: 'Overwrite' },
        { value: 'auto-rename', label: 'Auto-rename' },
        { value: 'error', label: 'Error' },
    ];
    return (
        <>
            <SelectInput
                label="Action"
                value={config.action}
                options={ACTION_OPTIONS}
                onChange={(action) => onChange({ ...config, action })}
            />
            <TextInput
                label="Destination"
                value={config.destination}
                placeholder="/destination/path"
                onChange={(destination) => onChange({ ...config, destination })}
            />
            <SelectInput
                label="On conflict"
                value={config.onConflict}
                options={CONFLICT_OPTIONS}
                onChange={(onConflict) => onChange({ ...config, onConflict })}
            />
        </>
    );
}

export function NotificationConfigForm({
    config,
    onChange,
}: ConfigFormProps<NotificationConfig>): ReactElement {
    return (
        <>
            <TextInput
                label="Title"
                value={config.title}
                onChange={(title) => onChange({ ...config, title })}
            />
            <TextInput
                label="Body"
                value={config.body}
                onChange={(body) => onChange({ ...config, body })}
            />
        </>
    );
}

export function LogConfigForm({ config, onChange }: ConfigFormProps<LogConfig>): ReactElement {
    return (
        <TextInput
            label="Message"
            value={config.message}
            placeholder="{{payload.name}} arrived"
            mono
            onChange={(message) => onChange({ ...config, message })}
        />
    );
}

export function DelayConfigForm({ config, onChange }: ConfigFormProps<DelayConfig>): ReactElement {
    return (
        <NumberInput
            label="Milliseconds"
            value={config.ms}
            min={0}
            onChange={(ms) => onChange({ ...config, ms })}
        />
    );
}

export function StateGetConfigForm({
    config,
    onChange,
}: ConfigFormProps<StateGetConfig>): ReactElement {
    return (
        <>
            <TextInput
                label="State key"
                value={config.key}
                mono
                onChange={(key) => onChange({ ...config, key })}
            />
            <TextInput
                label="Assign to variable"
                value={config.assignTo}
                mono
                onChange={(assignTo) => onChange({ ...config, assignTo })}
            />
        </>
    );
}

export function StateSetConfigForm({
    config,
    onChange,
}: ConfigFormProps<StateSetConfig>): ReactElement {
    return (
        <>
            <TextInput
                label="State key"
                value={config.key}
                mono
                onChange={(key) => onChange({ ...config, key })}
            />
            <TextInput
                label="Value template"
                value={config.valueTemplate}
                mono
                placeholder="{{payload.path}}"
                onChange={(valueTemplate) => onChange({ ...config, valueTemplate })}
            />
        </>
    );
}
