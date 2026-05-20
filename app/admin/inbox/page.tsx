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
}

const STATUS_OPTIONS = ["", "Pending_AI", "Pending_Admin", "Validated", "Rejected"];
const CATEGORY_OPTIONS = ["", "Program_Discovery", "Pricing", "Ranking", "Capacity", "SchoolStats", "Accreditation"];

const STATUS_COLORS: Record<string, string> = {
  Pending_AI: "badge-warning",
  Pending_Admin: "badge-info",
  Validated: "badge-active",
  Rejected: "badge-danger",
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
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  // Panneau de détail
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const LIMIT = 20;

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterCategory]);

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
        </div>
      </div>

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
                <th>École</th>
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
                    <code style={{ fontSize: "0.8rem", color: "var(--accent)" }}>
                      {t.schoolId ? t.schoolId.substring(0, 8) + "…" : "—"}
                    </code>
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

            {/* Texte utilisateur (si crowdsourcing) */}
            {selectedTicket.user_text && (
              <div className="user-text-box">
                <p style={{ fontWeight: 600, marginBottom: "6px", fontSize: "0.9rem" }}>Message utilisateur :</p>
                <p style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap", margin: 0 }}>
                  {selectedTicket.user_text}
                </p>
              </div>
            )}

            {/* ── Formulaire par catégorie ── */}
            <div className="form-section">
              {selectedTicket.ai_category === "Program_Discovery" ? (
                <ProgramDiscoveryForm
                  ticket={selectedTicket}
                  onValidate={handleValidate}
                  loading={actionLoading}
                  disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
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
// Formulaire générique — Pricing, Ranking, Capacity, SchoolStats, Accreditation
// Référence : task.md §3.3, architecture.md §5.3
// ──────────────────────────────────────────────

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

  return (
    <div>
      <h3 style={{ fontSize: "1rem", marginBottom: "16px" }}>
        {CATEGORY_ICONS[ticket.ai_category]} Données extraites — {ticket.ai_category}
      </h3>

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
        { key: "year_obtained", label: "Année d'obtention", type: "number", required: true },
        { key: "is_active", label: "Active ?", type: "boolean" },
      ];

    default:
      return [];
  }
}
