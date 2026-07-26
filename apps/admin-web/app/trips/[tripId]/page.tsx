import Link from 'next/link';

import { adminApi } from '../../lib/api';

type Detail = {
  trip: {
    id: string;
    status: string;
    statusHistory: Array<{
      id: string;
      previousStatus: string;
      newStatus: string;
      actorType: string;
      reason: string | null;
      createdAt: string;
    }>;
    bids: Array<{
      id: string;
      status: string;
      offeredPriceKopecks: number;
      expiresAt: string;
      driver: { user: { phone: string } };
      vehicle: { brand: string; model: string; registrationNumber: string };
    }>;
  };
  locations: Array<{
    id: string;
    recordedAt: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    stale: boolean;
    suspectedSpoofing: boolean;
  }>;
};

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const { trip, locations } = await adminApi<Detail>(`trips/${tripId}`);
  return (
    <main>
      <p>
        <Link href="/">← К спискам</Link>
      </p>
      <h1>Поездка {trip.id}</h1>
      <p>Статус: {trip.status}</p>
      <section>
        <h2>История статусов</h2>
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Переход</th>
              <th>Кто</th>
              <th>Причина</th>
            </tr>
          </thead>
          <tbody>
            {trip.statusHistory.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.createdAt).toLocaleString('ru-RU')}</td>
                <td>
                  {item.previousStatus} → {item.newStatus}
                </td>
                <td>{item.actorType}</td>
                <td>{item.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Предложения водителей</h2>
        <table>
          <thead>
            <tr>
              <th>Водитель</th>
              <th>Автомобиль</th>
              <th>Цена</th>
              <th>Статус</th>
              <th>До</th>
            </tr>
          </thead>
          <tbody>
            {trip.bids.map((bid) => (
              <tr key={bid.id}>
                <td>{bid.driver.user.phone}</td>
                <td>
                  {bid.vehicle.brand} {bid.vehicle.model} (
                  {bid.vehicle.registrationNumber})
                </td>
                <td>{bid.offeredPriceKopecks}</td>
                <td>{bid.status}</td>
                <td>{new Date(bid.expiresAt).toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Последние координаты выбранного водителя</h2>
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Широта</th>
              <th>Долгота</th>
              <th>Точность</th>
              <th>Метка</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.id}>
                <td>{new Date(location.recordedAt).toLocaleString('ru-RU')}</td>
                <td>{location.latitude}</td>
                <td>{location.longitude}</td>
                <td>{location.accuracyMeters} м</td>
                <td>
                  {location.stale ? 'устарела' : ''}{' '}
                  {location.suspectedSpoofing ? 'подозрение на spoofing' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
