/**
 * test/admin-frame.test.ts — Le cadre et le menu du back-office dans la charte
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 9, lot 6 (D54). Le cadre (app/admin/layout.tsx)
 * et le menu (app/admin/SidebarClient.tsx) passent à la charte. Ce test garde :
 *
 * - **ce qui ne bouge pas** : `requirePage("manager")` dans le layout, le menu
 *   par rôle de `navFor` (test/admin-pages.test.ts), les textes et les liens,
 *   la déconnexion vers la page de connexion ;
 * - **les décisions du propriétaire du 21 octobre** : le menu sombre sur les
 *   jetons `side-*`, l'entrée choisie marquée aussi par un filet, le focus en
 *   `side-ink` (D92) ; texte seul (D93) ; repliable sous 1 024 px, refermé
 *   quand la page change (D94) ; le rôle en texte, l'avatar caché aux
 *   lecteurs d'écran (D95) ;
 * - **la charte** (§8) : `aria-current="page"` sur l'entrée choisie, une `nav`
 *   nommée, un `main`, aucun titre dans le menu (un `h1` par écran).
 *
 * Le menu se rend côté serveur par sa partie sans état (`AdminMenu`) ; le
 * composant client n'y ajoute que le chemin affiché et l'ouverture.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminMenu } from "../app/admin/SidebarClient";
import { ADMIN_NAV } from "../app/admin/nav";
import type { UserRole } from "../lib/roles";

const LAYOUT = "app/admin/layout.tsx";
const SIDEBAR = "app/admin/SidebarClient.tsx";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires (un commentaire peut nommer ce que le code n'a plus). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");

const ADMIN = { name: "Goat", role: "ADMIN" as UserRole };
const MANAGER = { name: "Jean Dupont", role: "GESTIONNAIRE" as UserRole };

function render(user: { name: string; role: UserRole }, pathname: string, open = false): string {
  return renderToStaticMarkup(h(AdminMenu, { user, pathname, open, onToggle: () => {} }));
}

/** Les classes d'un élément ouvert par `opening` (le début de sa balise, attributs compris). */
function classesOf(tag: string): string[] {
  return (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
}

/** La balise ouvrante du lien dont le texte est exactement `text`. */
function linkTag(out: string, text: string): string {
  const match = out.match(new RegExp(`<a ([^>]*)>${text}</a>`));
  assert.ok(match, `lien « ${text} » introuvable`);
  return match[1];
}

/** Les entrées de la `nav` du menu : [adresse, texte]. */
function navEntries(out: string): string[][] {
  const nav = out.match(/<nav aria-label="Navigation du back-office"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, "une nav nommée");
  return [...nav[1].matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2].replace(/&amp;/g, "&")]);
}

// ─── Le cadre ───────────────────────────────────────────────────────────────

test("le cadre : requirePage(\"manager\") d'abord, puis le menu et un main qui peut rétrécir ; plus d'ancienne classe", () => {
  const layout = code(LAYOUT);
  assert.match(layout, /const session = await requirePage\("manager"\);/);
  assert.match(layout, /<SidebarClient user=\{session\.user\} \/>/);
  // `min-w-0` : un tableau large défile dans son cadre au lieu d'élargir la page.
  assert.match(layout, /<main className="[^"]*\bmin-w-0\b[^"]*"/);
  assert.equal(layout.match(/<main\b/g)?.length, 1);
  assert.doesNotMatch(layout, /admin-layout-wrapper|admin-content-area|admin-container/);
});

// ─── Le menu : ce qui ne bouge pas ──────────────────────────────────────────

test("le menu : les entrées de navFor, dans l'ordre, avec leurs textes et leurs liens", () => {
  assert.deepEqual(
    navEntries(render(ADMIN, "/admin/schools")),
    ADMIN_NAV.map((item) => [item.href, item.label]),
  );
  assert.deepEqual(navEntries(render(MANAGER, "/admin/schools")), [
    ["/admin/schools", "Écoles & Campus"],
    ["/admin/reports", "Signalements"],
  ]);
});

test("le menu : « School Data Pipeline », le nom, « Mon compte » et « Déconnexion » gardés ; aucun titre", () => {
  const out = render(ADMIN, "/admin/schools");
  // Deux fois : la barre de l'écran étroit et la colonne de l'écran large (une seule visible à la fois).
  assert.equal(out.match(/>School Data Pipeline</g)?.length, 2);
  assert.match(out, />Goat</);
  assert.match(linkTag(out, "Mon compte"), /href="\/account"/);
  assert.match(out, /<button type="button" class="[^"]*">Déconnexion<\/button>/);
  // Le nom de l'application n'est plus un h2 avant le h1 de l'écran (charte §8).
  assert.doesNotMatch(out, /<h[1-6]\b/);
  assert.match(code(SIDEBAR), /signOut\(\{ callbackUrl: "\/admin\/login" \}\)/);
});

test("le menu : aria-current=\"page\" sur la seule entrée qui mène à l'écran affiché, sous-pages comprises", () => {
  const inbox = render(ADMIN, "/admin/inbox");
  assert.equal(inbox.match(/aria-current="page"/g)?.length, 1);
  assert.match(linkTag(inbox, "Validation Inbox"), /aria-current="page"/);
  const manage = render(ADMIN, "/admin/schools/fe46bddf/manage");
  assert.equal(manage.match(/aria-current="page"/g)?.length, 1);
  assert.match(linkTag(manage, "Écoles &amp; Campus"), /aria-current="page"/);
  assert.doesNotMatch(linkTag(manage, "Mon compte"), /aria-current/);
});

