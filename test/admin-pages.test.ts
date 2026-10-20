/**
 * test/admin-pages.test.ts — Les écrans du back-office contrôlent le rôle côté serveur
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 1 (piège 2) : un USER ne voit pas /admin, un
 * gestionnaire ne voit ni l'IA (inbox, cron) ni les comptes. Le contrôle se
 * fait côté serveur, par `requirePage` de lib/auth.ts (testée dans
 * test/auth.test.ts), pas seulement en masquant des liens.
 *
 * Analyse statique : chaque fichier qui porte un contrôle l'appelle avec le
 * bon niveau, en tête, avec `await`. Toute page ajoutée sous app/admin doit
 * être rangée ici (le test énumère les pages). Les écrans sont des coquilles :
 * leurs données viennent d'API gardées (test/api/access-matrix.test.ts).
 *
 * Le menu (app/admin/nav.ts) ne montre que ce que le rôle permet, et chaque
 * entrée a le niveau de l'écran qu'elle ouvre.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ADMIN_NAV, navFor } from "../app/admin/nav";
import type { AccessLevel } from "../lib/roles";

const ADMIN_DIR = path.join(process.cwd(), "app", "admin");

/** Le contrôle de chaque zone : fichier → niveau exigé. */
const CHECKS: Record<string, AccessLevel> = {
  "layout.tsx": "manager",
  "inbox/layout.tsx": "admin",
  "cron/page.tsx": "admin",
  "users/page.tsx": "admin",
};

/** Le niveau de chaque page, d'après le contrôle le plus proche. */
const PAGE_LEVEL: Record<string, AccessLevel> = {
  "schools/page.tsx": "manager",
  "schools/[id]/manage/page.tsx": "manager",
  "schools/[id]/campuses/page.tsx": "manager",
  // Étape 6 (D31) : les signalements, à part de l'inbox.
  "reports/page.tsx": "manager",
  "inbox/page.tsx": "admin",
  "cron/page.tsx": "admin",
  "users/page.tsx": "admin",
};

const read = (rel: string) => fs.readFileSync(path.join(ADMIN_DIR, rel), "utf-8");

function adminFiles(name: string): string[] {
  return fs
    .readdirSync(ADMIN_DIR, { recursive: true, encoding: "utf-8" })
    .filter((rel) => path.basename(rel) === name)
    .map((rel) => rel.split(path.sep).join("/"))
    .sort();
}

test("chaque contrôle attend requirePage avec son niveau, importée de @/lib/auth", () => {
  for (const [rel, level] of Object.entries(CHECKS)) {
    const text = read(rel);
    assert.match(text, /import \{[^}]*\brequirePage\b[^}]*\} from "@\/lib\/auth";/, rel);
    const calls = [...text.matchAll(/await requirePage\("(\w+)"\)/g)].map((m) => m[1]);
    assert.deepEqual(calls, [level], rel);
  }
});

test("aucun écran du back-office ne lit la session à côté de requirePage", () => {
  for (const rel of [...adminFiles("page.tsx"), ...adminFiles("layout.tsx")]) {
    const text = read(rel);
    assert.equal(/getServerSession|\bgetSession\b|useSession/.test(text), false, rel);
  }
});

test("chaque page du back-office a un niveau connu, et ses contrôles l'imposent", () => {
  assert.deepEqual(adminFiles("page.tsx"), Object.keys(PAGE_LEVEL).sort());
  assert.deepEqual(adminFiles("layout.tsx"), ["inbox/layout.tsx", "layout.tsx"]);

  for (const [page, level] of Object.entries(PAGE_LEVEL)) {
    // Le contrôle le plus proche : la page elle-même, puis les layouts en remontant.
    const dir = path.posix.dirname(page);
    const candidates = [page];
    for (let d = dir; d !== "."; d = path.posix.dirname(d)) candidates.push(`${d}/layout.tsx`);
    candidates.push("layout.tsx");
    const nearest = candidates.find((c) => c in CHECKS);
    assert.ok(nearest, page);
    assert.equal(CHECKS[nearest!], level, `${page} (contrôlée par ${nearest})`);
  }
});

test("le menu : un gestionnaire ne voit que les écoles et les signalements ; un admin voit tout", () => {
  assert.deepEqual(navFor("USER").map((i) => i.href), []);
  assert.deepEqual(navFor("GESTIONNAIRE").map((i) => i.href), ["/admin/schools", "/admin/reports"]);
  assert.deepEqual(navFor("ADMIN").map((i) => i.href), [
    "/admin/schools",
    "/admin/reports",
    "/admin/inbox",
    "/admin/cron",
    "/admin/users",
  ]);
});

test("chaque entrée du menu a le niveau de l'écran qu'elle ouvre", () => {
  for (const item of ADMIN_NAV) {
    const page = `${item.href.replace(/^\/admin\//, "")}/page.tsx`;
    assert.equal(item.level, PAGE_LEVEL[page], item.href);
  }
});

test("le menu passe par navFor, pas par une condition sur le rôle", () => {
  const sidebar = read("SidebarClient.tsx");
  assert.match(sidebar, /navFor\(/);
  assert.equal(/role\s*===\s*"ADMIN"/.test(sidebar), false);
});

test("« Mon compte » (app/account, étape 2) : toute session, par requirePage, et rien d'autre", () => {
  // Hors du back-office : un USER doit pouvoir y changer son mot de passe et son nom.
  const text = fs.readFileSync(path.join(process.cwd(), "app", "account", "page.tsx"), "utf-8");
  assert.match(text, /import \{[^}]*\brequirePage\b[^}]*\} from "@\/lib\/auth";/);
  assert.deepEqual([...text.matchAll(/await requirePage\("(\w+)"\)/g)].map((m) => m[1]), ["signedIn"]);
  assert.equal(/getServerSession|\bgetSession\b|useSession/.test(text), false);
});
