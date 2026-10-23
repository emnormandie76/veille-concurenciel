/**
 * test/page-titles.test.ts — Le nom du site n'apparaît qu'une fois dans le titre
 *
 *     npm run test:ts
 *
 * `app/layout.tsx` ajoute « — » et le nom de l'application (`lib/app-name.ts`,
 * D119) à tout titre de page par son modèle (`title.template`, voir
 * node_modules/next/dist/docs, generateMetadata). Jusqu'au 15 octobre 2026,
 * les fiches école et programme l'ajoutaient aussi : « EM Strasbourg — <nom>
 * — <nom> » (relevé par le smoke de l'étape 8 du plan backend-local).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { APP_NAME } from "../lib/app-name";

const layout = readFileSync("app/layout.tsx", "utf8");
const suffix = ` — ${APP_NAME}`;

const pages = (readdirSync("app", { recursive: true }) as string[])
  .filter((file) => /(^|[\\/])page\.tsx$/.test(file))
  .map((file) => join("app", file));

test("le modèle de titre du layout ajoute le nom du site", () => {
  assert.ok(layout.includes("template: `%s — ${APP_NAME}`,"), "title.template introuvable dans app/layout.tsx");
  assert.ok(pages.length > 0);
});

test("les pages du site à titre fixe : « Mon compte », « Signaler une information », « Aide » (étape 14)", () => {
  const titles: Record<string, string> = {
    "app/account/page.tsx": "Mon compte",
    "app/schools/[id]/report/page.tsx": "Signaler une information",
    "app/help/page.tsx": "Aide",
  };
  for (const [page, title] of Object.entries(titles)) {
    assert.ok(pages.includes(join(...page.split("/"))), page);
    assert.match(readFileSync(page, "utf8"), new RegExp(`export const metadata: Metadata = \\{ title: "${title}" \\};`), page);
  }
});

test("aucune page n'ajoute elle-même le suffixe du modèle", () => {
  for (const page of pages) {
    const source = readFileSync(page, "utf8");
    for (const [, literal] of source.matchAll(/title:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)) {
      const title = literal.slice(1, -1);
      assert.ok(!title.endsWith(suffix) && !title.endsWith("${APP_NAME}"), `${page} : ${literal}`);
    }
  }
});
