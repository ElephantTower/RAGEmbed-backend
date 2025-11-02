import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ParseDocsSchema = z.object({
  delayMs: z.coerce
    .number()
    .optional()
    .default(1000)
    .refine((val) => val >= 0 && val <= 10000, {
      message: 'DelayMs must be between 0 and 10000',
    }),
  chunkSize: z.coerce
    .number()
    .optional()
    .default(1500)
    .refine((val) => val > 0 && val <= 5000, {
      message: 'ChunkSize must be between 1 and 5000',
    }),
  chunkOverlap: z.coerce
    .number()
    .optional()
    .default(300)
    .refine((val) => val >= 0 && val < 1000, {
      message: 'ChunkOverlap must be between 0 and 999',
    }),
  batchSize: z.coerce
    .number()
    .optional()
    .default(16)
    .refine((val) => val > 0 && val <= 64, {
      message: 'BatchSize must be between 1 and 64',
    }),
  modelNames: z
    .array(
      z
        .string()
        .trim()
        .min(1, { message: 'Model name cannot be empty' })
        .max(200, { message: 'Model name must be ≤ 200 characters' }),
    )
    .optional()
    .default([]),
});

export class ParseDocsDto extends createZodDto(ParseDocsSchema) {}
