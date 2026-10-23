"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { AuthShell, AuthShellLoading } from "@/components/layout/AuthShell";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { TEXT_LINK } from "@/components/ui/text-link";
import { safeCallbackPath } from "@/lib/callback-url";
import { FIRST_LOGIN_PATH, LOGIN_BLOCKED, LOGIN_BLOCKED_MESSAGE } from "@/lib/roles";

/**
 * /admin/login — la connexion (plan gestion-contenu, étapes 1 et 2)
 *
 * Par l'adresse de travail et le mot de passe. Un compte d'avant la liste
 * blanche se connecte encore par son ancien identifiant tant qu'aucune
 * adresse ne lui est renseignée (D3, lib/sign-in.ts). Une personne dont
 * l'adresse vient d'être ajoutée choisit d'abord son mot de passe sur la
 * première connexion.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl");
  const firstLoginHref = callbackUrl
    ? `${FIRST_LOGIN_PATH}?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : FIRST_LOGIN_PATH;

  useEffect(() => {
    // Gérer l'erreur passée par l'URL si NextAuth redirige directement
    const urlError = searchParams.get("error");
    if (urlError === "CredentialsSignin") {
      setError("Identifiants incorrects. Veuillez réessayer.");
    } else if (urlError === LOGIN_BLOCKED) {
      setError(LOGIN_BLOCKED_MESSAGE);
    } else if (urlError) {
      setError("Une erreur d'authentification est survenue.");
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        login,
        password,
        redirect: false, // On gère la redirection nous-mêmes pour un meilleur UX
      });

      if (result?.error) {
        // D117 : le plafond d'échecs se dit ; tout autre refus reste silencieux.
        setError(result.error === LOGIN_BLOCKED ? LOGIN_BLOCKED_MESSAGE : "Adresse e-mail ou mot de passe incorrect.");
        setLoading(false);
      } else {
        // Connexion réussie : retour à la page demandée (posée par le proxy),
        // si c'est un chemin du site ; sinon les écoles du back-office.
        router.push(safeCallbackPath(callbackUrl));
        router.refresh();
      }
    } catch {
      setError("Une erreur réseau est survenue. Veuillez réessayer.");
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="School Data Pipeline"
      subtitle="Connectez-vous pour accéder au site"
      footer={
        <>
          Première connexion, ou mot de passe remis à zéro par un administrateur ?{" "}
          <Link href={firstLoginHref} className={TEXT_LINK}>
            Choisissez votre mot de passe
          </Link>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          id="login"
          label="Adresse e-mail"
          hint="Compte créé avant la liste blanche : votre ancien identifiant reste accepté tant qu'aucune adresse ne lui est associée."
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="email"
              placeholder="prenom.nom@em-normandie.fr"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
            />
          )}
        </Field>

        <Field id="password" label="Mot de passe">
          {(control) => (
            <Input
              {...control}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
            />
          )}
        </Field>

        <Button type="submit" variant="primary" className="mt-1 w-full" disabled={loading}>
          {loading ? "Connexion en cours..." : "Se connecter"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthShellLoading />}>
      <LoginForm />
    </Suspense>
  );
}
