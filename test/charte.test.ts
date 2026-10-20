/**
 * test/charte.test.ts — La charte graphique tient ses promesses (étape 4 du plan gestion-contenu)
 *
 *     npm run test:ts
 *
 * Jusqu'à l'étape 9, l'ancien style et la charte cohabitent (plan, G7 et
 * piège 10 ; docs/architecture/charte-graphique.md §9). Ce que ce test garde :
 *
 * - **les couches** : aucun style hors couche dans app/globals.css ni dans
 *   app/charte.css ; l'ancien CSS dans `legacy`, sous `base` et `utilities` ;
 *   pas de preflight, même par l'import complet de Tailwind ;
 * - **les sources** : Tailwind ne lit que les dossiers (ou les fichiers) des
 *   écrans repris, et chaque fichier qui emploie la charte est dans l'un
 *   d'eux ; aucun utilitaire généré ne porte le nom d'une classe des anciens
 *   écrans ;
 * - **les écrans repris** : aucune classe de l'ancien CSS, aucun `style` en
 *   ligne, un gabarit, aucun émoji (étape 9, D56) ;
 * - **la référence** : les jetons de app/charte.css et leurs valeurs sont ceux
 *   du §2 de la charte, et chaque contraste du §3 est juste et tient son seuil.
 *
 * La compilation passe par PostCSS et @tailwindcss/postcss, comme dans
 * `next build` ; elle ne touche pas le réseau.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";

import postcss, { type AtRule, type Root } from "postcss";
import tailwind from "@tailwindcss/postcss";

const GLOBALS = "app/globals.css";
const CHARTE = "app/charte.css";
const DOC = "docs/architecture/charte-graphique.md";
const LAYER_ORDER = "theme, legacy, base, components, utilities";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r/g, "");
const posix = (path: string) => path.split(sep).join("/");

function filesUnder(dir: string, pattern: RegExp): string[] {
  if (statSync(dir).isFile()) return pattern.test(dir) ? [posix(dir)] : [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, pattern));
    else if (pattern.test(entry)) out.push(posix(path));
  }
  return out;
}

// ─── Les sources déclarées ──────────────────────────────────────────────────

/** Les dossiers lus par Tailwind, relatifs à la racine du dépôt ; un fichier
 * seul pour l'accueil (`app/page.tsx`, étape 9), dont le dossier est `app/`. */
const sourceDirs = [...read(GLOBALS).matchAll(/^@source "([^"]+)";/gm)].map((m) => posix(join(dirname(GLOBALS), m[1])));
const inSources = (file: string) => sourceDirs.some((dir) => file === dir || file.startsWith(`${dir}/`));

// ─── Les noms de classe d'un fichier .tsx ───────────────────────────────────

/** Le texte de chaque valeur `className=…` : une chaîne, ou l'expression entre accolades. */
function classNameExpressions(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/className=/g)) {
    let i = match.index! + "className=".length;
    if (source[i] === '"') {
      out.push(source.slice(i, source.indexOf('"', i + 1) + 1));
      continue;
    }
    if (source[i] !== "{") continue;
    const start = i;
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) break;
    }
    out.push(source.slice(start, i + 1));
  }
  return out;
}

/** Les mots des chaînes d'une expression `className`, y compris dans un gabarit `${…}`. */
function classTokens(source: string): Set<string> {
  const tokens = new Set<string>();
  for (const expression of classNameExpressions(source)) {
    const literals = [
      ...[...expression.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]),
      ...[...expression.matchAll(/`([^`]*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, " ")),
    ];
    for (const literal of literals) for (const token of literal.split(/\s+/)) if (token) tokens.add(token);
  }
  return tokens;
}

