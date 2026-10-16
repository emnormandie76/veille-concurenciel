"use client";

import { signOut } from "next-auth/react";

/**
 * Déconnexion depuis la barre du site. Le site entier est derrière la connexion
 * (plan gestion-contenu, étape 1) : chacun doit pouvoir en sortir, pas
 * seulement depuis le back-office.
 */
export default function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => signOut({ callbackUrl: "/admin/login" })}
    >
      Se déconnecter
    </button>
  );
}
