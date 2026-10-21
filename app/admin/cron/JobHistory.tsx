"use client";

import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
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
import { JOB_STATUS_TONES } from "./cron-tones";

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
 * affichés en ligne comme en local, que le backend tourne ou non. « Lancé
 * par » (étape 7 du plan gestion-contenu) : le nom, ou « non suivi » et sa
 * raison au survol (D44). Dans la charte depuis l'étape 9, lot 5 (D45 gardait
 * l'ancien style jusque-là) : un ton par statut (D87) ; l'erreur d'un job en
 * échec, ou son action en cours, passe sous sa ligne, sur toute la largeur
 * (D90, comme la note d'un tarif, D74), en aperçu, le texte entier au survol.
 */
export default function JobHistory({ history, error, now }: JobHistoryProps) {
  const pending = history ? describePendingAi(history.pending_ai) : null;

  return (
    <Card aria-labelledby="pipeline-history-title" className="flex flex-col gap-4">
      <CardHeader titleId="pipeline-history-title" title="Historique du pipeline" />

      {pending && <Alert tone="info">{pending}</Alert>}

      {error && <Alert tone="danger">{error}</Alert>}

      {!history && !error && <p className="text-sm text-ink-2">Chargement de l&apos;historique…</p>}

      {history && history.jobs.length === 0 && <p className="text-sm text-ink-2">Aucun job enregistré.</p>}

      {history && history.jobs.length > 0 && (
        <Table caption="Historique du pipeline" className="max-h-[32.5rem] overflow-y-auto">
          <THead>
            <Tr>
              <Th>Début</Th>
              <Th>École</Th>
              <Th>Phase</Th>
              <Th>Origine</Th>
              <Th>Lancé par</Th>
              <Th>Statut</Th>
              <Th align="right">Durée</Th>
            </Tr>
          </THead>
          {history.jobs.map((job) => {
            const status = statusLabel(job.status);
            const active = job.status === "running" || job.status === "queued";
            const failure = job.status === "failed" ? errorPreview(job.error) : null;
            const action = active ? currentAction(job.progress) : null;
            const launcher = launcherLabel(job);
            return (
              <TBody key={job.id} className="border-b border-line last:border-b-0">
                <tr>
                  <Td numeric align="left" className="whitespace-nowrap">
                    {formatStart(job.started_at)}
                  </Td>
                  <Td>{job.school_name}</Td>
                  <Td>{job.phase}</Td>
                  <Td className="whitespace-nowrap">{sourceLabel(job.source)}</Td>
                  <Td className="whitespace-nowrap">
                    <span className={launcher.tracked ? undefined : "text-ink-2"} title={launcher.hint ?? undefined}>
                      {launcher.text}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Badge tone={JOB_STATUS_TONES[status.tone]}>{status.label}</Badge>
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {jobDuration(job, now)}
                  </Td>
                </tr>
                {(failure || action) && (
                  <tr>
                    <Td colSpan={7} className="pt-0 pb-3 text-xs leading-relaxed">
                      <span className="font-medium text-ink">Détail :</span>{" "}
                      {failure ? (
                        <span
                          className="whitespace-pre-wrap break-words text-danger"
                          title={failure.truncated ? job.error ?? undefined : undefined}
                        >
                          {failure.short}
                        </span>
                      ) : (
                        <span className="text-ink-2">{action}</span>
                      )}
                    </Td>
                  </tr>
                )}
              </TBody>
            );
          })}
        </Table>
      )}
    </Card>
  );
}
