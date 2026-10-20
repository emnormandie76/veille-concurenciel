"use client";

import { useEffect, useState } from "react";
import YearSelector from "../components/YearSelector";
import ProgramSelector from "../components/ProgramSelector";
import LastEdit from "../../LastEdit";

interface ProgramOption {
  id: string;
  name: string;
}

interface RankingRecord {
  id: string;
  programId: string;
  ranking_name: string;
  rank: number;
  academic_year: number;
  source_url: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
  program: {
    id: string;
    name: string;
  };
}

export default function RankingsTab({ schoolId }: { schoolId: string }) {
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [rankingRecords, setRankingRecords] = useState<RankingRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RankingRecord | null>(null);
  const [formProgramId, setFormProgramId] = useState("");
  const [formRankingName, setFormRankingName] = useState("");
  const [formRank, setFormRank] = useState<number>(1);
  const [formYear, setFormYear] = useState<number>(new Date().getFullYear());
  const [formSourceUrl, setFormSourceUrl] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteRecord, setDeleteRecord] = useState<RankingRecord | null>(null);

  useEffect(() => {
    fetchProgramsAndRankings();
  }, [schoolId]);

  const fetchProgramsAndRankings = async (year?: number, programId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const resProg = await fetch(`/api/admin/schools/${schoolId}/programs`);
      if (!resProg.ok) throw new Error("Erreur de chargement des programmes");
      const progsJson = await resProg.json();
      setPrograms(progsJson);

      const queryParams = [];
      if (year) queryParams.push(`year=${year}`);
      if (programId) queryParams.push(`programId=${programId}`);
      const queryString = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";

      const resRank = await fetch(`/api/admin/schools/${schoolId}/rankings${queryString}`);
      if (!resRank.ok) throw new Error("Erreur de chargement des classements");
      const rankJson = await resRank.json();

      setAvailableYears(rankJson.availableYears || []);
      if (!year && rankJson.availableYears && rankJson.availableYears.length > 0) {
        setSelectedYear(rankJson.availableYears[0]);
      }
      setRankingRecords(rankJson.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    fetchProgramsAndRankings(year, selectedProgramId);
  };

  const handleProgramChange = (progId: string | null) => {
    setSelectedProgramId(progId);
    fetchProgramsAndRankings(selectedYear || undefined, progId);
  };

  const openAddModal = () => {
    setEditingRecord(null);
    setFormProgramId(selectedProgramId || (programs.length > 0 ? programs[0].id : ""));
    setFormRankingName("");
    setFormRank(1);
    setFormYear(selectedYear || new Date().getFullYear());
    setFormSourceUrl("");
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (rec: RankingRecord) => {
    setEditingRecord(rec);
    setFormProgramId(rec.programId);
    setFormRankingName(rec.ranking_name);
    setFormRank(rec.rank);
    setFormYear(rec.academic_year);
    setFormSourceUrl(rec.source_url || "");
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProgramId) {
      setModalError("Veuillez sélectionner un programme.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    const body = {
      ranking_name: formRankingName.trim(),
      rank: formRank,
      academic_year: formYear,
      source_url: formSourceUrl.trim() || null,
    };

    try {
      const url = editingRecord
        ? `/api/admin/rankings/${editingRecord.id}`
        : `/api/admin/programs/${formProgramId}/rankings`;
      const method = editingRecord ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Une erreur est survenue");

      setIsModalOpen(false);
      fetchProgramsAndRankings(selectedYear || undefined, selectedProgramId);
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
      const res = await fetch(`/api/admin/rankings/${deleteRecord.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erreur de suppression");

      setDeleteRecord(null);
      fetchProgramsAndRankings(selectedYear || undefined, selectedProgramId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const getRankBadgeClass = (rank: number) => {
    if (rank <= 3) return "badge-active"; // Vert
    if (rank <= 10) return "badge-admin"; // Bleu
    return "badge-inactive"; // Gris
  };

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
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <YearSelector
            availableYears={availableYears}
            selectedYear={selectedYear}
            onYearChange={handleYearChange}
            loading={loading || actionLoading}
          />
          <ProgramSelector
            programs={programs}
            selectedProgramId={selectedProgramId}
            onProgramChange={handleProgramChange}
            showAllOption={true}
            loading={loading || actionLoading}
          />
        </div>

        <button
          className="btn btn-primary btn-sm"
          onClick={openAddModal}
          disabled={programs.length === 0}
        >
          ➕ Ajouter un classement
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des classements...
        </div>
      ) : programs.length === 0 ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)" }}>
            Aucun programme enregistré. Créez des programmes dans l'onglet Campus & Programmes avant d'ajouter des classements.
          </p>
        </div>
      ) : rankingRecords.length === 0 ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
            Aucun classement enregistré pour les critères sélectionnés.
          </p>
          <button className="btn btn-primary btn-sm" onClick={openAddModal}>
            ➕ Ajouter un premier classement
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>Nom du classement</th>
                <th>Rang</th>
                <th>Année</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rankingRecords.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>
                    {r.program?.name || "—"}
                    <LastEdit text={r.last_edit} />
                  </td>
                  <td>{r.ranking_name}</td>
                  <td>
                    <span className={`badge ${getRankBadgeClass(r.rank)}`}>
                      {r.rank === 1 ? "🥇 1er" : r.rank === 2 ? "🥈 2ème" : r.rank === 3 ? "🥉 3ème" : "#" + r.rank}
                    </span>
                  </td>
                  <td>{r.academic_year}</td>
                  <td>
                    {r.source_url ? (
                      <a
                        href={r.source_url}
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
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openEditModal(r)}
                        style={{ padding: "4px 8px" }}
                      >
                        Modifier
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => setDeleteRecord(r)}
                        style={{ padding: "4px 8px" }}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Formulaire */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">
                {editingRecord ? "Modifier le classement" : "Ajouter un classement"}
              </h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>

            {modalError && <div className="alert alert-danger" style={{ marginBottom: "16px" }}>{modalError}</div>}

            <form onSubmit={handleFormSubmit}>
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Programme *</label>
                <select
                  className="form-control"
                  value={formProgramId}
                  onChange={(e) => setFormProgramId(e.target.value)}
                  disabled={Boolean(editingRecord)}
                  required
                >
                  <option value="" disabled>
                    Choisir un programme
                  </option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Nom du classement (Média / Organisme) *</label>
                <input
                  type="text"
                  className="form-control"
                  value={formRankingName}
                  onChange={(e) => setFormRankingName(e.target.value)}
                  placeholder="ex: Le Figaro, SIGEM, L'Étudiant, FT..."
                  required
                />
              </div>

              <div className="inline-form-grid" style={{ marginBottom: "16px", gridTemplateColumns: "1fr 1fr" }}>
                <div className="form-group">
                  <label className="form-label">Rang / Position *</label>
                  <input
                    type="number"
                    className="form-control"
                    value={formRank}
                    onChange={(e) => setFormRank(Number(e.target.value))}
                    min={1}
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
                  placeholder="https://etudiant.lefigaro.fr/..."
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
                  {actionLoading ? "Enregistrement..." : editingRecord ? "Modifier" : "Ajouter"}
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
              <h3 className="modal-title">Supprimer le classement</h3>
              <button className="modal-close" onClick={() => setDeleteRecord(null)}>
                ✕
              </button>
            </div>
            <p style={{ marginBottom: "24px", color: "var(--text-secondary)" }}>
              Êtes-vous sûr de vouloir supprimer le classement{" "}
              <strong style={{ color: "#ffffff" }}>
                {deleteRecord.ranking_name + " (#" + deleteRecord.rank + ")"}
              </strong>{" "}
              pour le programme {deleteRecord.program?.name} ({deleteRecord.academic_year}) ?
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
