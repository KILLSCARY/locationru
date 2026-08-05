'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CreateBlockForm() {
  const router = useRouter();
  const [target, setTarget] = useState<'phone' | 'device'>('phone');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [expiresInSeconds, setExpiresInSeconds] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/auth/blocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          [target]: value,
          reason,
          ...(expiresInSeconds
            ? { expiresInSeconds: Number(expiresInSeconds) }
            : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? 'Не удалось создать блокировку');
        return;
      }
      setValue('');
      setReason('');
      setExpiresInSeconds('');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="toolbar">
      <select
        value={target}
        onChange={(event) =>
          setTarget(event.target.value as 'phone' | 'device')
        }
      >
        <option value="phone">Телефон</option>
        <option value="device">Device ID</option>
      </select>
      <input
        placeholder={target === 'phone' ? '+79995551001' : 'device-id'}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <input
        placeholder="Причина"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <input
        placeholder="Срок (сек), пусто = бессрочно"
        value={expiresInSeconds}
        onChange={(event) => setExpiresInSeconds(event.target.value)}
      />
      <button
        type="button"
        disabled={!value || !reason || submitting}
        onClick={submit}
      >
        Заблокировать
      </button>
      {error && <span className="danger">{error}</span>}
    </div>
  );
}
