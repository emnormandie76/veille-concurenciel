"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ROLE_LABELS, USER_ROLES, isUserRole, type UserRole } from "@/lib/roles";
import { STATUS_LABELS, WORK_EMAIL_DOMAIN, isAccountStatus } from "@/lib/accounts";

/**
 * L'écran des comptes (plan gestion-contenu, étape 2), réservé à ADMIN.
 *
 * - G5 : ajouter l'adresse de travail d'un collègue à la liste, sans envoi
 *   d'e-mail ; retirer un invité ;
 * - changer un rôle (un admin peut en nommer un autre) ;
 * - D4 : remettre un compte en première connexion (aussi la réactivation d'un
 *   compte désactivé) ; D21 : désactiver un compte actif ;
 * - D3 : renseigner l'adresse d'un compte d'avant la liste blanche.
 *
 * Les règles (dernier admin, domaine, états) sont tenues par les routes
 * /api/admin/users/** ; cet écran n'en montre que les boutons utiles.
 */

interface Account {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  role: string;
  status: string;
  first_login_at: string | null;
  createdAt: string;
}

type DialogKind = "add" | "role" | "reset" | "disable" | "remove" | "email";
type Dialog = { kind: DialogKind; account: Account | null } | null;

interface UsersManagerClientProps {
  currentUserId: string;
}

const ROLE_BADGES: Record<UserRole, string> = {
  USER: "badge-user",
  GESTIONNAIRE: "badge-moderator",
  ADMIN: "badge-admin",
};

const STATUS_BADGES: Record<string, string> = {
  INVITED: "badge-invited",
  ACTIVE: "badge-active",
  DISABLED: "badge-inactive",
};

const formatDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "—";

/** Le nom d'un compte à l'écran : son nom affiché, sinon son adresse, sinon son ancien identifiant. */
const nameOf = (account: Account) => account.display_name || account.email || account.username || "Compte sans nom";

/** Lit le message d'erreur d'une réponse ; un corps illisible donne le message par défaut. */
async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

