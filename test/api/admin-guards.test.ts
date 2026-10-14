/**
 * test/api/admin-guards.test.ts — Chaque route admin choisit sa garde
 *
 *     npm run test:ts
 *
 * Analyse statique, sans mock : chaque `app/api/admin/**\/route.ts` est lu par
 * le compilateur TypeScript. Le test vérifie que :
 * - chaque handler exporté (GET, POST, PUT, PATCH, DELETE) attend
 *   `guardAuth()` ou `guardAdmin()`, importés de `@/lib/auth`. Une garde
 *   appelée sans `await` rend une promesse dont `error` vaut `undefined` :
 *   la route s'ouvrirait à tous ;
 * - aucun fichier ne touche `getServerSession` ;
 * - les handlers sous `guardAdmin` sont exactement la liste ADMIN
 *   d'architecture.md §3.6.
 *
 * Les fichiers sont énumérés : une nouvelle route est couverte d'office.
 * Règle : README, *Sécurité* ; architecture.md §3.6.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ADMIN_ROOT = path.join(process.cwd(), "app", "api", "admin");
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const GUARDS = new Set(["guardAuth", "guardAdmin"]);

/**
 * Handlers réservés à ADMIN (architecture.md §3.6), sous la forme
 * « MÉTHODE chemin sous app/api/admin ». Toute modification se reporte aussi
 * dans le tableau de §3.6.
 */
const ADMIN_ONLY = [
  "DELETE schools/[id]",
  "DELETE campuses/[id]",
  "DELETE programs/[id]",
  "POST schools",
  "DELETE inbox/purge",
  "POST trigger-research",
  "POST run-due-passes",
  "GET users",
  "POST users",
  "DELETE users/[id]",
];

interface HandlerInfo {
  method: string;
  /** Gardes attendues (`await guardX()`) directement dans le corps du handler. */
  guards: string[];
}

interface RouteAnalysis {
  handlers: HandlerInfo[];
  /** Noms importés de `@/lib/auth`. */
  authImports: string[];
  /** Formes que l'analyse refuse, pour qu'elles ne passent pas en silence. */
  problems: string[];
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * Gardes attendues dans `body`, sans descendre dans les fonctions imbriquées :
 * une garde appelée dans un rappel ne protège pas le handler.
 */
function awaitedGuards(body: ts.Node | undefined): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node)) {
      let inner: ts.Expression = node.expression;
      while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
      if (
        ts.isCallExpression(inner) &&
        ts.isIdentifier(inner.expression) &&
        GUARDS.has(inner.expression.text)
      ) {
        found.push(inner.expression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (body) ts.forEachChild(body, visit);
  return found;
}

function analyzeRoute(fileName: string, text: string): RouteAnalysis {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const result: RouteAnalysis = { handlers: [], authImports: [], problems: [] };

  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const from = (stmt.moduleSpecifier as ts.StringLiteral).text;
      const bindings = stmt.importClause?.namedBindings;
      if (from === "@/lib/auth" && bindings && ts.isNamedImports(bindings)) {
        result.authImports.push(...bindings.elements.map((e) => e.name.text));
      }
    } else if (ts.isFunctionDeclaration(stmt) && isExported(stmt) && stmt.name) {
      if (METHODS.has(stmt.name.text)) {
        result.handlers.push({ method: stmt.name.text, guards: awaitedGuards(stmt.body) });
      }
    } else if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !METHODS.has(decl.name.text)) continue;
        const init = decl.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          result.handlers.push({ method: decl.name.text, guards: awaitedGuards(init.body) });
        } else {
          result.problems.push(
            `${decl.name.text} n'est pas une fonction écrite sur place : forme non analysée`
          );
        }
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        if (METHODS.has(el.name.text)) {
          result.problems.push(
            `${el.name.text} exporté par \`export { … }\` : forme non analysée, ` +
              `écrire \`export async function ${el.name.text}\``
          );
        }
      }
    }
  }
  return result;
}

/** Défauts d'une route : handler sans garde attendue, garde venue d'ailleurs, getServerSession. */
function routeDefects(fileName: string, text: string): string[] {
  const analysis = analyzeRoute(fileName, text);
  const defects = [...analysis.problems];
  if (analysis.handlers.length === 0 && analysis.problems.length === 0) {
    defects.push("aucun handler exporté trouvé");
  }
  for (const handler of analysis.handlers) {
    if (handler.guards.length === 0) {
      defects.push(`${handler.method} n'attend ni guardAuth() ni guardAdmin()`);
    }
    for (const guard of handler.guards) {
      if (!analysis.authImports.includes(guard)) {
        defects.push(`${handler.method} : ${guard} ne vient pas de @/lib/auth`);
      }
    }
  }
  if (text.includes("getServerSession")) {
    defects.push("touche getServerSession : passer par guardAuth ou guardAdmin");
  }
  return defects;
}

/** Chemins des route.ts sous app/api/admin, en `/`, relatifs et triés. */
function adminRouteFiles(): string[] {
  return fs
    .readdirSync(ADMIN_ROOT, { recursive: true, encoding: "utf-8" })
    .filter((rel) => path.basename(rel) === "route.ts")
    .map((rel) => rel.split(path.sep).join("/"))
    .sort();
}

const routeKey = (rel: string) => path.posix.dirname(rel);
const readRoute = (rel: string) => fs.readFileSync(path.join(ADMIN_ROOT, rel), "utf-8");

test("l'analyse repère les handlers mal gardés", () => {
  const source = `
    import { guardAuth } from "@/lib/auth";
    import { getServerSession } from "next-auth";
    async function guardAdmin() { return { error: null }; }
    export async function GET() { const { error } = await guardAuth(); if (error) return error; }
    export async function POST() { const { error } = guardAuth(); if (error) return error; }
    export async function PUT() { return [1].map(async () => await guardAuth()); }
    export async function PATCH() { await guardAdmin(); }
    async function remove() { await guardAuth(); }
    export { remove as DELETE };
  `;

  assert.deepEqual(routeDefects("synthetique.ts", source), [
    "DELETE exporté par `export { … }` : forme non analysée, écrire `export async function DELETE`",
    "POST n'attend ni guardAuth() ni guardAdmin()",
    "PUT n'attend ni guardAuth() ni guardAdmin()",
    "PATCH : guardAdmin ne vient pas de @/lib/auth",
    "touche getServerSession : passer par guardAuth ou guardAdmin",
  ]);
});

test("l'énumération descend dans tous les sous-dossiers", () => {
  const files = adminRouteFiles();
  assert.ok(files.includes("inbox/route.ts"));
  assert.ok(files.includes("schools/[id]/stats/[recordId]/route.ts"));
});

test("chaque handler admin attend guardAuth() ou guardAdmin(), sans getServerSession", () => {
  const defects = adminRouteFiles().flatMap((rel) =>
    routeDefects(rel, readRoute(rel)).map((d) => `${rel} : ${d}`)
  );
  assert.deepEqual(defects, []);
});

test("les handlers sous guardAdmin sont exactement la liste ADMIN d'architecture.md §3.6", () => {
  const underAdmin = adminRouteFiles().flatMap((rel) =>
    analyzeRoute(rel, readRoute(rel))
      .handlers.filter((h) => h.guards.includes("guardAdmin"))
      .map((h) => `${h.method} ${routeKey(rel)}`)
  );
  assert.deepEqual(
    underAdmin.sort(),
    [...ADMIN_ONLY].sort(),
    "Écart entre le code et architecture.md §3.6 : mettre à jour la route, " +
      "le tableau de §3.6 et ADMIN_ONLY ensemble."
  );
});
