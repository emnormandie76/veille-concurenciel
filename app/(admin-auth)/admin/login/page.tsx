"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { safeCallbackPath } from "@/lib/callback-url";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        username,
        password,
        redirect: false, // On gère la redirection nous-mêmes pour un meilleur UX
      });

      if (result?.error) {
        setError("Nom d'utilisateur ou mot de passe incorrect.");
        setLoading(false);
      } else {
        // Connexion réussie : retour à la page demandée (posée par le proxy),
        // si c'est un chemin du site ; sinon les écoles du back-office.
        router.push(safeCallbackPath(searchParams.get("callbackUrl")));
        router.refresh();
      }
    } catch (err) {
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
            <label className="form-label" htmlFor="username">
              Nom d'utilisateur
            </label>
            <input
              id="username"
              type="text"
              className="form-control"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
              autoComplete="username"
            />
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

          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading}
            style={{ width: "100%", marginTop: "12px" }}
          >
            {loading ? "Connexion en cours..." : "Se connecter"}
          </button>
        </form>
      </div>

      <style jsx>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at center, #111827 0%, #030712 100%);
          padding: 20px;
        }

        .login-card {
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          width: 100%;
          max-width: 420px;
          padding: 40px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        }

        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .login-title {
          font-size: 1.6rem;
          color: #ffffff;
          margin-bottom: 8px;
          letter-spacing: -0.5px;
        }

        .login-subtitle {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .login-btn {
          font-size: 0.95rem;
          padding: 12px;
        }
      `}</style>
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
