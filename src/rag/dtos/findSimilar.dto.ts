import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const MetricSchema = z.union([
  z.literal('cosine'),
  z.literal('euclidean'),
  z.literal('l2'),
  z.literal('ip'),
  z.literal('inner_product'),
]);

const FindSimilarSchema = z.object({
  input: z.string().min(1, 'Input must not be empty'),
  model_name: z.string().min(1, 'Model_name must not be empty'),
  metric: MetricSchema,
  length: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional()
    .default(5)
    .refine((val) => val > 0 && val <= 50, {
      message: 'Length must be between 1 and 50',
    }),
});

export class FindSimilarDto extends createZodDto(FindSimilarSchema) {}
