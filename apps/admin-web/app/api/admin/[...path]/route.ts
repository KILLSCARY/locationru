import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const token = (await cookies()).get('admin_access_token')?.value;
  if (!token)
    return NextResponse.json(
      { code: 'ADMIN_SESSION_REQUIRED' },
      { status: 401 },
    );
  const { path } = await context.params;
  const target = new URL(`${apiUrl}/admin/${path.join('/')}`);
  target.search = new URL(request.url).search;
  const hasBody = METHODS_WITH_BODY.has(request.method);
  const response = await fetch(target, {
    method: request.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    body: hasBody ? await request.text() : undefined,
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

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
