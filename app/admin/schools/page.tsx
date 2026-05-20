"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface School {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  _count?: {
    campuses: number;
  };
}

export default function SchoolsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // États des modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Champs de formulaires
  const [schoolName, setSchoolName] = useState("");
  const [schoolDomain, setSchoolDomain] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchSchools();
  }, []);

  const fetchSchools = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/schools");
      if (!res.ok) {
        throw new Error("Impossible de charger les écoles");
      }
      const data = await res.json();
      setSchools(data);
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: schoolName, official_domain: schoolDomain }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la création");
      }

      setSchoolName("");
      setSchoolDomain("");
      setIsAddModalOpen(false);
      fetchSchools();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchool) return;
    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/schools/${selectedSchool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: schoolName, official_domain: schoolDomain }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la modification");
      }

      setSchoolName("");
      setSchoolDomain("");
      setSelectedSchool(null);
      setIsEditModalOpen(false);
      fetchSchools();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchool) return;

    if (deleteConfirmText.trim() !== selectedSchool.name) {
      setError(`Veuillez saisir exactement "${selectedSchool.name}" pour confirmer.`);
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/schools/${selectedSchool.id}?confirmName=${encodeURIComponent(deleteConfirmText)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la suppression");
      }

      setDeleteConfirmText("");
      setSelectedSchool(null);
      setIsDeleteModalOpen(false);
      fetchSchools();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openEditModal = (school: School) => {
    setSelectedSchool(school);
    setSchoolName(school.name);
    setSchoolDomain(school.official_domain);
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (school: School) => {
    setSelectedSchool(school);
    setDeleteConfirmText("");
    setIsDeleteModalOpen(true);
  };

  // Filtrage des écoles
  const filteredSchools = schools.filter((school) =>
    school.name.toLowerCase().includes(search.toLowerCase()) ||
    school.official_domain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Gestion des Écoles</h1>
          <p className="page-title-desc">Ajoutez, modifiez ou gérez les écoles de l'enseignement supérieur.</p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setSchoolName("");
          setSchoolDomain("");
          setError(null);
          setIsAddModalOpen(true);
        }}>
          <span>➕</span> Ajouter une école
        </button>
      </div>

      {error && (
        <div className="alert alert-danger">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Barre de recherche */}
      <div className="search-bar-container" style={{ marginBottom: "20px" }}>
        <input
          type="text"
          className="form-control"
          placeholder="Rechercher par nom ou domaine officiel..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: "400px" }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des données...
        </div>
      ) : filteredSchools.length === 0 ? (
        <div className="empty-state">
          <span>🏫</span>
          <p>Aucune école trouvée.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Domaine Officiel</th>
                <th>Campus</th>
                <th>Statut</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchools.map((school) => (
                <tr key={school.id}>
                  <td style={{ fontWeight: 600 }}>{school.name}</td>
                  <td>
                    <code style={{ color: "var(--accent)", background: "rgba(59, 130, 246, 0.08)", padding: "2px 6px", borderRadius: "4px" }}>
                      {school.official_domain}
                    </code>
                  </td>
                  <td>
                    <Link href={`/admin/schools/${school.id}/campuses`} className="campus-link">
                      {school._count?.campuses || 0} campus 🔗
                    </Link>
                  </td>
                  <td>
                    <span className="badge badge-active">{school.status}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(school)} style={{ padding: "6px 12px" }}>
                        Modifier
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => openDeleteModal(school)} style={{ padding: "6px 12px" }}>
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
              <h3 className="modal-title">Ajouter une école</h3>
            </div>
            <form onSubmit={handleAddSchool}>
              <div className="form-group">
                <label className="form-label" htmlFor="add-name">Nom de l'école</label>
                <input
                  id="add-name"
                  type="text"
                  className="form-control"
                  placeholder="ex: EMLV"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="add-domain">Domaine internet officiel</label>
                <input
                  id="add-domain"
                  type="text"
                  className="form-control"
                  placeholder="ex: emlv.fr"
                  value={schoolDomain}
                  onChange={(e) => setSchoolDomain(e.target.value)}
                  required
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
              <h3 className="modal-title">Modifier l'école</h3>
            </div>
            <form onSubmit={handleEditSchool}>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-name">Nom de l'école</label>
                <input
                  id="edit-name"
                  type="text"
                  className="form-control"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-domain">Domaine internet officiel</label>
                <input
                  id="edit-domain"
                  type="text"
                  className="form-control"
                  value={schoolDomain}
                  onChange={(e) => setSchoolDomain(e.target.value)}
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => {
                  setSelectedSchool(null);
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
      {isDeleteModalOpen && selectedSchool && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: "var(--danger)" }}>⚠️ Double Confirmation Requise</h3>
            </div>
            <form onSubmit={handleDeleteSchool}>
              <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "20px", lineHeight: "1.5" }}>
                Vous êtes sur le point de supprimer définitivement l'école <strong>{selectedSchool.name}</strong> ainsi que tous ses campus et programmes associés. Cette action est irréversible.
              </p>
              <div className="form-group">
                <label className="form-label" htmlFor="delete-confirm">
                  Saisissez le nom de l'école (<strong>{selectedSchool.name}</strong>) pour confirmer :
                </label>
                <input
                  id="delete-confirm"
                  type="text"
                  className="form-control"
                  placeholder={selectedSchool.name}
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => {
                  setSelectedSchool(null);
                  setIsDeleteModalOpen(false);
                }}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-danger" disabled={actionLoading || deleteConfirmText !== selectedSchool.name}>
                  {actionLoading ? "Suppression..." : "Supprimer définitivement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .campus-link {
          color: var(--accent);
          text-decoration: none;
          font-weight: 500;
          transition: var(--transition-fast);
        }

        .campus-link:hover {
          text-decoration: underline;
          color: var(--accent-hover);
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
