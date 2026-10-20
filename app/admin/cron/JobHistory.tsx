"use client";

import {
  currentAction,
  describePendingAi,
  errorPreview,
  jobDuration,
  launcherLabel,
  sourceLabel,
  statusLabel,
  type PipelineJobsResponse,
} from "@/lib/pipeline-history";

export interface JobHistoryProps {
  history: PipelineJobsResponse | null;
  error: string | null;
  /** Heure courante (ms), pour la durée des jobs actifs. */
  now: number;
}

function formatStart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Les 30 derniers jobs du pipeline, lus en base (/api/admin/pipeline-jobs) :
 * affichés en ligne comme en local, que le backend tourne ou non. L'erreur
 * d'un job en échec s'affiche en aperçu, le texte entier au survol. « Lancé
 * par » (étape 7 du plan gestion-contenu) : le nom, ou « non suivi » et sa
 * raison au survol (D44) ; à l'ancien style de l'écran (D45).
 */
export default function JobHistory({ history, error, now }: JobHistoryProps) {
  const pending = history ? describePendingAi(history.pending_ai) : null;

  return (
    <div className="card history-card">
      <h2 className="section-title">🗂️ Historique du pipeline</h2>

      {pending && <p className="pending-line">⏳ {pending}</p>}

      {error && <p className="history-error">⚠️ {error}</p>}

      {!history && !error && <div className="history-muted">Chargement de l&apos;historique…</div>}

      {history && history.jobs.length === 0 && (
        <div className="history-muted">Aucun job enregistré.</div>
      )}

      {history && history.jobs.length > 0 && (
        <div className="history-scroll">
          <table className="admin-table history-table">
            <thead>
              <tr>
                <th>Début</th>
                <th>École</th>
                <th>Phase</th>
                <th>Origine</th>
                <th>Lancé par</th>
                <th>Statut</th>
                <th>Durée</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {history.jobs.map((job) => {
                const status = statusLabel(job.status);
                const active = job.status === "running" || job.status === "queued";
                const failure = job.status === "failed" ? errorPreview(job.error) : null;
                const action = active ? currentAction(job.progress) : null;
                const launcher = launcherLabel(job);
                return (
                  <tr key={job.id}>
                    <td className="cell-nowrap">{formatStart(job.started_at)}</td>
                    <td>{job.school_name}</td>
                    <td>{job.phase}</td>
                    <td className="cell-nowrap">{sourceLabel(job.source)}</td>
                    <td className="cell-nowrap">
                      <span
                        className={launcher.tracked ? undefined : "history-muted-inline"}
                        title={launcher.hint ?? undefined}
                      >
                        {launcher.text}
                      </span>
                    </td>
                    <td className="cell-nowrap">
                      <span className={`status-pill tone-${status.tone}`}>{status.label}</span>
                    </td>
                    <td className="cell-nowrap">{jobDuration(job, now)}</td>
                    <td className="cell-detail">
                      {failure ? (
                        <span className="job-error" title={failure.truncated ? job.error ?? undefined : undefined}>
                          {failure.short}
                        </span>
                      ) : action ? (
                        <span className="job-action">{action}</span>
                      ) : (
                        <span className="history-muted-inline">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .history-card {
          margin-top: 24px;
        }

        .section-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 20px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 10px;
        }

        .pending-line {
          margin: 0 0 12px;
          padding: 10px 14px;
          border-radius: var(--radius-md);
          background-color: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.25);
          color: var(--warning, #f59e0b);
          font-size: 0.85rem;
        }

        .history-error {
          margin: 0 0 12px;
          color: var(--danger, #ef4444);
          font-size: 0.85rem;
        }

        .history-muted {
          padding: 16px;
          color: var(--text-secondary);
          font-size: 0.85rem;
        }

        .history-scroll {
          max-height: 520px;
          overflow: auto;
        }

        .history-table :global(th),
        .history-table :global(td) {
          padding: 10px 14px;
          font-size: 0.8rem;
          vertical-align: top;
        }

        .cell-nowrap {
          white-space: nowrap;
        }

        .cell-detail {
          min-width: 220px;
          max-width: 420px;
        }

        .status-pill {
          font-size: 0.72rem;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 9999px;
          border: 1px solid transparent;
        }

        .tone-ok {
          color: var(--success, #10b981);
          background-color: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.25);
        }

        .tone-error {
          color: var(--danger, #ef4444);
          background-color: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.25);
        }

        .tone-pending {
          color: var(--warning, #f59e0b);
          background-color: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.25);
        }

        .job-error {
          color: var(--danger, #ef4444);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .job-action {
          color: var(--text-secondary);
        }

        .history-muted-inline {
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
