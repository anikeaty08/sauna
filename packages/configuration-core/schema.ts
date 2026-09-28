import { z } from 'zod';

export const SaunaConfigurationSchema = z.object({
  modelId: z.literal('zirbe-6eck'),
  modelVersion: z.string(),
  dimensions: z.object({ widthCm: z.number().int(), depthCm: z.number().int() }),
  materials: z.object({ benchWood: z.string() }),
  heaterSet: z.string(),
  accessories: z.array(z.string()),
  interior: z.object({ lowerBenchOffsetMm: z.number().min(0).max(400) }),
});
