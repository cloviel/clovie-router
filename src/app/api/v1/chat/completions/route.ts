import { NextRequest, NextResponse } from 'next/server';
import { MODEL_PRICING } from '@/lib/model-pricing';

const UPSTREAM_BASE = process.env.UPSTREAM_BASE_URL || 'https://opengateway.gitlawb.com/v1/xiaomi-mimo';
const UPSTREAM_KEY = process.env.UPSTREAM_API_KEY || '';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let userKey = '';

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: { message: 'Missing or invalid Authorization header. Use: Bearer clovie-xxxxx', type: 'auth_error' } },
        { status: 401 }
      );
    }

    userKey = authHeader.replace('Bearer ', '');
    const { validateKey } = await import('@/lib/key-store');
    if (!(await validateKey(userKey))) {
      return NextResponse.json(
        { error: { message: 'Invalid or disabled API key', type: 'auth_error' } },
        { status: 401 }
      );
    }

    const body = await req.text();
    let model = 'unknown';
    try {
      const parsed = JSON.parse(body);
      model = parsed.model || 'unknown';
    } catch { /* ignore */ }

    const upstreamUrl = `${UPSTREAM_BASE}/chat/completions`;
    const upstreamResp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${UPSTREAM_KEY}`,
        'Accept-Encoding': 'identity',
      },
      body,
    });

    const latencyMs = Date.now() - startTime;
    const contentType = upstreamResp.headers.get('content-type') || '';
    const isStream = contentType.includes('text/event-stream');

    if (isStream) {
      // Don't record streaming requests (can't parse usage from stream)
      return new NextResponse(upstreamResp.body, {
        status: upstreamResp.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const data = await upstreamResp.text();
    const latency = Date.now() - startTime;

    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    try {
      const parsed = JSON.parse(data);
      if (parsed.usage) usage = parsed.usage;
      if (parsed.model) model = parsed.model;
    } catch { /* ignore */ }

    const baseModel = model.replace('xiaomi/', '').replace(/-\d{8}$/, '');
    const pricing = MODEL_PRICING[baseModel];
    const cost = pricing
      ? (usage.prompt_tokens * pricing.input + usage.completion_tokens * pricing.output) / 1_000_000
      : 0;

    const { recordUsage } = await import('@/lib/key-store');
    await recordUsage(userKey, {
      model,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      latencyMs: latency,
      status: upstreamResp.status,
      endpoint: '/v1/chat/completions',
      cost,
    });

    return new NextResponse(data, {
      status: upstreamResp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Proxy error';

    if (userKey) {
      const { recordUsage } = await import('@/lib/key-store');
      await recordUsage(userKey, {
        model: 'unknown',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
        status: 502,
        endpoint: '/v1/chat/completions',
      });
    }

    return NextResponse.json(
      { error: { message: msg, type: 'proxy_error' } },
      { status: 502 }
    );
  }
}
