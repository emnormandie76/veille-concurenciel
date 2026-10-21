"use client";

import { useState, type ReactNode } from "react";

import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
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
import { ROTATION_MODE_TONES, usageTone } from "./cron-tones";

export interface RotationPanelProps {
  rotation?: RotationBlock;
  /** ADMIN, backend prêt : les boutons « Simuler » et « Lancer » s'affichent. */
  canRun?: boolean;
  /** Après une demande, pour rafraîchir l'état et l'historique. */
  onRunFinished?: () => void;
}

const MODE_LABELS: Record<RotationMode, string> = {
  on_demand: "sur demande",
  ceiling_zero: "plafond à 0",
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

/** Le titre d'un bloc du panneau, et ses chiffres à droite. */
function BlockTitle({ id, title, figures }: { id?: string; title: string; figures?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs font-semibold text-ink-2">
      <span id={id}>{title}</span>
      {figures}
    </div>
  );
}

/**
 * Les passes dues : ce qui est dû, ce que le mois a coûté, la dernière
 * exécution, et — pour un ADMIN, backend prêt — la simulation et le
 * lancement. Le bloc vient de pipeline-status (`scheduler.rotation`) ; voir
 * lib/rotation-status.ts. Il n'y a plus de cron : rien ne part sans un clic.
 *
 * Dans la charte depuis l'étape 9, lot 5 (le style seulement, règle 10) : la
 * confirmation d'une passe réelle passe par le dialogue de la charte (D84),
 * son texte figé à l'ouverture, focus sur « Annuler » ; les crédits du mois en
 * barre native (D86) ; un ton par état (D87).
 */
export default function RotationPanel({ rotation, canRun = false, onRunFinished }: RotationPanelProps) {
  const [maxPasses, setMaxPasses] = useState(1);
  const [running, setRunning] = useState<"dry" | "real" | null>(null);
  const [message, setMessage] = useState<RunMessage | null>(null);
  // Le texte de la confirmation, pris au clic : l'écran se rafraîchit toutes
  // les 5 s, et ce qu'on confirme doit être ce qu'on a lu.
  const [confirming, setConfirming] = useState<string | null>(null);

  const status = rotation && !isRotationError(rotation) ? rotation : null;
  const mode = status ? rotationMode(status) : null;
  const usage = status ? ceilingUsage(status) : null;
  const sync = status ? describeUsageSync(status.usage_sync) : null;
  // Plafond à 0 : rien ne tient — ni barre pleine ni badge « hors plafond »
  // sur chaque ligne.
  const ceilingHints = status !== null && status.monthly_ceiling > 0;

  // Une passe réelle paie : elle ne part que du bouton du dialogue de
  // confirmation (D84) ; la simulation part directement.
  async function runDuePasses(dryRun: boolean) {
    if (!status) return;

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

  function openConfirm() {
    if (!status) return;
    setConfirming(confirmText(status, maxPasses));
  }

  function closeConfirm() {
    setConfirming(null);
  }

  const confirmLines = confirming ? confirming.split("\n") : [];
  const runLabel = `Lancer ${maxPasses} passe${maxPasses > 1 ? "s" : ""} due${maxPasses > 1 ? "s" : ""}`;

  return (
    <section aria-labelledby="rotation-title" className="overflow-hidden rounded-control border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-4 py-3">
        <h3 id="rotation-title" className="text-sm font-semibold text-ink">
          Passes dues
        </h3>
        {mode && <Badge tone={ROTATION_MODE_TONES[mode]}>{MODE_LABELS[mode]}</Badge>}
      </div>

      <div className="flex flex-col gap-4 px-4 py-3">
        {!rotation && <p className="text-xs text-ink-2">Le backend ne remonte pas l&apos;état des passes dues.</p>}

        {rotation && isRotationError(rotation) && (
          <p className="text-sm text-danger">État des passes dues illisible : {rotation.error}</p>
        )}

        {status && (
          <>
            <p className="text-sm text-ink">{describeRotation(status)}</p>

            <div className="flex flex-col gap-1.5">
              <BlockTitle
                id="rotation-credits-title"
                title="Crédits du mois (estimés)"
                figures={
                  usage ? (
                    <span className="font-normal tabular-nums">
                      <strong className="font-semibold text-ink">{usage.used}</strong> / {usage.ceiling} du plafond
                    </span>
                  ) : (
                    <span className="font-normal">inconnus — aucune clé Tavily chargée</span>
                  )
                }
              />
              {usage && ceilingHints && (
                <ProgressBar
                  value={usage.used}
                  max={usage.ceiling}
                  tone={usageTone(usage.used, usage.ceiling)}
                  aria-labelledby="rotation-credits-title"
                />
              )}
              {sync && <p className={sync.tone === "ok" ? "text-xs text-ink-2" : "text-xs text-warning"}>{sync.text}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <BlockTitle
                title="Prochaines passes"
                figures={
                  <span className="font-normal tabular-nums">
                    {status.due_count} due{status.due_count > 1 ? "s" : ""}
                  </span>
                }
              />
              {status.next.length === 0 ? (
                <p className="text-xs text-ink-2">Aucune passe due.</p>
              ) : (
                <ul className="flex flex-col">
                  {status.next.map((candidate) => {
                    const fits = fitsUnderCeiling(candidate, status);
                    return (
                      <li
                        key={`${candidate.school_name}-${candidate.phase}`}
                        className="flex flex-col gap-0.5 border-b border-line py-1.5 text-xs last:border-b-0"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="min-w-0 font-semibold text-ink">
                            {candidate.school_name}
                            <span className="font-normal text-ink-2"> · Phase {candidate.phase}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums text-ink">
                            ~{candidate.estimated_credits} crédits
                            {ceilingHints && fits === false && <Badge tone="warning">hors plafond</Badge>}
                          </span>
                        </div>
                        <div className="text-ink-2">
                          {REASON_LABELS[candidate.reason]}
                          {candidate.last_pass_at && <> · dernier passage {formatPassDate(candidate.last_pass_at)}</>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <BlockTitle title="Dernière exécution" />
              {status.last_run ? (
                <p className={status.last_run.status === "failed" ? "text-sm text-danger" : "text-sm text-ink"}>
                  {status.last_run.detail || "—"}
                  <span className="text-xs text-ink-2"> — {formatDateTime(status.last_run.finished_at)}</span>
                </p>
              ) : (
                <p className="text-xs text-ink-2">Aucune exécution réelle depuis le démarrage du backend.</p>
              )}
            </div>

            {canRun && (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="rotation-max-passes" className="text-xs text-ink-2">
                    Au plus
                  </label>
                  <Select
                    id="rotation-max-passes"
                    value={maxPasses}
                    onChange={(e) => setMaxPasses(Number(e.target.value))}
                    disabled={running !== null}
                  >
                    {Array.from({ length: MAX_PASSES_PER_RUN }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                  <span className="text-xs text-ink-2">passe{maxPasses > 1 ? "s" : ""}</span>
                  <Button size="sm" onClick={() => runDuePasses(true)} disabled={running !== null}>
                    {running === "dry" ? "Simulation…" : "Simuler"}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={openConfirm}
                    disabled={running !== null || status.due_count === 0}
                  >
                    {running === "real" ? "Synchro /usage, puis départ…" : runLabel}
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-ink-2">
                  La simulation ne paie rien et ne crée aucun job. Le lancement paie Research ; il attend
                  d&apos;abord la synchro /usage des crédits (jusqu&apos;à 20 s).
                </p>
                {message && (
                  <Alert tone={message.tone === "error" ? "danger" : message.tone}>{message.text}</Alert>
                )}
              </div>
            )}

            {confirming && (
              <Dialog title={confirmLines[0]} titleId="rotation-confirm-title" onClose={closeConfirm}>
                <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink">
                  {confirmLines.slice(1).map((line, index) => (line ? <p key={index}>{line}</p> : null))}
                </div>
                <DialogFooter>
                  <Button data-autofocus onClick={closeConfirm}>
                    Annuler
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setConfirming(null);
                      runDuePasses(false);
                    }}
                  >
                    {runLabel}
                  </Button>
                </DialogFooter>
              </Dialog>
            )}
          </>
        )}
      </div>
    </section>
  );
}
