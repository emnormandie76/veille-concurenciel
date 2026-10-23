/**
 * test/site-bar.test.ts — La barre du site : le lien « Back-office » dès la connexion
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 10, D104 (revient sur D57) : le lien
 * « Back-office » est dans la barre de toutes les pages, dès la connexion,
 * pour un gestionnaire ou un admin, jamais pour un USER.
 * - « Mon compte » et le formulaire de signalement lisent la session (relue
 *   en base, D1) : ils disent au gabarit ce qu'ils savent, et le lien est
 *   là d'emblée, sans appel ;
 * - l'accueil, les deux fiches (cache ISR) et /api-docs ne la lisent pas :
 *   la barre le demande elle-même à `GET /api/admin/account/back-office`
 *   (test/api/account-back-office.test.ts), par `BackOfficeLink`. Le HTML
 *   rendu côté serveur ne l'a jamais : rien n'apparaît puis disparaît pour
 *   un USER ;
 * - la réponse est gardée en mémoire le temps de l'onglet et revérifiée à
 *   chaque page (choix du propriétaire) : un gestionnaire ne voit le lien
 *   arriver qu'au premier chargement.
 *
 * Sans navigateur : la lecture de la réponse et la mémoire de l'onglet se
 * testent par un faux `fetch` ; le gabarit est rendu en HTML
 * (`renderToStaticMarkup`), comme le serveur le rend.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SiteShell } from "../components/layout/SiteShell";
import {
  BACK_OFFICE_ACCESS_URL,
  createBackOfficeAccess,
  readBackOfficeAnswer,
} from "../components/layout/back-office-access";
import { hasAccess, USER_ROLES } from "../lib/roles";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires (un commentaire peut nommer ce que le code n'a plus). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

/** Le lien « Back-office » dans un HTML rendu. */
const BACK_OFFICE_LINK = /<a [^>]*href="\/admin\/schools"[^>]*>Back-office<\/a>/;

// ─── La réponse de la route ─────────────────────────────────────────────────

test("la réponse : le lien seulement sur un 200 qui dit oui", async () => {
  assert.equal(await readBackOfficeAnswer(json(200, { backOffice: true })), true);
  assert.equal(await readBackOfficeAnswer(json(200, { backOffice: false })), false, "un USER");
  assert.equal(await readBackOfficeAnswer(json(401, { error: "Non authentifié." })), false, "sans session");
  assert.equal(await readBackOfficeAnswer(json(500, { backOffice: true })), false, "une erreur, même qui dirait oui");
  assert.equal(await readBackOfficeAnswer(json(200, { backOffice: "true" })), false, "ni une chaîne");
  assert.equal(await readBackOfficeAnswer(json(200, { backOffice: 1 })), false, "ni un nombre");
  assert.equal(await readBackOfficeAnswer(json(200, null)), false);
  assert.equal(await readBackOfficeAnswer(new Response("<html>", { status: 200 })), false, "une réponse illisible");
});

// ─── La mémoire de l'onglet ─────────────────────────────────────────────────

/** Un faux `fetch` qui rend les réponses données, dans l'ordre, et note ses appels. */
function fakeFetch(...answers: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchAnswer = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error("appel de trop");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchAnswer };
}

test("avant toute réponse, pas de lien : ni dans le HTML du serveur, ni à l'hydratation", () => {
  const access = createBackOfficeAccess(fakeFetch().fetchAnswer);
  assert.equal(access.getServerSnapshot(), false);
  assert.equal(access.getSnapshot(), false);
});

test("un gestionnaire : le lien, gardé pour les pages suivantes ; un USER : jamais", async () => {
  const manager = fakeFetch(json(200, { backOffice: true }));
  const access = createBackOfficeAccess(manager.fetchAnswer);
  let notified = 0;
  const unsubscribe = access.subscribe(() => (notified += 1));
  await access.refresh();
  assert.equal(access.getSnapshot(), true);
  assert.equal(notified, 1, "la barre affichée est prévenue");
  assert.equal(access.getServerSnapshot(), false, "le serveur ne le rend jamais");
  unsubscribe();

  const user = fakeFetch(json(200, { backOffice: false }));
  const userAccess = createBackOfficeAccess(user.fetchAnswer);
  let userNotified = 0;
  userAccess.subscribe(() => (userNotified += 1));
  await userAccess.refresh();
  assert.equal(userAccess.getSnapshot(), false);
  assert.equal(userNotified, 0, "rien ne change pour un USER : rien ne s'affiche");
});

test("revérifié à chaque page : un rôle retiré fait partir le lien", async () => {
  const { fetchAnswer } = fakeFetch(json(200, { backOffice: true }), json(200, { backOffice: false }));
  const access = createBackOfficeAccess(fetchAnswer);
  await access.refresh();
  assert.equal(access.getSnapshot(), true);
  await access.refresh();
  assert.equal(access.getSnapshot(), false);
});

test("dans le doute, pas de lien : session finie, erreur, réseau coupé", async () => {
  for (const failure of [json(401, { error: "Non authentifié." }), json(500, {}), new Error("réseau coupé")]) {
    const { fetchAnswer } = fakeFetch(json(200, { backOffice: true }), failure);
    const access = createBackOfficeAccess(fetchAnswer);
    await access.refresh();
    await access.refresh();
    assert.equal(access.getSnapshot(), false, String(failure instanceof Error ? failure.message : failure.status));
  }
});

