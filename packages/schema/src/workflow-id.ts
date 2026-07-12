import { z } from 'zod';

const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const WorkflowIdSchema = z
    .string()
    .min(1, 'Workflow id must not be empty.')
    .max(128, 'Workflow id must be at most 128 characters.')
    .regex(
        WORKFLOW_ID_PATTERN,
        'Workflow id must contain only letters, numbers, hyphens, and underscores, and start with a letter or number.',
    );

export type WorkflowId = z.infer<typeof WorkflowIdSchema>;