export default function UsersManagerClient({ currentUserId }: UsersManagerClientProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [roleInput, setRoleInput] = useState<UserRole>("USER");

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error(await errorOf(res, "Impossible de charger les comptes."));
      setAccounts((await res.json()) as Account[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const open = (kind: DialogKind, account: Account | null = null) => {
    setDialog({ kind, account });
    setDialogError(null);
    setEmailInput("");
    setRoleInput(account && isUserRole(account.role) ? account.role : "USER");
  };
  const close = () => {
    if (!busy) setDialog(null);
  };

  /** Envoie l'action du dialogue ouvert, puis recharge la liste. */
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!dialog) return;
    const { kind, account } = dialog;
    const target = account ? `/api/admin/users/${account.id}` : "/api/admin/users";
    const requests: Record<DialogKind, { url: string; method: string; body?: unknown; done: string }> = {
      add: {
        url: "/api/admin/users",
        method: "POST",
        body: { email: emailInput },
        done: "Adresse ajoutée à la liste. Aucun e-mail n'est envoyé : prévenez la personne, qui choisira son mot de passe sur la page de première connexion.",
      },
      role: { url: `${target}/role`, method: "PATCH", body: { role: roleInput }, done: "Rôle mis à jour." },
      reset: {
        url: `${target}/reset`,
        method: "POST",
        done: "Compte remis en première connexion. Prévenez la personne : elle choisira un nouveau mot de passe avec son adresse.",
      },
      disable: { url: `${target}/disable`, method: "POST", done: "Compte désactivé." },
      remove: { url: target, method: "DELETE", done: "Adresse retirée de la liste." },
      email: { url: `${target}/email`, method: "PATCH", body: { email: emailInput }, done: "Adresse enregistrée : l'ancien identifiant ne sert plus à se connecter." },
    };
    const request = requests[kind];

    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      if (!res.ok) {
        setDialogError(await errorOf(res, "L'opération a échoué."));
        return;
      }
      setDialog(null);
      setNotice(request.done);
      // Un admin qui se rétrograde perd cet écran : le serveur le renvoie ailleurs.
      if (kind === "role" && account?.id === currentUserId && roleInput !== "ADMIN") {
        router.refresh();
        return;
      }
      fetchAccounts();
    } catch {
      setDialogError("Une erreur réseau est survenue. Veuillez réessayer.");
    } finally {
      setBusy(false);
    }
  };

  const account = dialog?.account ?? null;
  const isSelf = (a: Account) => a.id === currentUserId;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Comptes</h1>
          <p className="page-title-desc">
            Ajoutez l&apos;adresse de travail d&apos;un collègue : à sa première connexion, il choisit son mot de
            passe. Aucun e-mail n&apos;est envoyé.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => open("add")}>
          <span>➕</span> Ajouter une adresse
        </button>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-success" role="status">
          <span>✅</span>
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des comptes...
        </div>
      ) : (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Compte</th>
                <th>Rôle</th>
                <th>État</th>
                <th>Première connexion</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} style={isSelf(a) ? { background: "rgba(59, 130, 246, 0.03)" } : {}}>
                  <td style={{ fontWeight: 600 }}>
                    {nameOf(a)}
                    {isSelf(a) && (
                      <span style={{ color: "var(--accent)", fontSize: "0.8rem", marginLeft: "6px" }}>(vous)</span>
                    )}
                    {a.display_name && a.email && <span className="user-secondary">{a.email}</span>}
                    {!a.email && (
                      <span className="user-secondary">
                        Identifiant « {a.username} » : aucune adresse renseignée
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${isUserRole(a.role) ? ROLE_BADGES[a.role] : "badge-user"}`}>
                      {isUserRole(a.role) ? ROLE_LABELS[a.role] : a.role}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGES[a.status] ?? "badge-inactive"}`}>
                      {isAccountStatus(a.status) ? STATUS_LABELS[a.status] : a.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>{formatDate(a.first_login_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    <div className="users-actions" style={{ display: "inline-flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end" }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => open("role", a)}>
                        Changer le rôle
                      </button>
                      {!a.email && (
                        <button className="btn btn-secondary btn-sm" onClick={() => open("email", a)}>
                          Renseigner l&apos;adresse
                        </button>
                      )}
                      {isSelf(a) ? (
                        <Link className="btn btn-secondary btn-sm" href="/account">
                          Mon compte
                        </Link>
                      ) : (
                        <>
                          {a.status === "INVITED" && (
                            <button className="btn btn-danger btn-sm" onClick={() => open("remove", a)}>
                              Retirer
                            </button>
                          )}
                          {a.status !== "INVITED" && a.email && (
                            <button className="btn btn-secondary btn-sm" onClick={() => open("reset", a)}>
                              {a.status === "DISABLED" ? "Réactiver" : "Remettre en première connexion"}
                            </button>
                          )}
                          {a.status === "ACTIVE" && (
                            <button className="btn btn-danger btn-sm" onClick={() => open("disable", a)}>
                              Désactiver
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="users-dialog-title">
            <div className="modal-header">
              <h3 className="modal-title" id="users-dialog-title">
                {dialog.kind === "add" && "Ajouter une adresse à la liste"}
                {dialog.kind === "role" && account && `Rôle de ${nameOf(account)}`}
                {dialog.kind === "reset" && account &&
                  (account.status === "DISABLED" ? `Réactiver ${nameOf(account)} ?` : `Remettre ${nameOf(account)} en première connexion ?`)}
                {dialog.kind === "disable" && account && `Désactiver ${nameOf(account)} ?`}
                {dialog.kind === "remove" && account && `Retirer ${account.email} de la liste ?`}
                {dialog.kind === "email" && account && `Adresse de ${nameOf(account)}`}
              </h3>
              <button className="modal-close" onClick={close} aria-label="Fermer">
                ✕
              </button>
            </div>

            {dialogError && (
              <div className="alert alert-danger" role="alert" style={{ marginBottom: "16px" }}>
                <span>⚠️ </span>
                <span>{dialogError}</span>
              </div>
            )}

            <form onSubmit={submit}>
              {(dialog.kind === "add" || dialog.kind === "email") && (
                <div className="form-group">
                  <label className="form-label" htmlFor="users-email">
                    Adresse e-mail de travail
                  </label>
                  <input
                    id="users-email"
                    type="email"
                    className="form-control"
                    placeholder={`prenom.nom@${WORK_EMAIL_DOMAIN}`}
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    required
                    autoFocus
                  />
                  <p className="form-hint">
                    {dialog.kind === "add"
                      ? `Seules les adresses @${WORK_EMAIL_DOMAIN} sont acceptées. La personne devient « ${ROLE_LABELS.USER} » ; vous pourrez changer son rôle ensuite. Aucun e-mail n'est envoyé : prévenez-la vous-même.`
                      : `Dès que l'adresse est enregistrée, l'identifiant « ${account?.username} » ne permet plus de se connecter : la personne utilise son adresse, avec son mot de passe actuel.`}
                  </p>
                </div>
              )}

              {dialog.kind === "role" && account && (
                <div className="form-group">
                  <label className="form-label" htmlFor="users-role">
                    Rôle
                  </label>
                  <select
                    id="users-role"
                    className="form-control"
                    value={roleInput}
                    onChange={(e) => setRoleInput(e.target.value as UserRole)}
                  >
                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <p className="form-hint">
                    {ROLE_LABELS.USER} : consulte. {ROLE_LABELS.GESTIONNAIRE} : ajoute, modifie et supprime le contenu.{" "}
                    {ROLE_LABELS.ADMIN} : gère aussi les comptes et l&apos;IA. Il reste toujours au moins un administrateur
                    actif.
                    {isSelf(account) && " Si vous quittez le rôle administrateur, vous perdez l'accès à cet écran."}
                  </p>
                </div>
              )}

              {dialog.kind === "reset" && account && (
                <p className="modal-text">
                  Le mot de passe de <strong>{nameOf(account)}</strong> est effacé et ses sessions ouvertes sont coupées.
                  Son rôle et son nom sont gardés. La personne choisira un nouveau mot de passe sur la page de première
                  connexion, avec son adresse <strong>{account.email}</strong>. Aucun e-mail n&apos;est envoyé : prévenez-la
                  vous-même.
                </p>
              )}

              {dialog.kind === "disable" && account && (
                <p className="modal-text">
                  <strong>{nameOf(account)}</strong> ne pourra plus se connecter, et ses sessions ouvertes sont coupées. Son
                  nom reste dans l&apos;historique des modifications. Vous pourrez réactiver le compte en le remettant en
                  première connexion.
                </p>
              )}

              {dialog.kind === "remove" && account && (
                <p className="modal-text">
                  La personne ne s&apos;est pas encore connectée. Une fois l&apos;adresse retirée, elle ne pourra plus faire
                  sa première connexion.
                </p>
              )}

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
                  Annuler
                </button>
                <button
                  type="submit"
                  className={`btn ${dialog.kind === "disable" || dialog.kind === "remove" ? "btn-danger" : "btn-primary"}`}
                  disabled={busy}
                >
                  {busy
                    ? "En cours…"
                    : {
                        add: "Ajouter à la liste",
                        role: "Enregistrer le rôle",
                        reset: account?.status === "DISABLED" ? "Réactiver" : "Remettre en première connexion",
                        disable: "Désactiver le compte",
                        remove: "Retirer de la liste",
                        email: "Enregistrer l'adresse",
                      }[dialog.kind]}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
