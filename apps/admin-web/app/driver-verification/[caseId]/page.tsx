import { DangerAction } from '../../components/danger-action';
import { adminApi } from '../../lib/api';
import {
  CaseDecisionForm,
  RejectDocumentForm,
  SuspendDriverForm,
} from '../case-actions-client';

type VerificationCase = {
  id: string;
  driverId: string;
  status: string;
  priority: string;
  assignedAdminId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  completedAt: string | null;
  decision: string | null;
  decisionReasonCodes: string[];
  publicComment: string | null;
  internalComment: string | null;
  submittedSnapshot: {
    profile?: {
      firstName: string;
      lastName: string;
      birthDate: string;
      cityId: string;
    };
    vehicleId?: string;
  };
  duplicateCheckResult: {
    result: string;
    matches: Array<{ category: string; otherDriverId: string }>;
    checkedAt: string;
  } | null;
};

type DocumentRow = {
  id: string;
  type: string;
  status: string;
  fileNameSanitized: string;
  mimeType: string;
  fileSize: number;
  expiresAt: string | null;
  rejectionReasonCode: string | null;
  rejectionComment: string | null;
  previewUrl: string | null;
};

type VehicleRow = {
  id: string;
  brand: string;
  model: string;
  productionYear: number;
  registrationNumberMasked: string;
  status: string;
  verificationStatus: string;
  documents: DocumentRow[];
};

type CaseDetail = {
  case: VerificationCase;
  driverDocuments: DocumentRow[];
  vehicles: VehicleRow[];
};

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const detail = await adminApi<CaseDetail>(`verification/cases/${caseId}`);
  const { case: verificationCase, driverDocuments, vehicles } = detail;
  const snapshotVehicleId = verificationCase.submittedSnapshot?.vehicleId;
  const canDecide = verificationCase.status === 'IN_REVIEW';

  return (
    <main>
      <h1>Кейс верификации</h1>
      <section>
        <h2>
          {verificationCase.submittedSnapshot?.profile?.firstName}{' '}
          {verificationCase.submittedSnapshot?.profile?.lastName}
        </h2>
        <p className="muted">
          Статус: {verificationCase.status} · Приоритет:{' '}
          {verificationCase.priority} · Назначен:{' '}
          {verificationCase.assignedAdminId ?? '—'} · Создан:{' '}
          {new Date(verificationCase.createdAt).toLocaleString('ru-RU')}
        </p>
        {verificationCase.duplicateCheckResult && (
          <p
            className={
              verificationCase.duplicateCheckResult.result === 'NO_MATCH'
                ? 'muted'
                : 'danger'
            }
          >
            Проверка на дубли: {verificationCase.duplicateCheckResult.result}
            {verificationCase.duplicateCheckResult.matches.length > 0 &&
              ` (${verificationCase.duplicateCheckResult.matches
                .map((m) => `${m.category}:${m.otherDriverId}`)
                .join(', ')})`}
          </p>
        )}
        <div className="toolbar">
          <DangerAction
            label="Назначить на себя"
            path={`verification/cases/${caseId}/assign`}
          />
          <DangerAction
            label="Начать рассмотрение"
            path={`verification/cases/${caseId}/start-review`}
          />
          <DangerAction
            label="Эскалировать"
            path={`verification/cases/${caseId}/escalate`}
          />
        </div>
        {canDecide && (
          <>
            <div className="toolbar">
              <DangerAction
                label="Одобрить водителя"
                path={`verification/cases/${caseId}/approve-driver`}
              />
            </div>
            <CaseDecisionForm
              path={`verification/cases/${caseId}/reject-driver`}
              label="Отклонить водителя"
            />
            <CaseDecisionForm
              path={`verification/cases/${caseId}/request-changes`}
              label="Запросить исправления"
            />
          </>
        )}
        <h3>Приостановка допуска (для уже одобренного водителя)</h3>
        <SuspendDriverForm driverId={verificationCase.driverId} />
      </section>

      <section>
        <h2>Документы водителя</h2>
        <DocumentsTable
          documents={driverDocuments}
          approvePath={(documentId) =>
            `verification/cases/${caseId}/documents/${documentId}/approve`
          }
          rejectPath={(documentId) =>
            `verification/cases/${caseId}/documents/${documentId}/reject`
          }
        />
      </section>

      {vehicles.map((vehicle) => (
        <section key={vehicle.id}>
          <h2>
            Автомобиль: {vehicle.brand} {vehicle.model} (
            {vehicle.productionYear}
            ), {vehicle.registrationNumberMasked}
            {vehicle.id === snapshotVehicleId ? ' — подан в этом кейсе' : ''}
          </h2>
          <p className="muted">
            Статус: {vehicle.status} · Проверка: {vehicle.verificationStatus}
          </p>
          <div className="toolbar">
            <DangerAction
              label="Одобрить автомобиль"
              path={`verification/cases/${caseId}/vehicles/${vehicle.id}/approve`}
            />
          </div>
          <CaseDecisionForm
            path={`verification/cases/${caseId}/vehicles/${vehicle.id}/reject`}
            label="Отклонить автомобиль"
          />
          <DocumentsTable
            documents={vehicle.documents}
            approvePath={(documentId) =>
              `verification/cases/${caseId}/vehicles/${vehicle.id}/documents/${documentId}/approve`
            }
            rejectPath={(documentId) =>
              `verification/cases/${caseId}/vehicles/${vehicle.id}/documents/${documentId}/reject`
            }
          />
        </section>
      ))}
    </main>
  );
}

function DocumentsTable({
  documents,
  approvePath,
  rejectPath,
}: {
  documents: DocumentRow[];
  approvePath: (documentId: string) => string;
  rejectPath: (documentId: string) => string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Тип</th>
          <th>Статус</th>
          <th>Файл</th>
          <th>Истекает</th>
          <th>Превью</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr key={document.id}>
            <td>{document.type}</td>
            <td>
              {document.status}
              {document.rejectionReasonCode &&
                ` (${document.rejectionReasonCode}${
                  document.rejectionComment
                    ? `: ${document.rejectionComment}`
                    : ''
                })`}
            </td>
            <td>
              {document.fileNameSanitized} ({document.mimeType})
            </td>
            <td>
              {document.expiresAt
                ? new Date(document.expiresAt).toLocaleDateString('ru-RU')
                : '—'}
            </td>
            <td>
              {document.previewUrl ? (
                <a href={document.previewUrl} target="_blank" rel="noreferrer">
                  Открыть
                </a>
              ) : (
                '—'
              )}
            </td>
            <td>
              {document.status === 'READY_FOR_REVIEW' && (
                <>
                  <DangerAction
                    label="Одобрить"
                    path={approvePath(document.id)}
                  />
                  <RejectDocumentForm path={rejectPath(document.id)} />
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
