import { NextRequest, NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!(await getAuthFromRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { getStats } = await import('@/lib/key-store');
  const stats = await getStats();
  return NextResponse.json(stats);
}
