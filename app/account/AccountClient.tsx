"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { MAX_DISPLAY_NAME_LENGTH } from "@/lib/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

interface AccountClientProps {
  initialName: string;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

/** Lit le message d'une réponse d'API ; un corps illisible donne le message par défaut. */
async function messageOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  const message = res.ok ? body?.message : body?.error;
  return typeof message === "string" ? message : fallback;
}

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return <Alert tone={feedback.kind === "success" ? "success" : "danger"}>{feedback.message}</Alert>;
}

/**
 * Les deux formulaires de « Mon compte » : le nom affiché (D6) et le mot de
 * passe. Les routes ne prennent aucun identifiant : elles visent la session.
 */
export default function AccountClient({ initialName }: AccountClientProps) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameFeedback, setNameFeedback] = useState<Feedback>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameBusy(true);
    setNameFeedback(null);
    try {
      const res = await fetch("/api/admin/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) {
        setNameFeedback({ kind: "error", message: await messageOf(res, "Le nom n'a pas pu être enregistré.") });
        return;
      }
      const body = (await res.json()) as { displayName: string };
      setName(body.displayName);
      setNameFeedback({ kind: "success", message: "Nom affiché enregistré." });
      router.refresh();
    } catch {
      setNameFeedback({ kind: "error", message: "Une erreur réseau est survenue. Veuillez réessayer." });
    } finally {
      setNameBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ kind: "error", message: "Les deux saisies du nouveau mot de passe ne correspondent pas." });
      return;
    }
    setPasswordBusy(true);
    try {
      const res = await fetch("/api/admin/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const message = await messageOf(res, res.ok ? "Mot de passe mis à jour." : "Le mot de passe n'a pas pu être changé.");
      setPasswordFeedback({ kind: res.ok ? "success" : "error", message });
      if (res.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setPasswordFeedback({ kind: "error", message: "Une erreur réseau est survenue. Veuillez réessayer." });
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <>
      <Card aria-labelledby="account-name-title" className="flex flex-col gap-4">
        <CardHeader title="Nom affiché" titleId="account-name-title" />
        <FeedbackLine feedback={nameFeedback} />
        <form onSubmit={saveName} className="flex flex-col gap-4">
          <Field id="account-name" label="Prénom et nom">
            {(control) => (
              <Input
                {...control}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                autoComplete="name"
                required
                disabled={nameBusy}
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={nameBusy}>
              {nameBusy ? "Enregistrement…" : "Enregistrer le nom"}
            </Button>
          </div>
        </form>
      </Card>

      <Card aria-labelledby="account-password-title" className="flex flex-col gap-4">
        <CardHeader title="Mot de passe" titleId="account-password-title" />
        <FeedbackLine feedback={passwordFeedback} />
        <form onSubmit={savePassword} className="flex flex-col gap-4">
          <Field id="account-current-password" label="Mot de passe actuel">
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                disabled={passwordBusy}
              />
            )}
          </Field>
          <Field id="account-new-password" label="Nouveau mot de passe">
            {(control) => (
              <Input
                {...control}
                type="password"
                placeholder={`Au moins ${MIN_PASSWORD_LENGTH} caractères`}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
                disabled={passwordBusy}
              />
            )}
          </Field>
          <Field id="account-confirm-password" label="Confirmer le nouveau mot de passe">
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
                disabled={passwordBusy}
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={passwordBusy}>
              {passwordBusy ? "Mise à jour…" : "Changer le mot de passe"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
