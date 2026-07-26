'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const requestCode = async () => {
    const response = await fetch('/api/auth/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    setMessage(
      response.ok
        ? 'Код запрошен. В development он выводится сервером API.'
        : 'Не удалось запросить код.',
    );
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, code, deviceId: 'admin-web' }),
    });
    if (response.ok) router.replace('/');
    else setMessage((await response.json()).message ?? 'Вход не выполнен');
  };
  return (
    <main>
      <section>
        <h1>Resilient Taxi Admin</h1>
        <p className="muted">
          Вход доступен только пользователю с ролью ADMIN.
        </p>
        <form onSubmit={login}>
          <p>
            <input
              required
              placeholder="Телефон"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button type="button" onClick={requestCode}>
              Запросить код
            </button>
          </p>
          <p>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              placeholder="Код из 6 цифр"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit">Войти</button>
          </p>
        </form>
        {message && <p>{message}</p>}
      </section>
    </main>
  );
}
