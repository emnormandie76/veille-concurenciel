"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminPage } from "@/components/layout/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
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

// Charte (docs/architecture/charte-graphique.md, « Badges ») : les rôles sont
// des catégories, les états des états.
const ROLE_TONES: Record<UserRole, BadgeTone> = {
  USER: "neutral",
  GESTIONNAIRE: "accent",
  ADMIN: "solid",
};

const STATUS_TONES: Record<string, BadgeTone> = {
  INVITED: "warning",
  ACTIVE: "success",
  DISABLED: "danger",
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
    <AdminPage
      title="Comptes"
      description="Ajoutez l'adresse de travail d'un collègue : à sa première connexion, il choisit son mot de passe. Aucun e-mail n'est envoyé."
      actions={
        <Button variant="primary" onClick={() => open("add")}>
          Ajouter une adresse
        </Button>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des comptes...</p>
      ) : (
        <Table caption="Les comptes et les adresses de la liste blanche">
          <THead>
            <Tr>
              <Th>Compte</Th>
              <Th>Rôle</Th>
              <Th>État</Th>
              <Th>Première connexion</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {accounts.map((a) => (
              <Tr key={a.id} className={isSelf(a) ? "bg-accent-soft/40" : undefined}>
                <Td>
                  <div className="font-medium text-ink">
                    {nameOf(a)}
                    {isSelf(a) && <span className="ml-1.5 text-xs font-normal text-accent-strong">(vous)</span>}
                  </div>
                  {a.display_name && a.email && <div className="text-xs text-ink-2">{a.email}</div>}
                  {!a.email && (
                    <div className="text-xs text-ink-2">Identifiant « {a.username} » : aucune adresse renseignée</div>
                  )}
                </Td>
                <Td>
                  <Badge tone={isUserRole(a.role) ? ROLE_TONES[a.role] : "neutral"}>
                    {isUserRole(a.role) ? ROLE_LABELS[a.role] : a.role}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONES[a.status] ?? "neutral"}>
                    {isAccountStatus(a.status) ? STATUS_LABELS[a.status] : a.status}
                  </Badge>
                </Td>
                <Td numeric align="left" className="text-ink-2">
                  {formatDate(a.first_login_at)}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button size="sm" onClick={() => open("role", a)}>
                      Changer le rôle
                    </Button>
                    {!a.email && (
                      <Button size="sm" onClick={() => open("email", a)}>
                        Renseigner l&apos;adresse
                      </Button>
                    )}
                    {isSelf(a) ? (
                      <Link className={buttonClasses({ size: "sm" })} href="/account">
                        Mon compte
                      </Link>
                    ) : (
                      <>
                        {a.status === "INVITED" && (
                          <Button size="sm" variant="danger-soft" onClick={() => open("remove", a)}>
                            Retirer
                          </Button>
                        )}
                        {a.status !== "INVITED" && a.email && (
                          <Button size="sm" onClick={() => open("reset", a)}>
                            {a.status === "DISABLED" ? "Réactiver" : "Remettre en première connexion"}
                          </Button>
                        )}
                        {/* D24 : un invité se désactive aussi (remis en première
                            connexion, il ne se retire plus s'il a modifié des données). */}
                        {a.status !== "DISABLED" && (
                          <Button size="sm" variant="danger-soft" onClick={() => open("disable", a)}>
                            Désactiver
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {dialog && (
        <Dialog
          key={`${dialog.kind}-${account?.id ?? "new"}`}
          titleId="users-dialog-title"
          onClose={close}
          title={
            <>
              {dialog.kind === "add" && "Ajouter une adresse à la liste"}
              {dialog.kind === "role" && account && `Rôle de ${nameOf(account)}`}
              {dialog.kind === "reset" && account &&
                (account.status === "DISABLED" ? `Réactiver ${nameOf(account)} ?` : `Remettre ${nameOf(account)} en première connexion ?`)}
              {dialog.kind === "disable" && account && `Désactiver ${nameOf(account)} ?`}
              {dialog.kind === "remove" && account && `Retirer ${account.email} de la liste ?`}
              {dialog.kind === "email" && account && `Adresse de ${nameOf(account)}`}
            </>
          }
        >
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}

          <form onSubmit={submit} className="flex flex-col gap-4">
            {(dialog.kind === "add" || dialog.kind === "email") && (
              <Field
                id="users-email"
                label="Adresse e-mail de travail"
                hint={
                  dialog.kind === "add"
                    ? `Seules les adresses @${WORK_EMAIL_DOMAIN} sont acceptées. La personne devient « ${ROLE_LABELS.USER} » ; vous pourrez changer son rôle ensuite. Aucun e-mail n'est envoyé : prévenez-la vous-même.`
                    : `Dès que l'adresse est enregistrée, l'identifiant « ${account?.username} » ne permet plus de se connecter : la personne utilise son adresse, avec son mot de passe actuel.`
                }
              >
                {(control) => (
                  <Input
                    {...control}
                    type="email"
                    placeholder={`prenom.nom@${WORK_EMAIL_DOMAIN}`}
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    required
                    data-autofocus
                  />
                )}
              </Field>
            )}

            {dialog.kind === "role" && account && (
              <Field
                id="users-role"
                label="Rôle"
                hint={
                  <>
                    {ROLE_LABELS.USER} : consulte. {ROLE_LABELS.GESTIONNAIRE} : ajoute, modifie et supprime le contenu.{" "}
                    {ROLE_LABELS.ADMIN} : gère aussi les comptes et l&apos;IA. Il reste toujours au moins un administrateur
                    actif.
                    {isSelf(account) && " Si vous quittez le rôle administrateur, vous perdez l'accès à cet écran."}
                  </>
                }
              >
                {(control) => (
                  <Select {...control} value={roleInput} onChange={(e) => setRoleInput(e.target.value as UserRole)}>
                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}

            {dialog.kind === "reset" && account && (
              <p className="text-sm leading-relaxed text-ink-2">
                Le mot de passe de <strong className="font-medium text-ink">{nameOf(account)}</strong> est effacé et ses
                sessions ouvertes sont coupées. Son rôle et son nom sont gardés. La personne choisira un nouveau mot de
                passe sur la page de première connexion, avec son adresse{" "}
                <strong className="font-medium text-ink">{account.email}</strong>. Aucun e-mail n&apos;est envoyé :
                prévenez-la vous-même.
              </p>
            )}

            {dialog.kind === "disable" && account && (
              <p className="text-sm leading-relaxed text-ink-2">
                <strong className="font-medium text-ink">{nameOf(account)}</strong> ne pourra plus se connecter ni faire
                de première connexion, et ses sessions ouvertes sont coupées. Son nom reste dans l&apos;historique des
                modifications. Vous pourrez
                réactiver le compte en le remettant en première connexion.
              </p>
            )}

            {dialog.kind === "remove" && account && (
              <p className="text-sm leading-relaxed text-ink-2">
                Une fois l&apos;adresse retirée, la personne ne pourra plus faire sa première connexion. Un compte qui a
                déjà modifié des données, ou envoyé ou traité un signalement, ne se retire pas : désactivez-le.
              </p>
            )}

            <DialogFooter>
              <Button onClick={close} disabled={busy}>
                Annuler
              </Button>
              <Button type="submit" variant={dialog.kind === "disable" || dialog.kind === "remove" ? "danger" : "primary"} disabled={busy}>
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
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}
    </AdminPage>
  );
}
