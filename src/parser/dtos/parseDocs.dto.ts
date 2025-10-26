import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ParseDocsSchema = z.object({
  delayMs: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional()
    .default(1000)
    .refine((val) => val >= 0 && val <= 10000, {
      message: 'DelayMs must be between 0 and 10000',
    }),
  chunkSize: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional()
    .default(1500)
    .refine((val) => val > 0 && val <= 5000, {
      message: 'ChunkSize must be between 1 and 5000',
    }),
  chunkOverlap: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional()
    .default(300)
    .refine((val) => val >= 0 && val < 1000, {
      message: 'ChunkOverlap must be between 0 and 999',
    }),
  batchSize: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional()
    .default(16)
    .refine((val) => val > 0 && val <= 64, {
      message: 'BatchSize must be between 1 and 64',
    }),
  limit: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional()
    .default(5)
    .refine((val) => val > 0 && val <= 100, {
      message: 'Limit must be between 1 and 100',
    }),
});

export class ParseDocsDto extends createZodDto(ParseDocsSchema) {}
