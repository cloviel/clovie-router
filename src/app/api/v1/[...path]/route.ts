import { NextRequest, NextResponse } from 'next/server';
import { MODEL_PRICING } from '@/lib/model-pricing';

const UPSTREAM_BASE = process.env.UPSTREAM_BASE_URL || 'https://opengateway.gitlawb.com/v1/xiaomi-mimo';
const UPSTREAM_KEY = process.env.UPSTREAM_API_KEY || '';

function enrichModels(data: string): string {
  try {
    const parsed = JSON.parse(data);
    if (parsed.data && Array.isArray(parsed.data)) {
      parsed.data = parsed.data.map((m: Record<string, unknown>) => {
        const pricing = MODEL_PRICING[m.id as string];
        if (pricing) {
          if (!m.context_length || m.context_length === 0) m.context_length = pricing.context;
          const p = m.pricing as Record<string, string> | undefined;
          if (!p || (!p.prompt && !p.completion)) {
            m.pricing = {
              prompt: pricing.input ? (pricing.input / 1_000_000).toFixed(8) : '0',
              completion: pricing.output ? (pricing.output / 1_000_000).toFixed(8) : '0',
            };
          }
        }
        return m;
      });
    }
    return JSON.stringify(parsed);
  } catch { return data; }
}

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

async function proxy(req: NextRequest, params: Promise<{ path: string[] }>) {
  try {
    const { path } = await params;
    const upstreamPath = path.join('/');

    // Skip paths that have dedicated route handlers (prevents double-counting)
    if (upstreamPath === 'chat/completions') {
      return new NextResponse(null, { status: 404 });
    }

    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: { message: 'Missing Authorization header. Use: Bearer clovie-xxxxx' } },
        { status: 401 }
      );
    }

    const userKey = authHeader.replace('Bearer ', '');
    const { validateKey } = await import('@/lib/key-store');
    if (!validateKey(userKey)) {
      return NextResponse.json(
        { error: { message: 'Invalid or disabled API key' } },
        { status: 401 }
      );
    }

    const upstreamUrl = `${UPSTREAM_BASE}/${upstreamPath}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${UPSTREAM_KEY}`,
      'Accept-Encoding': 'identity',
    };
    const contentType = req.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = await req.text();
    }

    const upstreamResp = await fetch(upstreamUrl, fetchOptions);
    const respContentType = upstreamResp.headers.get('content-type') || '';
    const isStream = respContentType.includes('text/event-stream');

    if (isStream) {
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
    const isModels = path.length === 1 && path[0] === 'models';
    return new NextResponse(isModels ? enrichModels(data) : data, {
      status: upstreamResp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Proxy error';
    return NextResponse.json({ error: { message: msg } }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params);
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params);
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params);
}
