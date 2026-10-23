/**
 * test/app-name.test.ts — Le nom de l'application, en un seul endroit
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 15, D119 : « Veille concurrentielle » remplace
 * les deux noms que montrait l'écran, « EduData France » (la barre du site,
 * le titre des onglets, la doc de l'API) et « School Data Pipeline » (la
 * connexion, le menu du back-office). Le nom vit dans `lib/app-name.ts` : le
 * changer, c'est changer cette ligne, puis les captures et les Word du guide
 * (D112), qui le montrent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SiteShell } from "../components/layout/SiteShell";
import { APP_NAME } from "../lib/app-name";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");

const SOURCES = ["app", "components", "lib"].flatMap((dir) =>
  (readdirSync(dir, { recursive: true }) as string[])
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => join(dir, file)),
);
const HOME = join("lib", "app-name.ts");

/** Les écrans qui montrent le nom : la barre, le menu, la connexion, les onglets, la doc de l'API, l'aide. */
const SHOWN_BY = [
  "components/layout/SiteShell.tsx",
  "app/admin/SidebarClient.tsx",
  "app/(admin-auth)/admin/login/page.tsx",
  "app/layout.tsx",
  "app/api-docs/endpoints.ts",
  "app/help/page.tsx",
];

test("le nom : « Veille concurrentielle »", () => {
  assert.equal(APP_NAME, "Veille concurrentielle");
});

test("les anciens noms ont disparu du code et de la configuration", () => {
  for (const file of [...SOURCES, "next.config.ts", "package.json"]) {
    assert.doesNotMatch(read(file), /EduData|School Data Pipeline|school-data-pipeline/i, file);
  }
});

test("le nom ne s'écrit qu'une fois, dans lib/app-name.ts : les écrans l'importent", () => {
  assert.ok(SOURCES.includes(HOME));
  for (const file of SOURCES.filter((file) => file !== HOME)) {
    assert.equal(read(file).includes(APP_NAME), false, `${file} écrit le nom en clair`);
  }
  for (const file of SHOWN_BY) {
    assert.match(read(file), /import \{[^}]*\bAPP_NAME\b[^}]*\} from "@\/lib\/app-name";/, file);
  }
  // Un module sans dépendance : la connexion et le menu, composants client, l'importent.
  assert.doesNotMatch(read(HOME), /^import /m);
});

test("la barre du site porte le nom, en lien vers l'accueil", () => {
  const out = renderToStaticMarkup(h(SiteShell, { current: "schools", showBackOffice: false, children: "contenu" }));
  assert.match(out, new RegExp(`<a [^>]*href="/"[^>]*>${APP_NAME}</a>`));
});

test("la connexion porte le nom en titre", () => {
  assert.match(read("app/(admin-auth)/admin/login/page.tsx"), /title=\{APP_NAME\}/);
});

test("le titre des onglets : le nom seul par défaut, en suffixe sinon ; le nom du site pour les aperçus", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /default: APP_NAME,/);
  assert.match(layout, /template: `%s — \$\{APP_NAME\}`,/);
  assert.match(layout, /siteName: APP_NAME,/);
});
