"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ── Category labels in French ──────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  Pricing: "💰 Tarifs",
  Ranking: "🏆 Classements",
  Capacity: "🎓 Places",
  SchoolStats: "📊 Statistiques école",
  Accreditation: "🏅 Accréditations",
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
  /** Lu côté serveur (page.tsx) : seuls les ADMIN voient les lancements. */
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

      if (selectedPhase === "1") {
        const confirmed = typeof data.collect_campus_attachments === "boolean";
        setLaunchMessage({
          type: confirmed ? "success" : "error",
          text: `${confirmed ? "✅" : "⚠️"} ${data.message} — Job #${data.job_id} · ${describeCampusCollection(data.collect_campus_attachments)}`,
        });
        setCollectCampusAttachments(false);
        setTimeout(refreshAll, 1000);
      } else {
        setLaunchMessage({
          type: "success",
          text: `✅ ${data.message} — Job #${data.job_id}`,
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
    <div className="monitoring-container">
      <div className="page-header">
        <div>
          <h1>⚙️ Pipeline de recherche</h1>
          <p className="page-title-desc">
            Passes dues, recherches ciblées et historique des jobs. Les recherches se lancent depuis le poste
            local, backend lancé ; l&apos;historique se lit partout.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={refreshAll}
          disabled={loadingStatus}
        >
          🔄 Rafraîchir
        </button>
      </div>

      {/* État du backend local (plan backend-local, étape 5) */}
      {backend?.kind === "local_only" && (
        <div className="backend-banner banner-info">
          <strong>🖥️ Pilotage depuis le poste local.</strong>
          <p>
            Ce site n&apos;a pas de backend : les passes dues et les recherches ciblées se lancent depuis
            le Next.js du poste de l&apos;admin, backend lancé. Ici : l&apos;historique des jobs et les
            contributions en attente, lus en base.
          </p>
        </div>
      )}

      {backend?.kind === "not_running" && (
        <div className="backend-banner banner-warning">
          <strong>⏸️ Backend local non lancé.</strong>
          <p>
            Lancez-le depuis la racine du dépôt : <code>{LOCAL_BACKEND_COMMAND}</code>. Il s&apos;ouvre
            dans sa propre fenêtre, et Next.js n&apos;est pas relancé. L&apos;écran le détecte tout seul
            (nouvel essai toutes les {STATUS_POLL_MS / 1000} s).
          </p>
        </div>
      )}

      {backend?.kind === "error" && (
        <div className="backend-banner banner-danger">
          <strong>⚠️ Backend injoignable.</strong>
          <p>{backend.message}</p>
        </div>
      )}

      {backendReady && startupErrors.length > 0 && (
        <div className="backend-banner banner-danger">
          <strong>❌ Le backend a démarré avec des erreurs.</strong>
          <ul className="startup-errors">
            {startupErrors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Tâches actives vues par le backend : seulement s'il répond. Sinon,
          l'historique (plus bas, lu en base) montre aussi les jobs en cours. */}
      {backendReady && (
      <div className="tasks-columns-grid">
        {/* ── Section Tâches en cours (manuelles) ─────────────────── */}
        <div className="card active-tasks-card">
          <h2 className="section-title">⚡ Tâches manuelles en cours ({pipelineStatus?.pipeline_jobs?.length || 0})</h2>

          {pipelineStatus?.pipeline_jobs && pipelineStatus.pipeline_jobs.length > 0 ? (
            <div className="tasks-grid">
              {pipelineStatus.pipeline_jobs.map((job) => {
                const elapsed = job.created_at
                  ? Math.floor(now / 1000 - job.created_at)
                  : 0;
                const progress = parseProgress(job.progress_details?.progress);
                const progressPct = progress
                  ? Math.min(100, (progress.done / progress.total) * 100)
                  : 0;

                return (
                  <div key={job.job_id} className="task-card">
                    <div className="task-card-header">
                      <div className="task-card-title">
                        <span className={`status-dot-sm ${job.status === "running" ? "dot-running" : "dot-queued"}`}></span>
                        <span className="task-phase">{job.phase}</span>
                        {job.progress_details?.school && (
                          <span className="task-school">— {job.progress_details.school}</span>
                        )}
                      </div>
                      <span className="task-timer">⏱ {formatElapsed(elapsed)}</span>
                    </div>

                    {/* Détail de l'action en cours */}
                    {job.progress_details && (
                      <div className="task-progress-details">
                        <p className="task-action">
                          🔍 {job.progress_details.current_action}
                          {job.progress_details.program && (
                            <> sur <strong>&quot;{job.progress_details.program}&quot;</strong></>
                          )}
                        </p>
                      </div>
                    )}

                    {/* Barre de progression */}
                    {progress && (
                      <div className="task-progress-bar-container">
                        <div className="progress-bar-bg">
                          <div
                            className="progress-bar-fill fill-accent"
                            style={{ width: `${progressPct}%` }}
                          ></div>
                        </div>
                        <span className="task-progress-text">
                          {progress.done}/{progress.total} catégories
                        </span>
                      </div>
                    )}

                    <div className="task-card-footer">
                      <span className={`badge ${job.status === "running" ? "badge-active" : "badge-queued"}`}>
                        {job.status === "running" ? "En cours" : "En file"}
                      </span>
                      <span className="job-id">Job #{job.job_id}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state-inline">
              <span>💤</span> Aucune tâche manuelle en cours d&apos;exécution.
            </div>
          )}
        </div>

        {/* ── Section Passes dues en cours (clé historique `cron_jobs`) ── */}
        <div className="card active-tasks-card">
          <h2 className="section-title">🔄 Passes dues en cours ({pipelineStatus?.cron_jobs?.length || 0})</h2>

          {pipelineStatus?.cron_jobs && pipelineStatus.cron_jobs.length > 0 ? (
            <div className="tasks-grid">
              {pipelineStatus.cron_jobs.map((job) => {
                const elapsed = job.created_at
                  ? Math.floor(now / 1000 - job.created_at)
                  : 0;

                return (
                  <div key={job.job_id} className="task-card task-card-cron">
                    <div className="task-card-header">
                      <div className="task-card-title">
                        <span className="status-dot-sm dot-running"></span>
                        <span className="task-phase" style={{ color: "var(--success)" }}>{job.phase}</span>
                        {job.school_id && job.school_id !== "N/A" && (
                          <span className="task-school">— École {job.school_id.substring(0, 8)}...</span>
                        )}
                      </div>
                      <span className="task-timer">⏱ {formatElapsed(elapsed)}</span>
                    </div>

                    <div className="task-card-footer" style={{ marginTop: "8px" }}>
                      <span className="badge badge-active" style={{ color: "var(--success)", borderColor: "rgba(16, 185, 129, 0.25)", backgroundColor: "rgba(16, 185, 129, 0.12)" }}>
                        En cours
                      </span>
                      <span className="job-id">Job #{job.job_id}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state-inline">
              <span>💤</span> Aucune passe due en cours d&apos;exécution.
            </div>
          )}
        </div>
      </div>
      )}

      <div className="dashboard-grid">
        {/* ── Section Pipeline & Tavily ─────────────────────────── */}
        <div className="grid-col card">
          <h2 className="section-title">📊 État du Pipeline IA</h2>

          {loadingStatus && !backend ? (
            <div className="loading-placeholder">Chargement des données du pipeline...</div>
          ) : (
            <div className="pipeline-details">
              <div className="status-indicator">
                <span className={`status-dot ${backendReady && pipelineStatus?.status === "ok" ? "dot-green" : "dot-red"}`}></span>
                <span>Backend local : <strong>{BACKEND_LABELS[backend?.kind ?? "error"]}</strong>
                  {backendReady && pipelineStatus?.status === "degraded" && <> (dégradé)</>}
                  {backendReady && pipelineStatus?.database === "disconnected" && <> · base injoignable</>}
                </span>
              </div>

              {pipelineStatus && (
                <>
                  {aiModels && (
                    <div className="metric-box">
                      <p className="metric-label">Modèles IA</p>
                      <p className="metric-value">{aiModels.headline}</p>
                      <p className="metric-detail">Cascade (du plus fort au plus faible) : {aiModels.cascade}</p>
                      <p className="metric-detail">Dernier recours : {aiModels.lastResort}</p>
                    </div>
                  )}

                  <div className="metric-box" data-testid="crowdsourcing-status">
                    <p className="metric-label">Contributions du public</p>
                    <p className={`metric-value crowdsourcing-${crowdsourcing.tone}`}>{crowdsourcing.headline}</p>
                    {crowdsourcing.lines.map((line) => (
                      <p key={line} className="metric-detail">{line}</p>
                    ))}
                  </div>

                  <div className="tavily-quotas-section">
                    <h3>🔑 Quotas Tavily restants</h3>
                    {Array.isArray(pipelineStatus.tavily) && pipelineStatus.tavily.length > 0 ? (
                      <QuotaTavilyPanel
                        keys={pipelineStatus.tavily.map((key) => ({
                          id: key.key_suffix,
                          used: key.credits_used,
                          total: key.credits_limit || 1000,
                        }))}
                      />
                    ) : (
                      <p className="no-data">Aucune clé Tavily active détectée par le backend.</p>
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
        </div>

        {/* ── Section Recherche Manuelle ──────────────────────────── */}
        <div className="grid-col card">
          <h2 className="section-title">🚀 Lancer une Recherche Manuelle</h2>

          {!isAdmin ? (
            <p className="launch-note">Réservé aux ADMIN : une recherche paie Research (crédits Tavily).</p>
          ) : !backendReady ? (
            <p className="launch-note">
              Une recherche ciblée se lance depuis le poste local, quand le backend répond.
            </p>
          ) : (
          <>
          {/* Phase toggle */}
          <div className="phase-toggle">
            <button
              className={`phase-btn ${selectedPhase === "1" ? "phase-active" : ""}`}
              onClick={() => setSelectedPhase("1")}
            >
              Phase 1 — Cartographie
            </button>
            <button
              className={`phase-btn ${selectedPhase === "2" ? "phase-active" : ""}`}
              onClick={() => setSelectedPhase("2")}
            >
              Phase 2 — Enrichissement
            </button>
          </div>

          <p className="phase-desc">
            {selectedPhase === "1"
              ? "Découvre les campus et programmes d'une école via Tavily Research."
              : "Enrichit les données (tarifs, classements, places...) d'un programme ou de toute l'école."}
          </p>

          {/* School selector */}
          <div className="form-group">
            <label className="form-label">École</label>
            <select
              className="form-control"
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
            </select>
          </div>

          {/* Phase 1: collecte du rattachement campus, décochée par défaut */}
          {selectedPhase === "1" && selectedSchoolId && (
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={collectCampusAttachments}
                  onChange={(e) => setCollectCampusAttachments(e.target.checked)}
                />
                <span className="checkbox-text">Collecter aussi le rattachement campus</span>
              </label>
              <p className="form-hint collect-hint">
                Pour cette passe seulement. Environ 15 à 17 crédits Tavily et 9 appels Gemini de
                plus, même si l&apos;école ne publie aucun lieu. Décochée, la collecte n&apos;émet
                aucun appel et le résultat du job porte <code>status: disabled</code>.
              </p>
            </div>
          )}

          {/* Phase 2: Program selector */}
          {selectedPhase === "2" && selectedSchoolId && (
            <>
              <div className="form-group">
                <label className="form-label">
                  Programme <span className="form-hint">(optionnel — laisser vide pour toute l&apos;école)</span>
                </label>
                <select
                  className="form-control"
                  value={selectedProgramId}
                  onChange={(e) => setSelectedProgramId(e.target.value)}
                >
                  <option value="">— Tous les programmes —</option>
                  {selectedSchool?.campuses.map((campus) => (
                    <optgroup key={campus.id} label={`📍 ${campus.name}`}>
                      {campus.programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Category checkboxes */}
              <div className="form-group">
                <label className="form-label">
                  Catégories à rechercher
                  {!selectedProgramId && (
                    <span className="form-hint"> (optionnel — laisser vide pour toutes)</span>
                  )}
                </label>
                <div className="category-checkboxes">
                  {availableCategories.map((cat) => (
                    <label key={cat} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(cat)}
                        onChange={() => handleCategoryToggle(cat)}
                      />
                      <span className="checkbox-text">{CATEGORY_LABELS[cat] || cat}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Launch button */}
          <div className="launch-section">
            <button
              className="btn btn-primary btn-launch"
              onClick={handleLaunchResearch}
              disabled={!canLaunch}
            >
              {launchingResearch
                ? "⏳ Lancement en cours..."
                : selectedPhase === "1"
                ? "🔍 Lancer la cartographie"
                : "🚀 Lancer la recherche"}
            </button>

            {schoolHasActiveJob && (
              <p className="launch-warning">
                ⚠️ Une tâche est déjà en cours pour cette école. Attendez qu&apos;elle se termine.
              </p>
            )}
          </div>
          </>
          )}

          {/* Launch message */}
          {launchMessage && (
            <div className={`launch-message ${launchMessage.type === "success" ? "msg-success" : "msg-error"}`}>
              {launchMessage.text}
            </div>
          )}
        </div>
      </div>

      <JobHistory history={history} error={historyError} now={now} />

      <style jsx>{`
        .monitoring-container {
          padding-bottom: 40px;
        }

        /* ── Active Tasks Section ─────────────────────────────── */

        .active-tasks-card {
          margin-top: 24px;
          margin-bottom: 24px;
        }

        .tasks-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
          gap: 16px;
        }

        .task-card {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.06) 0%, rgba(139, 92, 246, 0.04) 100%);
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: var(--radius-lg);
          padding: 16px 20px;
          position: relative;
          overflow: hidden;
        }

        .task-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--accent), rgba(139, 92, 246, 0.8));
          animation: shimmer 2s ease-in-out infinite;
        }

        @keyframes shimmer {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .task-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .task-card-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 0.95rem;
        }

        .status-dot-sm {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .dot-running {
          background-color: var(--success);
          box-shadow: 0 0 8px var(--success);
          animation: pulse-dot 1.5s ease-in-out infinite;
        }

        .dot-queued {
          background-color: var(--warning);
          box-shadow: 0 0 6px var(--warning);
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }

        .task-phase {
          color: var(--accent);
        }

        .task-school {
          color: var(--text-primary);
          font-weight: 500;
        }

        .task-timer {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
          background: rgba(255, 255, 255, 0.05);
          padding: 4px 10px;
          border-radius: var(--radius-md);
        }

        .task-progress-details {
          margin-bottom: 12px;
        }

        .task-action {
          font-size: 0.85rem;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.4;
        }

        .task-progress-bar-container {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .task-progress-bar-container .progress-bar-bg {
          flex: 1;
        }

        .task-progress-text {
          font-size: 0.8rem;
          color: var(--text-secondary);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .fill-accent {
          background: linear-gradient(90deg, var(--accent), rgba(139, 92, 246, 0.8));
          transition: width 0.6s ease;
        }

        .task-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .badge-queued {
          background-color: rgba(245, 158, 11, 0.12);
          color: var(--warning);
          border: 1px solid rgba(245, 158, 11, 0.25);
        }

        .empty-state-inline {
          text-align: center;
          padding: 24px;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        /* ── Dashboard Grid ──────────────────────────────────── */

        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
        }

        @media (min-width: 1024px) {
          .dashboard-grid {
            grid-template-columns: 4fr 6fr;
          }
        }

        .section-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 20px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 10px;
        }

        .pipeline-details {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 0.95rem;
        }

        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          display: inline-block;
        }

        .dot-green {
          background-color: var(--success);
          box-shadow: 0 0 8px var(--success);
        }

        .dot-red {
          background-color: var(--danger);
          box-shadow: 0 0 8px var(--danger);
        }

        .metric-box {
          background-color: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          padding: 12px 16px;
        }

        .metric-label {
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin: 0 0 4px 0;
        }

        .metric-value {
          font-size: 1rem;
          font-weight: 600;
          color: var(--accent);
          margin: 0;
        }

        .metric-detail {
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin: 4px 0 0 0;
        }

        .crowdsourcing-muted {
          color: var(--text-secondary);
        }

        .crowdsourcing-ok {
          color: var(--success);
        }

        .crowdsourcing-warning {
          color: var(--warning, #f59e0b);
        }

        .crowdsourcing-error {
          color: var(--danger);
        }

        .tavily-quotas-section h3 {
          font-size: 0.95rem;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--text-primary);
        }



        .no-data {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-style: italic;
        }

        /* ── Recherche Manuelle ────────────────────────────────── */

        .phase-toggle {
          display: flex;
          gap: 0;
          margin-bottom: 16px;
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          overflow: hidden;
        }

        .phase-btn {
          flex: 1;
          padding: 10px 16px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .phase-btn:hover {
          background: rgba(59, 130, 246, 0.05);
          color: var(--text-primary);
        }

        .phase-btn.phase-active {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%);
          color: var(--accent);
          font-weight: 600;
          box-shadow: inset 0 -2px 0 var(--accent);
        }

        .phase-desc {
          font-size: 0.82rem;
          color: var(--text-secondary);
          margin: 0 0 20px 0;
          line-height: 1.4;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-label {
          display: block;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 6px;
        }

        .form-hint {
          font-weight: 400;
          color: var(--text-secondary);
          font-size: 0.78rem;
        }

        .form-control {
          width: 100%;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 0.9rem;
          transition: border-color 0.2s ease;
        }

        .form-control:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        select.form-control {
          cursor: pointer;
        }

        select.form-control optgroup {
          font-weight: 600;
          font-style: normal;
          background-color: var(--bg-secondary, #161f30);
          color: var(--text-primary, #f3f4f6);
        }

        select.form-control option {
          background-color: var(--bg-secondary, #161f30);
          color: var(--text-primary, #f3f4f6);
        }

        .category-checkboxes {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 0.82rem;
        }

        .checkbox-label:hover {
          background: rgba(59, 130, 246, 0.06);
          border-color: rgba(59, 130, 246, 0.3);
        }

        .checkbox-label input[type="checkbox"] {
          accent-color: var(--accent);
          width: 14px;
          height: 14px;
        }

        .checkbox-label input[type="checkbox"]:checked + .checkbox-text {
          color: var(--accent);
          font-weight: 500;
        }

        .checkbox-text {
          color: var(--text-primary);
        }

        .collect-hint {
          display: block;
          margin: 6px 0 0;
          line-height: 1.4;
        }

        .launch-section {
          margin-top: 20px;
        }

        .btn-launch {
          width: 100%;
          padding: 12px 20px;
          font-size: 0.95rem;
          font-weight: 600;
          background: linear-gradient(135deg, var(--accent) 0%, rgba(139, 92, 246, 0.9) 100%);
          border: none;
          border-radius: var(--radius-md);
          color: white;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-launch:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
        }

        .btn-launch:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .launch-warning {
          font-size: 0.8rem;
          color: var(--warning);
          margin: 8px 0 0;
        }

        .launch-message {
          margin-top: 12px;
          padding: 10px 14px;
          border-radius: var(--radius-md);
          font-size: 0.85rem;
          animation: fadeIn 0.3s ease;
        }

        .msg-success {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.25);
          color: var(--success);
        }

        .msg-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: var(--danger);
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Cron Targets Table ────────────────────────────────── */

        .loading-placeholder {
          text-align: center;
          padding: 40px;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .school-prog-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .school-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .program-name {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .global-badge {
          font-size: 0.7rem;
          background-color: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          padding: 2px 6px;
          border-radius: 4px;
          width: fit-content;
        }

        .category-code {
          color: var(--accent);
          background: rgba(59, 130, 246, 0.08);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.8rem;
        }

        .failed-count {
          font-weight: 600;
          font-size: 0.9rem;
        }

        .count-red {
          color: var(--danger);
        }

        .count-orange {
          color: var(--warning);
        }

        .count-green {
          color: var(--success);
        }

        .badge-blacklisted {
          background-color: rgba(239, 68, 68, 0.15);
          color: var(--danger);
          border: 1px solid rgba(239, 68, 68, 0.25);
        }

        .scrollable-table {
          max-height: 500px;
          overflow-y: auto;
        }

        .backend-banner {
          margin: 0 0 20px;
          padding: 14px 18px;
          border-radius: var(--radius-md);
          border: 1px solid transparent;
          border-left-width: 4px;
          font-size: 0.9rem;
        }

        .backend-banner p {
          margin: 6px 0 0;
          color: var(--text-secondary);
        }

        .backend-banner code {
          font-size: 0.82rem;
          padding: 1px 6px;
          border-radius: 4px;
          background-color: rgba(255, 255, 255, 0.06);
          color: var(--text-primary);
          word-break: break-all;
        }

        .banner-info {
          background-color: rgba(59, 130, 246, 0.08);
          border-color: rgba(59, 130, 246, 0.3);
          color: #60a5fa;
        }

        .banner-warning {
          background-color: rgba(245, 158, 11, 0.08);
          border-color: rgba(245, 158, 11, 0.3);
          color: var(--warning, #f59e0b);
        }

        .banner-danger {
          background-color: rgba(239, 68, 68, 0.08);
          border-color: rgba(239, 68, 68, 0.3);
          color: var(--danger, #ef4444);
        }

        .startup-errors {
          margin: 6px 0 0;
          padding-left: 20px;
        }

        .launch-note {
          margin: 0;
          font-size: 0.85rem;
          color: var(--text-secondary);
        }

        .empty-state {
          text-align: center;
          padding: 40px;
          background-color: rgba(255, 255, 255, 0.01);
          border: 1px dashed var(--border-color);
          border-radius: var(--radius-lg);
          color: var(--text-secondary);
        }

        .empty-state span {
          font-size: 2.5rem;
          display: block;
          margin-bottom: 12px;
        }

        .text-muted {
          color: var(--text-secondary);
          opacity: 0.5;
        }

        .task-card-cron {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(139, 92, 246, 0.04) 100%) !important;
          border: 1px solid rgba(16, 185, 129, 0.20) !important;
        }

        .task-card-cron::before {
          background: linear-gradient(90deg, var(--success), rgba(139, 92, 246, 0.8)) !important;
        }

        .tasks-columns-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
          margin-top: 24px;
          margin-bottom: 24px;
        }

        @media (min-width: 1024px) {
          .tasks-columns-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        .tasks-columns-grid .active-tasks-card {
          margin: 0 !important;
          height: 100%;
        }
      `}</style>
    </div>
  );
}
