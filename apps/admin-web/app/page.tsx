import Link from 'next/link';

import { DangerAction } from './components/danger-action';
import { adminApi } from './lib/api';

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type User = {
  id: string;
  phone: string;
  role: string;
  status: string;
  createdAt: string;
};
type Driver = {
  userId: string;
  firstName: string;
  lastName: string;
  status: string;
  verificationStatus: string;
  user: { phone: string; status: string };
  vehicles: Array<{
    id: string;
    brand: string;
    model: string;
    registrationNumber: string;
    status: string;
  }>;
};
type Trip = {
  id: string;
  status: string;
  passengerPriceKopecks: number;
  createdAt: string;
  passenger: { phone: string };
  selectedDriver: { phone: string } | null;
};
type Payment = {
  id: string;
  tripId: string;
  amountKopecks: number;
  status: string;
  provider: string;
  transactions: Array<{ type: string; status: string }>;
};
type Audit = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  admin: { phone: string };
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    role?: string;
    status?: string;
    search?: string;
  }>;
}) {
  const query = await searchParams;
  const qs = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  ).toString();
  const [users, drivers, trips, payments, audit] = await Promise.all([
    adminApi<Page<User>>(`users?${qs}`),
    adminApi<Page<Driver>>('drivers?pageSize=20'),
    adminApi<Page<Trip>>('trips?pageSize=20'),
    adminApi<Page<Payment>>('payments?pageSize=20'),
    adminApi<Page<Audit>>('audit?pageSize=20'),
  ]);
  return (
    <main>
      <h1>Resilient Taxi — администрирование</h1>
      <p className="muted">
        Сервер API проверяет роль ADMIN для каждого административного запроса.{' '}
        <Link href="/auth-monitoring">Мониторинг авторизации</Link>
        {' · '}
        <Link href="/push-monitoring">Push-уведомления</Link>
        {' · '}
        <Link href="/staging">Staging tools</Link> (только staging +
        SUPER_ADMIN).
      </p>
      <section>
        <h2>Пользователи ({users.total})</h2>
        <form className="toolbar">
          <input
            name="search"
            placeholder="Телефон"
            defaultValue={query.search}
          />
          <select name="role" defaultValue={query.role ?? ''}>
            <option value="">Все роли</option>
            <option>PASSENGER</option>
            <option>DRIVER</option>
            <option>ADMIN</option>
          </select>
          <select name="status" defaultValue={query.status ?? ''}>
            <option value="">Все статусы</option>
            <option>ACTIVE</option>
            <option>BLOCKED</option>
            <option>PENDING</option>
          </select>
          <button>Фильтровать</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Телефон</th>
              <th>Роль</th>
              <th>Статус</th>
              <th>Создан</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {users.items.map((user) => (
              <tr key={user.id}>
                <td>{user.phone}</td>
                <td>{user.role}</td>
                <td>{user.status}</td>
                <td>{new Date(user.createdAt).toLocaleString('ru-RU')}</td>
                <td>
                  {user.status !== 'BLOCKED' && (
                    <DangerAction
                      label="Заблокировать"
                      path={`users/${user.id}/block`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={users.page}
          total={users.total}
          pageSize={users.pageSize}
          query={query}
        />
      </section>
      <section>
        <h2>Водители ({drivers.total})</h2>
        <table>
          <thead>
            <tr>
              <th>Водитель</th>
              <th>Статус</th>
              <th>Проверка</th>
              <th>Автомобили</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {drivers.items.map((driver) => (
              <tr key={driver.userId}>
                <td>
                  {driver.firstName} {driver.lastName}
                  <br />
                  {driver.user.phone}
                </td>
                <td>{driver.status}</td>
                <td>{driver.verificationStatus}</td>
                <td>
                  {driver.vehicles.map((vehicle) => (
                    <div key={vehicle.id}>
                      {vehicle.brand} {vehicle.model} (
                      {vehicle.registrationNumber}) — {vehicle.status}{' '}
                      {vehicle.status === 'PENDING' && (
                        <DangerAction
                          label="Подтвердить авто"
                          path={`vehicles/${vehicle.id}/review`}
                          body={{ decision: 'APPROVED' }}
                        />
                      )}
                    </div>
                  ))}
                </td>
                <td>
                  {driver.verificationStatus !== 'APPROVED' && (
                    <DangerAction
                      label="Подтвердить"
                      path={`drivers/${driver.userId}/review`}
                      body={{ decision: 'APPROVED' }}
                    />
                  )}
                  {driver.verificationStatus !== 'REJECTED' && (
                    <DangerAction
                      label="Отклонить"
                      path={`drivers/${driver.userId}/review`}
                      body={{ decision: 'REJECTED' }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Поездки ({trips.total})</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Статус</th>
              <th>Пассажир / водитель</th>
              <th>Цена</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trips.items.map((trip) => (
              <tr key={trip.id}>
                <td>{trip.id}</td>
                <td>{trip.status}</td>
                <td>
                  {trip.passenger.phone}
                  <br />
                  {trip.selectedDriver?.phone ?? '—'}
                </td>
                <td>{trip.passengerPriceKopecks}</td>
                <td>
                  <Link href={`/trips/${trip.id}`}>
                    История, предложения и координаты
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Платежи ({payments.total})</h2>
        <table>
          <thead>
            <tr>
              <th>Поездка</th>
              <th>Сумма</th>
              <th>Провайдер</th>
              <th>Статус</th>
              <th>Операции</th>
            </tr>
          </thead>
          <tbody>
            {payments.items.map((payment) => (
              <tr key={payment.id}>
                <td>{payment.tripId}</td>
                <td>{payment.amountKopecks}</td>
                <td>{payment.provider}</td>
                <td>{payment.status}</td>
                <td>
                  {payment.transactions
                    .map(
                      (transaction) =>
                        `${transaction.type}: ${transaction.status}`,
                    )
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Аудит ({audit.total})</h2>
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Администратор</th>
              <th>Действие</th>
              <th>Объект</th>
            </tr>
          </thead>
          <tbody>
            {audit.items.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString('ru-RU')}</td>
                <td>{entry.admin.phone}</td>
                <td>{entry.action}</td>
                <td>
                  {entry.targetType}: {entry.targetId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
