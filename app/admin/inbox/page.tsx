"use client";

/**
 * app/admin/inbox/page.tsx — Dashboard ContributionInbox (Étape 3)
 *
 * Interface complète de validation des tickets :
 * - Liste paginée avec filtres (status, ai_category)
 * - Panneau de détail latéral (slide-over)
 * - Formulaire répéteur pour Program_Discovery (Super Ticket)
 * - Formulaires spécifiques par catégorie (Pricing, Ranking, Capacity, SchoolStats, Accreditation)
 * - Badges d'alerte visuels : year_assumed, data_conflict_warning, program_name_mismatch
 * - Actions : Valider (→ upsert tables rigides) / Rejeter
 *
 * Référence : task.md §3, architecture.md §5.2, bdd.md §4 (upsert)
 */

import { useState, useEffect, useCallback } from "react";
import { CONTRIBUTION_CATEGORIES, CONTRIBUTION_STATUSES, STATUS_PENDING_AI } from "@/lib/contribution";
import { hasCampusAttachmentBlock } from "@/lib/campus-attachment";
import { describePendingAi } from "@/lib/pipeline-history";
import { readRefreshedTicket, TICKET_REFRESH_ERROR } from "@/lib/ticket-refresh";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface DiscoveredProgram {
  name: string;
  admission_exam?: string | null;
  is_alternance_possible?: boolean | null;
  is_expatriation_mandatory?: boolean | null;
}

interface DiscoveredCampus {
  name: string;
  city?: string | null;
  programs: DiscoveredProgram[];
}

interface Ticket {
  id: string;
  source_type: string;
  ai_category: string;
  status: string;
  schoolId: string | null;
  campusId: string | null;
  programId: string | null;
  user_text: string | null;
  urls: string[];
  ai_extracted_json: Record<string, unknown> | null;
  year_assumed: boolean;
  data_conflict_warning: boolean;
  program_name_mismatch: boolean;
  createdAt: string;
  schoolName?: string | null;
  campusName?: string | null;
  programName?: string | null;
}

// Les listes viennent de lib/contribution.ts : elles étaient recopiées ici, et
// « Failed » y manquait déjà — un ticket en échec était invisible au filtre.
const STATUS_OPTIONS = ["", ...CONTRIBUTION_STATUSES];
const CATEGORY_OPTIONS = ["", ...CONTRIBUTION_CATEGORIES];

const STATUS_COLORS: Record<string, string> = {
  Pending_AI: "badge-warning",
  Pending_Admin: "badge-info",
  Validated: "badge-active",
  Rejected: "badge-danger",
  // Manquait : un ticket en échec s'affichait sans badge, donc sans couleur.
  Failed: "badge-danger",
};

const CATEGORY_ICONS: Record<string, string> = {
  Program_Discovery: "🗺️",
  Pricing: "💰",
  Ranking: "🏆",
  Capacity: "🎓",
  SchoolStats: "📊",
  Accreditation: "📜",
};

// ──────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────

