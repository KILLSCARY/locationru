import { DangerAction } from '../components/danger-action';
import { adminApi } from '../lib/api';

type PushStats = {
  outboxByStatus: Record<string, number>;
  notificationsByStatus: Record<string, number>;
  activeTokens: Array<{
    application: string;
    platform: string;
    count: number;
  }>;
};

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type DeadLetterEvent = {
  id: string;
  type: string;
  application: string;
  userId: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
};

export default async function PushMonitoringPage() {
  const [stats, deadLetter] = await Promise.all([
    adminApi<PushStats>('notifications/push-stats'),
    adminApi<Page<DeadLetterEvent>>('notifications/dead-letter?pageSize=50'),
  ]);

  return (
    <main>
      <h1>Push-уведомления</h1>
      <p className="muted">
        Push никогда не является источником истины — клиент всегда
        синхронизируется через REST/WebSocket после открытия. Здесь только
        счётчики и статусы очереди, без телефонов, токенов и содержимого
        уведомлений.
      </p>

      <section>
        <h2>Очередь исходящих push (по статусу)</h2>
        <table>
          <thead>
            <tr>
              <th>Статус</th>
              <th>Количество</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stats.outboxByStatus).map(([status, count]) => (
              <tr key={status}>
                <td>{status}</td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Уведомления (по статусу)</h2>
        <table>
          <thead>
            <tr>
              <th>Статус</th>
              <th>Количество</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stats.notificationsByStatus).map(
              ([status, count]) => (
                <tr key={status}>
                  <td>{status}</td>
                  <td>{count}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Активные push-токены</h2>
        <table>
          <thead>
            <tr>
              <th>Приложение</th>
              <th>Платформа</th>
              <th>Количество</th>
            </tr>
          </thead>
          <tbody>
            {stats.activeTokens.map((row) => (
              <tr key={`${row.application}-${row.platform}`}>
                <td>{row.application}</td>
                <td>{row.platform}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats.activeTokens.length === 0 && (
          <p className="muted">Нет активных токенов.</p>
        )}
      </section>

      <section>
        <h2>Dead-letter ({deadLetter.total})</h2>
        <p className="muted">
          События, исчерпавшие все попытки доставки. Повтор сбрасывает счётчик
          попыток и возвращает событие в очередь — дальше им снова управляет
          обычная политика ограниченных попыток.
        </p>
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Тип</th>
              <th>Приложение</th>
              <th>Попытки</th>
              <th>Последняя ошибка</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {deadLetter.items.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.createdAt).toLocaleString('ru-RU')}</td>
                <td>{event.type}</td>
                <td>{event.application}</td>
                <td>
                  {event.attempts}/{event.maxAttempts}
                </td>
                <td>{event.lastError ?? '—'}</td>
                <td>
                  <DangerAction
                    label="Повторить"
                    path={`notifications/dead-letter/${event.id}/retry`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {deadLetter.items.length === 0 && (
          <p className="muted">Dead-letter пуст.</p>
        )}
      </section>
    </main>
  );
}
