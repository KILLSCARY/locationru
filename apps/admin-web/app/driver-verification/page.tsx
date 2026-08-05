import Link from 'next/link';

import { adminApi } from '../lib/api';

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type VerificationCaseRow = {
  id: string;
  driverId: string;
  status: string;
  priority: string;
  createdAt: string;
  driver: {
    firstName: string;
    lastName: string;
    cityId: string;
    user: { phone: string };
  };
  assignedAdmin: { id: string; phone: string } | null;
};

const STATUSES = [
  'QUEUED',
  'ASSIGNED',
  'IN_REVIEW',
  'ESCALATED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
];

export default async function DriverVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const query = await searchParams;
  const qs = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  ).toString();
  const cases = await adminApi<Page<VerificationCaseRow>>(
    `verification/cases?${qs}`,
  );

  return (
    <main>
      <h1>Верификация водителей</h1>
      <p className="muted">
        По умолчанию показаны только активные кейсы (в очереди, назначенные, на
        рассмотрении, эскалированные). Без назначения на себя действия по кейсу
        недоступны.
      </p>
      <section>
        <h2>Очередь ({cases.total})</h2>
        <form className="toolbar">
          <select name="status" defaultValue={query.status ?? ''}>
            <option value="">Активные (по умолчанию)</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button>Фильтровать</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Водитель</th>
              <th>Город</th>
              <th>Статус</th>
              <th>Приоритет</th>
              <th>Назначен</th>
              <th>Создан</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cases.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.driver.firstName} {item.driver.lastName}
                  <br />
                  {item.driver.user.phone}
                </td>
                <td>{item.driver.cityId}</td>
                <td>{item.status}</td>
                <td>{item.priority}</td>
                <td>{item.assignedAdmin?.phone ?? '—'}</td>
                <td>{new Date(item.createdAt).toLocaleString('ru-RU')}</td>
                <td>
                  <Link href={`/driver-verification/${item.id}`}>
                    Открыть кейс
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={cases.page}
          total={cases.total}
          pageSize={cases.pageSize}
          query={query}
        />
      </section>
    </main>
  );
}

function Pagination({
  page,
  total,
  pageSize,
  query,
}: {
  page: number;
  total: number;
  pageSize: number;
  query: Record<string, string | undefined>;
}) {
  const link = (nextPage: number) =>
    `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter(([, value]) => value)), page: String(nextPage) }).toString()}`;
  return (
    <p className="toolbar">
      Страница {page} из {Math.max(1, Math.ceil(total / pageSize))}{' '}
      {page > 1 && <Link href={link(page - 1)}>Назад</Link>}{' '}
      {page * pageSize < total && <Link href={link(page + 1)}>Вперёд</Link>}
    </p>
  );
}
