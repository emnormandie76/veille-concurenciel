/**
 * test/api/admin-guards.test.ts — Chaque route admin choisit sa garde
 *
 *     npm run test:ts
 *
 * Analyse statique, sans mock : chaque `app/api/admin/**\/route.ts` est lu par
 * le compilateur TypeScript. Le test vérifie que :
 * - chaque handler exporté (GET, POST, PUT, PATCH, DELETE) attend une seule
 *   garde, `guardSignedIn()`, `guardManager()` ou `guardAdmin()`, importée de
 *   `@/lib/auth`. Une garde appelée sans `await` rend une promesse dont
 *   `error` vaut `undefined` : la route s'ouvrirait à tous ;
 * - la garde de chaque handler est celle de son niveau dans
 *   test/helpers/access-policy.ts (plan gestion-contenu, étape 1) ;
 * - aucun fichier ne touche `getServerSession` ;
 * - l'ancienne garde `guardAuth` (« toute session ») n'existe plus nulle part
 *   (piège 1) : aucune route ne peut la garder par oubli.
 *
 * Les fichiers sont énumérés : une nouvelle route est couverte d'office, et
 * tombe en `guardManager` tant que la table ne dit pas autre chose.
 * Règle : README, *Sécurité* ; docs/architecture/gestion-contenu.md §4.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import {
  ADMIN_ROOT,
  GUARD_OF,
  adminRouteFiles,
  expectedLevel,
  routeKey,
} from "../helpers/access-policy";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const GUARDS = new Set(Object.values(GUARD_OF));

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
      defects.push(`${handler.method} n'attend aucune garde`);
    } else if (handler.guards.length > 1) {
      defects.push(`${handler.method} attend plusieurs gardes : ${handler.guards.join(", ")}`);
    }
    for (const guard of handler.guards) {
      if (!analysis.authImports.includes(guard)) {
        defects.push(`${handler.method} : ${guard} ne vient pas de @/lib/auth`);
      }
    }
  }
  if (text.includes("getServerSession")) {
    defects.push("touche getServerSession : passer par une garde de @/lib/auth");
  }
  return defects;
}

const readRoute = (rel: string) => fs.readFileSync(path.join(ADMIN_ROOT, rel), "utf-8");

test("l'analyse repère les handlers mal gardés", () => {
  const source = `
    import { guardManager } from "@/lib/auth";
    import { getServerSession } from "next-auth";
    async function guardAdmin() { return { error: null }; }
    export async function GET() { const { error } = await guardManager(); if (error) return error; }
    export async function POST() { const { error } = guardManager(); if (error) return error; }
    export async function PUT() { return [1].map(async () => await guardManager()); }
    export async function PATCH() { await guardAdmin(); }
    async function remove() { await guardManager(); }
    export { remove as DELETE };
  `;

  assert.deepEqual(routeDefects("synthetique.ts", source), [
    "DELETE exporté par `export { … }` : forme non analysée, écrire `export async function DELETE`",
    "POST n'attend aucune garde",
    "PUT n'attend aucune garde",
    "PATCH : guardAdmin ne vient pas de @/lib/auth",
    "touche getServerSession : passer par une garde de @/lib/auth",
  ]);
});

test("l'analyse refuse deux gardes dans un même handler", () => {
  const source = `
    import { guardManager, guardSignedIn } from "@/lib/auth";
    export async function GET() { await guardSignedIn(); await guardManager(); }
  `;
  assert.deepEqual(routeDefects("synthetique.ts", source), [
    "GET attend plusieurs gardes : guardSignedIn, guardManager",
  ]);
});

test("l'ancienne garde guardAuth n'est plus une garde reconnue", () => {
  const source = `
    import { guardAuth } from "@/lib/auth";
    export async function GET() { const { error } = await guardAuth(); if (error) return error; }
  `;
  assert.deepEqual(routeDefects("synthetique.ts", source), ["GET n'attend aucune garde"]);
});

test("l'énumération descend dans tous les sous-dossiers", () => {
  const files = adminRouteFiles();
  assert.ok(files.includes("inbox/route.ts"));
  assert.ok(files.includes("schools/[id]/stats/[recordId]/route.ts"));
});

test("chaque handler admin attend une seule garde de @/lib/auth, sans getServerSession", () => {
  const defects = adminRouteFiles().flatMap((rel) =>
    routeDefects(rel, readRoute(rel)).map((d) => `${rel} : ${d}`)
  );
  assert.deepEqual(defects, []);
});

test("chaque handler attend la garde de son niveau (test/helpers/access-policy.ts)", () => {
  const mismatches = adminRouteFiles().flatMap((rel) =>
    analyzeRoute(rel, readRoute(rel)).handlers.flatMap((h) => {
      const key = `${h.method} ${routeKey(rel)}`;
      const expected = GUARD_OF[expectedLevel(key)];
      return h.guards.length === 1 && h.guards[0] === expected
        ? []
        : [`${key} : attendu ${expected}, trouvé ${h.guards.join(", ") || "aucune"}`];
    })
  );
  assert.deepEqual(
    mismatches,
    [],
    "Écart entre le code et la table d'accès : mettre à jour la route, " +
      "test/helpers/access-policy.ts et docs/architecture/gestion-contenu.md §4 ensemble."
  );
});

/** Fichiers .ts et .tsx sous `dir`, hors node_modules. */
function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((rel) => /\.tsx?$/.test(rel) && !rel.split(path.sep).includes("node_modules"))
    .map((rel) => path.join(dir, rel));
}

test("piège 1 : guardAuth et requireAuth (« toute session ») n'existent plus nulle part", () => {
  const root = process.cwd();
  const offenders = [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "lib")), path.join(root, "proxy.ts")]
    .filter((file) => /\b(guardAuth|requireAuth)\b/.test(fs.readFileSync(file, "utf-8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"));
  assert.deepEqual(offenders, []);
});
