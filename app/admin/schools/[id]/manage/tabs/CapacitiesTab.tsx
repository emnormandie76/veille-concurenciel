"use client";

import { useEffect, useState } from "react";
import YearSelector from "../legacy/YearSelector";
import LastEdit from "../legacy/LastEdit";

interface ProgramWithCampuses {
  id: string;
  name: string;
  associatedCampuses: {
    programCampusId: string;
    campusId: string;
    campusName: string;
    campusCity: string | null;
  }[];
}

interface CapacityRecord {
  id: string;
  programCampusId: string;
  spots_available: number;
  academic_year: number;
  source_url: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
  programCampus: {
    id: string;
    program: { id: string; name: string };
    campus: { id: string; name: string; city: string | null };
  };
}

export default function CapacitiesTab({ schoolId }: { schoolId: string }) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [capacityRecords, setCapacityRecords] = useState<CapacityRecord[]>([]);
  const [programsWithCampuses, setProgramsWithCampuses] = useState<ProgramWithCampuses[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit inline state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSpots, setEditingSpots] = useState<string>("");

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formProgramCampusId, setFormProgramCampusId] = useState("");
  const [formSpots, setFormSpots] = useState<string>("100");
  const [formYear, setFormYear] = useState<number>(new Date().getFullYear());
  const [formSourceUrl, setFormSourceUrl] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteRecord, setDeleteRecord] = useState<CapacityRecord | null>(null);

  useEffect(() => {
    fetchInitialData();
  }, [schoolId]);

  const fetchInitialData = async (year?: number) => {
    setLoading(true);
    setError(null);
    try {
      const resProgs = await fetch(`/api/admin/schools/${schoolId}/programs`);
      if (!resProgs.ok) throw new Error("Erreur de chargement des programmes");
      const progsJson = await resProgs.json();
      setProgramsWithCampuses(progsJson);

      const yearQuery = year ? `?year=${year}` : "";
      const resCap = await fetch(`/api/admin/schools/${schoolId}/capacities${yearQuery}`);
      if (!resCap.ok) throw new Error("Erreur de chargement des capacités");
      const capJson = await resCap.json();

      setAvailableYears(capJson.availableYears || []);
      const activeYear = year || (capJson.availableYears && capJson.availableYears.length > 0 ? capJson.availableYears[0] : new Date().getFullYear());
      setSelectedYear(activeYear);
      setCapacityRecords(capJson.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCapacitiesForYear = async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/capacities?year=${year}`);
      if (!res.ok) throw new Error("Erreur de chargement des capacités");
      const json = await res.json();
      setCapacityRecords(json.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    fetchCapacitiesForYear(year);
  };

  const handleInlineSave = async (recordId: string) => {
    const spotsNum = parseInt(editingSpots);
    if (isNaN(spotsNum) || spotsNum < 0) {
      alert("Le nombre de places doit être un nombre ≥ 0");
      return;
    }

    try {
      const res = await fetch(`/api/admin/capacities/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spots_available: spotsNum }),
      });
      if (!res.ok) throw new Error("Erreur de mise à jour");

      setEditingId(null);
      if (selectedYear) fetchCapacitiesForYear(selectedYear);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const openAddModal = () => {
    let defaultPCId = "";
    for (const p of programsWithCampuses) {
      if (p.associatedCampuses.length > 0) {
        defaultPCId = p.associatedCampuses[0].programCampusId;
        break;
      }
    }

    setFormProgramCampusId(defaultPCId);
    setFormSpots("100");
    setFormYear(selectedYear || new Date().getFullYear());
    setFormSourceUrl("");
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProgramCampusId) {
      setModalError("Veuillez sélectionner un programme et un campus.");
      return;
    }

    const spotsNum = parseInt(formSpots);
    if (isNaN(spotsNum) || spotsNum < 0) {
      setModalError("Le nombre de places doit être un entier ≥ 0.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    const body = {
      spots_available: spotsNum,
      academic_year: formYear,
      source_url: formSourceUrl.trim() || null,
    };

    try {
      const res = await fetch(`/api/admin/program-campuses/${formProgramCampusId}/capacity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur de création");

      setIsModalOpen(false);
      fetchCapacitiesForYear(formYear);
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteRecord) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/capacities/${deleteRecord.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erreur de suppression");

      setDeleteRecord(null);
      if (selectedYear) fetchCapacitiesForYear(selectedYear);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const hasAnyProgramCampus = programsWithCampuses.some((p) => p.associatedCampuses.length > 0);

  return (
    <div>
      {error && <div className="alert alert-danger" style={{ marginBottom: "20px" }}>{error}</div>}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <YearSelector
          availableYears={availableYears}
          selectedYear={selectedYear}
          onYearChange={handleYearChange}
          loading={loading || actionLoading}
        />

        <button
          className="btn btn-primary btn-sm"
          onClick={openAddModal}
          disabled={!hasAnyProgramCampus}
        >
          ➕ Ajouter une capacité
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des capacités d'accueil...
        </div>
      ) : !hasAnyProgramCampus ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)" }}>
            Aucun programme associé à un campus. Associez d'abord des programmes à des campus dans l'onglet Campus & Programmes.
          </p>
        </div>
      ) : capacityRecords.length === 0 ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
            Aucune capacité d'accueil enregistrée pour l'année {selectedYear}.
          </p>
          <button className="btn btn-primary btn-sm" onClick={openAddModal}>
            ➕ Ajouter une première capacité
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>Campus</th>
                <th>Places disponibles</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {capacityRecords.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {c.programCampus?.program?.name || "—"}
                    <LastEdit text={c.last_edit} />
                  </td>
                  <td>
                    {c.programCampus?.campus?.name}{" "}
                    {c.programCampus?.campus?.city && (
                      <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        ({c.programCampus.campus.city})
                      </span>
                    )}
                  </td>
                  <td>
                    {editingId === c.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          type="number"
                          className="form-control"
                          style={{ width: "90px", padding: "4px 8px" }}
                          value={editingSpots}
                          onChange={(e) => setEditingSpots(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleInlineSave(c.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ padding: "4px 8px" }}
                          onClick={() => handleInlineSave(c.id)}
                        >
                          ✓
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: "4px 8px" }}
                          onClick={() => setEditingId(null)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <span
                        onClick={() => {
                          setEditingId(c.id);
                          setEditingSpots(String(c.spots_available));
                        }}
                        style={{
                          cursor: "pointer",
                          fontWeight: 600,
                          color: "var(--accent)",
                          borderBottom: "1px dashed var(--accent)",
                          paddingBottom: "1px",
                        }}
                        title="Cliquer pour modifier rapidement"
                      >
                        {c.spots_available} places ✏️
                      </span>
                    )}
                  </td>
                  <td>
                    {c.source_url ? (
                      <a
                        href={c.source_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.85rem" }}
                      >
                        Source 🔗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setDeleteRecord(c)}
                      style={{ padding: "4px 8px" }}
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Ajout */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Ajouter une capacité d'accueil</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>

            {modalError && <div className="alert alert-danger" style={{ marginBottom: "16px" }}>{modalError}</div>}

            <form onSubmit={handleFormSubmit}>
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Programme & Campus *</label>
                <select
                  className="form-control"
                  value={formProgramCampusId}
                  onChange={(e) => setFormProgramCampusId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Sélectionner la combinaison Programme — Campus
                  </option>
                  {programsWithCampuses.map((prog) => (
                    <optgroup key={prog.id} label={prog.name}>
                      {prog.associatedCampuses.map((ac) => (
                        <option key={ac.programCampusId} value={ac.programCampusId}>
                          {prog.name} — {ac.campusName} {ac.campusCity ? `(${ac.campusCity})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="inline-form-grid" style={{ marginBottom: "16px", gridTemplateColumns: "1fr 1fr" }}>
                <div className="form-group">
                  <label className="form-label">Nombre de places *</label>
                  <input
                    type="number"
                    className="form-control"
                    value={formSpots}
                    onChange={(e) => setFormSpots(e.target.value)}
                    min={0}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Année académique *</label>
                  <input
                    type="number"
                    className="form-control"
                    value={formYear}
                    onChange={(e) => setFormYear(Number(e.target.value))}
                    min={2000}
                    max={new Date().getFullYear() + 2}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "24px" }}>
                <label className="form-label">URL de la source</label>
                <input
                  type="text"
                  className="form-control"
                  value={formSourceUrl}
                  onChange={(e) => setFormSourceUrl(e.target.value)}
                  placeholder="https://parcoursup.fr/..."
                />
              </div>

              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                  disabled={actionLoading}
                >
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Enregistrement..." : "Ajouter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Suppression */}
      {deleteRecord && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Supprimer la capacité</h3>
              <button className="modal-close" onClick={() => setDeleteRecord(null)}>
                ✕
              </button>
            </div>
            <p style={{ marginBottom: "24px", color: "var(--text-secondary)" }}>
              Êtes-vous sûr de vouloir supprimer la capacité de{" "}
              <strong style={{ color: "#ffffff" }}>
                {deleteRecord.spots_available} places
              </strong>{" "}
              pour {deleteRecord.programCampus?.program?.name} ({deleteRecord.programCampus?.campus?.name}) — {deleteRecord.academic_year} ?
            </p>
            <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteRecord(null)}
                disabled={actionLoading}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
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
