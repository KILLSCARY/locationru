import { NextResponse } from 'next/server';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1';

export async function POST(request: Request) {
  const body = await request.json();
  const verification = await fetch(`${apiUrl}/auth/verify-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone: body.phone,
      code: body.code,
      deviceId: body.deviceId,
      platform: 'WEB',
    }),
    cache: 'no-store',
  });
  const tokens = await verification.json();
  if (!verification.ok)
    return NextResponse.json(tokens, { status: verification.status });

  const meResponse = await fetch(`${apiUrl}/auth/me`, {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
    cache: 'no-store',
  });
  const me = await meResponse.json();
  if (!meResponse.ok || me.role !== 'ADMIN') {
    return NextResponse.json(
      {
        code: 'ADMIN_ACCESS_REQUIRED',
        message: 'Administrative role is required',
      },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ user: me });
  response.cookies.set('admin_access_token', tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 900,
  });
  return response;
}