test("une seule question à la fois, à la route de la session, jamais en cache", async () => {
  const { calls, fetchAnswer } = fakeFetch(json(200, { backOffice: true }), json(200, { backOffice: true }));
  const access = createBackOfficeAccess(fetchAnswer);
  // Deux barres montées ensemble (ou les effets rejoués par React en
  // développement) : un seul appel.
  await Promise.all([access.refresh(), access.refresh()]);
  assert.equal(calls.length, 1);
  assert.equal(BACK_OFFICE_ACCESS_URL, "/api/admin/account/back-office");
  assert.equal(calls[0].url, BACK_OFFICE_ACCESS_URL);
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(calls[0].init?.method ?? "GET", "GET");
  // Une fois la réponse arrivée, la page suivante redemande.
  await access.refresh();
  assert.equal(calls.length, 2);
});

// ─── Le gabarit ─────────────────────────────────────────────────────────────

const shell = (props: { showBackOffice?: boolean }) =>
  renderToStaticMarkup(h(SiteShell, { ...props, children: "contenu" }));

test("une page qui lit la session : le lien d'emblée pour un gestionnaire ou un admin, jamais pour un USER", () => {
  for (const role of USER_ROLES) {
    const out = shell({ showBackOffice: hasAccess(role, "manager") });
    if (role === "USER") assert.doesNotMatch(out, /Back-office/, role);
    else assert.match(out, BACK_OFFICE_LINK, role);
  }
});

test("une page qui ne lit pas la session : la barre demande, et son HTML n'a jamais le lien", () => {
  const out = shell({});
  assert.doesNotMatch(out, /Back-office/, "rien n'apparaît puis disparaît pour un USER");
  // Le reste de la barre ne change pas.
  assert.match(out, /<nav aria-label="Navigation du site"/);
  for (const text of ["Écoles", "API", "Aide", "Mon compte", "Se déconnecter"]) assert.match(out, new RegExp(`>${text}<`), text);
});

test("étape 14 (D109) : « Aide » dans la barre, avant « Mon compte », marquée sur la page d'aide", () => {
  for (const props of [{}, { showBackOffice: true }, { showBackOffice: false }]) {
    const out = shell(props);
    const entries = [...out.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => m[2]);
    const help = entries.indexOf("Aide");
    assert.ok(help > 0, "« Aide » dans la barre");
    assert.equal(entries[help + 1], "Mon compte", "juste avant « Mon compte »");
  }
  assert.match(shell({}), /<a [^>]*href="\/help"[^>]*>Aide<\/a>/);
  const onHelp = renderToStaticMarkup(h(SiteShell, { current: "help", showBackOffice: false, children: "contenu" }));
  assert.equal(onHelp.match(/aria-current="page"/g)?.length, 1);
  assert.match(onHelp, /<a [^>]*href="\/help"[^>]*aria-current="page"[^>]*>Aide<\/a>|<a [^>]*aria-current="page"[^>]*href="\/help"[^>]*>Aide<\/a>/);
});

test("BackOfficeLink : composant client, la mémoire de l'onglet par useSyncExternalStore, la question dans un effet", () => {
  const source = code("components/layout/BackOfficeLink.tsx");
  assert.match(source, /^"use client";/);
  assert.match(
    source,
    /useSyncExternalStore\(\s*backOfficeAccess\.subscribe,\s*backOfficeAccess\.getSnapshot,\s*backOfficeAccess\.getServerSnapshot,?\s*\)/,
  );
  assert.match(source, /useEffect\(\(\) => \{\s*void backOfficeAccess\.refresh\(\);\s*\}, \[\]\)/);
  assert.match(source, /return shown \? <BackOfficeNavLink \/> : null;/);
  const gabarit = code("components/layout/SiteShell.tsx");
  assert.match(gabarit, /showBackOffice\?: boolean;/, "facultatif : absent, la barre demande");
  assert.match(gabarit, /\{showBackOffice === undefined \? <BackOfficeLink \/> : showBackOffice && <BackOfficeNavLink \/>\}/);
});

test("la barre ne lit pas la session : ni le gabarit, ni le lien, ni sa mémoire", () => {
  const SESSION = /requirePage|getSession|getServerSession|useSession|next-auth/;
  for (const file of ["components/layout/SiteShell.tsx", "components/layout/BackOfficeLink.tsx", "components/layout/SiteNavLink.tsx", "components/layout/back-office-access.ts"]) {
    assert.equal(SESSION.test(code(file)), false, file);
  }
});

test("D104 : l'accueil, les deux fiches et /api-docs laissent la barre demander ; « Mon compte » et le signalement disent ce qu'ils savent", () => {
  // L'attendu change avec la règle (D104 revient sur D57) : ces quatre pages
  // passaient `showBackOffice={false}`.
  for (const file of ["app/page.tsx", "app/schools/[id]/SchoolDetailClient.tsx", "app/schools/[id]/programs/[pid]/page.tsx", "app/api-docs/page.tsx"]) {
    const source = code(file);
    assert.match(source, /<SiteShell[\s>]/, file);
    assert.doesNotMatch(source, /showBackOffice/, file);
  }
  for (const file of ["app/account/page.tsx", "app/schools/[id]/report/page.tsx"]) {
    assert.match(code(file), /showBackOffice=\{hasAccess\(user\.role, "manager"\)\}/, file);
  }
});
