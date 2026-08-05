import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { DangerAction } from '../components/danger-action';
import { adminApi } from '../lib/api';
import { CreateBlockForm } from './auth-monitoring-client';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1';

type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type SecurityEvent = {
  id: string;
  type: string;
  phoneHash: string | null;
  userId: string | null;
  deviceId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type AuthBlock = {
  id: string;
  phoneHash: string | null;
  deviceId: string | null;
  reason: string;
  blockedAt: string;
  expiresAt: string | null;
  unblockedAt: string | null;
};

export default async function AuthMonitoringPage() {
  const token = (await cookies()).get('admin_access_token')?.value;
  if (!token) redirect('/login');

  const [events, blocks, balanceResponse] = await Promise.all([
    adminApi<Page<SecurityEvent>>('auth/security-events?pageSize=20'),
    adminApi<Page<AuthBlock>>('auth/blocks?activeOnly=true&pageSize=50'),
    fetch(`${apiUrl}/admin/auth/sms-balance`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }),
  ]);

  // 503 here just means the active SMS_PROVIDER isn't sms-ru (dev/staging
  // provider active) — not a real error, so it's shown as an info message
  // rather than treated as a page-level failure.
  const balance =
    balanceResponse.status === 200
      ? ((await balanceResponse.json()) as { balanceRub: number })
      : null;

  return (
    <main>
      <h1>Мониторинг авторизации</h1>
      <p className="muted">
        События безопасности и блокировки, связанные с OTP-авторизацией по
        номеру телефона. Номера телефонов везде хранятся и показываются только в
        виде хеша — сырой номер нигде в этом разделе не отображается.
      </p>

      <section>
        <h2>Баланс SMS.RU</h2>
        {balance ? (
          <p>{balance.balanceRub.toFixed(2)} ₽</p>
        ) : (
          <p className="muted">
            Недоступно: активный SMS-провайдер сейчас не sms-ru (проверка
            баланса поддерживается только для реального SMS.RU-адаптера).
          </p>
        )}
      </section>

      <section>
        <h2>Заблокировать номер или устройство вручную</h2>
        <CreateBlockForm />
      </section>

      <section>
        <h2>Активные блокировки ({blocks.total})</h2>
        <table>
          <thead>
            <tr>
              <th>Телефон (хеш)</th>
              <th>Устройство</th>
              <th>Причина</th>
              <th>Заблокирован</th>
              <th>Истекает</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {blocks.items.map((block) => (
              <tr key={block.id}>
                <td>{block.phoneHash ? shortHash(block.phoneHash) : '—'}</td>
                <td>{block.deviceId ?? '—'}</td>
                <td>{block.reason}</td>
                <td>{new Date(block.blockedAt).toLocaleString('ru-RU')}</td>
                <td>
                  {block.expiresAt
                    ? new Date(block.expiresAt).toLocaleString('ru-RU')
                    : 'бессрочно'}
                </td>
                <td>
                  {!block.unblockedAt && (
                    <DangerAction
                      label="Разблокировать"
                      path={`auth/blocks/${block.id}/unblock`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {blocks.items.length === 0 && (
          <p className="muted">Активных блокировок нет.</p>
        )}
      </section>

      <section>
        <h2>События безопасности ({events.total})</h2>
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Тип</th>
              <th>Телефон (хеш)</th>
              <th>Устройство</th>
              <th>Метаданные</th>
            </tr>
          </thead>
          <tbody>
            {events.items.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.createdAt).toLocaleString('ru-RU')}</td>
                <td>{event.type}</td>
                <td>{event.phoneHash ? shortHash(event.phoneHash) : '—'}</td>
                <td>{event.deviceId ?? '—'}</td>
                <td>
                  <code>{JSON.stringify(event.metadata)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`;
}
