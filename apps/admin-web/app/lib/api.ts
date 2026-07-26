import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1';

export async function adminApi<T>(path: string): Promise<T> {
  const token = (await cookies()).get('admin_access_token')?.value;
  if (!token) redirect('/login');
  const response = await fetch(`${apiUrl}/admin/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (response.status === 401 || response.status === 403) redirect('/login');
  if (!response.ok)
    throw new Error(`Admin API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
