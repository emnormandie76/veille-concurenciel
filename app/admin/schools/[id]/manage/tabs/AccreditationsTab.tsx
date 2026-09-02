"use client";

import { useEffect, useState } from "react";

interface Accreditation {
  id: string;
  schoolId: string;
  accreditation_name: string;
  accreditation_type: "international" | "state" | "label";
  // null = année inconnue (les accréditations issues du pipeline peuvent
  // arriver sans année publiée).
  year_obtained: number | null;
  is_active: boolean;
}

export default function AccreditationsTab({ schoolId }: { schoolId: string }) {
  const [accreditations, setAccreditations] = useState<Accreditation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Accreditation | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<"international" | "state" | "label">("international");
  const [formYear, setFormYear] = useState(new Date().getFullYear());
  const [formIsActive, setFormIsActive] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteRecord, setDeleteRecord] = useState<Accreditation | null>(null);

  useEffect(() => {
    fetchAccreditations();
  }, [schoolId]);

  const fetchAccreditations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/accreditations`);
      if (!res.ok) throw new Error("Erreur lors de la récupération des accréditations");
      const json = await res.json();
      setAccreditations(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingRecord(null);
    setFormName("");
    setFormType("international");
    setFormYear(new Date().getFullYear());
    setFormIsActive(true);
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (rec: Accreditation) => {
    setEditingRecord(rec);
    setFormName(rec.accreditation_name);
    setFormType(rec.accreditation_type);
    setFormYear(rec.year_obtained ?? new Date().getFullYear());
    setFormIsActive(rec.is_active);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setModalError(null);

    const body = {
      accreditation_name: formName.trim(),
      accreditation_type: formType,
      year_obtained: formYear,
      is_active: formIsActive,
    };

    try {
      const url = editingRecord
        ? `/api/admin/accreditations/${editingRecord.id}`
        : `/api/admin/schools/${schoolId}/accreditations`;
      const method = editingRecord ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Une erreur est survenue");

      setIsModalOpen(false);
      fetchAccreditations();
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
      const res = await fetch(`/api/admin/accreditations/${deleteRecord.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur lors de la suppression");

      setDeleteRecord(null);
      fetchAccreditations();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div>
      <div className="tab-section-header">
        <h2 className="tab-section-title">Accréditations et Labels</h2>
        <button className="btn btn-primary btn-sm" onClick={openAddModal}>
          ➕ Ajouter une accréditation
        </button>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: "20px" }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des accréditations...
        </div>
      ) : accreditations.length === 0 ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
            Aucune accréditation enregistrée pour cette école.
          </p>
          <button className="btn btn-primary btn-sm" onClick={openAddModal}>
            ➕ Ajouter une première accréditation
          </button>
        </div>
      ) : (
        <div className="cards-grid">
          {accreditations.map((acc) => (
            <div key={acc.id} className="data-card">
              <div className="data-card-header">
                <span className="data-card-title">{acc.accreditation_name}</span>
                <div className="data-card-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => openEditModal(acc)}
                    style={{ padding: "4px 8px" }}
                  >
                    Modifier
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setDeleteRecord(acc)}
                    style={{ padding: "4px 8px" }}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
              <div className="data-card-meta">
                <span className={`badge badge-type-${acc.accreditation_type}`}>
                  {acc.accreditation_type}
                </span>
                <span className={`badge ${acc.is_active ? "badge-active" : "badge-inactive"}`}>
                  {acc.is_active ? "Actif" : "Inactif"}
                </span>
                <span>
                  {acc.year_obtained != null
                    ? `Obtenue en ${acc.year_obtained}`
                    : "Année d'obtention inconnue"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Ajout/Édition */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">
                {editingRecord ? "Modifier l'accréditation" : "Ajouter une accréditation"}
              </h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>

            {modalError && <div className="alert alert-danger" style={{ marginBottom: "16px" }}>{modalError}</div>}

            <form onSubmit={handleFormSubmit}>
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label" htmlFor="acc-name">
                  Nom de l'accréditation *
                </label>
                <input
                  id="acc-name"
                  type="text"
                  className="form-control"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ex: EQUIS, AACSB, CTI..."
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label" htmlFor="acc-type">
                  Type d'accréditation *
                </label>
                <select
                  id="acc-type"
                  className="form-control"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as any)}
                >
                  <option value="international">International (ex: EQUIS, AACSB, AMBA)</option>
                  <option value="state">État (ex: Visa, Grade de Master, CTI)</option>
                  <option value="label">Label (ex: Bienvenue en France, EESPIG)</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label" htmlFor="acc-year">
                  Année d'obtention *
                </label>
                <input
                  id="acc-year"
                  type="number"
                  className="form-control"
                  value={formYear}
                  onChange={(e) => setFormYear(Number(e.target.value))}
                  min={2000}
                  max={new Date().getFullYear() + 2}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: "24px" }}>
                <label className="form-label">Statut de l'accréditation</label>
                <div
                  className="toggle-container"
                  onClick={() => setFormIsActive(!formIsActive)}
                  style={{ cursor: "pointer" }}
                >
                  <div className={`toggle-switch ${formIsActive ? "active" : ""}`} />
                  <span style={{ fontSize: "0.9rem", color: "var(--text-primary)" }}>
                    {formIsActive ? "Accréditation encore active" : "Accréditation expirée / inactive"}
                  </span>
                </div>
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

      {/* Modal Confirmation Suppression */}
      {deleteRecord && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Confirmer la suppression</h3>
              <button className="modal-close" onClick={() => setDeleteRecord(null)}>
                ✕
              </button>
            </div>
            <p style={{ marginBottom: "24px", color: "var(--text-secondary)" }}>
              Êtes-vous sûr de vouloir supprimer l'accréditation{" "}
              <strong style={{ color: "#ffffff" }}>{deleteRecord.accreditation_name}</strong> ?
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
