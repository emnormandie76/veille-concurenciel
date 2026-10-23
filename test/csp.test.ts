/**
 * test/csp.test.ts — La CSP à nonce
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 15, D123 : `'unsafe-inline'` quitte
 * `script-src`. Le proxy tire un nonce par requête et pose la CSP
 * (`lib/csp.ts`) sur la requête, où Next le lit pour ses propres scripts, et
 * sur la réponse (test/proxy.test.ts). Un nonce n'existe qu'au rendu d'une
 * requête : toutes les pages sont dynamiques, et aucune n'est en cache (une
 * page gardée en cache porterait le nonce d'une autre requête, et ses
 * scripts seraient bloqués). `style-src` garde `'unsafe-inline'`, hors du
 * périmètre de D123.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { contentSecurityPolicy, createNonce } from "../lib/csp";
import nextConfig from "../next.config";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r/g, "");
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.split(" ")[0] === name);

test("D123 : script-src sans 'unsafe-inline' : le nonce de la requête et 'strict-dynamic'", () => {
  const csp = contentSecurityPolicy("bm9uY2U=", false);
  assert.equal(directive(csp, "script-src"), "script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'");
  assert.doesNotMatch(directive(csp, "script-src")!, /unsafe/);
});

test("'unsafe-eval' en développement seulement : le rafraîchissement à chaud de next dev", () => {
  assert.equal(
    directive(contentSecurityPolicy("bm9uY2U=", true), "script-src"),
    "script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic' 'unsafe-eval'",
  );
  assert.equal(contentSecurityPolicy("n", process.env.NODE_ENV !== "production"), contentSecurityPolicy("n"));
});

test("le reste de la politique ne change pas (étape 3) ; style-src garde 'unsafe-inline'", () => {
  assert.deepEqual(
    contentSecurityPolicy("n", false).split("; ").filter((d) => !d.startsWith("script-src")),
    [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ],
  );
});

test("createNonce : en base64, au moins 128 bits d'aléa, différent à chaque appel", () => {
  const nonces = Array.from({ length: 200 }, createNonce);
  assert.equal(new Set(nonces).size, nonces.length);
  for (const nonce of nonces) {
    assert.match(nonce, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.ok(nonce.length >= 24, nonce);
  }
});

test("next.config.ts ne pose plus de CSP, le proxy la pose avec son nonce ; les cinq autres en-têtes restent", async () => {
  const rules = await nextConfig.headers!();
  assert.deepEqual(rules.map((rule) => rule.source), ["/:path*"]);
  assert.deepEqual(
    rules[0].headers.map((header) => header.key).sort(),
    ["Permissions-Policy", "Referrer-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options"],
  );
});

test("toutes les pages sont dynamiques : le layout racine attend la requête, aucune page ne se met en cache", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /^import \{ connection \} from "next\/server";$/m);
  assert.match(layout, /export default async function RootLayout\(/);
  assert.match(layout, /\n  await connection\(\);\n/);
  const files = (readdirSync("app", { recursive: true }) as string[])
    .filter((file) => /(^|[\\/])(page|layout)\.tsx$/.test(file))
    .map((file) => join("app", file));
  assert.ok(files.length > 15);
  for (const file of files) {
    assert.doesNotMatch(read(file), /export const (revalidate|dynamic)\b|generateStaticParams|["']use cache["']/, file);
  }
});
