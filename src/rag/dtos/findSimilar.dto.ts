import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const FindSimilarSchema = z.object({
  query: z.string().min(1, 'Query must not be empty'),
  n: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional()
    .default(5)
    .refine((val) => val > 0 && val <= 50, {
      message: 'n must be between 1 and 50',
    }),
});

export class FindSimilarDto extends createZodDto(FindSimilarSchema) {}
