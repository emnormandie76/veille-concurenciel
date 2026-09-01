"use client";

import { useEffect, useState } from "react";

interface Campus {
  id: string;
  schoolId: string;
  name: string;
  city: string | null;
}

interface AssociatedCampus {
  programCampusId: string;
  campusId: string;
  campusName: string;
  campusCity: string | null;
}

interface Program {
  id: string;
  schoolId: string;
  name: string;
  admission_exam: string | null;
  is_alternance_possible: boolean;
  is_expatriation_mandatory: boolean;
  min_expatriation_months: number | null;
  max_internship_months: number | null;
  associatedCampuses: AssociatedCampus[];
}

export default function CampusProgramsTab({ schoolId }: { schoolId: string }) {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states for Campus
  const [isCampusModalOpen, setIsCampusModalOpen] = useState(false);
  const [editingCampus, setEditingCampus] = useState<Campus | null>(null);
  const [campusName, setCampusName] = useState("");
  const [campusCity, setCampusCity] = useState("");
  const [deleteCampus, setDeleteCampus] = useState<Campus | null>(null);

  // Modal states for Program
  const [isProgramModalOpen, setIsProgramModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [progName, setProgName] = useState("");
  const [progExam, setProgExam] = useState("");
  const [progAlternance, setProgAlternance] = useState(false);
  const [progExpatriation, setProgExpatriation] = useState(false);
  const [progMinExpat, setProgMinExpat] = useState("");
  const [progMaxInternship, setProgMaxInternship] = useState("");
  const [progCampusIds, setProgCampusIds] = useState<string[]>([]);
  const [deleteProgram, setDeleteProgram] = useState<Program | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, [schoolId]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resCampuses, resPrograms] = await Promise.all([
        fetch(`/api/admin/schools/${schoolId}/campuses`),
        fetch(`/api/admin/schools/${schoolId}/programs`),
      ]);

      if (!resCampuses.ok || !resPrograms.ok) {
        throw new Error("Erreur de chargement des campus et programmes");
      }

      const jsonCampuses = await resCampuses.json();
      const jsonPrograms = await resPrograms.json();

      setCampuses(jsonCampuses);
      setPrograms(jsonPrograms);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- CAMPUS HANDLERS ---
  const openAddCampusModal = () => {
    setEditingCampus(null);
    setCampusName("");
    setCampusCity("");
    setModalError(null);
    setIsCampusModalOpen(true);
  };

  const openEditCampusModal = (c: Campus) => {
    setEditingCampus(c);
    setCampusName(c.name);
    setCampusCity(c.city || "");
    setModalError(null);
    setIsCampusModalOpen(true);
  };

  const handleCampusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setModalError(null);

    const body = { name: campusName.trim(), city: campusCity.trim() || null };

    try {
      const url = editingCampus
        ? `/api/admin/campuses/${editingCampus.id}`
        : `/api/admin/schools/${schoolId}/campuses`;
      const method = editingCampus ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur campus");

      setIsCampusModalOpen(false);
      fetchAll();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCampus = async () => {
    if (!deleteCampus) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/campuses/${deleteCampus.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Erreur de suppression");
      }
      setDeleteCampus(null);
      fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // --- PROGRAM HANDLERS ---
  const openAddProgramModal = () => {
    setEditingProgram(null);
    setProgName("");
    setProgExam("");
    setProgAlternance(false);
    setProgExpatriation(false);
    setProgMinExpat("");
    setProgMaxInternship("");
    setProgCampusIds(campuses.map((c) => c.id)); // Cocher tout par défaut
    setModalError(null);
    setIsProgramModalOpen(true);
  };

  const openEditProgramModal = (p: Program) => {
    setEditingProgram(p);
    setProgName(p.name);
    setProgExam(p.admission_exam || "");
    setProgAlternance(p.is_alternance_possible);
    setProgExpatriation(p.is_expatriation_mandatory);
    setProgMinExpat(p.min_expatriation_months !== null ? String(p.min_expatriation_months) : "");
    setProgMaxInternship(p.max_internship_months !== null ? String(p.max_internship_months) : "");
    setProgCampusIds(p.associatedCampuses.map((ac) => ac.campusId));
    setModalError(null);
    setIsProgramModalOpen(true);
  };

  const handleProgramSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (progCampusIds.length === 0) {
      setModalError("Au moins un campus doit être sélectionné.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    const body = {
      name: progName.trim(),
      admission_exam: progExam.trim() || null,
      is_alternance_possible: progAlternance,
      is_expatriation_mandatory: progExpatriation,
      min_expatriation_months: progMinExpat ? parseInt(progMinExpat) : null,
      max_internship_months: progMaxInternship ? parseInt(progMaxInternship) : null,
      campusIds: progCampusIds,
    };

    try {
      const url = editingProgram
        ? `/api/admin/programs/${editingProgram.id}`
        : `/api/admin/schools/${schoolId}/programs`;
      const method = editingProgram ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur programme");

      setIsProgramModalOpen(false);
      fetchAll();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleProgramCampus = async (program: Program, campusId: string) => {
    const currentCampusIds = program.associatedCampuses.map((ac) => ac.campusId);
    let nextCampusIds: string[];
    if (currentCampusIds.includes(campusId)) {
      if (currentCampusIds.length <= 1) {
        alert("Un programme doit être associé à au moins un campus.");
        return;
      }
      nextCampusIds = currentCampusIds.filter((id) => id !== campusId);
    } else {
      nextCampusIds = [...currentCampusIds, campusId];
    }

    try {
      const res = await fetch(`/api/admin/programs/${program.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campusIds: nextCampusIds }),
      });
      if (!res.ok) throw new Error("Erreur de mise à jour de l'association");
      fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteProgram = async () => {
    if (!deleteProgram) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/programs/${deleteProgram.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Erreur de suppression");
      }
      setDeleteProgram(null);
      fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div>
      {error && <div className="alert alert-danger" style={{ marginBottom: "20px" }}>{error}</div>}

      {/* ZONE CAMPUS */}
      <section style={{ marginBottom: "40px" }}>
        <div className="tab-section-header">
          <h2 className="tab-section-title">Campus ({campuses.length})</h2>
          <button className="btn btn-primary btn-sm" onClick={openAddCampusModal}>
            ➕ Ajouter un campus
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "20px", color: "var(--text-secondary)" }}>
            Chargement des campus...
          </div>
        ) : campuses.length === 0 ? (
          <div className="inline-form" style={{ textAlign: "center", padding: "30px" }}>
            <p style={{ color: "var(--text-secondary)" }}>Aucun campus enregistré pour cette école.</p>
          </div>
        ) : (
          <div className="cards-grid">
            {campuses.map((c) => (
              <div key={c.id} className="data-card">
                <div className="data-card-header">
                  <span className="data-card-title">{c.name}</span>
                  <div className="data-card-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => openEditCampusModal(c)}
                      style={{ padding: "4px 8px" }}
                    >
                      Modifier
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setDeleteCampus(c)}
                      style={{ padding: "4px 8px" }}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
                <div className="data-card-meta">
                  <span>📍 Ville : {c.city || "Non précisée"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ZONE PROGRAMMES */}
      <section>
        <div className="tab-section-header">
          <h2 className="tab-section-title">Programmes ({programs.length})</h2>
          <button
            className="btn btn-primary btn-sm"
            onClick={openAddProgramModal}
            disabled={campuses.length === 0}
            title={campuses.length === 0 ? "Veuillez d'abord créer au moins un campus" : ""}
          >
            ➕ Ajouter un programme
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "20px", color: "var(--text-secondary)" }}>
            Chargement des programmes...
          </div>
        ) : programs.length === 0 ? (
          <div className="inline-form" style={{ textAlign: "center", padding: "30px" }}>
            <p style={{ color: "var(--text-secondary)" }}>Aucun programme enregistré pour cette école.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nom du programme</th>
                  <th>Concours / Admission</th>
                  <th>Alternance</th>
                  <th>Expatriation</th>
                  <th>Campus associés</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {programs.map((prog) => {
                  const associatedIds = prog.associatedCampuses.map((ac) => ac.campusId);
                  return (
                    <tr key={prog.id}>
                      <td style={{ fontWeight: 600 }}>{prog.name}</td>
                      <td>{prog.admission_exam || "—"}</td>
                      <td>
                        <span className={`badge ${prog.is_alternance_possible ? "badge-active" : "badge-inactive"}`}>
                          {prog.is_alternance_possible ? "Oui" : "Non"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${prog.is_expatriation_mandatory ? "badge-active" : "badge-inactive"}`}>
                          {prog.is_expatriation_mandatory ? "Oui" : "Non"}
                        </span>
                        {prog.min_expatriation_months && (
                          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginLeft: "6px" }}>
                            ({prog.min_expatriation_months} mois min)
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {prog.associatedCampuses.length > 0 ? (
                            prog.associatedCampuses.map((ac) => (
                              <span
                                key={ac.programCampusId}
                                className="badge badge-admin"
                                style={{ textTransform: "none", letterSpacing: "normal", fontSize: "0.8rem" }}
                              >
                                🏫 {ac.campusName}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>—</span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEditProgramModal(prog)}
                            style={{ padding: "4px 8px" }}
                          >
                            Modifier
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => setDeleteProgram(prog)}
                            style={{ padding: "4px 8px" }}
                          >
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL CAMPUS */}
      {isCampusModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">{editingCampus ? "Modifier le campus" : "Ajouter un campus"}</h3>
              <button className="modal-close" onClick={() => setIsCampusModalOpen(false)}>
                ✕
              </button>
            </div>
            {modalError && <div className="alert alert-danger" style={{ marginBottom: "16px" }}>{modalError}</div>}
            <form onSubmit={handleCampusSubmit}>
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Nom du campus *</label>
                <input
                  type="text"
                  className="form-control"
                  value={campusName}
                  onChange={(e) => setCampusName(e.target.value)}
                  placeholder="ex: Campus Paris La Défense"
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: "24px" }}>
                <label className="form-label">Ville</label>
                <input
                  type="text"
                  className="form-control"
                  value={campusCity}
                  onChange={(e) => setCampusCity(e.target.value)}
                  placeholder="ex: Courbevoie"
                />
              </div>
              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCampusModalOpen(false)}
                  disabled={actionLoading}
                >
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Enregistrement..." : editingCampus ? "Modifier" : "Ajouter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PROGRAMME */}
      {isProgramModalOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: "600px" }}>
            <div className="modal-header">
              <h3 className="modal-title">{editingProgram ? "Modifier le programme" : "Ajouter un programme"}</h3>
              <button className="modal-close" onClick={() => setIsProgramModalOpen(false)}>
                ✕
              </button>
            </div>
            {modalError && <div className="alert alert-danger" style={{ marginBottom: "16px" }}>{modalError}</div>}
            <form onSubmit={handleProgramSubmit}>
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Nom du programme *</label>
                <input
                  type="text"
                  className="form-control"
                  value={progName}
                  onChange={(e) => setProgName(e.target.value)}
                  placeholder="ex: Programme Grande École, Bachelor..."
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Concours / Examen d'entrée</label>
                <input
                  type="text"
                  className="form-control"
                  value={progExam}
                  onChange={(e) => setProgExam(e.target.value)}
                  placeholder="ex: Concours Sésame, Accès..."
                />
              </div>

              <div className="inline-form-grid" style={{ marginBottom: "16px", gridTemplateColumns: "1fr 1fr" }}>
                <div className="form-group">
                  <label className="form-label">Possibilité d'alternance</label>
                  <div
                    className="toggle-container"
                    onClick={() => setProgAlternance(!progAlternance)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className={`toggle-switch ${progAlternance ? "active" : ""}`} />
                    <span style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>
                      {progAlternance ? "Alternance possible" : "Pas d'alternance"}
                    </span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Expatriation obligatoire</label>
                  <div
                    className="toggle-container"
                    onClick={() => setProgExpatriation(!progExpatriation)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className={`toggle-switch ${progExpatriation ? "active" : ""}`} />
                    <span style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>
                      {progExpatriation ? "Obligatoire" : "Optionnel / Non"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="inline-form-grid" style={{ marginBottom: "16px", gridTemplateColumns: "1fr 1fr" }}>
                <div className="form-group">
                  <label className="form-label">Durée min. expatriation (mois)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={progMinExpat}
                    onChange={(e) => setProgMinExpat(e.target.value)}
                    placeholder="ex: 6"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Durée max. stage (mois)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={progMaxInternship}
                    onChange={(e) => setProgMaxInternship(e.target.value)}
                    placeholder="ex: 12"
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "24px" }}>
                <label className="form-label">Campus dispensant ce programme *</label>
                <div className="campus-checkbox-group" style={{ marginTop: "6px" }}>
                  {campuses.map((c) => {
                    const isChecked = progCampusIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`campus-checkbox ${isChecked ? "checked" : ""}`}
                        style={{ padding: "6px 12px", fontSize: "0.9rem" }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setProgCampusIds([...progCampusIds, c.id]);
                            } else {
                              setProgCampusIds(progCampusIds.filter((id) => id !== c.id));
                            }
                          }}
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsProgramModalOpen(false)}
                  disabled={actionLoading}
                >
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Enregistrement..." : editingProgram ? "Modifier" : "Ajouter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION SUPPRESSION CAMPUS */}
      {deleteCampus && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Supprimer le campus</h3>
              <button className="modal-close" onClick={() => setDeleteCampus(null)}>
                ✕
              </button>
            </div>
            <p style={{ marginBottom: "16px", color: "var(--text-secondary)" }}>
              Êtes-vous sûr de vouloir supprimer le campus{" "}
              <strong style={{ color: "#ffffff" }}>{deleteCampus.name}</strong> ?
            </p>
            <div className="alert alert-danger" style={{ marginBottom: "24px" }}>
              ⚠️ Attention : Cela supprimera également toutes les associations aux programmes et les capacités rattachées à ce campus.
            </div>
            <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteCampus(null)}
                disabled={actionLoading}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteCampus}
                disabled={actionLoading}
              >
                {actionLoading ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION SUPPRESSION PROGRAMME */}
      {deleteProgram && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Supprimer le programme</h3>
              <button className="modal-close" onClick={() => setDeleteProgram(null)}>
                ✕
              </button>
            </div>
            <p style={{ marginBottom: "16px", color: "var(--text-secondary)" }}>
              Êtes-vous sûr de vouloir supprimer le programme{" "}
              <strong style={{ color: "#ffffff" }}>{deleteProgram.name}</strong> ?
            </p>
            <div className="alert alert-danger" style={{ marginBottom: "24px" }}>
              ⚠️ Attention : Cela supprimera également tous les tarifs, classements et capacités rattachés à ce programme.
            </div>
            <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteProgram(null)}
                disabled={actionLoading}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteProgram}
                disabled={actionLoading}
              >
                {actionLoading ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
