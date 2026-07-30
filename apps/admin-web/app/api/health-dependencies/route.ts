import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1';

export async function GET() {
  const token = (await cookies()).get('admin_access_token')?.value;
  if (!token) {
    return NextResponse.json(
      { code: 'ADMIN_SESSION_REQUIRED' },
      { status: 401 },
    );
  }
  const response = await fetch(`${apiUrl}/health/dependencies`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') ?? 'application/json',
    },
  });
}
