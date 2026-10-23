/**
 * test/help-page.test.ts — La page d'aide : à chacun le guide de son rôle
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 14 (D108) : `/help`, ouverte à toute session,
 * montre à chacun le guide de son rôle, et lui seul : un USER le guide de
 * l'utilisateur, un gestionnaire celui du gestionnaire, un admin celui de
 * l'admin. L'attendu a changé avec la règle : le propriétaire a d'abord
 * retenu des guides cumulés, puis, la page vue, le seul guide de son rôle
 * (« sinon ça noie l'utilisateur »). Le rôle est celui de la base, relu par
 * `requirePage` (D1), jamais celui du jeton ; un compte qui n'est plus actif
 * n'a plus de session (D20).
 *
 * Comme test/api/account-back-office.test.ts, `@/lib/auth` n'est pas
 * remplacé : la vraie lib/auth.ts juge, avec `getServerSession` de next-auth
 * remplacé et le faux Prisma qui rend le compte. La page est rendue en HTML
 * (`renderToStaticMarkup`), comme le serveur la rend.
 *
 * Le texte dit vrai : chaque libellé que le guide cite (`<Ui>…</Ui>`) existe
 * dans le code des écrans ; le guide ne cite aucune fonction disparue, et
 * celui de l'admin dit où vit la console IA sans commande ni secret (D114).
 */

import { afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { installFakePrisma } from "./helpers/fake-prisma";
import { schemaErrors } from "./helpers/prisma-schema";
import { APP_NAME } from "../lib/app-name";
import { USER_ROLES } from "../lib/roles";

const PAGE = "app/help/page.tsx";
const GUIDES = "app/help/guides.tsx";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
/** Le code seul, sans les commentaires (un commentaire peut nommer ce que le code n'a plus). */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");

/** Le jeton de la session : son compte, le rôle qu'il a copié, sa version (D20). */
let token: { id: string; role: string; sessionVersion: number } | null = null;

mock.module("next-auth", {
  exports: {
    getServerSession: async () =>
      token && {
        user: { id: token.id, name: "jeton", email: null, role: token.role, sessionVersion: token.sessionVersion },
        expires: "2099-01-01T00:00:00.000Z",
      },
  },
});
// La vraie route NextAuth charge Prisma et bcrypt : seul son authOptions
// intéresse lib/auth.ts.
mock.module("@/app/api/auth/[...nextauth]/route", {
  exports: { authOptions: { marker: "authOptions" } },
});

/** `redirect` de Next lève ; ce faux lève une erreur qui porte la destination. */
class Redirected extends Error {
  constructor(public readonly url: string) {
    super(`redirection vers ${url}`);
  }
}
mock.module("next/navigation", {
  exports: {
    redirect: (url: string) => {
      throw new Redirected(url);
    },
  },
});

const db = installFakePrisma();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

let HelpPage: () => Promise<ReactElement>;
let guides: typeof import("../app/help/guides");

before(async () => {
  ({ default: HelpPage } = (await import("../app/help/page")) as unknown as { default: () => Promise<ReactElement> });
  guides = await import("../app/help/guides");
});

/** Le compte en base, tel que lib/auth.ts le relit. */
function account(role: string, status = "ACTIVE") {
  return {
    username: null,
    email: "camille.martin@em-normandie.fr",
    display_name: "Camille Martin",
    role,
    status,
    session_version: 0,
  };
}

/** Le jeton dit `tokenRole`, la base `dbRole` ; rend le HTML de la page. */
async function page(tokenRole: string, dbRole: string, status = "ACTIVE"): Promise<string> {
  token = { id: "u-camille", role: tokenRole, sessionVersion: 0 };
  db.use({ user: { findUnique: () => account(dbRole, status) } });
  return renderToStaticMarkup(await HelpPage());
}

/** Les guides rendus, dans l'ordre de la page. */
const shownGuides = (html: string) => [...html.matchAll(/<section [^>]*id="guide-(\w+)"/g)].map((m) => m[1]);

// ─── Qui voit quoi ──────────────────────────────────────────────────────────

test("guideFor : un guide par rôle, et chaque rôle le sien", () => {
  assert.deepEqual(
    USER_ROLES.map((role) => [role, guides.guideFor(role).id]),
    [
      ["USER", "user"],
      ["GESTIONNAIRE", "manager"],
      ["ADMIN", "admin"],
    ],
  );
  assert.deepEqual(
    guides.HELP_GUIDES.map((guide) => guide.role),
    [...USER_ROLES],
    "un guide par rôle, ni plus ni moins",
  );
});

test("un USER ne voit ni le guide du gestionnaire ni celui de l'admin", async () => {
  const html = await page("USER", "USER");
  assert.deepEqual(shownGuides(html), ["user"]);
  for (const guide of guides.HELP_GUIDES.filter((g) => g.id !== "user")) {
    assert.doesNotMatch(html, new RegExp(`id="${guide.id}-`), guide.id);
    for (const section of guide.sections) assert.doesNotMatch(html, new RegExp(`href="#${guide.id}-${section.id}"`), section.id);
  }
  // Ni le back-office, ni ses écrans, ni l'IA : rien qui ne serve qu'aux autres rôles.
  for (const text of ["Back-office", "Validation Inbox", "Comptes", "Signalements", "/admin/", "Tavily"]) {
    assert.equal(html.includes(text), false, text);
  }
});

test("un gestionnaire ne voit que le guide du gestionnaire, un admin que celui de l'admin", async () => {
  const manager = await page("GESTIONNAIRE", "GESTIONNAIRE");
  assert.deepEqual(shownGuides(manager), ["manager"]);
  for (const text of ["Validation Inbox", "Tavily", 'id="user-', 'id="admin-']) assert.equal(manager.includes(text), false, text);
  const admin = await page("ADMIN", "ADMIN");
  assert.deepEqual(shownGuides(admin), ["admin"]);
  for (const text of ['id="user-', 'id="manager-']) assert.equal(admin.includes(text), false, text);
});

test("D119 : la page nomme l'application une fois, en tête ; le guide dit « le site »", async () => {
  for (const role of ["USER", "GESTIONNAIRE", "ADMIN"]) {
    // Après la barre, qui porte aussi le nom (test/app-name.test.ts).
    const body = (await page(role, role)).split("<h1")[1];
    assert.equal(body.split(APP_NAME).length - 1, 1, role);
    assert.match(body, new RegExp(`Le guide de ${APP_NAME} pour votre rôle : <strong[^>]*>`), role);
  }
});

test("D1 : le rôle de la base compte, jamais celui du jeton", async () => {
  // Un admin rétrogradé en USER depuis sa connexion : le guide de l'utilisateur.
  assert.deepEqual(shownGuides(await page("ADMIN", "USER")), ["user"]);
  assert.deepEqual(shownGuides(await page("GESTIONNAIRE", "USER")), ["user"]);
  // Un USER promu depuis sa connexion : le guide de son nouveau rôle, sans se reconnecter.
  assert.deepEqual(shownGuides(await page("USER", "GESTIONNAIRE")), ["manager"]);
  assert.deepEqual(shownGuides(await page("USER", "ADMIN")), ["admin"]);
  assert.deepEqual(shownGuides(await page("ADMIN", "GESTIONNAIRE")), ["manager"]);
  // Un rôle inconnu en base ne vaut que USER.
  assert.deepEqual(shownGuides(await page("ADMIN", "MODERATOR")), ["user"]);
});

test("sans session, ou un compte qui n'est plus actif : vers la connexion, aucun guide rendu", async () => {
  token = null;
  db.use({ user: { findUnique: () => account("ADMIN") } });
  await assert.rejects(HelpPage(), (error) => error instanceof Redirected && error.url === "/admin/login");
  for (const status of ["INVITED", "DISABLED"]) {
    await assert.rejects(page("ADMIN", "ADMIN", status), (error) => error instanceof Redirected && error.url === "/admin/login", status);
  }
});

test("le sommaire renvoie à chaque section du guide affiché, et chaque ancre existe une fois", async () => {
  for (const role of USER_ROLES) {
    const html = await page(role, role);
    const sommaire = html.match(/<nav aria-label="Sommaire de l&#x27;aide"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(sommaire, "un sommaire nommé");
    const links = [...sommaire[1].matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
    const guide = guides.guideFor(role);
    const expected = guide.sections.map((s) => `${guide.id}-${s.id}`);
    assert.deepEqual(links, expected, role);
    for (const anchor of [`guide-${guide.id}`, ...expected]) assert.equal(html.split(`id="${anchor}"`).length - 1, 1, anchor);
  }
});

test("la page : requirePage(\"signedIn\"), le rôle de sa session pour le guide et la barre, rien d'autre de la session", () => {
  const source = code(PAGE);
  assert.match(source, /const \{ user \} = await requirePage\("signedIn"\);/);
  assert.match(source, /guideFor\(user\.role\)/);
  assert.match(source, /<SiteShell current="help" showBackOffice=\{hasAccess\(user\.role, "manager"\)\}/);
  for (const file of [PAGE, GUIDES]) {
    assert.equal(/getServerSession|\bgetSession\b|useSession|next-auth/.test(code(file)), false, file);
  }
  assert.match(source, /export const metadata: Metadata = \{ title: "Aide" \};/);
});

// ─── Les captures (D111) ────────────────────────────────────────────────────

/** Les captures rendues par une page, dans l'ordre. */
const shownCaptures = (html: string) => [...html.matchAll(/<img [^>]*src="\/help\/([\w-]+)\.png"/g)].map((m) => m[1]);

test("D111 : chaque capture existe sous public/help, à ses dimensions, avec un texte de remplacement", async () => {
  const names = Object.keys(guides.CAPTURES);
  assert.deepEqual(readdirSync("public/help").sort(), names.map((name) => `${name}.png`).sort(), "ni capture orpheline ni fichier absent");
  for (const [name, capture] of Object.entries(guides.CAPTURES)) {
    const png = readFileSync(`public/help/${name}.png`);
    assert.equal(png.toString("latin1", 1, 4), "PNG", name);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [capture.width, capture.height], name);
    assert.ok(capture.alt.length >= 30, `${name} : un texte de remplacement qui décrit l'écran`);
    assert.match(name, /^(user|manager|admin)-/, "préfixée par le guide qui la montre");
  }
  const shown: string[] = [];
  for (const role of USER_ROLES) {
    const html = await page(role, role);
    shown.push(...shownCaptures(html));
    for (const tag of html.match(/<img [^>]*>/g) ?? []) assert.match(tag, /alt="[^"]{30,}"/, tag);
  }
  assert.deepEqual([...shown].sort(), [...names].sort(), "chaque capture une fois, d'un rôle à l'autre");
});

test("D111 : chacun ne voit que les captures du guide de son rôle", async () => {
  for (const [role, prefix] of [
    ["USER", "user-"],
    ["GESTIONNAIRE", "manager-"],
    ["ADMIN", "admin-"],
  ]) {
    const shown = shownCaptures(await page(role, role));
    assert.ok(shown.length > 0, role);
    for (const name of shown) assert.ok(name.startsWith(prefix), `${role} : ${name}`);
  }
});

// ─── Le texte dit vrai ──────────────────────────────────────────────────────

/** Les sources des écrans, hors de la page d'aide : où un libellé cité doit exister. */
function screensCorpus(): string {
  const files: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const rel of readdirSync(dir, { recursive: true, encoding: "utf-8" })) {
      const file = join(dir, rel).replace(/\\/g, "/");
      if (/\.tsx?$/.test(file) && !file.startsWith("app/help/")) files.push(file);
    }
  }
  return files
    .map((file) => read(file))
    .join("\n")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/** Les libellés que le guide cite : le texte de chaque `<Ui>…</Ui>`. */
function citedLabels(): string[] {
  return [...code(GUIDES).matchAll(/<Ui>([^<{}]+)<\/Ui>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/\s+/g, " ").trim());
}

test("chaque libellé que le guide cite existe, mot pour mot, dans le code des écrans", () => {
  const corpus = screensCorpus();
  const labels = citedLabels();
  assert.ok(labels.length >= 60, `${labels.length} libellés cités`);
  const missing = [...new Set(labels)].filter((label) => !corpus.includes(label));
  assert.deepEqual(missing, []);
  // Les noms de la barre et du menu, tels que l'interface les écrit.
  for (const label of ["Écoles", "API", "Back-office", "Aide", "Mon compte", "Écoles & Campus", "Signalements", "Validation Inbox", "Comptes", "Signaler une information"]) {
    assert.ok(labels.includes(label), label);
  }
});

test("aucune fonction disparue, aucune commande, aucun secret (D114)", () => {
  const text = code(GUIDES) + code(PAGE);
  for (const gone of ["/contribute", "/admin/cron", "MODERATOR", "Monitoring", "Modérateur", "Contribuer"]) {
    assert.equal(text.includes(gone), false, gone);
  }
  for (const forbidden of ["npm ", "uvicorn", "git ", "FASTAPI_URL", "INTERNAL_API_TOKEN", "API_KEY", ".env", "DATABASE_URL"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("D114 : le guide de l'admin dit où vit la console IA et que la lancer paie ; les autres n'en parlent pas", async () => {
  const admin = guides.HELP_GUIDES.find((guide) => guide.id === "admin");
  assert.ok(admin);
  const ia = renderToStaticMarkup(admin.sections.find((section) => section.id === "ia")!.body as ReactElement);
  for (const text of ["branche", "local", "poste", "Tavily", "Gemini", "accord du propriétaire"]) assert.ok(ia.includes(text), text);
  const others = await page("GESTIONNAIRE", "GESTIONNAIRE");
  for (const text of ["Tavily", "Gemini", "branche"]) assert.equal(others.includes(text), false, text);
});

test("D124 : le guide du gestionnaire dit comment revenir au site depuis le back-office", () => {
  const manager = guides.HELP_GUIDES.find((guide) => guide.id === "manager");
  assert.ok(manager);
  const backOffice = renderToStaticMarkup(manager.sections.find((section) => section.id === "back-office")!.body as ReactElement);
  // L'entrée du pied du menu, citée comme un libellé (relu contre le code des écrans), et le nom en haut du menu.
  assert.ok(citedLabels().includes("Voir le site"), "« Voir le site » cité");
  assert.match(backOffice, /Voir le site/);
  assert.match(backOffice, /nom du site, en haut du menu/);
});
