'use client';

import { useRouter } from 'next/navigation';

export function DangerAction({
  label,
  path,
  body,
}: {
  label: string;
  path: string;
  body?: object;
}) {
  const router = useRouter();
  const act = async () => {
    if (!window.confirm(`Подтвердите действие: ${label}`)) return;
    const response = await fetch(`/api/admin/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok)
      window.alert((await response.json()).message ?? 'Операция не выполнена');
    else router.refresh();
  };
  return (
    <button className="danger" type="button" onClick={act}>
      {label}
    </button>
  );
}
