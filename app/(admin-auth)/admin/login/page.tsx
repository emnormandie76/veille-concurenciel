"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { safeCallbackPath } from "@/lib/callback-url";
import { FIRST_LOGIN_PATH } from "@/lib/roles";

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
        setError("Adresse e-mail ou mot de passe incorrect.");
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
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title">School Data Pipeline</h1>
          <p className="login-subtitle">Connectez-vous pour accéder au site</p>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="login">
              Adresse e-mail
            </label>
            <input
              id="login"
              type="text"
              inputMode="email"
              className="form-control"
              placeholder="prenom.nom@em-normandie.fr"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
              aria-describedby="login-hint"
            />
            <p className="form-hint" id="login-hint">
              Compte créé avant la liste blanche : votre ancien identifiant reste accepté tant
              qu&apos;aucune adresse ne lui est associée.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              className="form-control"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? "Connexion en cours..." : "Se connecter"}
          </button>
        </form>

        <p className="login-footer">
          Première connexion, ou mot de passe remis à zéro par un administrateur ?{" "}
          <Link href={firstLoginHref}>Choisissez votre mot de passe</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0b0f19",
        color: "#ffffff"
      }}>
        Chargement...
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
