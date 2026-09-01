"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

interface UsersManagerClientProps {
  currentUserId: string;
}

/** Doit rester aligné sur MIN_PASSWORD_LENGTH de lib/password.ts. */
const MIN_PASSWORD_LENGTH = 12;

export default function UsersManagerClient({ currentUserId }: UsersManagerClientProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // États des formulaires/modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Impossible de charger les modérateurs");
      }
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setModalError(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la création");
      }

      setUsername("");
      setPassword("");
      setIsAddModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    if (selectedUser.id === currentUserId) {
      setModalError("Erreur : vous ne pouvez pas supprimer votre propre compte.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la suppression");
      }

      setSelectedUser(null);
      setIsDeleteModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setModalError(null);
    setModalSuccess(null);

    if (newPassword !== confirmPassword) {
      setModalError("Les deux saisies du nouveau mot de passe ne correspondent pas.");
      return;
    }

    setActionLoading(true);
    const isSelf = selectedUser.id === currentUserId;

    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSelf ? { currentPassword, newPassword } : { newPassword }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors du changement de mot de passe");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setModalSuccess(data.message || "Mot de passe mis à jour.");
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openAddModal = () => {
    setUsername("");
    setPassword("");
    setModalError(null);
    setIsAddModalOpen(true);
  };

  const openDeleteModal = (user: User) => {
    setSelectedUser(user);
    setModalError(null);
    setIsDeleteModalOpen(true);
  };

  const openPasswordModal = (user: User) => {
    setSelectedUser(user);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setModalError(null);
    setModalSuccess(null);
    setIsPasswordModalOpen(true);
  };

  const closePasswordModal = () => {
    setSelectedUser(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setIsPasswordModalOpen(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Gestion des Modérateurs</h1>
          <p className="page-title-desc">Créez et supprimez les comptes des modérateurs de la plateforme.</p>
        </div>
        <button className="btn btn-primary" onClick={openAddModal}>
          <span>➕</span> Créer un modérateur
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
          Chargement des utilisateurs...
        </div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nom d'utilisateur</th>
                <th>Rôle</th>
                <th>Date de création</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} style={user.id === currentUserId ? { background: "rgba(59, 130, 246, 0.03)" } : {}}>
                  <td style={{ fontWeight: 600 }}>
                    {user.username} {user.id === currentUserId && <span style={{ color: "var(--accent)", fontSize: "0.8rem", marginLeft: "6px" }}>(vous)</span>}
                  </td>
                  <td>
                    <span className={`badge ${user.role === "ADMIN" ? "badge-admin" : "badge-moderator"}`}>
                      {user.role}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                    {new Date(user.createdAt).toLocaleDateString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => openPasswordModal(user)}
                      style={{ padding: "6px 12px", marginRight: "8px" }}
                    >
                      {user.id === currentUserId ? "Changer mon mot de passe" : "Réinitialiser"}
                    </button>
                    {user.id !== currentUserId && (
                      <button className="btn btn-danger btn-sm" onClick={() => openDeleteModal(user)} style={{ padding: "6px 12px" }}>
                        Supprimer
                      </button>
                    )}
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
              <h3 className="modal-title">Créer un modérateur</h3>
              <button className="modal-close" onClick={() => setIsAddModalOpen(false)}>
                ✕
              </button>
            </div>
            {modalError && (
              <div className="alert alert-danger" style={{ marginBottom: "16px" }}>
                <span>⚠️ </span>
                <span>{modalError}</span>
              </div>
            )}
            <form onSubmit={handleAddUser}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-username">Nom d'utilisateur</label>
                <input
                  id="new-username"
                  type="text"
                  className="form-control"
                  placeholder="ex: mod_france"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="new-password">Mot de passe provisoire</label>
                <input
                  id="new-password"
                  type="password"
                  className="form-control"
                  placeholder={`Minimum ${MIN_PASSWORD_LENGTH} caractères`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setIsAddModalOpen(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Création..." : "Créer le compte"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Changement de mot de passe */}
      {isPasswordModalOpen && selectedUser && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">
                {selectedUser.id === currentUserId
                  ? "Changer mon mot de passe"
                  : `Réinitialiser le mot de passe de ${selectedUser.username}`}
              </h3>
              <button className="modal-close" onClick={closePasswordModal}>
                ✕
              </button>
            </div>
            {modalError && (
              <div className="alert alert-danger" style={{ marginBottom: "16px" }}>
                <span>⚠️ </span>
                <span>{modalError}</span>
              </div>
            )}
            {modalSuccess && (
              <div className="alert alert-success" style={{ marginBottom: "16px" }}>
                <span>✅ </span>
                <span>{modalSuccess}</span>
              </div>
            )}
            <form onSubmit={handleChangePassword}>
              {selectedUser.id === currentUserId && (
                <div className="form-group">
                  <label className="form-label" htmlFor="current-password">Mot de passe actuel</label>
                  <input
                    id="current-password"
                    type="password"
                    className="form-control"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label" htmlFor="change-new-password">Nouveau mot de passe</label>
                <input
                  id="change-new-password"
                  type="password"
                  className="form-control"
                  placeholder={`Minimum ${MIN_PASSWORD_LENGTH} caractères`}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="confirm-new-password">Confirmer le nouveau mot de passe</label>
                <input
                  id="confirm-new-password"
                  type="password"
                  className="form-control"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closePasswordModal} disabled={actionLoading}>
                  Fermer
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Mise à jour..." : "Mettre à jour"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Suppression */}
      {isDeleteModalOpen && selectedUser && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: "var(--danger)" }}>Supprimer le compte ?</h3>
              <button className="modal-close" onClick={() => setIsDeleteModalOpen(false)}>
                ✕
              </button>
            </div>
            {modalError && (
              <div className="alert alert-danger" style={{ marginBottom: "16px" }}>
                <span>⚠️ </span>
                <span>{modalError}</span>
              </div>
            )}
            <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "20px", lineHeight: "1.5" }}>
              Êtes-vous sûr de vouloir supprimer définitivement le modérateur <strong>{selectedUser.username}</strong> ? Son accès à la plateforme sera immédiatement révoqué.
            </p>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => {
                setSelectedUser(null);
                setIsDeleteModalOpen(false);
              }} disabled={actionLoading}>
                Annuler
              </button>
              <button className="btn btn-danger" onClick={handleDeleteUser} disabled={actionLoading}>
                {actionLoading ? "Révocation..." : "Confirmer la suppression"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
