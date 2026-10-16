/**
 * lib/callback-url.ts — Où revenir après la connexion
 *
 * Le proxy renvoie toute page demandée sans session vers la connexion, avec
 * `callbackUrl` (plan gestion-contenu, étape 1). La page de connexion y revient
 * une fois la personne connectée, à condition que ce soit un chemin du site :
 * suivre une adresse d'un autre site ferait de la connexion une redirection
 * ouverte (test/callback-url.test.ts).
 */

import { FIRST_LOGIN_PATH, LOGIN_PATH } from "@/lib/roles";

/** Sans destination demandée : les écoles du back-office (un USER est ensuite renvoyé vers le site). */
export const AFTER_LOGIN_DEFAULT = "/admin/schools";

export function safeCallbackPath(value: string | null | undefined): string {
  if (!value) return AFTER_LOGIN_DEFAULT;
  // Un chemin absolu du site : « / » suivi d'autre chose que « / » ou « \ »
  // (« //hote » et « /\hote » visent un autre site), sans caractère de contrôle.
  if (!/^\/(?![/\\])/.test(value) || /[\\\s\u0000-\u001f]/.test(value)) return AFTER_LOGIN_DEFAULT;
  // Un « // » encodé, que le navigateur pourrait décoder.
  if (/%2f|%5c/i.test(value.slice(1, 4))) return AFTER_LOGIN_DEFAULT;

  let url: URL;
  try {
    url = new URL(value, "http://site.invalid");
  } catch {
    return AFTER_LOGIN_DEFAULT;
  }
  if (url.origin !== "http://site.invalid") return AFTER_LOGIN_DEFAULT;
  // Ni la connexion ni la première connexion : une fois connecté, on n'y revient pas.
  for (const page of [LOGIN_PATH, FIRST_LOGIN_PATH]) {
    if (url.pathname === page || url.pathname.startsWith(`${page}/`)) return AFTER_LOGIN_DEFAULT;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
