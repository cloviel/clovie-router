import { NextRequest, NextResponse } from 'next/server';
import { verifyCredentials, signToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!verifyCredentials(username, password)) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const token = await signToken(username);

    const response = NextResponse.json({
      token,
      expires_in: 86400,
      token_type: 'Bearer',
    });

    // Set httpOnly cookie too
    response.cookies.set('clovie_session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 86400,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