export default function InboxPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres
  const [filterStatus, setFilterStatus] = useState("Pending_Admin");
  const [filterCategory, setFilterCategory] = useState("");

  // Panneau de détail
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Contributions Pending_AI : elles attendent le backend local, qui ne tourne
  // que lorsque l'admin le lance (plan backend-local).
  const [pendingAi, setPendingAi] = useState<number | null>(null);

  // Purge
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeStatuses, setPurgeStatuses] = useState<string[]>(["Validated", "Rejected"]);
  const [purgeCount, setPurgeCount] = useState<number | null>(null);
  const [purgeLoading, setPurgeLoading] = useState(false);

  const LIMIT = 20;

  // Le compte suit chaque rechargement de la liste (filtres, validation, purge).
  const fetchPendingAi = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/inbox?status=${STATUS_PENDING_AI}&limit=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPendingAi(data.pagination.total);
    } catch (err: unknown) {
      // La liste affiche déjà l'erreur de lecture : le bandeau s'efface.
      console.warn("[inbox] Compte des contributions Pending_AI impossible :", err);
      setPendingAi(null);
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (filterStatus) params.set("status", filterStatus);
      if (filterCategory) params.set("ai_category", filterCategory);

      const res = await fetch(`/api/admin/inbox?${params}`);
      if (!res.ok) throw new Error("Impossible de charger les tickets");
      const data = await res.json();
      setTickets(data.data);
      setTotal(data.pagination.total);
      void fetchPendingAi();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterCategory, fetchPendingAi]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const openTicket = (t: Ticket) => {
    setSelectedTicket(JSON.parse(JSON.stringify(t))); // deep copy pour édition
    setPanelOpen(true);
    setActionMsg(null);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setSelectedTicket(null);
  };

  const handleValidate = async (overrideJson?: Record<string, unknown>) => {
    if (!selectedTicket) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const body = overrideJson ?? selectedTicket.ai_extracted_json ?? {};
      const res = await fetch(`/api/admin/inbox/${selectedTicket.id}/validate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la validation");
      setActionMsg({ type: "success", text: data.message || "Ticket validé ✓" });
      fetchTickets();
      // Mettre à jour le ticket affiché
      setSelectedTicket((prev) => prev ? { ...prev, status: "Validated" } : null);
    } catch (err: unknown) {
      setActionMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedTicket) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/inbox/${selectedTicket.id}/reject`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors du rejet");
      setActionMsg({ type: "success", text: "Ticket rejeté" });
      fetchTickets();
      setSelectedTicket((prev) => prev ? { ...prev, status: "Rejected" } : null);
    } catch (err: unknown) {
      setActionMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setActionLoading(false);
    }
  };

  const fetchPurgeCount = async (statuses: string[]) => {
    try {
      let totalCount = 0;
      for (const status of statuses) {
        const res = await fetch(`/api/admin/inbox?status=${status}&limit=1`);
        if (res.ok) {
          const data = await res.json();
          totalCount += data.pagination.total;
        }
      }
      setPurgeCount(totalCount);
    } catch {
      setPurgeCount(null);
    }
  };

  const handlePurge = async () => {
    setPurgeLoading(true);
    try {
      const res = await fetch("/api/admin/inbox/purge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: purgeStatuses }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la purge");
      setPurgeModalOpen(false);
      fetchTickets();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setPurgeLoading(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      {/* ── En-tête ── */}
      <div className="page-header">
        <div>
          <h1>Boîte de Réception — Validation IA</h1>
          <p className="page-title-desc">
            Examinez et validez les données extraites par le pipeline IA avant publication.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            {total} ticket{total !== 1 ? "s" : ""}
          </span>
          <button
            id="btn-open-purge"
            className="btn btn-danger btn-sm"
            onClick={() => {
              setPurgeModalOpen(true);
              fetchPurgeCount(purgeStatuses);
            }}
          >
            🗑️ Purger
          </button>
        </div>
      </div>

      {pendingAi !== null && describePendingAi(pendingAi) && (
        <div className="pending-ai-banner">
          <span>
            ⏳ {describePendingAi(pendingAi)} Passage en <code>Pending_Admin</code> au prochain
            lancement du backend, sur le poste de l&apos;admin.
          </span>
          {filterStatus !== STATUS_PENDING_AI && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setFilterStatus(STATUS_PENDING_AI);
                setPage(1);
              }}
            >
              Voir
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="alert alert-danger">
          <span>⚠️</span> <span>{error}</span>
        </div>
      )}

      {/* ── Filtres ── */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <select
          id="filter-status"
          className="form-control"
          style={{ maxWidth: "200px" }}
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
        >
          <option value="">Tous les statuts</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          id="filter-category"
          className="form-control"
          style={{ maxWidth: "220px" }}
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
        >
          <option value="">Toutes les catégories</option>
          {CATEGORY_OPTIONS.filter(Boolean).map((c) => (
            <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>
          ))}
        </select>

        {(filterStatus || filterCategory) && (
          <button
            className="btn btn-secondary"
            onClick={() => { setFilterStatus(""); setFilterCategory(""); setPage(1); }}
          >
            ✕ Réinitialiser
          </button>
        )}
      </div>

      {/* ── Table des tickets ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des tickets...
        </div>
      ) : tickets.length === 0 ? (
        <div className="empty-state">
          <span>📬</span>
          <p>Aucun ticket trouvé avec ces filtres.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th>Source</th>
                <th>École / Campus / Parcours</th>
                <th>Alertes</th>
                <th>Statut</th>
                <th>Date</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => openTicket(t)}
                >
                  <td>
                    <span style={{ fontWeight: 600 }}>
                      {CATEGORY_ICONS[t.ai_category]} {t.ai_category}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                      {t.source_type}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                        {t.schoolName || (t.schoolId ? t.schoolId.substring(0, 8) + "…" : "—")}
                      </span>
                      {(t.campusName || t.programName) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                          {t.campusName && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
                              📍 {t.campusName}
                            </span>
                          )}
                          {t.programName && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
                              📚 {t.programName}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {t.year_assumed && (
                        <span className="flag-badge flag-warning" title="Année supposée par l'IA">📅 Année supposée</span>
                      )}
                      {t.data_conflict_warning && (
                        <span className="flag-badge flag-danger" title="Conflit de données détecté">⚡ Conflit</span>
                      )}
                      {t.program_name_mismatch && (
                        <span className="flag-badge flag-orange" title="Nom de programme incohérent">🔀 Nom incohérent</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[t.status] || "badge-info"}`}>
                      {t.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                    {new Date(t.createdAt).toLocaleDateString("fr-FR")}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => { e.stopPropagation(); openTicket(t); }}
                    >
                      Examiner →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "20px" }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Précédent
          </button>
          <span style={{ padding: "6px 12px", color: "var(--text-secondary)" }}>
            Page {page} / {totalPages}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Suivant →
          </button>
        </div>
      )}

      {/* ── Panneau de détail (slide-over) ── */}
      {panelOpen && selectedTicket && (
        <div className="panel-overlay" onClick={closePanel}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <div>
                <h2 style={{ margin: 0, fontSize: "1.2rem" }}>
                  {CATEGORY_ICONS[selectedTicket.ai_category]} {selectedTicket.ai_category}
                </h2>
                <p style={{ margin: "4px 0 0", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                  ID: {selectedTicket.id}
                </p>
                {(selectedTicket.schoolName || selectedTicket.schoolId) && (
                  <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--accent)" }}>
                      🏫 {selectedTicket.schoolName || selectedTicket.schoolId}
                    </span>
                    {(selectedTicket.campusName || selectedTicket.programName) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        {selectedTicket.campusName && <span>📍 {selectedTicket.campusName}</span>}
                        {selectedTicket.programName && <span>📚 {selectedTicket.programName}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={closePanel}>✕ Fermer</button>
            </div>

            {/* Badges d'alerte — toujours visibles (task.md §3.3) */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
              <span className={`badge ${STATUS_COLORS[selectedTicket.status] || "badge-info"}`}>
                {selectedTicket.status}
              </span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {selectedTicket.source_type}
              </span>
              {selectedTicket.year_assumed && (
                <span className="flag-badge flag-warning">📅 Année supposée — Vérifier l'année</span>
              )}
              {selectedTicket.data_conflict_warning && (
                <span className="flag-badge flag-danger">⚡ Conflit de données — Sources contradictoires</span>
              )}
              {selectedTicket.program_name_mismatch && (
                <span className="flag-badge flag-orange">🔀 Nom de programme incohérent</span>
              )}
            </div>

            {/* URLs source */}
            {selectedTicket.urls.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <p style={{ fontWeight: 600, marginBottom: "6px", fontSize: "0.9rem" }}>Sources :</p>
                {selectedTicket.urls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "block", fontSize: "0.85rem", color: "var(--accent)", wordBreak: "break-all", marginBottom: "4px" }}
                  >
                    🔗 {url}
                  </a>
                ))}
              </div>
            )}

            {/* Commentaire utilisateur — bloc secondaire, conditionnel */}
            {selectedTicket.user_text && (
              <aside
                style={{
                  borderLeft: "3px solid var(--muted, #64748b)",
                  paddingLeft: "12px",
                  marginTop: "16px",
                  marginBottom: "16px",
                  opacity: 0.75,
                }}
              >
                <p style={{ fontSize: "11px", textTransform: "uppercase", marginBottom: "4px", fontWeight: "bold", color: "var(--text-secondary)" }}>
                  Note du contributeur
                </p>
                <p style={{ fontSize: "14px", margin: 0 }}>{selectedTicket.user_text}</p>
              </aside>
            )}

            {/* ── Formulaire par catégorie ── */}
            <div className="form-section">
              {selectedTicket.ai_category === "Program_Discovery" &&
              hasCampusAttachmentBlock(selectedTicket.ai_extracted_json) ? (
                // Même catégorie, autre charge : ces lignes s'écrivent par la
                // route voisine, jamais par le formulaire répéteur.
                <CampusAttachmentsForm
                  ticket={selectedTicket}
                  disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
                  onWritten={() => {
                    fetchTickets();
                    setSelectedTicket((prev) => (prev ? { ...prev, status: "Validated" } : null));
                  }}
                />
              ) : selectedTicket.ai_category === "Program_Discovery" ? (
                <ProgramDiscoveryForm
                  ticket={selectedTicket}
                  onValidate={handleValidate}
                  loading={actionLoading}
                  disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
                />
              ) : selectedTicket.ai_category === "Accreditation" ? (
                <AccreditationListForm
                  ticket={selectedTicket}
                  onValidate={handleValidate}
                  loading={actionLoading}
                  disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
                />
              ) : (selectedTicket.ai_extracted_json as any)?.programs ? (
                <MultiProgramForm
                  ticket={selectedTicket}
                  onValidate={handleValidate}
                  loading={actionLoading}
                  disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
                  onRefreshTicket={async () => {
                    // Recharger le ticket depuis l'API pour avoir le JSON mis à
                    // jour. Un échec s'affiche : l'admin ne doit pas valider
                    // sans le savoir sur des données anciennes (F6,
                    // lib/ticket-refresh.ts).
                    try {
                      const res = await fetch(`/api/admin/inbox/${selectedTicket.id}`);
                      const refreshed = readRefreshedTicket<Ticket>(
                        res.status,
                        await res.json().catch(() => null)
                      );
                      if (refreshed.ok) setSelectedTicket(refreshed.ticket);
                      else setActionMsg({ type: "error", text: refreshed.error });
                    } catch {
                      setActionMsg({ type: "error", text: TICKET_REFRESH_ERROR });
                    }
                    fetchTickets();
                  }}
                />
              ) : (
                <GenericForm
                  ticket={selectedTicket}
                  onValidate={handleValidate}
                  loading={actionLoading}
                  disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
                />
              )}
            </div>

            {/* Message d'action */}
            {actionMsg && (
              <div className={`alert ${actionMsg.type === "success" ? "alert-success" : "alert-danger"}`} style={{ margin: "16px 0 0" }}>
                {actionMsg.type === "success" ? "✅" : "❌"} {actionMsg.text}
              </div>
            )}

            {/* Bouton Rejeter (commun à toutes les catégories) */}
            {selectedTicket.status !== "Validated" && selectedTicket.status !== "Rejected" && (
              <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
                <button
                  id="btn-reject-ticket"
                  className="btn btn-danger"
                  style={{ width: "100%" }}
                  onClick={handleReject}
                  disabled={actionLoading}
                >
                  {actionLoading ? "Rejet en cours..." : "❌ Rejeter ce ticket"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal de purge ── */}
      {purgeModalOpen && (
        <div className="panel-overlay" onClick={() => setPurgeModalOpen(false)}>
          <div
            className="purge-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: "1.1rem" }}>
              🗑️ Purger les tickets traités
            </h3>

            <div className="form-group" style={{ marginBottom: "16px" }}>
              <label className="form-label">Statuts à supprimer</label>
              <select
                id="purge-status-filter"
                className="form-control"
                value={purgeStatuses.join(",")}
                onChange={(e) => {
                  const val = e.target.value;
                  const newStatuses = val.split(",");
                  setPurgeStatuses(newStatuses);
                  fetchPurgeCount(newStatuses);
                }}
              >
                <option value="Validated,Rejected">Validés + Rejetés</option>
                <option value="Validated">Validés uniquement</option>
                <option value="Rejected">Rejetés uniquement</option>
              </select>
            </div>

            {purgeCount !== null && (
              <div style={{
                padding: "12px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: "var(--radius)",
                marginBottom: "16px",
                fontSize: "0.9rem",
                textAlign: "center",
              }}>
                ⚠️ <strong>{purgeCount}</strong> ticket{purgeCount !== 1 ? "s" : ""} seront supprimés définitivement
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                className="btn btn-secondary"
                onClick={() => setPurgeModalOpen(false)}
              >
                Annuler
              </button>
              <button
                id="btn-confirm-purge"
                className="btn btn-danger"
                onClick={handlePurge}
                disabled={purgeLoading || purgeCount === 0}
              >
                {purgeLoading ? "Suppression..." : "Confirmer la suppression"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .empty-state {
          text-align: center;
          padding: 60px 40px;
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          color: var(--text-secondary);
        }
        .empty-state span { font-size: 3rem; display: block; margin-bottom: 16px; }

        /* ── Flags ── */
        .flag-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .flag-warning { background: rgba(234,179,8,0.15); color: #ca8a04; border: 1px solid rgba(234,179,8,0.3); }
        .flag-danger  { background: rgba(239,68,68,0.12); color: #dc2626; border: 1px solid rgba(239,68,68,0.25); }
        .flag-orange  { background: rgba(249,115,22,0.12); color: #ea580c; border: 1px solid rgba(249,115,22,0.25); }

        /* ── Badges status ── */
        .badge-warning { background: rgba(234,179,8,0.15); color: #ca8a04; }
        .pending-ai-banner {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          margin-bottom: 20px; padding: 12px 16px; border-radius: var(--radius-md);
          background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.3);
          color: #ca8a04; font-size: 0.9rem;
        }
        .badge-info    { background: rgba(59,130,246,0.12); color: #2563eb; }
        .badge-danger  { background: rgba(239,68,68,0.12); color: #dc2626; }

        /* ── Panneau slide-over ── */
        .panel-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000;
          display: flex; justify-content: flex-end;
          animation: fadeIn 0.15s ease;
        }
        .panel {
          width: min(600px, 95vw); height: 100vh; overflow-y: auto;
          background: var(--bg-primary); border-left: 1px solid var(--border-color);
          padding: 28px; display: flex; flex-direction: column; gap: 0;
          animation: slideIn 0.2s ease;
        }
        .panel-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border-color);
        }
        .user-text-box {
          background: var(--bg-secondary); border: 1px solid var(--border-color);
          border-radius: var(--radius); padding: 12px; margin-bottom: 16px;
        }
        .form-section { flex: 1; }

        /* ── Formulaire Program_Discovery ── */
        .campus-block {
          border: 1px solid var(--border-color); border-radius: var(--radius);
          padding: 16px; margin-bottom: 12px; background: var(--bg-secondary);
        }
        .campus-block-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;
        }
        .program-row {
          display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center;
          padding: 8px; border-radius: var(--radius); background: var(--bg-primary);
          margin-bottom: 6px; border: 1px solid var(--border-color);
        }
        .program-fields { display: flex; flex-direction: column; gap: 4px; }

        /* ── Formulaire générique ── */
        .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

        /* ── Modal de purge ── */
        .purge-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          padding: 28px;
          min-width: 400px;
          max-width: 90vw;
          z-index: 1001;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────
// Formulaire répéteur — Program_Discovery (Super Ticket)
// Référence : task.md §3.2, architecture.md §5.2
// ──────────────────────────────────────────────

function ProgramDiscoveryForm({
  ticket,
  onValidate,
  loading,
  disabled,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const initial = ticket.ai_extracted_json as { discovered_campuses?: DiscoveredCampus[] } | null;

  const [campuses, setCampuses] = useState<DiscoveredCampus[]>(
    initial?.discovered_campuses ?? []
  );

  const updateCampusName = (ci: number, val: string) => {
    setCampuses((prev) => prev.map((c, i) => i === ci ? { ...c, name: val } : c));
  };

  const updateCampusCity = (ci: number, val: string) => {
    setCampuses((prev) => prev.map((c, i) => i === ci ? { ...c, city: val } : c));
  };

  const removeCampus = (ci: number) => {
    setCampuses((prev) => prev.filter((_, i) => i !== ci));
  };

  const addCampus = () => {
    setCampuses((prev) => [...prev, { name: "", city: "", programs: [] }]);
  };

  const updateProgram = (ci: number, pi: number, field: keyof DiscoveredProgram, val: string | boolean | null) => {
    setCampuses((prev) =>
      prev.map((c, i) =>
        i !== ci ? c : {
          ...c,
          programs: c.programs.map((p, j) =>
            j !== pi ? p : { ...p, [field]: val }
          ),
        }
      )
    );
  };

  const removeProgram = (ci: number, pi: number) => {
    setCampuses((prev) =>
      prev.map((c, i) =>
        i !== ci ? c : { ...c, programs: c.programs.filter((_, j) => j !== pi) }
      )
    );
  };

  const addProgram = (ci: number) => {
    setCampuses((prev) =>
      prev.map((c, i) =>
        i !== ci ? c : {
          ...c,
          programs: [...c.programs, { name: "", admission_exam: null, is_alternance_possible: false, is_expatriation_mandatory: false }],
        }
      )
    );
  };

  const handleSubmit = () => {
    onValidate({ discovered_campuses: campuses });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>
          🗺️ Campus & Programmes découverts ({campuses.length} campus)
        </h3>
        {!disabled && (
          <button id="btn-add-campus" className="btn btn-secondary btn-sm" onClick={addCampus}>
            + Ajouter un campus
          </button>
        )}
      </div>

      {campuses.length === 0 && (
        <div style={{ color: "var(--text-secondary)", fontStyle: "italic", marginBottom: "16px" }}>
          Aucun campus détecté dans le JSON.
        </div>
      )}

      {campuses.map((campus, ci) => (
        <div key={ci} className="campus-block">
          <div className="campus-block-header">
            <strong>🏫 Campus {ci + 1}</strong>
            {!disabled && (
              <button className="btn btn-danger btn-sm" onClick={() => removeCampus(ci)}>
                Supprimer campus
              </button>
            )}
          </div>

          <div className="field-grid" style={{ marginBottom: "12px" }}>
            <div className="form-group">
              <label className="form-label">Nom du campus *</label>
              <input
                id={`campus-name-${ci}`}
                type="text"
                className="form-control"
                value={campus.name}
                onChange={(e) => updateCampusName(ci, e.target.value)}
                disabled={disabled}
                placeholder="ex: Campus Paris La Défense"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Ville</label>
              <input
                id={`campus-city-${ci}`}
                type="text"
                className="form-control"
                value={campus.city ?? ""}
                onChange={(e) => updateCampusCity(ci, e.target.value)}
                disabled={disabled}
                placeholder="ex: Paris"
              />
            </div>
          </div>

          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Programmes ({campus.programs.length})
              </span>
              {!disabled && (
                <button className="btn btn-secondary btn-sm" onClick={() => addProgram(ci)}>
                  + Programme
                </button>
              )}
            </div>

            {campus.programs.map((prog, pi) => (
              <div key={pi} className="program-row">
                <div className="program-fields">
                  <input
                    id={`prog-name-${ci}-${pi}`}
                    type="text"
                    className="form-control"
                    value={prog.name}
                    onChange={(e) => updateProgram(ci, pi, "name", e.target.value)}
                    disabled={disabled}
                    placeholder="Nom exact du programme"
                    style={{ marginBottom: "4px" }}
                  />
                  <input
                    id={`prog-exam-${ci}-${pi}`}
                    type="text"
                    className="form-control"
                    value={prog.admission_exam ?? ""}
                    onChange={(e) => updateProgram(ci, pi, "admission_exam", e.target.value || null)}
                    disabled={disabled}
                    placeholder="Concours d'admission (optionnel)"
                    style={{ fontSize: "0.85rem" }}
                  />
                  <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={prog.is_alternance_possible ?? false}
                        onChange={(e) => updateProgram(ci, pi, "is_alternance_possible", e.target.checked)}
                        disabled={disabled}
                      />
                      Alternance possible
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={prog.is_expatriation_mandatory ?? false}
                        onChange={(e) => updateProgram(ci, pi, "is_expatriation_mandatory", e.target.checked)}
                        disabled={disabled}
                      />
                      Expatriation obligatoire
                    </label>
                  </div>
                </div>
                {!disabled && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeProgram(ci, pi)}
                    title="Supprimer ce programme"
                    style={{ alignSelf: "flex-start" }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!disabled && (
        <button
          id="btn-validate-discovery"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "8px" }}
          onClick={handleSubmit}
          disabled={loading || campuses.length === 0}
        >
          {loading ? "Validation en cours..." : "✓ Valider — Créer Campus & Programmes"}
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Rattachement campus — lignes-années et notes de politique de campus
//
// Un ticket Program_Discovery qui porte `campus_attachments` vient de la
// collecte de la Phase 1. Il ne crée ni Campus, ni Program, ni arête : chaque
// ligne se pose sur une arête ProgramCampus existante, et une ligne dont
// l'arête manque ressort en conflit `edge_missing`. L'admin retire ici ce
// qu'il refuse ; le corps envoyé prime sur le JSON du ticket.
// ──────────────────────────────────────────────

interface CampusAttachmentClaim {
  programId: string | null;
  campusId: string | null;
  program?: string | null;
  campus?: string | null;
  fiche?: string | null;
  study_year: number;
  regime?: string | null;
  languages?: string[];
  note?: string | null;
  source_url?: string | null;
}

interface CampusPolicyNoteClaim {
  programId: string | null;
  program?: string | null;
  fiche?: string | null;
  note: string;
}

interface WriteCounts {
  created: number;
  updated: number;
  unchanged: number;
}

interface AttachmentWriteResult {
  message?: string;
  written?: WriteCounts;
  stale?: Array<{ program: string | null; campus: string | null; study_year: number; regime: string }>;
  policy_notes?: { written: WriteCounts };
  conflicts?: Array<{
    type: string;
    program?: string | null;
    campus?: string | null;
    study_year?: number;
    regime?: string;
    effect: string;
  }>;
}

function CampusAttachmentsForm({
  ticket,
  disabled,
  onWritten,
}: {
  ticket: Ticket;
  disabled: boolean;
  onWritten: () => void;
}) {
  const initial = ticket.ai_extracted_json as {
    campus_attachments?: CampusAttachmentClaim[];
    campus_policy_notes?: CampusPolicyNoteClaim[];
    collector?: {
      unresolved_claims?: unknown[];
      placements_not_written?: number;
      pages_read?: number;
      plan_at_collection?: {
        attachments?: { create: number; update: number; unchanged: number };
        policy_notes?: { create: number; update: number; unchanged: number };
      };
    };
  } | null;
  const planned = initial?.collector?.plan_at_collection;

  const [rows, setRows] = useState<CampusAttachmentClaim[]>(() =>
    [...(initial?.campus_attachments ?? [])].sort((a, b) =>
      `${a.program} ${a.campus} ${a.study_year} ${a.regime}`.localeCompare(
        `${b.program} ${b.campus} ${b.study_year} ${b.regime}`
      )
    )
  );
  const [notes, setNotes] = useState<CampusPolicyNoteClaim[]>(initial?.campus_policy_notes ?? []);
  const [writing, setWriting] = useState(false);
  const [result, setResult] = useState<AttachmentWriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const removed =
    (initial?.campus_attachments?.length ?? 0) - rows.length +
    (initial?.campus_policy_notes?.length ?? 0) - notes.length;

  const handleWrite = async () => {
    setWriting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/inbox/${ticket.id}/attachments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campus_attachments: rows, campus_policy_notes: notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'écriture");
      setResult(data);
      onWritten();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setWriting(false);
    }
  };

  const conflictsByType = (result?.conflicts ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.type] = (acc[c.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>
        🧭 Rattachement campus — {rows.length} ligne(s)-année(s), {notes.length} note(s)
      </h3>
      {planned && (
        <p style={{ fontSize: "0.85rem", margin: "0 0 8px" }}>
          Au moment de la collecte : {planned.attachments?.create ?? 0} ligne(s) à créer,{" "}
          {planned.attachments?.update ?? 0} à mettre à jour, {planned.attachments?.unchanged ?? 0} déjà
          en base ; {(planned.policy_notes?.create ?? 0) + (planned.policy_notes?.update ?? 0)} note(s) à
          écrire. La route recalcule ce plan au moment d&apos;écrire.
        </p>
      )}
      <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "0 0 12px" }}>
        Aucune arête n&apos;est créée : une ligne dont l&apos;arête ProgramCampus manque n&apos;est pas
        écrite. Aucune ligne n&apos;est supprimée.
        {initial?.collector?.placements_not_written
          ? ` ${initial.collector.placements_not_written} lieu(x) hors parc collecté(s) ne sont pas proposé(s) : ProgramPlacement n'a pas de chemin d'écriture.`
          : ""}
        {initial?.collector?.unresolved_claims?.length
          ? ` ${initial.collector.unresolved_claims.length} ligne(s) sans programme ou campus en base sont écartée(s) (voir le JSON brut).`
          : ""}
      </p>

      {rows.length > 0 && (
        <div className="table-container" style={{ marginBottom: "12px" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>Campus</th>
                <th>Année</th>
                <th>Régime</th>
                <th>Langues</th>
                <th>Fiche</th>
                {!disabled && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.programId}-${row.campusId}-${row.study_year}-${row.regime}-${row.fiche}-${index}`}>
                  <td>{row.program ?? row.programId}</td>
                  <td>{row.campus ?? row.campusId}</td>
                  <td>{row.study_year}</td>
                  <td>{row.regime ?? "ANY"}</td>
                  <td>{(row.languages ?? []).join(", ") || "—"}</td>
                  <td style={{ fontSize: "0.75rem" }}>
                    {row.source_url ? (
                      <a href={row.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        {row.fiche ?? "source"}
                      </a>
                    ) : (
                      row.fiche ?? "—"
                    )}
                  </td>
                  {!disabled && (
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        title="Retirer cette ligne avant l'écriture"
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notes.map((note, index) => (
        <div key={`${note.programId}-${index}`} className="campus-block">
          <div className="campus-block-header">
            <strong>📝 Note de politique de campus — {note.program ?? note.programId}</strong>
            {!disabled && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setNotes((prev) => prev.filter((_, i) => i !== index))}
              >
                Retirer
              </button>
            )}
          </div>
          <p style={{ margin: 0, fontSize: "0.9rem" }}>« {note.note} »</p>
        </div>
      ))}

      {removed > 0 && !disabled && (
        <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
          {removed} élément(s) retiré(s) : ils ne seront pas écrits.
        </p>
      )}

      {error && <div className="alert alert-danger">❌ {error}</div>}

      {result && (
        <div className="alert alert-success" style={{ display: "block" }}>
          <div>✅ {result.message}</div>
          {Object.keys(conflictsByType).length > 0 && (
            <div style={{ fontSize: "0.8rem", marginTop: "6px" }}>
              Non écrit ou fusionné :{" "}
              {Object.entries(conflictsByType)
                .map(([type, count]) => `${type} ×${count}`)
                .join(" · ")}
            </div>
          )}
          {(result.stale?.length ?? 0) > 0 && (
            <div style={{ fontSize: "0.8rem", marginTop: "6px" }}>
              {result.stale!.length} ligne(s) en base non réaffirmée(s), conservée(s) :{" "}
              {result.stale!.map((s) => `${s.program} · ${s.campus} · année ${s.study_year}`).join(" ; ")}
            </div>
          )}
        </div>
      )}

      <details style={{ marginTop: "12px" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          Voir JSON brut complet
        </summary>
        <pre style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
          borderRadius: "var(--radius)", padding: "12px", fontSize: "0.75rem",
          overflow: "auto", maxHeight: "200px", marginTop: "8px",
        }}>
          {JSON.stringify(ticket.ai_extracted_json, null, 2)}
        </pre>
      </details>

      {!disabled && (
        <button
          id="btn-write-campus-attachments"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "16px" }}
          onClick={handleWrite}
          disabled={writing || rows.length + notes.length === 0}
        >
          {writing
            ? "Écriture en cours..."
            : `✓ Écrire ${rows.length} ligne(s)-année(s) et ${notes.length} note(s)`}
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Formulaire générique — Pricing, Ranking, Capacity, SchoolStats, Accreditation
// Référence : task.md §3.3, architecture.md §5.3
// ──────────────────────────────────────────────

// Une voie d'admission d'un ticket Capacity au nouveau format.
interface CapacityChannel {
  spots_available: number;
  academic_year?: number | null;
  admission_channel?: string | null;
  source_url?: string | null;
}

function GenericForm({
  ticket,
  onValidate,
  loading,
  disabled,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>(
    (ticket.ai_extracted_json as Record<string, unknown>) ?? {}
  );

  const update = (key: string, val: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
  };

  const fields = getFieldsForCategory(ticket.ai_category);

  // Capacity nouveau format : le pipeline extrait une entrée par voie
  // d'admission (SESAME, ACCÈS, Parcoursup…), parce que c'est ainsi que les
  // places sont publiées. CapacityRecord n'en garde qu'une par année, et la
  // recomposition est un arbitrage — donc humain. Les voies sont affichées
  // ici ; laisser « Places disponibles » vide fait appliquer la règle par
  // défaut du serveur (total publié s'il existe, somme sinon), et y saisir un
  // chiffre prime sur le tableau.
  const capacityChannels = (
    (ticket.ai_extracted_json as { capacities?: CapacityChannel[] } | null)?.capacities ?? []
  ).filter((item) => item && item.spots_available != null);

  return (
    <div>
      <h3 style={{ fontSize: "1rem", marginBottom: "16px" }}>
        {CATEGORY_ICONS[ticket.ai_category]} Données extraites — {ticket.ai_category}
      </h3>

      {capacityChannels.length > 0 && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "12px 14px",
            marginBottom: "16px",
            fontSize: "13px",
          }}
        >
          <strong style={{ display: "block", marginBottom: "8px" }}>
            🎓 Voies d&apos;admission détectées ({capacityChannels.length})
          </strong>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {capacityChannels.map((item, idx) => (
              <li key={idx} style={{ marginBottom: "4px" }}>
                <strong>{item.spots_available}</strong> place(s)
                {item.admission_channel ? ` — ${item.admission_channel}` : ""}
                {item.academic_year ? ` (${item.academic_year})` : ""}
                {item.source_url && (
                  <>
                    {" — "}
                    <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                      source
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0", color: "var(--muted, #666)" }}>
            Laisser « Places disponibles » vide applique la règle par défaut :
            le total publié s&apos;il en existe un, la somme des voies sinon.
            Un chiffre saisi ici fait autorité.
          </p>
        </div>
      )}

      <div className="field-grid">
        {fields.map(({ key, label, type, required }) => (
          <div key={key} className="form-group">
            <label className="form-label" htmlFor={`field-${key}`}>
              {label}{required && <span style={{ color: "var(--danger)" }}> *</span>}
            </label>
            {type === "boolean" ? (
              <select
                id={`field-${key}`}
                className="form-control"
                value={String(formData[key] ?? "")}
                onChange={(e) => update(key, e.target.value === "true" ? true : e.target.value === "false" ? false : null)}
                disabled={disabled}
              >
                <option value="">—</option>
                <option value="true">Oui</option>
                <option value="false">Non</option>
              </select>
            ) : type === "number" ? (
              <input
                id={`field-${key}`}
                type="number"
                className="form-control"
                value={formData[key] != null ? String(formData[key]) : ""}
                onChange={(e) => update(key, e.target.value ? Number(e.target.value) : null)}
                disabled={disabled}
              />
            ) : (
              <input
                id={`field-${key}`}
                type="text"
                className="form-control"
                value={formData[key] != null ? String(formData[key]) : ""}
                onChange={(e) => update(key, e.target.value || null)}
                disabled={disabled}
              />
            )}
          </div>
        ))}
      </div>

      {/* JSON brut (lecture seule) */}
      <details style={{ marginTop: "12px" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          Voir JSON brut complet
        </summary>
        <pre style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
          borderRadius: "var(--radius)", padding: "12px", fontSize: "0.75rem",
          overflow: "auto", maxHeight: "200px", marginTop: "8px",
        }}>
          {JSON.stringify(ticket.ai_extracted_json, null, 2)}
        </pre>
      </details>

      {!disabled && (
        <button
          id="btn-validate-generic"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "16px" }}
          onClick={() => onValidate(formData)}
          disabled={loading}
        >
          {loading ? "Validation en cours..." : `✓ Valider et publier — ${ticket.ai_category}`}
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Définition des champs par catégorie
// ──────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  required?: boolean;
}

function getFieldsForCategory(category: string): FieldDef[] {
  switch (category) {
    case "Pricing":
      return [
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "currency", label: "Devise", type: "text" },
        { key: "year_1_fee", label: "Frais Année 1 (€)", type: "number" },
        { key: "year_2_fee", label: "Frais Année 2 (€)", type: "number" },
        { key: "year_3_fee", label: "Frais Année 3 (€)", type: "number" },
        { key: "year_4_fee", label: "Frais Année 4 (€)", type: "number" },
        { key: "year_5_fee", label: "Frais Année 5 (€)", type: "number" },
        { key: "total_fee", label: "Total cursus (€)", type: "number" },
        { key: "intl_year_1_fee", label: "Frais An.1 Non-UE", type: "number" },
        { key: "intl_total_fee", label: "Total Non-UE", type: "number" },
        { key: "intl_currency", label: "Devise Non-UE", type: "text" },
        { key: "additional_fees_notes", label: "Frais annexes (notes)", type: "text" },
        { key: "source_url", label: "URL source", type: "text" },
        { key: "year_assumed", label: "Année supposée ?", type: "boolean" },
        { key: "data_conflict_warning", label: "Conflit de données ?", type: "boolean" },
      ];

    case "Ranking":
      return [
        { key: "ranking_name", label: "Nom du classement", type: "text", required: true },
        { key: "rank", label: "Rang", type: "number", required: true },
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "source_url", label: "URL source", type: "text" },
        { key: "data_conflict_warning", label: "Conflit de données ?", type: "boolean" },
      ];

    case "Capacity":
      return [
        { key: "spots_available", label: "Places disponibles", type: "number", required: true },
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "source_url", label: "URL source", type: "text" },
        { key: "year_assumed", label: "Année supposée ?", type: "boolean" },
      ];

    case "SchoolStats":
      return [
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "total_students", label: "Total étudiants", type: "number" },
        { key: "total_alumni", label: "Total alumni", type: "number" },
        { key: "partner_companies", label: "Entreprises partenaires", type: "number" },
        { key: "annual_internship_offers", label: "Offres de stage/an", type: "number" },
        { key: "abroad_campuses", label: "Campus à l'étranger", type: "number" },
        { key: "partner_universities", label: "Univ. partenaires", type: "number" },
        { key: "permanent_professors", label: "Profs permanents", type: "number" },
        { key: "international_professors_pct", label: "% Profs internationaux", type: "number" },
        { key: "external_speakers_pct", label: "% Intervenants externes", type: "number" },
      ];

    case "Accreditation":
      return [
        { key: "accreditation_name", label: "Nom accréditation", type: "text", required: true },
        // Non requise : l'année n'est pas toujours publiée, et la colonne
        // accepte désormais NULL plutôt que la sentinelle 0.
        { key: "year_obtained", label: "Année d'obtention", type: "number" },
        { key: "is_active", label: "Active ?", type: "boolean" },
      ];

    default:
      return [];
  }
}

// ──────────────────────────────────────────────
// Formulaire répéteur — Accreditation (Liste d'accréditations)
// ──────────────────────────────────────────────

interface AccreditationListItem {
  accreditation_name: string;
  accreditation_type: "international" | "label" | "state";
  // null = année inconnue. L'ancienne sentinelle 0 partait en production
  // comme une année réelle.
  year_obtained: number | null;
  is_active: boolean;
  source_url?: string | null;
}

function AccreditationListForm({
  ticket,
  onValidate,
  loading,
  disabled,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const initial = ticket.ai_extracted_json as {
    accreditations?: AccreditationListItem[];
    accreditation_name?: string;
    accreditation_type?: "international" | "label" | "state";
    year_obtained?: number | null;
    is_active?: boolean;
    source_url?: string | null;
  } | null;

  const [accreditations, setAccreditations] = useState<AccreditationListItem[]>(() => {
    if (initial?.accreditations && Array.isArray(initial.accreditations)) {
      return initial.accreditations.map((item) => ({
        accreditation_name: item.accreditation_name || "",
        accreditation_type: item.accreditation_type || "international",
        year_obtained: item.year_obtained ?? null,
        is_active: item.is_active ?? true,
        source_url: item.source_url || null,
      }));
    }
    // Rétrocompatibilité : format objet unique
    if (initial?.accreditation_name) {
      return [{
        accreditation_name: initial.accreditation_name,
        accreditation_type: initial.accreditation_type || "international",
        year_obtained: initial.year_obtained ?? null,
        is_active: initial.is_active ?? true,
        source_url: initial.source_url || null,
      }];
    }
    return [];
  });

  const updateItem = (index: number, field: keyof AccreditationListItem, val: any) => {
    setAccreditations((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: val } : item))
    );
  };

  const removeItem = (index: number) => {
    setAccreditations((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setAccreditations((prev) => [
      ...prev,
      { accreditation_name: "", accreditation_type: "international", year_obtained: new Date().getFullYear(), is_active: true },
    ]);
  };

  const handleSubmit = () => {
    onValidate({ accreditations });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>
          📜 Accréditations et Labels détectés ({accreditations.length})
        </h3>
        {!disabled && (
          <button className="btn btn-secondary btn-sm" onClick={addItem}>
            + Ajouter
          </button>
        )}
      </div>

      {accreditations.length === 0 && (
        <div style={{ color: "var(--text-secondary)", fontStyle: "italic", marginBottom: "16px" }}>
          Aucune accréditation détectée dans le JSON.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
        {accreditations.map((item, idx) => (
          <div
            key={idx}
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius)",
              padding: "12px",
              background: "var(--bg-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "var(--text-secondary)" }}>
                Item #{idx + 1}
              </span>
              {!disabled && (
                <button
                  className="btn btn-danger btn-sm"
                  style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                  onClick={() => removeItem(idx)}
                >
                  Supprimer
                </button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: "0.75rem" }}>Nom</label>
                <input
                  type="text"
                  className="form-control"
                  value={item.accreditation_name}
                  onChange={(e) => updateItem(idx, "accreditation_name", e.target.value)}
                  disabled={disabled}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: "0.75rem" }}>Type</label>
                <select
                  className="form-control"
                  value={item.accreditation_type}
                  onChange={(e) => updateItem(idx, "accreditation_type", e.target.value as any)}
                  disabled={disabled}
                >
                  <option value="international">🌍 International (EQUIS, AACSB, AMBA...)</option>
                  <option value="state">🇫🇷 Reconnu par l'État (Grade, CTI...)</option>
                  <option value="label">🏷️ Label / Certif (CGE, Qualiopi, DDRS...)</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: "0.75rem" }}>Année d'obtention</label>
                <input
                  type="number"
                  className="form-control"
                  value={item.year_obtained ?? ""}
                  onChange={(e) => updateItem(idx, "year_obtained", e.target.value ? Number(e.target.value) : null)}
                  disabled={disabled}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: "0.75rem" }}>Statut actif</label>
                <select
                  className="form-control"
                  value={String(item.is_active)}
                  onChange={(e) => updateItem(idx, "is_active", e.target.value === "true")}
                  disabled={disabled}
                >
                  <option value="true">Actif</option>
                  <option value="false">Inactif (Expiré)</option>
                </select>
              </div>
            </div>

            {item.source_url && (
              <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", wordBreak: "break-all" }}>
                Source : <a href={item.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{item.source_url}</a>
              </div>
            )}
          </div>
        ))}
      </div>

      {!disabled && (
        <button
          id="btn-validate-accreditations"
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "8px" }}
          onClick={handleSubmit}
          disabled={loading || accreditations.length === 0}
        >
          {loading ? "Validation en cours..." : "✓ Valider et Publier ces accréditations"}
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Formulaire répéteur — Multi-Programme (Pricing, Ranking, Capacity)
// Affiche les programmes matchés par l'IA avec leur données extraites
// ──────────────────────────────────────────────

interface MatchedProgramEntry {
  extracted_program_name: string;
  matched_program_id: string | null;
  matched_program_name: string | null;
  match_confidence: "exact" | "fuzzy" | "none";
  data: Record<string, unknown>;
}

interface UnmatchedProgramEntry {
  extracted_program_name: string;
  reason: string;
}

interface MultiProgramJson {
  programs: MatchedProgramEntry[];
  unmatched_programs: UnmatchedProgramEntry[];
  source_url?: string;
  year_assumed?: boolean;
  data_conflict_warning?: boolean;
}

function MultiProgramForm({
  ticket,
  onValidate,
  loading,
  disabled,
  onRefreshTicket,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
  onRefreshTicket?: () => Promise<void>;
}) {
  const initial = ticket.ai_extracted_json as MultiProgramJson | null;
  const [programs, setPrograms] = useState<MatchedProgramEntry[]>(initial?.programs ?? []);
  const [unmatchedPrograms, setUnmatchedPrograms] = useState<UnmatchedProgramEntry[]>(initial?.unmatched_programs ?? []);
  const [creatingPrograms, setCreatingPrograms] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Mettre à jour l'état si le ticket parent change
  useEffect(() => {
    const fresh = ticket.ai_extracted_json as MultiProgramJson | null;
    if (fresh) {
      setPrograms(fresh.programs ?? []);
      setUnmatchedPrograms(fresh.unmatched_programs ?? []);
    }
  }, [ticket]);

  // Les champs éditables dépendent de la catégorie
  const fields = getFieldsForCategory(ticket.ai_category);

  const updateProgramData = (progIdx: number, key: string, val: unknown) => {
    setPrograms((prev) =>
      prev.map((p, i) =>
        i !== progIdx ? p : { ...p, data: { ...p.data, [key]: val } }
      )
    );
  };

  const removeProgram = (progIdx: number) => {
    setPrograms((prev) => prev.filter((_, i) => i !== progIdx));
  };

  const handleSubmit = () => {
    onValidate({
      programs,
      unmatched_programs: unmatchedPrograms,
      source_url: initial?.source_url,
      year_assumed: initial?.year_assumed,
      data_conflict_warning: initial?.data_conflict_warning,
    });
  };

  const CONFIDENCE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
    exact: { bg: "rgba(34, 197, 94, 0.12)", color: "#16a34a", label: "✓ Match exact" },
    fuzzy: { bg: "rgba(249, 115, 22, 0.12)", color: "#ea580c", label: "⚠ Match approximatif" },
    none: { bg: "rgba(239, 68, 68, 0.12)", color: "#dc2626", label: "✕ Non matché" },
  };

  return (
    <div>
      <h3 style={{ fontSize: "1rem", marginBottom: "16px" }}>
        {CATEGORY_ICONS[ticket.ai_category]} Données extraites — {ticket.ai_category} ({programs.length} programme{programs.length !== 1 ? "s" : ""})
      </h3>

      {/* Programmes matchés */}
      {programs.map((prog, idx) => {
        const conf = CONFIDENCE_STYLES[prog.match_confidence] || CONFIDENCE_STYLES.none;
        return (
          <div
            key={idx}
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius)",
              padding: "16px",
              marginBottom: "12px",
              background: "var(--bg-secondary)",
            }}
          >
            {/* Header du programme */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "4px" }}>
                  📚 {prog.matched_program_name || prog.extracted_program_name}
                </div>
                {prog.extracted_program_name !== prog.matched_program_name && prog.matched_program_name && (
                  <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
                    Nom extrait : « {prog.extracted_program_name} »
                  </div>
                )}
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    marginTop: "6px",
                    background: conf.bg,
                    color: conf.color,
                  }}
                >
                  {conf.label}
                </span>
              </div>
              {!disabled && (
                <button
                  className="btn btn-danger btn-sm"
                  style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                  onClick={() => removeProgram(idx)}
                >
                  Retirer
                </button>
              )}
            </div>

            {/* Champs de données */}
            <div className="field-grid">
              {fields.map(({ key, label, type, required }) => (
                <div key={key} className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" style={{ fontSize: "0.75rem" }}>
                    {label}{required && <span style={{ color: "var(--danger)" }}> *</span>}
                  </label>
                  {type === "boolean" ? (
                    <select
                      className="form-control"
                      value={String(prog.data[key] ?? "")}
                      onChange={(e) =>
                        updateProgramData(
                          idx,
                          key,
                          e.target.value === "true" ? true : e.target.value === "false" ? false : null
                        )
                      }
                      disabled={disabled}
                    >
                      <option value="">—</option>
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </select>
                  ) : type === "number" ? (
                    <input
                      type="number"
                      className="form-control"
                      value={prog.data[key] != null ? String(prog.data[key]) : ""}
                      onChange={(e) => updateProgramData(idx, key, e.target.value ? Number(e.target.value) : null)}
                      disabled={disabled}
                    />
                  ) : (
                    <input
                      type="text"
                      className="form-control"
                      value={prog.data[key] != null ? String(prog.data[key]) : ""}
                      onChange={(e) => updateProgramData(idx, key, e.target.value || null)}
                      disabled={disabled}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Programmes non matchés */}
      {unmatchedPrograms.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h4 style={{ fontSize: "0.9rem", margin: 0, color: "var(--danger)" }}>
              ⚠️ Programmes non matchés ({unmatchedPrograms.length})
            </h4>
          </div>
          {unmatchedPrograms.map((up, idx) => (
            <div
              key={idx}
              style={{
                padding: "10px 14px",
                background: "rgba(239, 68, 68, 0.06)",
                border: "1px solid rgba(239, 68, 68, 0.15)",
                borderRadius: "var(--radius)",
                marginBottom: "6px",
                fontSize: "0.85rem",
              }}
            >
              <strong>{up.extracted_program_name}</strong>
              <span style={{ color: "var(--text-secondary)", marginLeft: "8px" }}>— {up.reason}</span>
            </div>
          ))}

          {createMsg && (
            <div className={`alert ${createMsg.type === "success" ? "alert-success" : "alert-danger"}`} style={{ margin: "8px 0" }}>
              {createMsg.type === "success" ? "✅" : "❌"} {createMsg.text}
            </div>
          )}

          {!disabled && (
            <button
              className="btn btn-primary btn-sm"
              style={{
                width: "100%",
                marginTop: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
              disabled={creatingPrograms}
              onClick={async () => {
                setCreatingPrograms(true);
                setCreateMsg(null);
                try {
                  const programNames = unmatchedPrograms.map((u) => u.extracted_program_name);
                  const res = await fetch(`/api/admin/inbox/${ticket.id}/create-programs`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ programNames }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || "Erreur lors de la création");
                  
                  // Update local React state instantly with new updated JSON
                  if (data.updatedJson) {
                    setPrograms(data.updatedJson.programs || []);
                    setUnmatchedPrograms(data.updatedJson.unmatched_programs || []);
                  }
                  
                  setCreateMsg({ type: "success", text: `${data.count} programme(s) créé(s) et rattaché(s) au ticket` });
                  
                  // Refresh parent ticket in background
                  if (onRefreshTicket) await onRefreshTicket();
                } catch (err: unknown) {
                  setCreateMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
                } finally {
                  setCreatingPrograms(false);
                }
              }}
            >
              {creatingPrograms ? "Création en cours..." : `➕ Créer et rattacher les ${unmatchedPrograms.length} programme(s)`}
            </button>
          )}
        </div>
      )}

      {/* JSON brut */}
      <details style={{ marginTop: "12px" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          Voir JSON brut complet
        </summary>
        <pre style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
          borderRadius: "var(--radius)", padding: "12px", fontSize: "0.75rem",
          overflow: "auto", maxHeight: "200px", marginTop: "8px",
        }}>
          {JSON.stringify(ticket.ai_extracted_json, null, 2)}
        </pre>
      </details>

      {!disabled && (
        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "16px" }}
          onClick={handleSubmit}
          disabled={loading || programs.length === 0}
        >
          {loading ? "Validation en cours..." : `✓ Valider — ${programs.length} programme(s) ${ticket.ai_category}`}
        </button>
      )}
    </div>
  );
}