// ─── Les décisions du propriétaire ──────────────────────────────────────────

test("D92 : sombre sur les jetons side-*, l'entrée choisie marquée aussi par un filet, le focus en side-ink", () => {
  const out = render(ADMIN, "/admin/reports");
  const aside = out.match(/<aside ([^>]*)>/);
  assert.ok(aside);
  for (const name of ["bg-side", "text-side-ink"]) assert.ok(classesOf(aside[1]).includes(name), name);
  const current = classesOf(linkTag(out, "Signalements"));
  for (const name of ["bg-side-active", "text-side-ink", "font-medium", "shadow-[inset_3px_0_0_var(--color-side-ink)]"]) {
    assert.ok(current.includes(name), `entrée choisie : ${name}`);
  }
  const idle = classesOf(linkTag(out, "Comptes"));
  assert.ok(idle.includes("text-side-ink-2") && !idle.includes("bg-side-active"), "entrée non choisie");
  assert.ok(!idle.some((name) => name.startsWith("shadow-")), "le filet n'est que sur l'entrée choisie");
  // Le bleu du focus ne tiendrait que 2:1 sur le fond side : le menu prend side-ink.
  for (const tag of [linkTag(out, "Signalements"), linkTag(out, "Comptes"), linkTag(out, "Mon compte")]) {
    assert.ok(classesOf(tag).includes("focus-visible:outline-side-ink"), tag);
  }
  assert.doesNotMatch(out, /outline-focus/);
});

test("D93 : texte seul, plus d'émoji ni de champ icon", () => {
  for (const item of ADMIN_NAV) assert.deepEqual(Object.keys(item).sort(), ["href", "label", "level"], item.href);
  const emoji = /\p{Emoji_Presentation}|\uFE0F/u;
  assert.doesNotMatch(read(SIDEBAR), emoji);
  assert.doesNotMatch(read("app/admin/nav.ts"), emoji);
  assert.doesNotMatch(render(ADMIN, "/admin/schools"), /<svg/);
});

test("D94 : sous 1 024 px, un bouton « Menu » qui ouvre le menu sous la barre ; au-delà, la colonne", () => {
  const closed = render(ADMIN, "/admin/schools");
  const button = closed.match(/<button ([^>]*)>Menu<\/button>/);
  assert.ok(button, "le bouton « Menu »");
  assert.match(button[1], /type="button"/);
  assert.match(button[1], /aria-expanded="false"/);
  assert.match(button[1], /aria-controls="admin-menu"/);
  const closedAside = classesOf(closed.match(/<aside ([^>]*)>/)![1]);
  assert.match(closed, /<aside id="admin-menu"/);
  assert.ok(closedAside.includes("hidden") && !closedAside.includes("flex"), "fermé : caché sous 1 024 px");
  for (const name of ["lg:flex", "lg:sticky", "lg:top-0", "lg:h-screen", "lg:w-60"]) assert.ok(closedAside.includes(name), name);

  const open = render(ADMIN, "/admin/schools", true);
  assert.match(open.match(/<button ([^>]*)>Menu<\/button>/)![1], /aria-expanded="true"/);
  const openAside = classesOf(open.match(/<aside ([^>]*)>/)![1]);
  assert.ok(openAside.includes("flex") && !openAside.includes("hidden"), "ouvert : affiché sous la barre");

  // La barre ne s'affiche que sous 1 024 px ; le menu ne flotte pas sur le contenu.
  const bar = closed.match(/<div ([^>]*)><div[^>]*>School Data Pipeline<\/div><button/);
  assert.ok(bar && classesOf(bar[1]).includes("lg:hidden"), "la barre");
  assert.doesNotMatch(closed, /\b(fixed|absolute|z-\d+)\b/);
  // Refermé quand la page change : l'ouverture est liée au chemin où elle a eu lieu, sans effet.
  const source = code(SIDEBAR);
  assert.match(source, /openOn === pathname/);
  assert.doesNotMatch(source, /useEffect/);
});

test("D95 : le rôle en texte secondaire sous le nom, l'avatar caché aux lecteurs d'écran", () => {
  const admin = render(ADMIN, "/admin/schools");
  assert.match(admin, /<p class="[^"]*\btext-side-ink-2\b[^"]*">Administrateur<\/p>/);
  assert.match(render(MANAGER, "/admin/schools"), /<p class="[^"]*\btext-side-ink-2\b[^"]*">Gestionnaire<\/p>/);
  assert.match(admin, /<div aria-hidden="true" class="[^"]*">GO<\/div>/);
  assert.match(render(MANAGER, "/admin/schools"), /<div aria-hidden="true" class="[^"]*">JE<\/div>/, "le calcul des initiales ne change pas");
  assert.doesNotMatch(admin, /\bbadge\b/);
});

test("le menu dans la charte : ni ancienne classe, ni styled-jsx, ni style en ligne, ni couleur littérale", () => {
  const source = read(SIDEBAR);
  assert.doesNotMatch(source, /<style\b|style=\{\{/);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  assert.doesNotMatch(code(SIDEBAR), /\b(sidebar|nav-link|btn|badge-admin|badge-moderator|logout-btn|user-avatar)\b/);
});