/** Les classes que l'ancien CSS nomme : globals.css (couche legacy) et les blocs styled-jsx. */
function legacyCssClasses(): Set<string> {
  const css = [read(GLOBALS).split("@layer legacy {")[1] ?? ""];
  for (const file of filesUnder("app", /\.tsx$/)) {
    for (const block of read(file).matchAll(/<style jsx>\{`([\s\S]*?)`\}<\/style>/g)) css.push(block[1]);
  }
  const classes = new Set<string>();
  for (const text of css) for (const m of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(m[1]);
  return classes;
}

// ─── La compilation ─────────────────────────────────────────────────────────

let compiled = "";
let generatedClasses = new Set<string>();

/** Les noms de classe des sélecteurs de la couche `utilities` (sans échappement ni pseudo-classe). */
function utilityClasses(css: string): Set<string> {
  const classes = new Set<string>();
  postcss.parse(css).walkAtRules("layer", (layer) => {
    if (layer.params !== "utilities") return;
    layer.walkRules((rule) => {
      for (const m of rule.selector.matchAll(/\.((?:\\.|[\w-])+)/g)) classes.add(m[1].replace(/\\(.)/g, "$1"));
    });
  });
  return classes;
}

before(async () => {
  const result = await postcss([tailwind()]).process(read(GLOBALS), { from: GLOBALS });
  compiled = result.css;
  generatedClasses = utilityClasses(compiled);
});

// ─── Couches ────────────────────────────────────────────────────────────────

/** Les nœuds de premier niveau qui sont des règles de style, hors de toute couche. */
function unlayeredRules(root: Root): string[] {
  return root.nodes.filter((node) => node.type === "rule").map((node) => (node as { selector: string }).selector);
}

test("app/globals.css : l'ordre des couches d'abord, le thème et les utilitaires seulement, l'ancien CSS dans legacy", () => {
  const root = postcss.parse(read(GLOBALS));
  assert.deepEqual(unlayeredRules(root), [], "aucune règle hors couche");
  const atRules = root.nodes.filter((node): node is AtRule => node.type === "atrule");
  assert.equal(atRules[0].name, "layer");
  assert.equal(atRules[0].params, LAYER_ORDER);
  assert.equal(atRules[0].nodes, undefined, "une déclaration d'ordre, pas un bloc");

  const imports = atRules.filter((rule) => rule.name === "import").map((rule) => rule.params);
  assert.deepEqual(imports, [
    '"tailwindcss/theme.css" layer(theme)',
    '"tailwindcss/utilities.css" layer(utilities) source(none)',
    '"./charte.css"',
  ]);

  const blocks = atRules.filter((rule) => rule.nodes !== undefined);
  assert.deepEqual(blocks.map((rule) => `${rule.name} ${rule.params}`), ["layer legacy"], "un seul bloc : l'ancien CSS");
  assert.match(blocks[0].toString(), /globals\.css — Design System & Dark Theme \(Étape 2\.1\)/, "l'ancien en-tête est dans la couche");
});

test("app/charte.css : tout est dans une couche ou dans @theme", () => {
  const root = postcss.parse(read(CHARTE));
  assert.deepEqual(unlayeredRules(root), []);
  const atRules = root.nodes.filter((node): node is AtRule => node.type === "atrule");
  for (const rule of atRules) assert.ok(rule.name === "theme" || (rule.name === "layer" && rule.params === "base"), `@${rule.name} ${rule.params}`);
});

test("le CSS compilé : pas de preflight, l'ordre des couches posé avant tout bloc", () => {
  assert.ok(compiled.length > 0);
  assert.doesNotMatch(compiled, /::file-selector-button/, "la remise à zéro de Tailwind (preflight) n'est pas là");
  const order = compiled.indexOf(`@layer ${LAYER_ORDER};`);
  assert.ok(order >= 0, "ordre des couches présent");
  const firstBlock = compiled.search(/@layer [\w-]+\s*\{/);
  assert.ok(order < firstBlock, "l'ordre précède le premier bloc");
  const properties = compiled.indexOf("@layer properties;");
  if (properties >= 0) assert.ok(properties < order, "la couche properties de Tailwind passe en premier, donc en dessous de tout");
  assert.match(compiled, /@layer legacy\s*\{[\s\S]*\.admin-layout-wrapper/);
});

// ─── Sources ────────────────────────────────────────────────────────────────

test("@source : chaque source déclarée existe, et components/ en fait partie", () => {
  assert.ok(sourceDirs.includes("components"));
  // Un dossier, ou un fichier .tsx (l'accueil, étape 9 : lire tout app/ ferait
  // générer les homonymes des classes des écrans pas encore repris).
  for (const dir of sourceDirs) {
    assert.ok(existsSync(dir), dir);
    assert.ok(statSync(dir).isDirectory() || (statSync(dir).isFile() && dir.endsWith(".tsx")), dir);
  }
  assert.match(read(GLOBALS), /^@source not inline\("block fill-accent"\);/m);
});

test("@source : tout fichier de app/ qui emploie la charte est lu par Tailwind", () => {
  const users = filesUnder("app", /\.tsx$/).filter((file) => /from "@\/components\//.test(read(file)));
  assert.ok(users.length >= 5, users.join(", "));
  for (const file of users) assert.ok(inSources(file), `${file} emploie la charte hors des @source de ${GLOBALS}`);
});

test("aucun utilitaire généré ne porte le nom d'une classe des anciens écrans", () => {
  const legacy = legacyCssClasses();
  for (const file of filesUnder("app", /\.tsx$/).filter((f) => !inSources(f))) for (const token of classTokens(read(file))) legacy.add(token);
  assert.ok(legacy.has("btn") && legacy.has("block") && legacy.has("fill-accent"), "le relevé voit les anciennes classes");
  assert.ok(generatedClasses.has("flex") && generatedClasses.has("bg-surface"), "le relevé voit les utilitaires");
  const collisions = [...generatedClasses].filter((name) => legacy.has(name));
  assert.deepEqual(collisions, [], "à exclure par @source not inline(…) dans app/globals.css");
});

// ─── Écrans repris ──────────────────────────────────────────────────────────

const SCREENS = [
  "app/(admin-auth)/admin/login/page.tsx",
  "app/(admin-auth)/admin/first-login/page.tsx",
  "app/admin/users/UsersManagerClient.tsx",
  "app/account/page.tsx",
  // Étape 6 (D33) : le formulaire de signalement et la vue des gestionnaires.
  "app/schools/[id]/report/page.tsx",
  "app/admin/reports/ReportsManagerClient.tsx",
  // Étape 9, lot 1 (D54) : le site public et /api-docs.
  "app/page.tsx",
  "app/schools/[id]/SchoolDetailClient.tsx",
  "app/schools/[id]/programs/[pid]/page.tsx",
  "app/api-docs/page.tsx",
];

/** Un émoji (présentation émoji, ou sélecteur de variante U+FE0F) ; les flèches
 * de texte (« → », « ↗ ») n'en sont pas. */
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/u;

test("les écrans repris : un gabarit, aucune classe de l'ancien CSS, aucun style en ligne, aucun émoji", () => {
  const legacy = legacyCssClasses();
  const files = sourceDirs.filter((dir) => dir.startsWith("app/")).flatMap((dir) => filesUnder(dir, /\.tsx$/));
  for (const screen of SCREENS) assert.ok(files.includes(screen), screen);
  for (const file of files) {
    const source = read(file);
    const old = [...classTokens(source)].filter((token) => legacy.has(token));
    assert.deepEqual(old, [], `${file} : classes de l'ancien CSS`);
    assert.doesNotMatch(source, /style=\{\{/, `${file} : style en ligne`);
    // D56 : les émojis décoratifs partent avec l'ancien style, les textes restent.
    assert.doesNotMatch(source, EMOJI, `${file} : émoji`);
  }
  for (const screen of SCREENS) assert.match(read(screen), /from "@\/components\/layout\/(AuthShell|AdminPage|SiteShell)"/, screen);
});

test("les gabarits : leur racine porte la classe charte", () => {
  for (const file of filesUnder("components/layout", /\.tsx$/)) {
    const roots = [...read(file).matchAll(/return \(\s*<(\w+) className="([^"]*)"/g)];
    assert.ok(roots.length > 0, file);
    for (const [, , classes] of roots) assert.match(classes, /^charte /, file);
  }
});

// ─── Jetons et contrastes : la référence dit vrai ──────────────────────────

function codeTokens(): Map<string, string> {
  return new Map([...read(CHARTE).matchAll(/--charte-([\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
}

/** Les lignes d'un tableau Markdown dont la première cellule est un jeton entre accents graves. */
function docRows(section: string): string[][] {
  const text = read(DOC);
  const start = text.indexOf(`\n## ${section}`);
  assert.ok(start >= 0, `section « ${section} » absente de ${DOC}`);
  const end = text.indexOf("\n## ", start + 1);
  return text
    .slice(start, end < 0 ? undefined : end)
    .split("\n")
    .filter((line) => /^\| `[\w-]+` \|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/`/g, "")));
}

test("§2 de la charte : les mêmes jetons, avec les mêmes valeurs, que app/charte.css", () => {
  const code = codeTokens();
  const doc = new Map(docRows("2. Couleurs").map(([name, value]) => [name, value]));
  assert.ok(code.size >= 20);
  assert.deepEqual([...doc.entries()].sort(), [...code.entries()].sort());
});

test("@theme : chaque jeton devient une couleur Tailwind, et seulement eux", () => {
  const theme = read(CHARTE).split("@theme inline {")[1].split("}")[0];
  const colors = [...theme.matchAll(/--color-([\w-]+): var\(--charte-([\w-]+)\);/g)];
  for (const [, color, token] of colors) assert.equal(color, token);
  assert.deepEqual(colors.map((m) => m[1]).sort(), [...codeTokens().keys()].sort());
  assert.match(theme, /--color-\*: initial;/);
  assert.match(theme, /--radius-\*: initial;/);
  assert.match(theme, /--font-\*: initial;/);
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("§3 de la charte : chaque contraste est juste et tient son seuil (WCAG 2.2 AA)", () => {
  const tokens = codeTokens();
  const rows = docRows("3. Contrastes");
  assert.ok(rows.length >= 25);
  for (const [fg, bg, written, threshold] of rows) {
    assert.ok(tokens.has(fg) && tokens.has(bg), `${fg} sur ${bg} : jeton inconnu`);
    const ratio = contrast(tokens.get(fg)!, tokens.get(bg)!);
    assert.equal(ratio.toFixed(1).replace(".", ","), written, `${fg} sur ${bg} : ${ratio.toFixed(2)}`);
    assert.ok(ratio >= Number(threshold.replace(",", ".")), `${fg} sur ${bg} : ${ratio.toFixed(2)} < ${threshold}`);
  }
  // Les couples qui portent le texte des écrans repris sont tous dans le tableau.
  const pairs = new Set(rows.map(([fg, bg]) => `${fg}/${bg}`));
  for (const pair of ["ink/surface", "ink-2/surface", "ink-3/surface", "accent-ink/accent", "danger/danger-soft", "line-strong/surface", "focus/surface"]) {
    assert.ok(pairs.has(pair), pair);
  }
});
