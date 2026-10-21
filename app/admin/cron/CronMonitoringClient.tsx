"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminPage } from "@/components/layout/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { Field, Select } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { CROWDSOURCING_TEXT_TONES } from "./cron-tones";
import JobHistory from "./JobHistory";
import QuotaTavilyPanel from "./QuotaTavilyPanel";
import RotationPanel from "./RotationPanel";
import { buildLaunchBody, describeCampusCollection } from "@/lib/trigger-research";
import type { RotationBlock } from "@/lib/rotation-status";
import { describeAiModels, type AiModelsBlock } from "@/lib/ai-models";
import { describeCrowdsourcing, type CrowdsourcingBlock } from "@/lib/crowdsourcing-status";
import {
  LOCAL_BACKEND_COMMAND,
  backendState,
  describeBackendError,
  type BackendState,
} from "@/lib/backend-state";
import type { PipelineJobsResponse } from "@/lib/pipeline-history";

// ── Interfaces ─────────────────────────────────────────────────

interface TavilyKeyStatus {
  key_suffix: string;
  credits_used: number;
  credits_limit: number;
  credits_remaining: number;
  exhausted: boolean;
}

interface ProgressDetails {
  current_action: string;
  school?: string;
  program?: string;
  category?: string;
  progress?: string; // ex: "5/12"
  tickets_created?: number;
  updated_at?: number;
}

interface PipelineJob {
  job_id: string;
  school_id: string;
  phase: string;
  status: string;
  priority?: string;
  source?: string;
  categories?: string[];
  program_id?: string;
  error?: string;
  created_at?: number;
  progress_details?: ProgressDetails;
}

interface SchedulerStatus {
  running: boolean;
  rotation?: RotationBlock;
  crowdsourcing?: CrowdsourcingBlock;
}

interface PipelineStatus {
  status: string;
  database: string;
  startup_errors?: string[];
  pipeline_jobs_active: number;
  pipeline_jobs: PipelineJob[];
  cron_jobs: PipelineJob[];
  tavily: TavilyKeyStatus[];
  ai_models?: AiModelsBlock;
  scheduler?: SchedulerStatus;
}

interface ProgramInfo {
  id: string;
  name: string;
}

interface CampusInfo {
  id: string;
  name: string;
  programs: ProgramInfo[];
}

interface SchoolWithPrograms {
  id: string;
  name: string;
  official_domain: string;
  campuses: CampusInfo[];
}

// ── Helper: format elapsed time ────────────────────────────────

