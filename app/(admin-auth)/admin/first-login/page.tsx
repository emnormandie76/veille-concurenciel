"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell, AuthShellLoading } from "@/components/layout/AuthShell";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { TEXT_LINK } from "@/components/ui/text-link";
import { safeCallbackPath } from "@/lib/callback-url";
import { MAX_DISPLAY_NAME_LENGTH, WORK_EMAIL_DOMAIN, nameFromEmail } from "@/lib/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { FIRST_LOGIN_API, LOGIN_PATH } from "@/lib/roles";

/**
 * /admin/first-login — la première connexion (plan gestion-contenu, étape 2, G5)
 *
 * L'admin a ajouté l'adresse de la personne à la liste blanche, sans envoi
 * d'e-mail, ou a remis son compte en première connexion (D4). Elle saisit
 * cette adresse, choisit son nom affiché (D6, prérempli depuis l'adresse) et
 * son mot de passe ; la route (`POST /api/first-login`) active le compte, puis
 * la page la connecte par NextAuth.
 *
 * Ouverte sans session (proxy.ts), hors du layout admin comme la connexion ; la
 * route partage le plafond d'échecs de la connexion (D117 : 5 par adresse,
 * 20 par IP, 15 minutes) et répond 429 au-delà, avec un message que la page
 * affiche tel quel.
 */
function FirstLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Tant que la personne n'a pas touché au nom, il suit l'adresse saisie.
  const [nameEdited, setNameEdited] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl");
  const loginHref = callbackUrl ? `${LOGIN_PATH}?callbackUrl=${encodeURIComponent(callbackUrl)}` : LOGIN_PATH;

  const onEmailChange = (value: string) => {
    setEmail(value);
    if (!nameEdited) setDisplayName(value.includes("@") ? nameFromEmail(value) : "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Les deux saisies du mot de passe ne correspondent pas.");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch(FIRST_LOGIN_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof body?.error === "string" ? body.error : "La première connexion a échoué. Veuillez réessayer.");
        setLoading(false);
        return;
      }

      // Le compte est actif : la connexion se fait avec ce qui vient d'être saisi.
      const result = await signIn("credentials", { login: email, password, redirect: false });
      if (result?.error) {
        setError("Votre mot de passe est enregistré, mais la connexion a échoué : connectez-vous depuis la page de connexion.");
        setLoading(false);
        return;
      }
      // Une personne qui vient d'arriver est le plus souvent un USER : le site.
      router.push(callbackUrl ? safeCallbackPath(callbackUrl) : "/");
      router.refresh();
    } catch {
      setError("Une erreur réseau est survenue. Veuillez réessayer.");
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Première connexion"
      subtitle="Votre adresse doit avoir été ajoutée par un administrateur. Aucun e-mail ne vous est envoyé : vous choisissez votre mot de passe ici."
      footer={
        <>
          Vous avez déjà un mot de passe ?{" "}
          <Link href={loginHref} className={TEXT_LINK}>
            Se connecter
          </Link>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field id="first-login-email" label="Adresse e-mail de travail">
          {(control) => (
            <Input
              {...control}
              type="email"
              placeholder={`prenom.nom@${WORK_EMAIL_DOMAIN}`}
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
            />
          )}
        </Field>

        <Field
          id="first-login-name"
          label="Nom affiché"
          hint="Il signera vos modifications. Vous pourrez le changer sur « Mon compte »."
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              placeholder="Prénom Nom"
              value={displayName}
              onChange={(e) => {
                setNameEdited(true);
                setDisplayName(e.target.value);
              }}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              required
              disabled={loading}
              autoComplete="name"
            />
          )}
        </Field>

        <Field id="first-login-password" label="Mot de passe">
          {(control) => (
            <Input
              {...control}
              type="password"
              placeholder={`Au moins ${MIN_PASSWORD_LENGTH} caractères`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
              disabled={loading}
              autoComplete="new-password"
            />
          )}
        </Field>

        <Field id="first-login-confirm" label="Confirmer le mot de passe">
          {(control) => (
            <Input
              {...control}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
              disabled={loading}
              autoComplete="new-password"
            />
          )}
        </Field>

        <Button type="submit" variant="primary" className="mt-1 w-full" disabled={loading}>
          {loading ? "Enregistrement…" : "Choisir mon mot de passe"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function FirstLoginPage() {
  return (
    <Suspense fallback={<AuthShellLoading />}>
      <FirstLoginForm />
    </Suspense>
  );
}
