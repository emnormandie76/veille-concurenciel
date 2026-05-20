"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface Campus {
  id: string;
  schoolId: string;
  name: string;
  city: string | null;
}

interface School {
  id: string;
  name: string;
  official_domain: string;
}

export default function CampusesPage() {
  const { id: schoolId } = useParams() as { id: string };

  const [school, setSchool] = useState<School | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // États des modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Champs de formulaires
  const [campusName, setCampusName] = useState("");
  const [campusCity, setCampusCity] = useState("");
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);

  useEffect(() => {
    if (schoolId) {
      fetchSchoolAndCampuses();
    }
  }, [schoolId]);

  const fetchSchoolAndCampuses = async () => {
    setLoading(true);
    setError(null);
    try {
      // Charger l'école
      const schoolRes = await fetch(`/api/admin/schools/${schoolId}`);
      if (!schoolRes.ok) {
        throw new Error("Impossible de charger les détails de l'école");
      }
      const schoolData = await schoolRes.json();
      setSchool(schoolData);

      // Charger les campus
      const campusesRes = await fetch(`/api/admin/schools/${schoolId}/campuses`);
      if (!campusesRes.ok) {
        throw new Error("Impossible de charger les campus");
      }
      const campusesData = await campusesRes.json();
      setCampuses(campusesData);
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const handleAddCampus = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/campuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campusName, city: campusCity }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la création du campus");
      }

      setCampusName("");
      setCampusCity("");
      setIsAddModalOpen(false);
      fetchSchoolAndCampuses();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditCampus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampus) return;
    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/campuses/${selectedCampus.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campusName, city: campusCity }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la modification du campus");
      }

      setCampusName("");
      setCampusCity("");
      setSelectedCampus(null);
      setIsEditModalOpen(false);
      fetchSchoolAndCampuses();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCampus = async () => {
    if (!selectedCampus) return;
    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/campuses/${selectedCampus.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la suppression du campus");
      }

      setSelectedCampus(null);
      setIsDeleteModalOpen(false);
      fetchSchoolAndCampuses();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openEditModal = (campus: Campus) => {
    setSelectedCampus(campus);
    setCampusName(campus.name);
    setCampusCity(campus.city || "");
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (campus: Campus) => {
    setSelectedCampus(campus);
    setIsDeleteModalOpen(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <Link href="/admin/schools" className="back-link">
            ← Retour aux écoles
          </Link>
          <h1 style={{ marginTop: "12px" }}>
            Campus de {school ? school.name : "..."}
          </h1>
          <p className="page-title-desc">Gérez les différents sites géographiques de l'école.</p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setCampusName("");
          setCampusCity("");
          setError(null);
          setIsAddModalOpen(true);
        }}>
          <span>➕</span> Ajouter un campus
        </button>
      </div>

      {error && (
        <div className="alert alert-danger">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des campus...
        </div>
      ) : campuses.length === 0 ? (
        <div className="empty-state">
          <span>📍</span>
          <p>Aucun campus enregistré pour cette école.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nom du Campus</th>
                <th>Ville</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campuses.map((campus) => (
                <tr key={campus.id}>
                  <td style={{ fontWeight: 600 }}>{campus.name}</td>
                  <td>
                    {campus.city ? (
                      <span className="city-tag">{campus.city}</span>
                    ) : (
                      <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
                        Non spécifiée
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(campus)} style={{ padding: "6px 12px" }}>
                        Modifier
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => openDeleteModal(campus)} style={{ padding: "6px 12px" }}>
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

      {/* Modal Ajout */}
      {isAddModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Ajouter un campus</h3>
            </div>
            <form onSubmit={handleAddCampus}>
              <div className="form-group">
                <label className="form-label" htmlFor="add-campus-name">Nom du campus</label>
                <input
                  id="add-campus-name"
                  type="text"
                  className="form-control"
                  placeholder="ex: Paris La Défense"
                  value={campusName}
                  onChange={(e) => setCampusName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="add-campus-city">Ville</label>
                <input
                  id="add-campus-city"
                  type="text"
                  className="form-control"
                  placeholder="ex: Puteaux"
                  value={campusCity}
                  onChange={(e) => setCampusCity(e.target.value)}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsAddModalOpen(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Création..." : "Créer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Édition */}
      {isEditModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Modifier le campus</h3>
            </div>
            <form onSubmit={handleEditCampus}>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-campus-name">Nom du campus</label>
                <input
                  id="edit-campus-name"
                  type="text"
                  className="form-control"
                  value={campusName}
                  onChange={(e) => setCampusName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-campus-city">Ville</label>
                <input
                  id="edit-campus-city"
                  type="text"
                  className="form-control"
                  value={campusCity}
                  onChange={(e) => setCampusCity(e.target.value)}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => {
                  setSelectedCampus(null);
                  setIsEditModalOpen(false);
                }}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Suppression */}
      {isDeleteModalOpen && selectedCampus && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: "var(--danger)" }}>Confirmer la suppression</h3>
            </div>
            <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "20px", lineHeight: "1.5" }}>
              Êtes-vous sûr de vouloir supprimer définitivement le campus <strong>{selectedCampus.name}</strong> ? Tous les programmes liés à ce campus seront également supprimés en cascade.
            </p>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => {
                setSelectedCampus(null);
                setIsDeleteModalOpen(false);
              }} disabled={actionLoading}>
                Annuler
              </button>
              <button className="btn btn-danger" onClick={handleDeleteCampus} disabled={actionLoading}>
                {actionLoading ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .back-link {
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 0.9rem;
          transition: var(--transition-fast);
        }

        .back-link:hover {
          color: #ffffff;
        }

        .city-tag {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: 0.85rem;
          color: var(--text-primary);
        }

        .empty-state {
          text-align: center;
          padding: 60px 40px;
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          color: var(--text-secondary);
        }

        .empty-state span {
          font-size: 3rem;
          display: block;
          margin-bottom: 16px;
        }

        .empty-state p {
          font-size: 1rem;
        }
      `}</style>
    </div>
  );
}
