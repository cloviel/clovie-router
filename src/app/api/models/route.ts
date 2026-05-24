import { NextResponse } from 'next/server';
import { MODEL_PRICING } from '@/lib/model-pricing';

const UPSTREAM_BASE = process.env.UPSTREAM_BASE_URL || 'https://opengateway.gitlawb.com/v1/xiaomi-mimo';
const UPSTREAM_KEY = process.env.UPSTREAM_API_KEY || '';

// Cache models for 10 minutes
let cachedModels: { data: unknown[]; cachedAt: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

export async function GET() {
  try {
    if (cachedModels && Date.now() - cachedModels.cachedAt < CACHE_TTL) {
      return NextResponse.json({ models: cachedModels.data, cached: true, count: cachedModels.data.length });
    }

    const resp = await fetch(`${UPSTREAM_BASE}/models`, {
      headers: {
        'Authorization': `Bearer ${UPSTREAM_KEY}`,
        'Accept-Encoding': 'identity',
      },
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: err }, { status: resp.status });
    }

    const data = await resp.json();
    const rawModels = data.data || [];

    // Enrich with our pricing data
    const models = rawModels.map((m: { id: string; name?: string }) => {
      const pricing = MODEL_PRICING[m.id];
      return {
        id: m.id,
        name: m.name || m.id,
        context_length: pricing?.context || 0,
        architecture: { modality: pricing?.modality || 'text→text' },
        pricing: {
          prompt: pricing?.input ? String(pricing.input) : '0',
          completion: pricing?.output ? String(pricing.output) : '0',
        },
      };
    });

    cachedModels = { data: models, cachedAt: Date.now() };

    return NextResponse.json({ models, cached: false, count: models.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch models';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
