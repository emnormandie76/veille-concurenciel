/**
 * components/layout/back-office-access.ts — Le lien « Back-office » des pages qui ne lisent pas la session
 *
 * Plan gestion-contenu, étape 10, D104 (revient sur D57) : l'accueil, les
 * deux fiches et /api-docs ne lisent pas la session (ils étaient alors en
 * cache ; ils se rendent à chaque visite depuis D123). Leur barre
 * demande à `GET /api/admin/account/back-office` si le compte a accès au
 * back-office (rôle relu en base, D1), et ne montre le lien que sur un
 * « oui » ; dans le doute (session finie, erreur, réseau), pas de lien.
 *
 * La réponse est gardée en mémoire le temps de l'onglet, et revérifiée à
 * chaque page (choix du propriétaire) : un gestionnaire ne voit le lien
 * arriver qu'au premier chargement, un rôle retiré le fait partir à la page
 * suivante. Le serveur ne rend jamais le lien (`getServerSnapshot`) : rien
 * n'apparaît puis disparaît pour un USER. Une déconnexion recharge la page
 * et vide la mémoire.
 *
 * Module sans React, testé par test/site-bar.test.ts ; lu par
 * `useSyncExternalStore` dans BackOfficeLink.tsx.
 */

export const BACK_OFFICE_ACCESS_URL = "/api/admin/account/back-office";

/** La réponse de la route : le lien seulement sur un 200 qui dit `true`. */
export async function readBackOfficeAnswer(response: Response): Promise<boolean> {
  if (response.status !== 200) return false;
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && (body as { backOffice?: unknown }).backOffice === true;
  } catch {
    return false;
  }
}

export interface BackOfficeAccess {
  subscribe(listener: () => void): () => void;
  /** Ce que l'onglet sait : le lien, ou rien. */
  getSnapshot(): boolean;
  /** Ce que rend le serveur, et l'hydratation : jamais le lien. */
  getServerSnapshot(): boolean;
  /** Pose la question à la route ; une seule à la fois. */
  refresh(): Promise<void>;
}

type FetchAnswer = (url: string, init: RequestInit) => Promise<Response>;

export function createBackOfficeAccess(fetchAnswer: FetchAnswer): BackOfficeAccess {
  let shown = false;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const settle = (next: boolean) => {
    if (next === shown) return;
    shown = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => shown,
    getServerSnapshot: () => false,
    refresh() {
      pending ??= fetchAnswer(BACK_OFFICE_ACCESS_URL, { cache: "no-store" })
        .then(readBackOfficeAnswer, () => false)
        .then(settle)
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}

/** La mémoire de l'onglet : une seule pour toutes les barres. */
export const backOfficeAccess = createBackOfficeAccess((url, init) => fetch(url, init));
