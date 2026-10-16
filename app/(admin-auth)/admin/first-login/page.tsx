"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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
 * route est plafonnée avec la connexion (5 tentatives / 15 min / IP).
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
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1 className="login-title">Première connexion</h1>
          <p className="login-subtitle">
            Votre adresse doit avoir été ajoutée par un administrateur. Aucun e-mail ne vous est
            envoyé : vous choisissez votre mot de passe ici.
          </p>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="first-login-email">
              Adresse e-mail de travail
            </label>
            <input
              id="first-login-email"
              type="email"
              className="form-control"
              placeholder={`prenom.nom@${WORK_EMAIL_DOMAIN}`}
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="first-login-name">
              Nom affiché
            </label>
            <input
              id="first-login-name"
              type="text"
              className="form-control"
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
              aria-describedby="first-login-name-hint"
            />
            <p className="form-hint" id="first-login-name-hint">
              Il signera vos modifications. Vous pourrez le changer sur « Mon compte ».
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="first-login-password">
              Mot de passe
            </label>
            <input
              id="first-login-password"
              type="password"
              className="form-control"
              placeholder={`Au moins ${MIN_PASSWORD_LENGTH} caractères`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="first-login-confirm">
              Confirmer le mot de passe
            </label>
            <input
              id="first-login-confirm"
              type="password"
              className="form-control"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? "Enregistrement…" : "Choisir mon mot de passe"}
          </button>
        </form>

        <p className="login-footer">
          Vous avez déjà un mot de passe ? <Link href={loginHref}>Se connecter</Link>
        </p>
      </div>
    </div>
  );
}

export default function FirstLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-container" style={{ color: "#ffffff" }}>
          Chargement...
        </div>
      }
    >
      <FirstLoginForm />
    </Suspense>
  );
}
