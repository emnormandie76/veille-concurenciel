"use client";

import { useEffect, useState } from "react";

interface TavilyKeyStatus {
  key_suffix: string;
  credits_used: number;
  credits_limit: number;
  credits_remaining: number;
  exhausted: boolean;
}

interface PipelineJob {
  job_id: string;
  school_id: string;
  phase: string;
  status: string;
  priority?: string;
  categories?: string[];
  error?: string;
}

interface PipelineStatus {
  status: string;
  database: string;
  pipeline_jobs_active: number;
  pipeline_jobs: PipelineJob[];
  tavily: TavilyKeyStatus[];
  ai_model_primary: string;
}

interface CronTarget {
  id: string;
  schoolId: string;
  programId: string | null;
  data_category: string;
  failed_attempts_count: number;
  is_blacklisted: boolean;
  last_failed_attempt: string | null;
  school: {
    name: string;
  };
  program: {
    name: string;
  } | null;
}

export default function CronMonitoringPage() {
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [cronTargets, setCronTargets] = useState<CronTarget[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingTargets, setLoadingTargets] = useState(true);
  
  // Cold start handling
  const [backendDown, setBackendDown] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState(5);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [errorTargets, setErrorTargets] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPipelineStatus = async () => {
    try {
      const res = await fetch("/api/admin/pipeline-status");
      if (!res.ok) {
        if (res.status === 503) {
          throw new Error("Backend indisponible (Cold Start)");
        }
        throw new Error(`Erreur serveur backend (${res.status})`);
      }
      const data = await res.json();
      setPipelineStatus(data);
      setBackendDown(false);
      setErrorStatus(null);
    } catch (err: any) {
      console.error(err);
      setBackendDown(true);
      setErrorStatus(err.message || "Erreur de connexion au backend");
    } finally {
      setLoadingStatus(false);
    }
  };

  const fetchCronTargets = async () => {
    try {
      const res = await fetch("/api/admin/cron-targets");
      if (!res.ok) {
        throw new Error("Impossible de charger les cibles de monitoring BDD");
      }
      const data = await res.json();
      setCronTargets(data);
      setErrorTargets(null);
    } catch (err: any) {
      setErrorTargets(err.message || "Erreur de connexion BDD");
    } finally {
      setLoadingTargets(false);
    }
  };

  // Poll status every 5 seconds for updates and cold start retry
  useEffect(() => {
    fetchPipelineStatus();
    fetchCronTargets();

    const statusInterval = setInterval(() => {
      fetchPipelineStatus();
    }, 5000);

    return () => clearInterval(statusInterval);
  }, []);

  // Countdown timer for user feedback when backend is down
  useEffect(() => {
    if (!backendDown) return;
    
    setRetrySeconds(5);
    const countdown = setInterval(() => {
      setRetrySeconds((prev) => (prev > 1 ? prev - 1 : 5));
    }, 1000);

    return () => clearInterval(countdown);
  }, [backendDown]);

  const handleUnblock = async (id: string) => {
    setUnblockingId(id);
    try {
      const res = await fetch(`/api/admin/cron-targets/${id}/unblock`, {
        method: "POST"
      });
      if (!res.ok) {
        throw new Error("Échec du déblocage");
      }
      // Refresh cron targets
      await fetchCronTargets();
    } catch (err: any) {
      alert(err.message || "Une erreur est survenue lors du déblocage.");
    } finally {
      setUnblockingId(null);
    }
  };

  // Filter cron targets based on search query
  const filteredTargets = cronTargets.filter((target) => {
    const schoolMatch = target.school.name.toLowerCase().includes(searchQuery.toLowerCase());
    const categoryMatch = target.data_category.toLowerCase().includes(searchQuery.toLowerCase());
    const programMatch = target.program?.name.toLowerCase().includes(searchQuery.toLowerCase()) || false;
    return schoolMatch || categoryMatch || programMatch;
  });

  return (
    <div className="monitoring-container">
      <div className="page-header">
        <div>
          <h1>⚙️ Monitoring & Cibles Cron</h1>
          <p className="page-title-desc">
            Suivi des quotas Tavily, des tâches du pipeline d'enrichissement IA, et gestion des cibles bloquées.
          </p>
        </div>
        <button 
          className="btn btn-secondary" 
          onClick={() => {
            fetchPipelineStatus();
            fetchCronTargets();
          }}
          disabled={loadingStatus || loadingTargets}
        >
          🔄 Rafraîchir
        </button>
      </div>

      {/* Bandeau d'alerte Cold Start (Edge Case 15) */}
      {backendDown && (
        <div className="alert alert-warning cold-start-banner animate-pulse">
          <div className="alert-content">
            <span className="spinner">⚙️</span>
            <div>
              <strong>Le serveur FastAPI subit un démarrage à froid (Cold Start).</strong>
              <p>Reconnexion automatique en cours... Prochaine tentative dans {retrySeconds} seconde{retrySeconds > 1 ? "s" : ""}.</p>
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        {/* Section Pipeline & Tavily */}
        <div className="grid-col card">
          <h2 className="section-title">📊 État du Pipeline IA</h2>
          
          {loadingStatus && !pipelineStatus ? (
            <div className="loading-placeholder">Chargement des données du pipeline...</div>
          ) : (
            <div className="pipeline-details">
              <div className="status-indicator">
                <span className={`status-dot ${backendDown ? "dot-red" : "dot-green"}`}></span>
                <span>Statut Backend: <strong>{backendDown ? "Indisponible" : "Opérationnel"}</strong></span>
              </div>

              {pipelineStatus && (
                <>
                  <div className="metric-box">
                    <p className="metric-label">Modèle IA Principal</p>
                    <p className="metric-value">{pipelineStatus.ai_model_primary || "Gemma 31B"}</p>
                  </div>

                  <div className="tavily-quotas-section">
                    <h3>🔑 Quotas Tavily restants</h3>
                    {Array.isArray(pipelineStatus.tavily) && pipelineStatus.tavily.length > 0 ? (
                      pipelineStatus.tavily.map((key, idx) => {
                        const maxCredits = key.credits_limit || 1000;
                        const percentage = Math.min(100, (key.credits_used / maxCredits) * 100);
                        const isHighUsage = percentage > 85;
                        const isExhausted = key.exhausted || percentage >= 100;
                        
                        return (
                          <div key={idx} className="quota-bar-wrapper">
                            <div className="quota-bar-header">
                              <span>Clé {key.key_suffix}</span>
                              <span className={isExhausted ? "text-red" : isHighUsage ? "text-orange" : "text-green"}>
                                {key.credits_used} / {maxCredits} crédits utilisés ({key.credits_remaining} restants)
                              </span>
                            </div>
                            <div className="progress-bar-bg">
                              <div 
                                className={`progress-bar-fill ${isExhausted ? "fill-red" : isHighUsage ? "fill-orange" : "fill-green"}`} 
                                style={{ width: `${100 - percentage}%` }}
                              ></div>
                            </div>
                            {isExhausted && <p className="quota-warning">🚫 Quota épuisé. Cycle de rotation actif.</p>}
                          </div>
                        );
                      })
                    ) : (
                      <p className="no-data">Aucune clé Tavily active détectée par le backend.</p>
                    )}
                  </div>

                  <div className="active-jobs-section">
                    <h3>⚡ Tâches en cours ({pipelineStatus.pipeline_jobs_active || 0})</h3>
                    {pipelineStatus.pipeline_jobs && pipelineStatus.pipeline_jobs.length > 0 ? (
                      <div className="jobs-list">
                        {pipelineStatus.pipeline_jobs.map((job) => (
                          <div key={job.job_id} className="job-item">
                            <div className="job-header">
                              <span className="badge badge-active">{job.phase}</span>
                              <span className="job-id">#{job.job_id}</span>
                            </div>
                            <p className="job-desc">Cible ID: <code>{job.school_id}</code></p>
                            <span className="job-status-badge">Statut: {job.status}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="no-data">Aucun traitement en cours d'exécution.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Section Cibles Cron & Blacklist */}
        <div className="grid-col card">
          <div className="section-header-row">
            <h2 className="section-title">🛡️ Suivi des Cibles de Scan (Cron)</h2>
          </div>

          <div className="search-bar-container" style={{ margin: "16px 0" }}>
            <input
              type="text"
              className="form-control"
              placeholder="Rechercher par école, programme, catégorie..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {loadingTargets && cronTargets.length === 0 ? (
            <div className="loading-placeholder">Chargement des cibles de scan...</div>
          ) : filteredTargets.length === 0 ? (
            <div className="empty-state">
              <span>🛡️</span>
              <p>Aucune cible de scan en échec ou blacklistée trouvée.</p>
            </div>
          ) : (
            <div className="table-container scrollable-table">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>École / Programme</th>
                    <th>Catégorie</th>
                    <th>Échecs</th>
                    <th>Statut</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTargets.map((target) => {
                    const isRed = target.is_blacklisted || target.failed_attempts_count >= 3;
                    const isOrange = !isRed && target.failed_attempts_count > 0;
                    
                    return (
                      <tr key={target.id}>
                        <td>
                          <div className="school-prog-cell">
                            <span className="school-name">{target.school.name}</span>
                            {target.program ? (
                              <span className="program-name">{target.program.name}</span>
                            ) : (
                              <span className="global-badge">Niveau École</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <code className="category-code">{target.data_category}</code>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span className={`failed-count ${isRed ? "count-red" : isOrange ? "count-orange" : "count-green"}`}>
                            {target.failed_attempts_count}/3
                          </span>
                        </td>
                        <td>
                          {isRed ? (
                            <span className="badge badge-blacklisted">⚠️ Bloqué</span>
                          ) : isOrange ? (
                            <span className="badge badge-warning">En échec</span>
                          ) : (
                            <span className="badge badge-active">Actif</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {isRed ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ border: "1px solid var(--accent)" }}
                              onClick={() => handleUnblock(target.id)}
                              disabled={unblockingId === target.id}
                            >
                              {unblockingId === target.id ? "Déblocage..." : "Débloquer"}
                            </button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .monitoring-container {
          padding-bottom: 40px;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
          margin-top: 24px;
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

        .tavily-quotas-section h3,
        .active-jobs-section h3 {
          font-size: 0.95rem;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--text-primary);
        }

        .quota-bar-wrapper {
          margin-bottom: 16px;
        }

        .quota-bar-header {
          display: flex;
          justify-content: space-between;
          font-size: 0.85rem;
          margin-bottom: 6px;
        }

        .progress-bar-bg {
          height: 8px;
          background-color: rgba(255, 255, 255, 0.08);
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.4s ease;
        }

        .fill-green {
          background-color: var(--success);
        }

        .fill-orange {
          background-color: var(--warning);
        }

        .fill-red {
          background-color: var(--danger);
        }

        .text-green {
          color: var(--success);
          font-weight: 500;
        }

        .text-orange {
          color: var(--warning);
          font-weight: 500;
        }

        .text-red {
          color: var(--danger);
          font-weight: 500;
        }

        .quota-warning {
          font-size: 0.75rem;
          color: var(--danger);
          margin: 4px 0 0 0;
        }

        .no-data {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-style: italic;
        }

        .jobs-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .job-item {
          background-color: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          padding: 10px 14px;
        }

        .job-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .job-id {
          font-size: 0.8rem;
          color: var(--text-secondary);
        }

        .job-desc {
          font-size: 0.85rem;
          margin: 4px 0;
          color: var(--text-primary);
        }

        .job-status-badge {
          font-size: 0.75rem;
          color: var(--accent);
          font-weight: 500;
        }

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

        .cold-start-banner {
          margin-bottom: 20px;
          border-left: 4px solid var(--warning);
        }

        .alert-content {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .spinner {
          font-size: 1.5rem;
          animation: spin 2s linear infinite;
        }

        @keyframes spin {
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.85;
          }
        }

        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
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
      `}</style>
    </div>
  );
}
