import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  DriverLocationTools,
  HealthDependenciesViewer,
  OtpViewer,
  OutboxViewer,
  PaymentScenarioPicker,
  PushTestTools,
  ResetTestDataButton,
  WebhookSimulator,
} from './staging-tools-client';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1';

export default async function StagingToolsPage() {
  const token = (await cookies()).get('admin_access_token')?.value;
  if (!token) redirect('/login');

  // The backend 404s this entire route tree outside APP_ENV=staging and
  // for anyone who isn't SUPER_ADMIN (StagingOnlyGuard + @Roles), so a
  // 404 here just means "not available", not "broken".
  const probe = await fetch(`${apiUrl}/admin/staging/outbox`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (probe.status === 404) {
    return (
      <main>
        <h1>Staging tools</h1>
        <p className="muted">
          Недоступно: этот раздел существует только при APP_ENV=staging и
          требует роль SUPER_ADMIN.
        </p>
      </main>
    );
  }
  if (probe.status === 401 || probe.status === 403) redirect('/login');

  return (
    <main>
      <h1>Staging tools</h1>
      <p className="muted">
        Каждое действие здесь пишется в журнал аудита. Доступно только в staging
        и только для SUPER_ADMIN.
      </p>

      <section>
        <h2>Просмотр тестового OTP-кода</h2>
        <OtpViewer />
      </section>

      <section>
        <h2>Сценарий тестового платежа</h2>
        <PaymentScenarioPicker />
      </section>

      <section>
        <h2>Симуляция вебхука платежа</h2>
        <WebhookSimulator />
      </section>

      <section>
        <h2>Outbox: очередь realtime-событий</h2>
        <OutboxViewer />
      </section>

      <section>
        <h2>Координаты водителя</h2>
        <DriverLocationTools />
      </section>

      <section>
        <h2>Push-уведомления: тестовая отправка</h2>
        <p className="muted">
          Отправляет реальный SYSTEM_SERVICE_NOTICE push через настоящий
          пайплайн (outbox → провайдер) и сразу прогоняет worker, чтобы
          результат был виден без ожидания следующего опроса.
        </p>
        <PushTestTools />
      </section>

      <section>
        <h2>Состояние зависимостей</h2>
        <HealthDependenciesViewer />
      </section>

      <section>
        <h2>Очистка тестовых данных</h2>
        <ResetTestDataButton />
      </section>

      <section>
        <h2>Симулятор поездки</h2>
        <p className="muted">
          Полный прогон поездки (с движением GPS по маршруту) выполняется
          отдельным скриптом, а не из браузера — ему нужны инструменты
          разработки (tsx, Prisma CLI), которых нет в собранном образе api в
          целях безопасности. Запустите{' '}
          <code>pnpm --filter @resilient-taxi/api staging:smoke</code> для
          быстрой сквозной проверки или{' '}
          <code>
            API_URL=https://ваш-домен/api/v1 pnpm --filter @resilient-taxi/api
            simulate:trip
          </code>{' '}
          для полной симуляции с движением по маршруту.
        </p>
      </section>
    </main>
  );
}
