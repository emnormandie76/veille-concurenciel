"use client";

import { useState } from "react";

import { describeBackendError } from "@/lib/backend-state";
import {
  MAX_PASSES_PER_RUN,
  REASON_LABELS,
  ceilingUsage,
  describeCandidate,
  describeDuePassesReport,
  describeRotation,
  describeUsageSync,
  fitsUnderCeiling,
  formatPassDate,
  isRotationError,
  previewRun,
  rotationMode,
  type DuePassesReport,
  type RotationBlock,
  type RotationMode,
  type RotationStatus,
} from "@/lib/rotation-status";

export interface RotationPanelProps {
  rotation?: RotationBlock;
  /** ADMIN, backend prêt : les boutons « Simuler » et « Lancer » s'affichent. */
  canRun?: boolean;
  /** Après une demande, pour rafraîchir l'état et l'historique. */
  onRunFinished?: () => void;
}

const MODE_BADGES: Record<RotationMode, { label: string; className: string }> = {
  on_demand: { label: "sur demande", className: "badge-on" },
  ceiling_zero: { label: "plafond à 0", className: "badge-dry" },
};

type RunMessage = { tone: "success" | "info" | "error"; text: string };

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/** Le texte de confirmation d'un lancement réel : il paie Research. */
function confirmText(status: RotationStatus, maxPasses: number): string {
  const preview = previewRun(status, maxPasses);
  const lines = [
    `Lancer au plus ${maxPasses} passe${maxPasses > 1 ? "s" : ""} due${maxPasses > 1 ? "s" : ""} ?`,
    "",
    "Elles paient Research (crédits Tavily) et Gemini.",
  ];
  if (preview === null) {
    lines.push("Crédits du mois inconnus : pas d'aperçu.");
  } else if (preview.passes.length === 0) {
    lines.push("Aperçu : aucune des passes affichées ne tient sous le plafond.");
  } else {
    lines.push(
      `Aperçu : ${preview.passes.map(describeCandidate).join(" ; ")}`,
      `Soit ~${preview.credits} crédits estimés.`,
    );
  }
  lines.push("", "Le backend recale d'abord les crédits sur Tavily (/usage, jusqu'à 20 s), puis replanifie.");
  return lines.join("\n");
}

/**
 * Les passes dues : ce qui est dû, ce que le mois a coûté, la dernière
 * exécution, et — pour un ADMIN, backend prêt — la simulation et le
 * lancement. Le bloc vient de pipeline-status (`scheduler.rotation`) ; voir
 * lib/rotation-status.ts. Il n'y a plus de cron : rien ne part sans un clic.
 */
