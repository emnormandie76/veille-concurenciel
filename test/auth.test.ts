/**
 * test/auth.test.ts — Les gardes des routes admin (lib/auth.ts)
 *
 *     npm run test:ts
 *
 * Toutes les routes admin en dépendent (architecture.md §3.6). Les tests de
 * routes remplacent ce module par test/helpers/session.ts ; ici, c'est la
 * logique réelle de lib/auth.ts qui est testée, avec `getServerSession` de
 * next-auth remplacé : `guardAuth` sans session → 401, `guardAdmin` en
 * MODERATOR → 403, en ADMIN → passe. Plan backend-local, étape 7 (P0).
 */

import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

type Session = { user?: { id: string; name: string; email: string | null; role: string } } | null;

let current: Session = null;
const received: unknown[] = [];
const AUTH_OPTIONS = { marker: "authOptions de la route NextAuth" };

mock.module("next-auth", {
  exports: {
    getServerSession: async (options: unknown) => {
      received.push(options);
      return current;
    },
  },
});
// La vraie route NextAuth charge Prisma et bcrypt : seul son authOptions
// intéresse lib/auth.ts.
mock.module("@/app/api/auth/[...nextauth]/route", {
  exports: { authOptions: AUTH_OPTIONS },
});

let auth: typeof import("../lib/auth");

before(async () => {
  auth = await import("../lib/auth");
});

const MODERATOR = { user: { id: "u-mod", name: "moderateur", email: null, role: "MODERATOR" } };
const ADMIN = { user: { id: "u-admin", name: "admin", email: null, role: "ADMIN" } };

test("getSession lit la session avec les options de la route NextAuth", async () => {
  current = MODERATOR;
  received.length = 0;

  assert.deepEqual(await auth.getSession(), MODERATOR);
  assert.deepEqual(received, [AUTH_OPTIONS]);
});

test("une session sans utilisateur ne compte pas", async () => {
  current = {};
  assert.equal(await auth.getSession(), null);
  current = null;
  assert.equal(await auth.getSession(), null);
});

test("guardAuth : sans session → 401", async () => {
  current = null;
  const { session, error } = await auth.guardAuth();

  assert.equal(session, null);
  assert.equal(error?.status, 401);
  assert.deepEqual(await error?.json(), { error: "Non authentifié. Veuillez vous connecter." });
});

test("guardAuth : un MODERATOR ou un ADMIN passe", async () => {
  for (const s of [MODERATOR, ADMIN]) {
    current = s;
    const { session, error } = await auth.guardAuth();
    assert.equal(error, null);
    assert.deepEqual(session, s);
  }
});

test("guardAdmin : sans session → 401", async () => {
  current = null;
  const { session, error } = await auth.guardAdmin();

  assert.equal(session, null);
  assert.equal(error?.status, 401);
});

test("guardAdmin : un MODERATOR → 403", async () => {
  current = MODERATOR;
  const { session, error } = await auth.guardAdmin();

  assert.equal(session, null);
  assert.equal(error?.status, 403);
  assert.deepEqual(await error?.json(), { error: "Accès refusé. Droits ADMIN requis." });
});

test("guardAdmin : un ADMIN passe", async () => {
  current = ADMIN;
  const { session, error } = await auth.guardAdmin();

  assert.equal(error, null);
  assert.deepEqual(session, ADMIN);
});

test("guardAdmin : un rôle inconnu n'est pas ADMIN", async () => {
  for (const role of ["admin", "SUPERADMIN", "", undefined]) {
    current = { user: { ...ADMIN.user, role: role as string } };
    const { error } = await auth.guardAdmin();
    assert.equal(error?.status, 403, String(role));
  }
});

test("requireAuth et requireAdmin rendent la session ou null", async () => {
  current = MODERATOR;
  assert.deepEqual(await auth.requireAuth(), MODERATOR);
  assert.equal(await auth.requireAdmin(), null);
  current = ADMIN;
  assert.deepEqual(await auth.requireAdmin(), ADMIN);
  current = null;
  assert.equal(await auth.requireAuth(), null);
  assert.equal(await auth.requireAdmin(), null);
});
