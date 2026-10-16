/**
 * test/api/users.test.ts — /api/admin/users/**
 *
 *     npm run test:ts
 *
 * Plan backend-local, étape 7 (P1) : seul un ADMIN gère les comptes ; changer
 * son propre mot de passe exige l'actuel ; celui d'un tiers exige ADMIN ; la
 * politique de lib/password.ts est appliquée (architecture.md §3.6).
 * Plan gestion-contenu, étape 1 : trois rôles ; l'écran crée des GESTIONNAIRE
 * (D18) ; changer son mot de passe est ouvert à toute session (USER compris).
 *
 * bcryptjs est le vrai : les empreintes de test sont calculées avec un coût
 * faible, la route hache les nouveaux mots de passe avec le sien (12).
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";

const db = installFakePrisma();

// Chaque requête reçue par le faux doit exister dans le vrai schéma Prisma
// (test/helpers/prisma-schema.ts).
afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
const session = installSession();

type Ctx = { params: Promise<{ id: string }> };
let listUsers: () => Promise<Response>;
let createUser: (request: Request) => Promise<Response>;
let deleteUser: (request: Request, ctx: Ctx) => Promise<Response>;
let changePassword: (request: Request, ctx: Ctx) => Promise<Response>;

before(async () => {
  ({ GET: listUsers, POST: createUser } = await import("../../app/api/admin/users/route"));
  ({ DELETE: deleteUser } = await import("../../app/api/admin/users/[id]/route"));
  ({ PATCH: changePassword } = await import("../../app/api/admin/users/[id]/password/route"));
});

beforeEach(() => {
  session.as("ADMIN");
});

// Identifiants des profils de test/helpers/session.ts.
const ADMIN_ID = "test-admin";
const GESTIONNAIRE_ID = "test-gestionnaire";
const USER_ID = "test-user";
const CURRENT = "mot-de-passe-actuel-1";
const CURRENT_HASH = bcrypt.hashSync(CURRENT, 4);
const NEW = "nouveau-mot-de-passe-2";

const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function withUser(id = GESTIONNAIRE_ID) {
  db.use({
    user: {
      findUnique: ({ where }: { where: { id?: string; username?: string } }) =>
        where.id === id ? { id, username: "u", password_hash: CURRENT_HASH, role: "GESTIONNAIRE" } : null,
      update: () => ({ id }),
    },
  });
}

function writtenHash(): string | undefined {
  const update = db.writes().find((c) => c.model === "user" && c.method === "update");
  return (update?.args[0] as { data: { password_hash: string } } | undefined)?.data.password_hash;
}

const quietAudit = async <T>(fn: () => Promise<T>) => {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
};

// ── Liste, création, suppression : ADMIN seulement ───────────────────

test("un USER ou un GESTIONNAIRE ne liste ni ne crée ni ne supprime de compte", async () => {
  for (const profile of ["USER", "GESTIONNAIRE"] as const) {
    session.as(profile);
    db.use({});

    assert.equal((await listUsers()).status, 403, profile);
    assert.equal((await createUser(json({ username: "nouveau", password: "x".repeat(12) }))).status, 403, profile);
    assert.equal((await deleteUser(json({}, "DELETE"), ctx("u-1"))).status, 403, profile);
    assert.deepEqual(db.calls, []);
  }
});

test("sans session : 401 partout", async () => {
  session.as("none");
  db.use({});

  assert.equal((await listUsers()).status, 401);
  assert.equal((await createUser(json({}))).status, 401);
  assert.equal((await deleteUser(json({}, "DELETE"), ctx("u-1"))).status, 401);
  assert.equal((await changePassword(json({}, "PATCH"), ctx("u-1"))).status, 401);
  assert.deepEqual(db.calls, []);
});

test("création : la politique de mot de passe est appliquée", async () => {
  for (const password of ["court", "a".repeat(11), "é".repeat(37)]) {
    db.use({ user: { findUnique: () => null, create: () => ({}) } });
    const res = await createUser(json({ username: "nouveau", password }));
    assert.equal(res.status, 400, password);
    assert.deepEqual(db.writes(), []);
  }
});

test("création : un GESTIONNAIRE (D18), écrit explicitement, mot de passe haché, jamais renvoyé", async () => {
  db.use({
    user: {
      findUnique: () => null,
      create: ({ data, select }: { data: Record<string, string>; select: Record<string, boolean> }) => {
        assert.equal(select.password_hash, undefined);
        return { id: "u-new", username: data.username, role: data.role, createdAt: "2026-10-14" };
      },
    },
  });

  const res = await createUser(json({ username: "  nouveau  ", password: "un-mot-de-passe-sur" }));

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.role, "GESTIONNAIRE");
  assert.equal(body.password_hash, undefined);
  const data = (db.writes()[0].args[0] as { data: { username: string; password_hash: string; role: string } }).data;
  assert.equal(data.username, "nouveau");
  // Le rôle est écrit par la route : le défaut de la base (USER) ne décide pas.
  assert.equal(data.role, "GESTIONNAIRE");
  assert.ok(await bcrypt.compare("un-mot-de-passe-sur", data.password_hash));
});

test("création : nom pris ou trop court → 400", async () => {
  db.use({ user: { findUnique: () => ({ id: "u-1" }), create: () => ({}) } });
  assert.equal((await createUser(json({ username: "pris", password: "x".repeat(12) }))).status, 400);
  db.use({ user: { findUnique: () => null, create: () => ({}) } });
  assert.equal((await createUser(json({ username: "ab", password: "x".repeat(12) }))).status, 400);
  assert.deepEqual(db.writes(), []);
});

test("suppression : pas son propre compte ; inconnu → 404 ; sinon supprimé", async () => {
  db.use({ user: { findUnique: () => ({ id: ADMIN_ID }), delete: () => ({}) } });
  assert.equal((await deleteUser(json({}, "DELETE"), ctx(ADMIN_ID))).status, 400);

  db.use({ user: { findUnique: () => null, delete: () => ({}) } });
  assert.equal((await deleteUser(json({}, "DELETE"), ctx("u-absent"))).status, 404);
  assert.deepEqual(db.writes(), []);

  db.use({ user: { findUnique: () => ({ id: "u-1" }), delete: () => ({}) } });
  assert.equal((await deleteUser(json({}, "DELETE"), ctx("u-1"))).status, 200);
  assert.equal(db.writes().length, 1);
});

// ── Mot de passe ─────────────────────────────────────────────────────

test("son propre mot de passe : l'actuel est exigé", async () => {
  session.as("GESTIONNAIRE");
  withUser(GESTIONNAIRE_ID);

  const res = await changePassword(json({ newPassword: NEW }, "PATCH"), ctx(GESTIONNAIRE_ID));

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /actuel est requis/);
  assert.equal(writtenHash(), undefined);
});

test("son propre mot de passe : un actuel faux → 403, rien d'écrit", async () => {
  session.as("GESTIONNAIRE");
  withUser(GESTIONNAIRE_ID);

  const res = await changePassword(
    json({ currentPassword: "pas-le-bon-mot-de-passe", newPassword: NEW }, "PATCH"),
    ctx(GESTIONNAIRE_ID)
  );

  assert.equal(res.status, 403);
  assert.equal(writtenHash(), undefined);
});

test("son propre mot de passe : avec l'actuel, le nouveau est haché et écrit", async () => {
  session.as("GESTIONNAIRE");
  withUser(GESTIONNAIRE_ID);

  const res = await quietAudit(() =>
    changePassword(json({ currentPassword: CURRENT, newPassword: NEW }, "PATCH"), ctx(GESTIONNAIRE_ID))
  );

  assert.equal(res.status, 200);
  const hash = writtenHash();
  assert.ok(hash && (await bcrypt.compare(NEW, hash)));
});

test("son propre mot de passe : un USER aussi (guardSignedIn), avec l'actuel", async () => {
  session.as("USER");
  withUser(USER_ID);

  const res = await quietAudit(() =>
    changePassword(json({ currentPassword: CURRENT, newPassword: NEW }, "PATCH"), ctx(USER_ID))
  );

  assert.equal(res.status, 200);
  assert.ok(await bcrypt.compare(NEW, writtenHash() ?? ""));
});

test("le mot de passe d'un tiers : un USER ou un GESTIONNAIRE est refusé avant toute lecture", async () => {
  for (const profile of ["USER", "GESTIONNAIRE"] as const) {
    session.as(profile);
    db.use({});

    const res = await changePassword(json({ newPassword: NEW }, "PATCH"), ctx("u-autre"));

    assert.equal(res.status, 403, profile);
    assert.deepEqual(db.calls, []);
  }
});

test("le mot de passe d'un tiers : un ADMIN le réinitialise sans l'actuel", async () => {
  withUser("u-autre");

  const res = await quietAudit(() => changePassword(json({ newPassword: NEW }, "PATCH"), ctx("u-autre")));

  assert.equal(res.status, 200);
  assert.ok(await bcrypt.compare(NEW, writtenHash() ?? ""));
});

test("la politique s'applique au nouveau mot de passe, avant la base", async () => {
  for (const newPassword of [undefined, "a".repeat(11), "🔑".repeat(19)]) {
    withUser("u-autre");
    const res = await changePassword(json({ newPassword }, "PATCH"), ctx("u-autre"));
    assert.equal(res.status, 400, String(newPassword));
    assert.deepEqual(db.calls, []);
  }
});

test("un nouveau mot de passe identique à l'actuel est refusé", async () => {
  withUser("u-autre");

  const res = await changePassword(json({ newPassword: CURRENT }, "PATCH"), ctx("u-autre"));

  assert.equal(res.status, 400);
  assert.equal(writtenHash(), undefined);
});

test("compte inconnu → 404 ; corps illisible → 400", async () => {
  withUser("u-autre");
  assert.equal((await changePassword(json({ newPassword: NEW }, "PATCH"), ctx("u-absent"))).status, 404);
  assert.equal((await changePassword(json("{pas du json", "PATCH"), ctx("u-autre"))).status, 400);
  assert.equal(writtenHash(), undefined);
});