export default function RotationPanel({ rotation, canRun = false, onRunFinished }: RotationPanelProps) {
  const [maxPasses, setMaxPasses] = useState(1);
  const [running, setRunning] = useState<"dry" | "real" | null>(null);
  const [message, setMessage] = useState<RunMessage | null>(null);

  const status = rotation && !isRotationError(rotation) ? rotation : null;
  const mode = status ? rotationMode(status) : null;
  const usage = status ? ceilingUsage(status) : null;
  const sync = status ? describeUsageSync(status.usage_sync) : null;
  // Plafond à 0 : rien ne tient — ni barre pleine ni badge « hors plafond »
  // sur chaque ligne.
  const ceilingHints = status !== null && status.monthly_ceiling > 0;

  async function runDuePasses(dryRun: boolean) {
    if (!status) return;
    // Une passe réelle paie : jamais sans confirmation explicite.
    if (!dryRun && !window.confirm(confirmText(status, maxPasses))) return;

    setRunning(dryRun ? "dry" : "real");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/run-due-passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // dry_run toujours explicite : la route le refuse absent.
        body: JSON.stringify({ max_passes: maxPasses, dry_run: dryRun }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setMessage(describeDuePassesReport(body as DuePassesReport));
      } else {
        setMessage({ tone: "error", text: describeBackendError(res.status, body) });
      }
    } catch {
      setMessage({ tone: "error", text: "Serveur Next.js injoignable : la demande n'est pas partie." });
    } finally {
      setRunning(null);
      onRunFinished?.();
    }
  }

  return (
    <div className="rotation-panel">
      <div className="rotation-header">
        <span className="header-title">🔄 Passes dues</span>
        {mode && <span className={`mode-badge ${MODE_BADGES[mode].className}`}>{MODE_BADGES[mode].label}</span>}
      </div>

      <div className="rotation-body">
        {!rotation && <p className="muted">Le backend ne remonte pas l&apos;état des passes dues.</p>}

        {rotation && isRotationError(rotation) && (
          <p className="error-line">⚠️ État des passes dues illisible : {rotation.error}</p>
        )}

        {status && (
          <>
            <p className="state-line">{describeRotation(status)}</p>

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
              {sync && <p className={sync.tone === "ok" ? "muted" : "warning-line"}>{sync.text}</p>}
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
                <span>Dernière exécution</span>
              </div>
              {status.last_run ? (
                <p className={status.last_run.status === "failed" ? "error-line" : "last-line"}>
                  {status.last_run.status === "failed" ? "❌" : "✅"} {status.last_run.detail || "—"}
                  <span className="muted"> — {formatDateTime(status.last_run.finished_at)}</span>
                </p>
              ) : (
                <p className="muted">Aucune exécution réelle depuis le démarrage du backend.</p>
              )}
            </div>

            {canRun && (
              <div className="block run-block">
                <div className="run-controls">
                  <label className="run-label">
                    Au plus
                    <select
                      className="run-select"
                      value={maxPasses}
                      onChange={(e) => setMaxPasses(Number(e.target.value))}
                      disabled={running !== null}
                    >
                      {Array.from({ length: MAX_PASSES_PER_RUN }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    passe{maxPasses > 1 ? "s" : ""}
                  </label>
                  <button
                    type="button"
                    className="run-btn run-dry"
                    onClick={() => runDuePasses(true)}
                    disabled={running !== null}
                  >
                    {running === "dry" ? "⏳ Simulation…" : "🧪 Simuler"}
                  </button>
                  <button
                    type="button"
                    className="run-btn run-real"
                    onClick={() => runDuePasses(false)}
                    disabled={running !== null || status.due_count === 0}
                  >
                    {running === "real"
                      ? "⏳ Synchro /usage, puis départ…"
                      : `🚀 Lancer ${maxPasses} passe${maxPasses > 1 ? "s" : ""} due${maxPasses > 1 ? "s" : ""}`}
                  </button>
                </div>
                <p className="muted">
                  La simulation ne paie rien et ne crée aucun job. Le lancement paie Research ; il attend
                  d&apos;abord la synchro /usage des crédits (jusqu&apos;à 20 s).
                </p>
                {message && <p className={`run-message tone-${message.tone}`}>{message.text}</p>}
              </div>
            )}
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

        .warning-line {
          margin: 0;
          font-size: 0.8rem;
          color: var(--warning, #f59e0b);
        }

        .run-block {
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding-top: 12px;
        }

        .run-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .run-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 0.8rem;
          color: var(--text-secondary, #94a3b8);
        }

        .run-select {
          background-color: rgba(255, 255, 255, 0.04);
          color: var(--text-primary, #ffffff);
          border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
          border-radius: 6px;
          padding: 2px 6px;
        }

        .run-btn {
          font-size: 0.8rem;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid transparent;
          cursor: pointer;
        }

        .run-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .run-dry {
          color: var(--text-primary, #ffffff);
          background-color: rgba(255, 255, 255, 0.05);
          border-color: var(--border-color, rgba(255, 255, 255, 0.15));
        }

        .run-real {
          color: #ffffff;
          background-color: var(--accent, #3b82f6);
        }

        .run-message {
          margin: 0;
          font-size: 0.82rem;
        }

        .tone-success {
          color: var(--success, #10b981);
        }

        .tone-info {
          color: var(--text-primary, #ffffff);
        }

        .tone-error {
          color: var(--danger, #ef4444);
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
