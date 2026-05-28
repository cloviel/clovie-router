import { NextResponse } from 'next/server';
import { MODEL_PRICING } from '@/lib/model-pricing';

export async function GET() {
  // Only expose mimo-v2.5-pro — no upstream fetch needed
  const models = Object.entries(MODEL_PRICING).map(([id, pricing]) => ({
    id,
    name: id,
    context_length: pricing.context,
    architecture: { modality: pricing.modality },
    pricing: {
      prompt: String(pricing.input),
      completion: String(pricing.output),
    },
  }));

  return NextResponse.json({ models, cached: false, count: models.length });
}
