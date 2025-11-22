import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const MetricSchema = z.union([
  z.literal('cosine'),
  z.literal('euclidean'),
  z.literal('l2'),
  z.literal('ip'),
  z.literal('inner_product'),
]);

const SendMessageSchema = z.object({
  input: z.string().min(1, 'Input must not be empty'),
  metric: MetricSchema.default('cosine'),
  topChunks: z.coerce
    .number()
    .optional()
    .default(10)
    .refine((val) => val > 0 && val <= 50, {
      message: 'Length must be between 1 and 50',
    }),
  topDocuments: z.coerce
    .number()
    .optional()
    .default(2)
    .refine((val) => val > 0 && val <= 50, {
      message: 'Length must be between 1 and 50',
    }),
  stream: z.boolean().default(true)
});

export class SendMessageDto extends createZodDto(SendMessageSchema) {}