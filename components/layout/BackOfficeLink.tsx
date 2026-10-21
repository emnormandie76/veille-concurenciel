"use client";

import { useEffect, useSyncExternalStore } from "react";
import { backOfficeAccess } from "./back-office-access";
import { BackOfficeNavLink } from "./SiteNavLink";

/**
 * components/layout/BackOfficeLink.tsx — « Back-office » dans la barre d'une page qui ne lit pas la session
 *
 * Plan gestion-contenu, étape 10, D104 : la barre demande à la route si le
 * compte a accès au back-office (back-office-access.ts), et ne montre le
 * lien que sur un « oui ». Rien au rendu du serveur ni à l'hydratation ;
 * d'une page à l'autre, la réponse gardée par l'onglet s'affiche d'emblée,
 * puis se revérifie.
 */
export default function BackOfficeLink() {
  const shown = useSyncExternalStore(
    backOfficeAccess.subscribe,
    backOfficeAccess.getSnapshot,
    backOfficeAccess.getServerSnapshot,
  );

  useEffect(() => {
    void backOfficeAccess.refresh();
  }, []);

  return shown ? <BackOfficeNavLink /> : null;
}
