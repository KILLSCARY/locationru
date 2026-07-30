'use client';

import { useState } from 'react';

const PAYMENT_SCENARIOS = [
  'SUCCESS',
  'DECLINED',
  'TIMEOUT',
  'DUPLICATE_WEBHOOK',
  'REFUND',
  'PAYOUT_FAILED',
];
const WEBHOOK_TYPES = ['CAPTURE', 'REFUND', 'PAYOUT', 'DECLINE'];

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; data: unknown }> {
  const response = await fetch(`/api/admin/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  return { ok: response.ok, data };
}

function ResultPanel({ result }: { result: unknown }) {
  if (result === undefined) return null;
  return (
    <pre className="staging-result">{JSON.stringify(result, null, 2)}</pre>
  );
}

export function OtpViewer() {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<unknown>();
  const view = async () => {
    const { data } = await call(
      'GET',
      `staging/otp/${encodeURIComponent(phone)}`,
    );
    setResult(data);
  };
  return (
    <div>
      <div className="toolbar">
        <input
          placeholder="+79995551001"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <button type="button" onClick={view} disabled={!phone}>
          Показать код
        </button>
      </div>
      <ResultPanel result={result} />
    </div>
  );
}

export function PaymentScenarioPicker() {
  const [tripId, setTripId] = useState('');
  const [scenario, setScenario] = useState(PAYMENT_SCENARIOS[0]);
  const [result, setResult] = useState<unknown>();
  const setIt = async () => {
    const { data } = await call('PUT', `staging/payments/${tripId}/scenario`, {
      scenario,
    });
    setResult(data);
  };
  const clearIt = async () => {
    const { data } = await call(
      'DELETE',
      `staging/payments/${tripId}/scenario`,
    );
    setResult(data);
  };
  return (
    <div>
      <div className="toolbar">
        <input
          placeholder="ID поездки"
          value={tripId}
          onChange={(event) => setTripId(event.target.value)}
        />
        <select
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
        >
          {PAYMENT_SCENARIOS.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <button type="button" onClick={setIt} disabled={!tripId}>
          Установить
        </button>
        <button type="button" onClick={clearIt} disabled={!tripId}>
          Сбросить
        </button>
      </div>
      <ResultPanel result={result} />
    </div>
  );
}

export function WebhookSimulator() {
  const [tripId, setTripId] = useState('');
  const [type, setType] = useState(WEBHOOK_TYPES[0]);
  const [result, setResult] = useState<unknown>();
  const send = async () => {
    const { data } = await call('POST', 'staging/payments/webhook-simulate', {
      tripId,
      type,
    });
    setResult(data);
  };
  return (
    <div>
      <div className="toolbar">
        <input
          placeholder="ID поездки"
          value={tripId}
          onChange={(event) => setTripId(event.target.value)}
        />
        <select value={type} onChange={(event) => setType(event.target.value)}>
          {WEBHOOK_TYPES.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <button type="button" onClick={send} disabled={!tripId}>
          Отправить вебхук
        </button>
      </div>
      <ResultPanel result={result} />
    </div>
  );
}

export function OutboxViewer() {
  const [result, setResult] = useState<unknown>();
  const [retryId, setRetryId] = useState('');
  const load = async () => {
    const { data } = await call('GET', 'staging/outbox');
    setResult(data);
  };
  const retry = async () => {
    const { data } = await call('POST', `staging/outbox/${retryId}/retry`);
    setResult(data);
  };
  return (
    <div>
      <div className="toolbar">
        <button type="button" onClick={load}>
          Обновить список
        </button>
        <input
          placeholder="ID события для повтора"
          value={retryId}
          onChange={(event) => setRetryId(event.target.value)}
        />
        <button type="button" onClick={retry} disabled={!retryId}>
          Повторить
        </button>
      </div>
      <ResultPanel result={result} />
    </div>
  );
}

export function HealthDependenciesViewer() {
  const [result, setResult] = useState<unknown>();
  const load = async () => {
    const response = await fetch('/api/health-dependencies');
    setResult(await response.json());
  };
  return (
    <div>
      <button type="button" onClick={load}>
        Проверить зависимости
      </button>
      <ResultPanel result={result} />
    </div>
  );
}

export function DriverLocationTools() {
  const [driverId, setDriverId] = useState('');
  const [result, setResult] = useState<unknown>();
  const markStale = async () => {
    const { data } = await call(
      'POST',
      `staging/driver-locations/${driverId}/mark-stale`,
    );
    setResult(data);
  };
  const emulateJump = async () => {
    const { data } = await call(
      'POST',
      `staging/driver-locations/${driverId}/emulate-gps-jump`,
    );
    setResult(data);
  };
  return (
    <div>
      <div className="toolbar">
        <input
          placeholder="ID водителя"
          value={driverId}
          onChange={(event) => setDriverId(event.target.value)}
        />
        <button type="button" onClick={markStale} disabled={!driverId}>
          Пометить координату устаревшей
        </button>
        <button type="button" onClick={emulateJump} disabled={!driverId}>
          Смоделировать скачок GPS
        </button>
      </div>
      <ResultPanel result={result} />
    </div>
  );
}

export function ResetTestDataButton() {
  const [result, setResult] = useState<unknown>();
  const reset = async () => {
    if (!window.confirm('Удалить все тестовые поездки пассажира-теста?'))
      return;
    const { data } = await call('POST', 'staging/reset-test-data', {
      confirm: true,
    });
    setResult(data);
  };
  return (
    <div>
      <button className="danger" type="button" onClick={reset}>
        Очистить тестовые данные
      </button>
      <ResultPanel result={result} />
    </div>
  );
}
