import { api } from '@/api/client';
import type { PricingEstimate } from '@/features/maps/types';

export type PricingEstimateInput = {
  distanceMeters: number;
  durationSeconds: number;
};

export const estimatePricing = (input: PricingEstimateInput) =>
  api<PricingEstimate>('/pricing/estimate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
