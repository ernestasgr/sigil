import { z } from 'zod';

export const FileEventNameSchema = z.enum(['file.created', 'file.modified', 'file.deleted']);
