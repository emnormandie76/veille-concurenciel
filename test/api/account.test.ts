/**
 * test/api/account.test.ts — /api/admin/account/** : ce que chacun fait pour soi
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 2 : toute session (USER compris) change son nom
 * affiché (D6) et son mot de passe, sur la page « Mon compte ». Ces routes ne
 * prennent aucun identifiant : elles visent le compte de la session, et lui
 * seul. Changer son mot de passe exige l'actuel ; la politique de
 * lib/password.ts s'applique (reprise des tests de l'ancienne route
 * `users/[id]/password`, dont la partie « tiers » a disparu avec D4).
 *
 * bcryptjs est le vrai : les empreintes de test ont un coût faible.
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";
import { userRow, userTable, type UserTable } from "../helpers/fake-users";

const db = installFakePrisma();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
const session = installSession();

let renameSelf: (request: Request) => Promise<Response>;
let changePassword: (request: Request) => Promise<Response>;

before(async () => {
  ({ PATCH: renameSelf } = await import("../../app/api/admin/account/route"));
  ({ PATCH: changePassword } = await import("../../app/api/admin/account/password/route"));
});

beforeEach(() => {
  session.as("USER");
});

const CURRENT = "mot-de-passe-actuel-1";
const CURRENT_HASH = bcrypt.hashSync(CURRENT, 4);
const NEW = "nouveau-mot-de-passe-2";

/** Les trois profils de test/helpers/session.ts, actifs, plus un autre compte. */
function table(): UserTable {
  const users = userTable([
    userRow({ id: "test-user", email: "user@em-normandie.fr", display_name: "Utilisateur", password_hash: CURRENT_HASH, status: "ACTIVE" }),
    userRow({ id: "test-gestionnaire", username: "gestion1", password_hash: CURRENT_HASH, role: "GESTIONNAIRE", status: "ACTIVE" }),
    userRow({ id: "test-admin", email: "admin@em-normandie.fr", password_hash: CURRENT_HASH, role: "ADMIN", status: "ACTIVE" }),
    userRow({ id: "u-autre", email: "autre@em-normandie.fr", display_name: "Autre", password_hash: CURRENT_HASH, status: "ACTIVE" }),
  ]);
  db.use({ user: users.methods });
  return users;
}

const patch = (body: unknown) =>
  new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const quietAudit = async <T>(fn: () => Promise<T>) => {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
};

test("sans session : 401, rien de lu", async () => {
  session.as("none");
  table();
  assert.equal((await renameSelf(patch({ displayName: "Jean" }))).status, 401);
  assert.equal((await changePassword(patch({ currentPassword: CURRENT, newPassword: NEW }))).status, 401);
  assert.deepEqual(db.calls, []);
});

// ── Le nom affiché (D6) ──────────────────────────────────────────────

test("D6 : chacun change son nom affiché, nettoyé ; USER, GESTIONNAIRE et ADMIN", async () => {
  for (const [profile, id] of [["USER", "test-user"], ["GESTIONNAIRE", "test-gestionnaire"], ["ADMIN", "test-admin"]] as const) {
    session.as(profile);
    const users = table();
    const res = await renameSelf(patch({ displayName: "  Jean   Dupont " }));
    assert.equal(res.status, 200, profile);
    assert.deepEqual(await res.json(), { displayName: "Jean Dupont" });
    assert.equal(users.get(id)!.display_name, "Jean Dupont", profile);
  }
});

test("le nom ne vise que le compte de la session, même si le corps nomme un autre compte", async () => {
  const users = table();
  assert.equal((await renameSelf(patch({ displayName: "Pirate", id: "u-autre", userId: "u-autre" }))).status, 200);
  assert.equal(users.get("u-autre")!.display_name, "Autre");
  assert.equal(users.get("test-user")!.display_name, "Pirate");
});

test("un nom invalide → 400, avant la base", async () => {
  for (const body of [{ displayName: "" }, { displayName: "J" }, {}, { displayName: "a".repeat(81) }, "{pas du json"]) {
    table();
    assert.equal((await renameSelf(patch(body))).status, 400, JSON.stringify(body));
    assert.deepEqual(db.calls, [], JSON.stringify(body));
  }
});

// ── Le mot de passe ──────────────────────────────────────────────────

test("son mot de passe : l'actuel est exigé", async () => {
  const users = table();
  const res = await changePassword(patch({ newPassword: NEW }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /actuel est requis/);
  assert.equal(users.get("test-user")!.password_hash, CURRENT_HASH);
});

test("son mot de passe : un actuel faux → 403, rien d'écrit", async () => {
  const users = table();
  const res = await changePassword(patch({ currentPassword: "pas-le-bon-mot-de-passe", newPassword: NEW }));
  assert.equal(res.status, 403);
  assert.equal(users.get("test-user")!.password_hash, CURRENT_HASH);
});

test("son mot de passe : avec l'actuel, le nouveau est haché et écrit ; USER, GESTIONNAIRE et ADMIN", async () => {
  for (const [profile, id] of [["USER", "test-user"], ["GESTIONNAIRE", "test-gestionnaire"], ["ADMIN", "test-admin"]] as const) {
    session.as(profile);
    const users = table();
    const res = await quietAudit(() => changePassword(patch({ currentPassword: CURRENT, newPassword: NEW })));
    assert.equal(res.status, 200, profile);
    assert.ok(await bcrypt.compare(NEW, users.get(id)!.password_hash ?? ""), profile);
    assert.equal(users.get("u-autre")!.password_hash, CURRENT_HASH);
  }
});

test("son mot de passe : ne vise que le compte de la session, même si le corps en nomme un autre", async () => {
  const users = table();
  const res = await quietAudit(() => changePassword(patch({ currentPassword: CURRENT, newPassword: NEW, id: "u-autre" })));
  assert.equal(res.status, 200);
  assert.equal(users.get("u-autre")!.password_hash, CURRENT_HASH);
});

test("la politique s'applique au nouveau mot de passe, avant la base", async () => {
  for (const newPassword of [undefined, "a".repeat(11), "🔑".repeat(19)]) {
    table();
    const res = await changePassword(patch({ currentPassword: CURRENT, newPassword }));
    assert.equal(res.status, 400, String(newPassword));
    assert.deepEqual(db.calls, []);
  }
});

test("un nouveau mot de passe identique à l'actuel est refusé", async () => {
  const users = table();
  const res = await changePassword(patch({ currentPassword: CURRENT, newPassword: CURRENT }));
  assert.equal(res.status, 400);
  assert.equal(users.get("test-user")!.password_hash, CURRENT_HASH);
});

test("corps illisible → 400", async () => {
  table();
  assert.equal((await changePassword(patch("{pas du json"))).status, 400);
  assert.deepEqual(db.calls, []);
});