function formatElapsed(seconds: number): string {
  if (seconds < 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Helper: parse progress fraction ────────────────────────────

function parseProgress(progress?: string): { done: number; total: number } | null {
  if (!progress) return null;
  const match = progress.match(/^(\d+)\/(\d+)$/);
  if (!match) return null;
  return { done: parseInt(match[1]), total: parseInt(match[2]) };
}

// ── Un segment du choix de la phase (D89) : le choisi en accent ─

function phaseButtonClasses(selected: boolean): string {
  return cx(
    "flex-1 px-4 py-2 text-compact transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
    selected
      ? "bg-accent-soft font-semibold text-accent-strong shadow-[inset_0_-2px_0_var(--color-accent)]"
      : "bg-surface font-medium text-ink-2 hover:bg-surface-2 hover:text-ink",
  );
}

// ── Category labels in French ──────────────────────────────────
// Sans leurs émojis depuis l'étape 9, lot 5 (D56) : les textes restent.

const CATEGORY_LABELS: Record<string, string> = {
  Pricing: "Tarifs",
  Ranking: "Classements",
  Capacity: "Places",
  SchoolStats: "Statistiques école",
  Accreditation: "Accréditations",
};

// Ranking est collecte au niveau ecole : un seul appel Research couvre tous les
// programmes, et le rapport est ensuite decoupe en un ticket par classement.
// Voir SCHOOL_LEVEL_CATEGORIES dans backend/pipeline/phase2_research.py.
const PROGRAM_CATEGORIES = ["Pricing", "Capacity"];
const SCHOOL_CATEGORIES = ["SchoolStats", "Accreditation", "Ranking"];

// Rafraîchissements : l'état du backend toutes les 5 s, l'historique (base)
// toutes les 10 s.
const STATUS_POLL_MS = 5000;
const HISTORY_POLL_MS = 10000;

const BACKEND_LABELS: Record<BackendState["kind"], string> = {
  ready: "prêt",
  local_only: "absent (site en ligne)",
  not_running: "non lancé",
  error: "injoignable",
};

export interface CronMonitoringClientProps {
  /**
   * Lu côté serveur (page.tsx) : seuls les ADMIN lancent. La page exige déjà
   * le rôle : le texte « Réservé aux ADMIN », qui ne s'affichait jamais, est
   * retiré (étape 9, lot 5, D81) ; les contrôles restent.
   */
  isAdmin: boolean;
}

export default function CronMonitoringClient({ isAdmin }: CronMonitoringClientProps) {
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Trois états du backend local (lib/backend-state.ts) : pilotage depuis le
  // poste local (en ligne), non lancé, prêt ; ou une erreur dite en clair.
  // null tant que la première réponse n'est pas arrivée.
  const [backend, setBackend] = useState<BackendState | null>(null);
  const backendRef = useRef<BackendState | null>(null);
  const statusInFlight = useRef(false);

  // Historique, lu en base : affiché que le backend tourne ou non.
  const [history, setHistory] = useState<PipelineJobsResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyInFlight = useRef(false);

  // ── Recherche manuelle ───────────────────────────────────────
  const [schools, setSchools] = useState<SchoolWithPrograms[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<"1" | "2">("1");
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>("");
  const [selectedProgramId, setSelectedProgramId] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  // Phase 1 : collecte du rattachement campus, pour cette passe et cette école
  // seulement. Décochée par défaut, et décochée de nouveau après chaque
  // lancement comme à chaque changement d'école ou de phase.
  const [collectCampusAttachments, setCollectCampusAttachments] = useState(false);
  const [launchingResearch, setLaunchingResearch] = useState(false);
  const [launchMessage, setLaunchMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ── Horloge pour la durée des tâches ─────────────────────────
  const [now, setNow] = useState(() => Date.now());

  // ── Derived: selected school and its programs ────────────────
  const selectedSchool = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId) || null,
    [schools, selectedSchoolId]
  );

  const allPrograms = useMemo(() => {
    if (!selectedSchool) return [];
    return selectedSchool.campuses.flatMap((c) =>
      c.programs.map((p) => ({ ...p, campusName: c.name }))
    );
  }, [selectedSchool]);

  // ── Fetch functions ──────────────────────────────────────────

  // Un appel à la fois : la route attend le backend jusqu'à 8 s, plus que
  // l'intervalle de rafraîchissement.
  const fetchPipelineStatus = useCallback(async () => {
    if (statusInFlight.current) return;
    statusInFlight.current = true;
    let next: BackendState;
    let data: PipelineStatus | null = null;
    try {
      const res = await fetch("/api/admin/pipeline-status", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      next = backendState(res.status, body);
      if (next.kind === "ready") data = body as PipelineStatus;
    } catch {
      next = { kind: "error", message: "Serveur Next.js injoignable : vérifiez la connexion." };
    } finally {
      statusInFlight.current = false;
    }
    backendRef.current = next;
    setBackend(next);
    // Hors de l'état « prêt », plus de jobs actifs ni de quotas : des données
    // d'avant la coupure tromperaient.
    setPipelineStatus(data);
    setLoadingStatus(false);
  }, []);

  const fetchHistory = useCallback(async () => {
    if (historyInFlight.current) return;
    historyInFlight.current = true;
    try {
      const res = await fetch("/api/admin/pipeline-jobs", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(describeBackendError(res.status, body));
      setHistory(body as PipelineJobsResponse);
      setHistoryError(null);
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : "Historique illisible");
    } finally {
      historyInFlight.current = false;
    }
  }, []);

  const refreshAll = useCallback(() => {
    fetchPipelineStatus();
    fetchHistory();
  }, [fetchPipelineStatus, fetchHistory]);



  const fetchSchools = useCallback(async () => {
    setLoadingSchools(true);
    try {
      const res = await fetch("/api/admin/schools-with-programs");
      if (!res.ok) throw new Error("Impossible de charger les écoles");
      const data = await res.json();
      setSchools(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingSchools(false);
    }
  }, []);

  // ── Polling + init ───────────────────────────────────────────

  useEffect(() => {
    refreshAll();
    fetchSchools();

    // En ligne (pas de backend), l'état ne changera pas sans redéploiement :
    // on ne redemande plus. Backend non lancé ou en erreur : on redemande,
    // pour voir le backend dès qu'il démarre.
    const statusInterval = setInterval(() => {
      if (backendRef.current?.kind !== "local_only") fetchPipelineStatus();
    }, STATUS_POLL_MS);
    const historyInterval = setInterval(fetchHistory, HISTORY_POLL_MS);

    // Horloge de l'écran, pour la durée des tâches en cours
    const clockInterval = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(historyInterval);
      clearInterval(clockInterval);
    };
  }, [refreshAll, fetchPipelineStatus, fetchHistory, fetchSchools]);

  // Reset categories when phase or school changes
  useEffect(() => {
    setSelectedCategories([]);
    setSelectedProgramId("");
    setCollectCampusAttachments(false);
  }, [selectedPhase, selectedSchoolId]);

  // ── Handlers ─────────────────────────────────────────────────

  const handleCategoryToggle = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleLaunchResearch = async () => {
    if (!selectedSchoolId) return;

    setLaunchingResearch(true);
    setLaunchMessage(null);

    try {
      const body = buildLaunchBody({
        schoolId: selectedSchoolId,
        phase: selectedPhase,
        programId: selectedProgramId,
        categories: selectedCategories,
        collectCampusAttachments,
      });

      const res = await fetch("/api/admin/trigger-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // Réponse de Next.js (`error`) ou refus du backend relayé tel quel
        // (`detail`) : une école occupée répond 409 ALREADY_RUNNING, et son
        // message nomme le job en cours (plan backend-local, étape 7).
        throw new Error(describeBackendError(res.status, data));
      }

      // Étape 9, lot 5 : plus de symbole de réussite ou d'avertissement en tête
      // (D78 : le ton du message le dit), ni « Job #<id> », que rien à l'écran
      // ne rapproche (D82, D46).
      if (selectedPhase === "1") {
        const confirmed = typeof data.collect_campus_attachments === "boolean";
        setLaunchMessage({
          type: confirmed ? "success" : "error",
          text: `${data.message} · ${describeCampusCollection(data.collect_campus_attachments)}`,
        });
        setCollectCampusAttachments(false);
        setTimeout(refreshAll, 1000);
      } else {
        setLaunchMessage({
          type: "success",
          text: `${data.message}`,
        });
        // Rafraîchir pour montrer le nouveau job
        setTimeout(refreshAll, 1000);
      }
    } catch (err: any) {
      setLaunchMessage({
        type: "error",
        text: err.message || "Erreur lors du lancement de la recherche",
      });
    } finally {
      setLaunchingResearch(false);
    }
  };

  // ── Derived: check if a school already has a running job ─────
  const schoolHasActiveJob = useMemo(() => {
    if (!selectedSchoolId || !pipelineStatus) return false;
    return pipelineStatus.pipeline_jobs.some(
      (j) => j.school_id === selectedSchoolId && ["running", "queued"].includes(j.status)
    );
  }, [selectedSchoolId, pipelineStatus]);

  // ── Derived: available categories based on selection ─────────
  const availableCategories = useMemo(() => {
    if (selectedPhase === "1") return [];
    if (selectedProgramId) return PROGRAM_CATEGORIES;
    // No program selected = all categories available
    return [...SCHOOL_CATEGORIES, ...PROGRAM_CATEGORIES];
  }, [selectedPhase, selectedProgramId]);



  // ── Can launch? ──────────────────────────────────────────────
  // Un lancement exige un ADMIN et un backend qui répond (architecture.md §7.4).
  const backendReady = backend?.kind === "ready";
  // Les modèles réellement appelés et le dernier passage utile du traitement des
  // contributions : la logique d'affichage est dans lib/ (testée sans serveur).
  const aiModels = describeAiModels(pipelineStatus?.ai_models);
  const crowdsourcing = describeCrowdsourcing(pipelineStatus?.scheduler?.crowdsourcing);
  const canLaunch = useMemo(() => {
    if (!isAdmin || !backendReady) return false;
    if (!selectedSchoolId) return false;
    if (schoolHasActiveJob) return false;
    if (launchingResearch) return false;
    if (selectedPhase === "2" && selectedProgramId && selectedCategories.length === 0) return false;
    return true;
  }, [isAdmin, backendReady, selectedSchoolId, schoolHasActiveJob, launchingResearch, selectedPhase, selectedProgramId, selectedCategories]);

  const startupErrors = pipelineStatus?.startup_errors ?? [];

  return (
    <AdminPage
      title="Pipeline de recherche"
      description="Passes dues, recherches ciblées et historique des jobs. Les recherches se lancent depuis le poste local, backend lancé ; l'historique se lit partout."
      actions={
        <Button onClick={refreshAll} disabled={loadingStatus}>
          Rafraîchir
        </Button>
      }
    >
      {/* État du backend local (plan backend-local, étape 5) ; tons : D85 */}
      {backend?.kind === "local_only" && (
        <Alert tone="info">
          <strong className="font-semibold">Pilotage depuis le poste local.</strong>
          <p className="mt-1 text-ink-2">
            Ce site n&apos;a pas de backend : les passes dues et les recherches ciblées se lancent depuis
            le Next.js du poste de l&apos;admin, backend lancé. Ici : l&apos;historique des jobs et les
            contributions en attente, lus en base.
          </p>
        </Alert>
      )}

      {backend?.kind === "not_running" && (
        <Alert tone="info">
          <strong className="font-semibold">Backend local non lancé.</strong>
          <p className="mt-1 text-ink-2">
            Lancez-le depuis la racine du dépôt :{" "}
            <code className="font-mono text-xs break-all text-ink">{LOCAL_BACKEND_COMMAND}</code>. Il s&apos;ouvre
            dans sa propre fenêtre, et Next.js n&apos;est pas relancé. L&apos;écran le détecte tout seul
            (nouvel essai toutes les {STATUS_POLL_MS / 1000} s).
          </p>
        </Alert>
      )}

      {backend?.kind === "error" && (
        <Alert tone="danger">
          <strong className="font-semibold">Backend injoignable.</strong>
          <p className="mt-1 text-ink-2">{backend.message}</p>
        </Alert>
      )}

      {backendReady && startupErrors.length > 0 && (
        <Alert tone="danger">
          <strong className="font-semibold">Le backend a démarré avec des erreurs.</strong>
          <ul className="mt-1 list-disc pl-5">
            {startupErrors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Tâches actives vues par le backend : seulement s'il répond. Sinon,
          l'historique (plus bas, lu en base) montre aussi les jobs en cours. */}
      {backendReady && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ── Tâches en cours (manuelles) ─────────────────────────── */}
          <Card aria-labelledby="cron-manual-tasks-title" className="flex flex-col gap-4">
            <CardHeader
              titleId="cron-manual-tasks-title"
              title={`Tâches manuelles en cours (${pipelineStatus?.pipeline_jobs?.length || 0})`}
            />

            {pipelineStatus?.pipeline_jobs && pipelineStatus.pipeline_jobs.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {pipelineStatus.pipeline_jobs.map((job) => {
                  const elapsed = job.created_at
                    ? Math.floor(now / 1000 - job.created_at)
                    : 0;
                  const progress = parseProgress(job.progress_details?.progress);

                  return (
                    <li key={job.job_id} className="flex flex-col gap-3 rounded-control border border-line bg-surface-2 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="font-semibold text-ink">
                          {job.phase}
                          {job.progress_details?.school && (
                            <span className="font-medium"> — {job.progress_details.school}</span>
                          )}
                        </p>
                        <span className="font-mono text-xs tabular-nums text-ink-2">{formatElapsed(elapsed)}</span>
                      </div>

                      {/* Détail de l'action en cours */}
                      {job.progress_details && (
                        <p className="text-sm leading-snug text-ink">
                          {job.progress_details.current_action}
                          {job.progress_details.program && (
                            <> sur <strong>&quot;{job.progress_details.program}&quot;</strong></>
                          )}
                        </p>
                      )}

                      {/* Barre de progression (D86) */}
                      {progress && (
                        <div className="flex items-center gap-3">
                          <ProgressBar
                            value={progress.done}
                            max={progress.total}
                            aria-label={`${progress.done}/${progress.total} catégories`}
                            className="flex-1"
                          />
                          <span className="font-mono text-xs whitespace-nowrap tabular-nums text-ink-2">
                            {progress.done}/{progress.total} catégories
                          </span>
                        </div>
                      )}

                      <div>
                        <Badge tone="neutral">{job.status === "running" ? "En cours" : "En file"}</Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-ink-2">Aucune tâche manuelle en cours d&apos;exécution.</p>
            )}
          </Card>

          {/* ── Passes dues en cours (clé historique `cron_jobs`) ──── */}
          <Card aria-labelledby="cron-due-tasks-title" className="flex flex-col gap-4">
            <CardHeader
              titleId="cron-due-tasks-title"
              title={`Passes dues en cours (${pipelineStatus?.cron_jobs?.length || 0})`}
            />

            {pipelineStatus?.cron_jobs && pipelineStatus.cron_jobs.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {pipelineStatus.cron_jobs.map((job) => {
                  const elapsed = job.created_at
                    ? Math.floor(now / 1000 - job.created_at)
                    : 0;

                  return (
                    <li key={job.job_id} className="flex flex-col gap-3 rounded-control border border-line bg-surface-2 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="font-semibold text-ink">
                          {job.phase}
                          {job.school_id && job.school_id !== "N/A" && (
                            <span className="font-medium"> — École {job.school_id.substring(0, 8)}...</span>
                          )}
                        </p>
                        <span className="font-mono text-xs tabular-nums text-ink-2">{formatElapsed(elapsed)}</span>
                      </div>

                      <div>
                        <Badge tone="neutral">En cours</Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-ink-2">Aucune passe due en cours d&apos;exécution.</p>
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[4fr_6fr]">
        {/* ── Pipeline & Tavily ───────────────────────────────────── */}
        <Card aria-labelledby="cron-pipeline-title" className="flex flex-col gap-5">
          <CardHeader titleId="cron-pipeline-title" title="État du Pipeline IA" />

          {loadingStatus && !backend ? (
            <p className="py-10 text-center text-sm text-ink-2">Chargement des données du pipeline...</p>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-ink">
                Backend local : <strong className="font-semibold">{BACKEND_LABELS[backend?.kind ?? "error"]}</strong>
                {backendReady && pipelineStatus?.status === "degraded" && <> (dégradé)</>}
                {backendReady && pipelineStatus?.database === "disconnected" && <> · base injoignable</>}
              </p>

              {pipelineStatus && (
                <>
                  {aiModels && (
                    <div className="rounded-control border border-line bg-surface-2 px-4 py-3">
                      <p className="text-xs text-ink-2">Modèles IA</p>
                      <p className="mt-1 font-semibold text-ink">{aiModels.headline}</p>
                      <p className="mt-1 text-xs text-ink-2">Cascade (du plus fort au plus faible) : {aiModels.cascade}</p>
                      <p className="mt-1 text-xs text-ink-2">Dernier recours : {aiModels.lastResort}</p>
                    </div>
                  )}

                  {/* D83 : gardé, seul signal de ce que le backend gelé traite (et paie) au démarrage. */}
                  <div className="rounded-control border border-line bg-surface-2 px-4 py-3" data-testid="crowdsourcing-status">
                    <p className="text-xs text-ink-2">Contributions du public</p>
                    <p className={cx("mt-1 font-semibold", CROWDSOURCING_TEXT_TONES[crowdsourcing.tone])}>
                      {crowdsourcing.headline}
                    </p>
                    {crowdsourcing.lines.map((line) => (
                      <p key={line} className="mt-1 text-xs text-ink-2">
                        {line}
                      </p>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-ink">Quotas Tavily restants</h3>
                    {Array.isArray(pipelineStatus.tavily) && pipelineStatus.tavily.length > 0 ? (
                      <QuotaTavilyPanel
                        keys={pipelineStatus.tavily.map((key) => ({
                          id: key.key_suffix,
                          used: key.credits_used,
                          total: key.credits_limit || 1000,
                        }))}
                      />
                    ) : (
                      <p className="text-sm text-ink-2 italic">Aucune clé Tavily active détectée par le backend.</p>
                    )}
                  </div>

                  <RotationPanel
                    rotation={pipelineStatus.scheduler?.rotation}
                    canRun={isAdmin}
                    onRunFinished={refreshAll}
                  />
                </>
              )}
            </div>
          )}
        </Card>

        {/* ── Recherche manuelle ──────────────────────────────────── */}
        <Card aria-labelledby="cron-research-title" className="flex flex-col gap-4">
          <CardHeader titleId="cron-research-title" title="Lancer une Recherche Manuelle" />

          {!backendReady ? (
            <p className="text-sm text-ink-2">
              Une recherche ciblée se lance depuis le poste local, quand le backend répond.
            </p>
          ) : (
          <>
          {/* Phase : deux boutons qui disent lequel est choisi (D89) */}
          <div className="flex overflow-hidden rounded-control border border-line-strong">
            <button
              type="button"
              aria-pressed={selectedPhase === "1"}
              className={phaseButtonClasses(selectedPhase === "1")}
              onClick={() => setSelectedPhase("1")}
            >
              Phase 1 — Cartographie
            </button>
            <button
              type="button"
              aria-pressed={selectedPhase === "2"}
              className={cx(phaseButtonClasses(selectedPhase === "2"), "border-l border-line-strong")}
              onClick={() => setSelectedPhase("2")}
            >
              Phase 2 — Enrichissement
            </button>
          </div>

          <p className="text-compact leading-relaxed text-ink-2">
            {selectedPhase === "1"
              ? "Découvre les campus et programmes d'une école via Tavily Research."
              : "Enrichit les données (tarifs, classements, places...) d'un programme ou de toute l'école."}
          </p>

          {/* School selector */}
          <Field id="research-school" label="École">
            {(control) => (
              <Select
                {...control}
                value={selectedSchoolId}
                onChange={(e) => setSelectedSchoolId(e.target.value)}
                disabled={loadingSchools}
              >
                <option value="">— Sélectionner une école —</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.official_domain})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* Phase 1: collecte du rattachement campus, décochée par défaut */}
          {selectedPhase === "1" && selectedSchoolId && (
            <div className="flex flex-col gap-1.5">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer accent-accent"
                  checked={collectCampusAttachments}
                  onChange={(e) => setCollectCampusAttachments(e.target.checked)}
                  aria-describedby="research-collect-hint"
                />
                Collecter aussi le rattachement campus
              </label>
              <p id="research-collect-hint" className="text-xs leading-relaxed text-ink-2">
                Pour cette passe seulement. Environ 15 à 17 crédits Tavily et 9 appels Gemini de
                plus, même si l&apos;école ne publie aucun lieu. Décochée, la collecte n&apos;émet
                aucun appel et le résultat du job porte <code className="font-mono">status: disabled</code>.
              </p>
            </div>
          )}

          {/* Phase 2: Program selector */}
          {selectedPhase === "2" && selectedSchoolId && (
            <>
              <Field
                id="research-program"
                label={
                  <>
                    Programme{" "}
                    <span className="text-xs font-normal text-ink-2">
                      (optionnel — laisser vide pour toute l&apos;école)
                    </span>
                  </>
                }
              >
                {(control) => (
                  <Select {...control} value={selectedProgramId} onChange={(e) => setSelectedProgramId(e.target.value)}>
                    <option value="">— Tous les programmes —</option>
                    {selectedSchool?.campuses.map((campus) => (
                      <optgroup key={campus.id} label={campus.name}>
                        {campus.programs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                )}
              </Field>

              {/* Category checkboxes */}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium text-ink">
                  Catégories à rechercher
                  {!selectedProgramId && (
                    <span className="text-xs font-normal text-ink-2"> (optionnel — laisser vide pour toutes)</span>
                  )}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {availableCategories.map((cat) => (
                    <label
                      key={cat}
                      className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-1 text-sm text-ink has-checked:border-accent has-checked:bg-accent-soft"
                    >
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-accent"
                        checked={selectedCategories.includes(cat)}
                        onChange={() => handleCategoryToggle(cat)}
                      />
                      {CATEGORY_LABELS[cat] || cat}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {/* Launch button */}
          <div className="flex flex-col gap-2 pt-1">
            <Button variant="primary" className="w-full" onClick={handleLaunchResearch} disabled={!canLaunch}>
              {launchingResearch
                ? "Lancement en cours..."
                : selectedPhase === "1"
                ? "Lancer la cartographie"
                : "Lancer la recherche"}
            </Button>

            {schoolHasActiveJob && (
              <p className="text-xs text-warning">
                Une tâche est déjà en cours pour cette école. Attendez qu&apos;elle se termine.
              </p>
            )}
          </div>
          </>
          )}

          {/* Launch message */}
          {launchMessage && (
            <Alert tone={launchMessage.type === "success" ? "success" : "danger"}>{launchMessage.text}</Alert>
          )}
        </Card>
      </div>

      <JobHistory history={history} error={historyError} now={now} />
    </AdminPage>
  );
}
