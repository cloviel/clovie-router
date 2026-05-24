import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!(await getAuthFromRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { listKeys } = await import('@/lib/key-store');
  const keys = await listKeys();
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  if (!(await getAuthFromRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { name, rate_limit } = await req.json();
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Missing key name' }, { status: 400 });
  }
  const { generateKey } = await import('@/lib/key-store');
  const apiKey = await generateKey(name, rate_limit || 0);
  return NextResponse.json({ key: apiKey }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!(await getAuthFromRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { key } = await req.json();
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  const { revokeKey } = await import('@/lib/key-store');
  const ok = await revokeKey(key);
  return NextResponse.json({ deleted: ok });
}

export async function PATCH(req: NextRequest) {
  if (!(await getAuthFromRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { key, action, rate_limit } = await req.json();
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  const store = await import('@/lib/key-store');

  if (action === 'rate_limit' && rate_limit !== undefined) {
    const result = await store.updateKeyRateLimit(key, rate_limit);
    if (!result) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    return NextResponse.json({ key: result });
  }

  const result = await store.toggleKey(key);
  if (!result) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  return NextResponse.json({ key: result });
}
