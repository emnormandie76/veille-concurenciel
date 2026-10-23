/**
 * test/page-titles.test.ts — Le nom du site n'apparaît qu'une fois dans le titre
 *
 *     npm run test:ts
 *
 * `app/layout.tsx` ajoute « — EduData France » à tout titre de page par son
 * modèle (`title.template`, voir node_modules/next/dist/docs, generateMetadata).
 * Jusqu'au 15 octobre 2026, les fiches école et programme l'ajoutaient aussi :
 * « EM Strasbourg — EduData France — EduData France » (relevé par le smoke de
 * l'étape 8 du plan backend-local).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const layout = readFileSync("app/layout.tsx", "utf8");
const template = layout.match(/template:\s*"%s([^"]+)"/);

const pages = (readdirSync("app", { recursive: true }) as string[])
  .filter((file) => /(^|[\\/])page\.tsx$/.test(file))
  .map((file) => join("app", file));

test("le modèle de titre du layout ajoute le nom du site", () => {
  assert.ok(template, "title.template introuvable dans app/layout.tsx");
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
  const suffix = template![1];
  for (const page of pages) {
    const source = readFileSync(page, "utf8");
    for (const [, literal] of source.matchAll(/title:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)) {
      assert.ok(!literal.slice(1, -1).endsWith(suffix), `${page} : ${literal}`);
    }
  }
});
