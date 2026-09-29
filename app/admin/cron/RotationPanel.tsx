"use client";

import {
  REASON_LABELS,
  ceilingUsage,
  describeRotation,
  fitsUnderCeiling,
  formatPassDate,
  isRotationError,
  rotationMode,
  type ResearchCron,
  type RotationBlock,
  type RotationMode,
} from "@/lib/rotation-status";

export interface RotationPanelProps {
  rotation?: RotationBlock;
  researchCron?: ResearchCron;
}

const MODE_BADGES: Record<RotationMode, { label: string; className: string }> = {
  active: { label: "active", className: "badge-on" },
  dry_run: { label: "à blanc", className: "badge-dry" },
  inactive: { label: "inactive", className: "badge-off" },
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Ce que la rotation nocturne des recherches va faire, et ce qu'elle a coûté.
 * Le bloc vient de pipeline-status (`scheduler.rotation`) ; voir
 * lib/rotation-status.ts.
 */
export default function RotationPanel({ rotation, researchCron }: RotationPanelProps) {
  const status = rotation && !isRotationError(rotation) ? rotation : null;
  const mode = status ? rotationMode(status) : null;
  const usage = status ? ceilingUsage(status) : null;
  // Plafond à 0 : rien ne tient, c'est le but de la vérification à blanc — ni
  // barre pleine ni badge « hors plafond » sur chaque ligne.
  const ceilingHints = status !== null && status.monthly_ceiling > 0;

  return (
    <div className="rotation-panel">
      <div className="rotation-header">
        <span className="header-title">🔄 Rotation automatique</span>
        {mode && <span className={`mode-badge ${MODE_BADGES[mode].className}`}>{MODE_BADGES[mode].label}</span>}
      </div>

      <div className="rotation-body">
        {!rotation && <p className="muted">Le backend ne remonte pas l&apos;état de la rotation.</p>}

        {rotation && isRotationError(rotation) && (
          <p className="error-line">⚠️ État de la rotation illisible : {rotation.error}</p>
        )}

        {status && (
          <>
            <p className="state-line">{describeRotation(status, researchCron)}</p>

            <div className="block">
              <div className="block-title">
                <span>Crédits du mois (estimés)</span>
                {usage ? (
                  <span className="figures">
                    <strong>{usage.used}</strong> / {usage.ceiling} du plafond
                  </span>
                ) : (
                  <span className="muted">inconnus — aucune clé Tavily chargée</span>
                )}
              </div>
              {usage && ceilingHints && (
                <div className="progress-bg">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${usage.pct}%`,
                      backgroundColor:
                        usage.pct >= 100
                          ? "var(--danger, #ef4444)"
                          : usage.pct >= 75
                            ? "var(--warning, #f59e0b)"
                            : "var(--success, #10b981)",
                    }}
                  ></div>
                </div>
              )}
            </div>

            <div className="block">
              <div className="block-title">
                <span>Prochaines passes</span>
                <span className="figures">{status.due_count} due{status.due_count > 1 ? "s" : ""}</span>
              </div>
              {status.next.length === 0 ? (
                <p className="muted">Aucune passe due.</p>
              ) : (
                <ul className="pass-list">
                  {status.next.map((candidate) => {
                    const fits = fitsUnderCeiling(candidate, status);
                    return (
                      <li key={`${candidate.school_name}-${candidate.phase}`} className="pass-row">
                        <div className="pass-main">
                          <span className="pass-school">
                            {candidate.school_name}
                            <span className="pass-phase"> · Phase {candidate.phase}</span>
                          </span>
                          <span className="pass-cost">
                            ~{candidate.estimated_credits} crédits
                            {ceilingHints && fits === false && <span className="over-badge">hors plafond</span>}
                          </span>
                        </div>
                        <div className="pass-reason">
                          {REASON_LABELS[candidate.reason]}
                          {candidate.last_pass_at && <> · dernier passage {formatPassDate(candidate.last_pass_at)}</>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="block">
              <div className="block-title">
                <span>Dernière nuit</span>
              </div>
              {status.last_night ? (
                <p className={status.last_night.status === "failed" ? "error-line" : "last-line"}>
                  {status.last_night.status === "failed" ? "❌" : "✅"} {status.last_night.detail || "—"}
                  <span className="muted"> — {formatDateTime(status.last_night.finished_at)}</span>
                </p>
              ) : (
                <p className="muted">Aucune nuit depuis le démarrage du backend.</p>
              )}
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .rotation-panel {
          border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
          border-radius: var(--radius-md, 8px);
          background-color: rgba(255, 255, 255, 0.01);
          overflow: hidden;
          margin-top: 12px;
        }

        .rotation-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background-color: rgba(255, 255, 255, 0.02);
          border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
        }

        .header-title {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-primary, #ffffff);
        }

        .mode-badge {
          font-size: 0.75rem;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 9999px;
          border: 1px solid transparent;
        }

        .badge-on {
          color: var(--success, #10b981);
          background-color: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.25);
        }

        .badge-dry {
          color: var(--warning, #f59e0b);
          background-color: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.3);
        }

        .badge-off {
          color: var(--text-secondary, #94a3b8);
          background-color: rgba(148, 163, 184, 0.12);
          border-color: rgba(148, 163, 184, 0.25);
        }

        .rotation-body {
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .state-line,
        .last-line {
          margin: 0;
          font-size: 0.85rem;
          color: var(--text-primary, #ffffff);
        }

        .error-line {
          margin: 0;
          font-size: 0.85rem;
          color: var(--danger, #ef4444);
        }

        .muted {
          margin: 0;
          font-size: 0.8rem;
          color: var(--text-secondary, #94a3b8);
        }

        .block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .block-title {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary, #94a3b8);
        }

        .figures {
          font-weight: 400;
          font-variant-numeric: tabular-nums;
        }

        .figures strong {
          color: var(--text-primary, #ffffff);
        }

        .progress-bg {
          width: 100%;
          height: 4px;
          background-color: rgba(255, 255, 255, 0.08);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .pass-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
        }

        .pass-row {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 6px 0;
          font-size: 0.8rem;
        }

        .pass-row:not(:last-child) {
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }

        .pass-main {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .pass-school {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-primary, #ffffff);
          font-weight: 600;
        }

        .pass-phase {
          font-weight: 400;
          color: var(--text-secondary, #94a3b8);
        }

        .pass-reason {
          font-size: 0.75rem;
          color: var(--text-secondary, #94a3b8);
        }

        .pass-cost {
          font-variant-numeric: tabular-nums;
          color: var(--text-primary, #ffffff);
          text-align: right;
          white-space: nowrap;
        }

        .over-badge {
          margin-left: 6px;
          font-size: 0.7rem;
          color: var(--warning, #f59e0b);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 9999px;
          padding: 1px 6px;
        }
      `}</style>
    </div>
  );
}
