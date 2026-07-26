import { NextResponse } from 'next/server';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1';

export async function POST(request: Request) {
  const body = await request.json();
  const response = await fetch(`${apiUrl}/auth/request-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: body.phone }),
    cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
