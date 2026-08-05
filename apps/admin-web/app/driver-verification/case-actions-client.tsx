'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const REASON_CODES = [
  'DOCUMENT_UNREADABLE',
  'DOCUMENT_CROPPED',
  'DOCUMENT_EXPIRED',
  'DOCUMENT_MISMATCH',
  'WRONG_DOCUMENT_TYPE',
  'PROFILE_PHOTO_MISMATCH',
  'DRIVER_LICENSE_INVALID',
  'VEHICLE_DATA_MISMATCH',
  'VEHICLE_TOO_OLD',
  'INSURANCE_EXPIRED',
  'SECURITY_CHECK_FAILED',
  'DUPLICATE_ACCOUNT',
  'OTHER',
];

async function postJson(path: string, body: unknown): Promise<string | null> {
  const response = await fetch(`/api/admin/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.message ?? 'Операция не выполнена';
}

/** Reject a single driver/vehicle document — RejectDocumentDto { reasonCode, comment?, internalComment? }. */
export function RejectDocumentForm({ path }: { path: string }) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState(REASON_CODES[0]);
  const [comment, setComment] = useState('');
  const [internalComment, setInternalComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (reasonCode === 'OTHER' && !comment.trim()) {
      setError('Для причины OTHER комментарий обязателен');
      return;
    }
    setSubmitting(true);
    setError(null);
    const failure = await postJson(path, {
      reasonCode,
      ...(comment ? { comment } : {}),
      ...(internalComment ? { internalComment } : {}),
    });
    setSubmitting(false);
    if (failure) setError(failure);
    else router.refresh();
  };

  return (
    <div className="toolbar">
      <select
        value={reasonCode}
        onChange={(e) => setReasonCode(e.target.value)}
      >
        {REASON_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <input
        placeholder="Комментарий (виден водителю)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <input
        placeholder="Внутренний комментарий"
        value={internalComment}
        onChange={(e) => setInternalComment(e.target.value)}
      />
      <button
        type="button"
        className="danger"
        disabled={submitting}
        onClick={submit}
      >
        Отклонить
      </button>
      {error && <span className="danger">{error}</span>}
    </div>
  );
}

/** Case-wide decision — CaseDecisionDto { reasonCodes[], comment?, internalComment? }. Used for reject-vehicle/reject-driver/request-changes. */
export function CaseDecisionForm({
  path,
  label,
}: {
  path: string;
  label: string;
}) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState(REASON_CODES[0]);
  const [comment, setComment] = useState('');
  const [internalComment, setInternalComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!window.confirm(`Подтвердите действие: ${label}`)) return;
    if (reasonCode === 'OTHER' && !comment.trim()) {
      setError('Для причины OTHER комментарий обязателен');
      return;
    }
    setSubmitting(true);
    setError(null);
    const failure = await postJson(path, {
      reasonCodes: [reasonCode],
      ...(comment ? { comment } : {}),
      ...(internalComment ? { internalComment } : {}),
    });
    setSubmitting(false);
    if (failure) setError(failure);
    else router.refresh();
  };

  return (
    <div className="toolbar">
      <select
        value={reasonCode}
        onChange={(e) => setReasonCode(e.target.value)}
      >
        {REASON_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <input
        placeholder="Комментарий (виден водителю)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <input
        placeholder="Внутренний комментарий"
        value={internalComment}
        onChange={(e) => setInternalComment(e.target.value)}
      />
      <button
        type="button"
        className="danger"
        disabled={submitting}
        onClick={submit}
      >
        {label}
      </button>
      {error && <span className="danger">{error}</span>}
    </div>
  );
}

/** SuspendDriverDto { comment (required) } — not case-scoped, acts directly on an already-APPROVED driver. */
export function SuspendDriverForm({ driverId }: { driverId: string }) {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!comment.trim()) {
      setError('Комментарий обязателен');
      return;
    }
    if (!window.confirm('Подтвердите: приостановить допуск водителя')) return;
    setSubmitting(true);
    setError(null);
    const failure = await postJson(`verification/drivers/${driverId}/suspend`, {
      comment,
    });
    setSubmitting(false);
    if (failure) setError(failure);
    else router.refresh();
  };

  return (
    <div className="toolbar">
      <input
        placeholder="Причина приостановки"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button
        type="button"
        className="danger"
        disabled={submitting}
        onClick={submit}
      >
        Приостановить допуск
      </button>
      {error && <span className="danger">{error}</span>}
    </div>
  );
}
