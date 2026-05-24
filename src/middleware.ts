import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  
  // Rewrite /v1/* → /api/v1/* (OpenAI-compatible paths)
  if (pathname.startsWith('/v1/')) {
    const url = req.nextUrl.clone();
    url.pathname = `/api${pathname}`;
    return NextResponse.rewrite(url);
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/v1/:path*'],
};
