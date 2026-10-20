/**
 * test/api/users.test.ts — /api/admin/users/** : la liste blanche et les rôles
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 2. Seul un ADMIN gère les comptes (G4) :
 * - G5 : il ajoute l'adresse de travail d'un collègue à la liste, sans envoi
 *   d'e-mail ; l'invité devient USER ; tant qu'il ne s'est pas connecté, il
 *   peut être retiré, et ne peut plus alors ni faire sa première connexion ni
 *   se connecter ;
 * - il change les rôles, et peut nommer un autre admin ; un USER ne change ni
 *   le sien ni celui d'un autre ;
 * - aucune opération ne laisse zéro admin actif : le dernier ne peut ni se
 *   rétrograder, ni se supprimer, ni se désactiver, ni se remettre à zéro. La
 *   règle se juge en base, dans une transaction sérialisable ;
 * - D4 : il remet un compte en première connexion (mot de passe effacé,
 *   sessions coupées) ; il ne fixe plus jamais le mot de passe d'un tiers ;
 * - D21 : un compte actif se désactive, il ne se supprime plus ;
 * - D24 (étape 5) : un compte qui a modifié une donnée ne se supprime jamais,
 *   même redevenu invité par une remise en première connexion (la base le
 *   refuse) ; un invité se désactive ;
 * - D3 : il renseigne l'adresse d'un compte d'avant la liste blanche, et
 *   l'ancien identifiant cesse alors de servir ;
 * - D5 : seul le domaine imposé est accepté.
 *
 * La table User est en mémoire (test/helpers/fake-users.ts), avec les
 * contraintes de la migration ; les gardes sont simulées
 * (test/helpers/session.ts, profils `test-admin`, `test-gestionnaire`,
 * `test-user`) ; la vraie lib/auth.ts juge chaque route dans
 * test/api/access-matrix.test.ts.
 */

import { afterEach, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";
import { userRow, userTable, type UserRow, type UserTable } from "../helpers/fake-users";
import { ADMIN_ONLY, SIGNED_IN } from "../helpers/access-policy";

const db = installFakePrisma();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
const session = installSession();

// Le journal d'audit des routes ([audit] …) n'est pas l'objet de ces tests.
mock.method(console, "log", () => {});

// Aucun e-mail ne part : le moindre appel réseau serait un envoi.
const outgoing: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  outgoing.push(String(input));
  throw new Error(`Appel réseau interdit dans ce test : ${String(input)}`);
}) as typeof fetch;

type Ctx = { params: Promise<{ id: string }> };
type Handler = (request: Request, ctx: Ctx) => Promise<Response>;
let listUsers: () => Promise<Response>;
let addEmail: (request: Request) => Promise<Response>;
let removeUser: Handler;
let changeRole: Handler;
let resetUser: Handler;
let disableUser: Handler;
let setEmail: Handler;
let firstLogin: (request: Request) => Promise<Response>;
let verifyCredentials: typeof import("../../lib/sign-in").verifyCredentials;

before(async () => {
  ({ GET: listUsers, POST: addEmail } = await import("../../app/api/admin/users/route"));
  ({ DELETE: removeUser } = await import("../../app/api/admin/users/[id]/route"));
  ({ PATCH: changeRole } = await import("../../app/api/admin/users/[id]/role/route"));
  ({ POST: resetUser } = await import("../../app/api/admin/users/[id]/reset/route"));
  ({ POST: disableUser } = await import("../../app/api/admin/users/[id]/disable/route"));
  ({ PATCH: setEmail } = await import("../../app/api/admin/users/[id]/email/route"));
  ({ POST: firstLogin } = await import("../../app/api/first-login/route"));
  ({ verifyCredentials } = await import("../../lib/sign-in"));
});

beforeEach(() => {
  session.as("ADMIN");
  outgoing.length = 0;
});

// Identifiants des profils de test/helpers/session.ts.
const ADMIN_ID = "test-admin";
const PASSWORD = "un-mot-de-passe-solide";
const HASH = bcrypt.hashSync(PASSWORD, 4);

/** L'admin connecté, seul admin actif. */
const ME = userRow({ id: ADMIN_ID, email: "admin@em-normandie.fr", display_name: "Admin", password_hash: HASH, role: "ADMIN", status: "ACTIVE" });
const ACTIVE_USER = userRow({ id: "u-jean", email: "jean.dupont@em-normandie.fr", display_name: "Jean Dupont", password_hash: HASH, status: "ACTIVE", first_login_at: new Date("2026-10-16T09:00:00Z") });
const INVITED = userRow({ id: "u-invite", email: "marie.curie@em-normandie.fr" });
// Un compte d'avant la liste blanche : un identifiant, pas d'adresse (D3).
const LEGACY = userRow({ id: "u-legacy", username: "gestion1", password_hash: HASH, role: "GESTIONNAIRE", status: "ACTIVE" });

function table(...rows: UserRow[]): UserTable {
  const users = userTable(rows);
  db.use({ user: users.methods });
  return users;
}

/** La table, où les comptes `authors` ont modifié des données (clé RESTRICT, D24). */
function tableWithAuthors(authors: string[], ...rows: UserRow[]): UserTable {
  const users = userTable(rows, { authors });
  db.use({ user: users.methods });
  return users;
}

const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const empty = (method = "POST") => new Request("http://localhost/x", { method });

const LAST_ADMIN = /au moins un administrateur actif/;

// ── L'accès : ADMIN seulement ────────────────────────────────────────

test("un USER ou un GESTIONNAIRE n'atteint aucune route des comptes, et rien n'est lu", async () => {
  for (const profile of ["USER", "GESTIONNAIRE"] as const) {
    session.as(profile);
    table(ME, ACTIVE_USER);

    const statuses = [
      (await listUsers()).status,
      (await addEmail(json({ email: "x@em-normandie.fr" }))).status,
      (await removeUser(empty("DELETE"), ctx("u-jean"))).status,
      (await changeRole(json({ role: "ADMIN" }, "PATCH"), ctx("u-jean"))).status,
      (await resetUser(empty(), ctx("u-jean"))).status,
      (await disableUser(empty(), ctx("u-jean"))).status,
      (await setEmail(json({ email: "x@em-normandie.fr" }, "PATCH"), ctx("u-jean"))).status,
    ];
    assert.deepEqual(statuses, [403, 403, 403, 403, 403, 403, 403], profile);
    assert.deepEqual(db.calls, [], profile);
  }
});

test("sans session : 401 partout", async () => {
  session.as("none");
  table(ME);
  assert.equal((await listUsers()).status, 401);
  assert.equal((await addEmail(json({}))).status, 401);
  assert.equal((await changeRole(json({}, "PATCH"), ctx("u-1"))).status, 401);
  assert.equal((await resetUser(empty(), ctx("u-1"))).status, 401);
  assert.equal((await disableUser(empty(), ctx("u-1"))).status, 401);
  assert.equal((await setEmail(json({}, "PATCH"), ctx("u-1"))).status, 401);
  assert.equal((await removeUser(empty("DELETE"), ctx("u-1"))).status, 401);
  assert.deepEqual(db.calls, []);
});

test("les routes des comptes sont réservées à ADMIN dans la table d'accès ; le mot de passe d'un tiers n'a plus de route (D4)", () => {
  for (const key of [
    "GET users",
    "POST users",
    "DELETE users/[id]",
    "PATCH users/[id]/role",
    "POST users/[id]/reset",
    "POST users/[id]/disable",
    "PATCH users/[id]/email",
  ]) {
    assert.ok(ADMIN_ONLY.includes(key), key);
  }
  assert.equal(SIGNED_IN.includes("PATCH users/[id]/password"), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), "app", "api", "admin", "users", "[id]", "password")), false);
});

// ── La liste ─────────────────────────────────────────────────────────

test("la liste : adresse, nom, rôle, état, date de première connexion ; jamais l'empreinte", async () => {
  table(ME, ACTIVE_USER, INVITED, LEGACY);

  const res = await listUsers();

  assert.equal(res.status, 200);
  const rows = (await res.json()) as Record<string, unknown>[];
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal("password_hash" in row, false);
    assert.equal("session_version" in row, false);
  }
  const jean = rows.find((r) => r.id === "u-jean")!;
  assert.equal(jean.email, "jean.dupont@em-normandie.fr");
  assert.equal(jean.display_name, "Jean Dupont");
  assert.equal(jean.status, "ACTIVE");
  assert.equal(jean.role, "USER");
  assert.ok(jean.first_login_at);
  assert.equal(rows.find((r) => r.id === "u-legacy")!.username, "gestion1");
});

// ── G5 : ajouter une adresse ─────────────────────────────────────────

test("ajouter une adresse : un invité USER, sans mot de passe ; aucun e-mail envoyé", async () => {
  const users = table(ME);

  const res = await addEmail(json({ email: "  Paul.Martin@EM-Normandie.fr " }));

  assert.equal(res.status, 201);
  const created = users.rows.find((r) => r.email === "paul.martin@em-normandie.fr");
  assert.ok(created);
  assert.equal(created.status, "INVITED");
  assert.equal(created.role, "USER");
  assert.equal(created.password_hash, null);
  assert.equal(created.username, null);
  assert.equal("password_hash" in (await res.json()), false);
  assert.deepEqual(outgoing, []);
});

test("D5 : une adresse hors du domaine n'entre pas sur la liste", async () => {
  for (const email of ["paul.martin@gmail.com", "paul.martin@etu.em-normandie.fr", "pas-une-adresse", "", undefined]) {
    const users = table(ME);
    const res = await addEmail(json({ email }));
    assert.equal(res.status, 400, String(email));
    assert.equal(users.rows.length, 1, String(email));
  }
});

test("une adresse déjà sur la liste, quelle que soit sa casse → 409, rien d'écrit", async () => {
  const users = table(ME, INVITED);
  const res = await addEmail(json({ email: "Marie.Curie@em-normandie.fr" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /déjà sur la liste/);
  assert.equal(users.rows.length, 2);
});

// ── G5 : retirer un invité ───────────────────────────────────────────

test("un invité retiré ne peut plus faire sa première connexion, ni se connecter", async () => {
  const users = table(ME, INVITED);

  assert.equal((await removeUser(empty("DELETE"), ctx("u-invite"))).status, 200);
  assert.equal(users.get("u-invite"), undefined);

  const res = await firstLogin(
    json({ email: "marie.curie@em-normandie.fr", password: PASSWORD, displayName: "Marie Curie" })
  );
  assert.equal(res.status, 403);
  assert.equal(users.rows.length, 1, "la première connexion ne recrée pas le compte");
  assert.equal(await verifyCredentials("marie.curie@em-normandie.fr", PASSWORD), null);
});

test("D21 : un compte actif ou désactivé ne se supprime pas, il se désactive", async () => {
  for (const row of [ACTIVE_USER, { ...ACTIVE_USER, status: "DISABLED", password_hash: null }]) {
    const users = table(ME, row);
    const res = await removeUser(empty("DELETE"), ctx("u-jean"));
    assert.equal(res.status, 409, row.status);
    assert.match((await res.json()).error, /désactiv/);
    assert.ok(users.get("u-jean"), row.status);
  }
});

test("D24 : un invité qui a modifié des données (remis en première connexion) ne se retire pas → 409", async () => {
  // Jean a servi, puis a été remis en première connexion (D4) : il est invité.
  const reset = { ...ACTIVE_USER, status: "INVITED", password_hash: null, first_login_at: null, session_version: 1 };
  const users = tableWithAuthors(["u-jean"], ME, reset);

  const res = await removeUser(empty("DELETE"), ctx("u-jean"));

  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /modifié des données[\s\S]*désactiv/);
  assert.deepEqual(users.get("u-jean"), reset, "le compte et son nom restent");
});

test("D38 : un invité qui a envoyé ou traité un signalement ne se retire pas non plus → 409", async () => {
  // Les clés `author_id` et `handled_by_id` de ContentReport (étape 6) sont en
  // RESTRICT, comme celle des auteurs du contenu : la base rend le même P2003.
  const reset = { ...ACTIVE_USER, status: "INVITED", password_hash: null, first_login_at: null, session_version: 1 };
  const users = tableWithAuthors(["u-jean"], ME, reset);

  const res = await removeUser(empty("DELETE"), ctx("u-jean"));

  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /signalement[\s\S]*désactiv/);
  assert.deepEqual(users.get("u-jean"), reset, "le compte et son nom restent");
});

test("D24 : un invité qui n'a rien modifié se retire toujours", async () => {
  const users = tableWithAuthors(["u-jean"], ME, INVITED);
  assert.equal((await removeUser(empty("DELETE"), ctx("u-invite"))).status, 200);
  assert.equal(users.get("u-invite"), undefined);
});

test("retirer : pas soi-même ; un compte inconnu → 404", async () => {
  table(ME);
  assert.equal((await removeUser(empty("DELETE"), ctx(ADMIN_ID))).status, 400);
  assert.equal((await removeUser(empty("DELETE"), ctx("u-absent"))).status, 404);
  assert.deepEqual(db.writes(), []);
});

// ── Les rôles ────────────────────────────────────────────────────────

test("un USER ne peut changer ni son rôle ni celui d'un autre", async () => {
  session.as("USER");
  const users = table(ME, userRow({ id: "test-user", email: "user@em-normandie.fr", password_hash: HASH, status: "ACTIVE" }));

  for (const id of ["test-user", ADMIN_ID]) {
    for (const role of ["ADMIN", "GESTIONNAIRE", "USER"]) {
      assert.equal((await changeRole(json({ role }, "PATCH"), ctx(id))).status, 403, `${id} → ${role}`);
    }
  }
  assert.deepEqual(db.calls, []);
  assert.equal(users.get("test-user")!.role, "USER");
  assert.equal(users.get(ADMIN_ID)!.role, "ADMIN");
});

test("un admin peut nommer un autre admin", async () => {
  const users = table(ME, ACTIVE_USER);

  const res = await changeRole(json({ role: "ADMIN" }, "PATCH"), ctx("u-jean"));

  assert.equal(res.status, 200);
  assert.equal((await res.json()).role, "ADMIN");
  assert.equal(users.get("u-jean")!.role, "ADMIN");
});

test("le rôle d'un invité se change avant sa première connexion", async () => {
  const users = table(ME, INVITED);
  assert.equal((await changeRole(json({ role: "GESTIONNAIRE" }, "PATCH"), ctx("u-invite"))).status, 200);
  assert.equal(users.get("u-invite")!.role, "GESTIONNAIRE");
});

test("rôle inconnu ou absent → 400 ; compte inconnu → 404 ; rien d'écrit", async () => {
  for (const body of [{ role: "MODERATOR" }, { role: "admin" }, {}, "{pas du json"]) {
    table(ME, ACTIVE_USER);
    assert.equal((await changeRole(json(body, "PATCH"), ctx("u-jean"))).status, 400, JSON.stringify(body));
    assert.deepEqual(db.writes(), []);
  }
  table(ME);
  assert.equal((await changeRole(json({ role: "ADMIN" }, "PATCH"), ctx("u-absent"))).status, 404);
});

// ── Aucune opération ne laisse zéro admin actif ──────────────────────

test("le dernier admin actif ne peut pas se rétrograder", async () => {
  for (const role of ["GESTIONNAIRE", "USER"]) {
    const users = table(ME, ACTIVE_USER);
    const res = await changeRole(json({ role }, "PATCH"), ctx(ADMIN_ID));
    assert.equal(res.status, 409, role);
    assert.match((await res.json()).error, LAST_ADMIN);
    assert.equal(users.get(ADMIN_ID)!.role, "ADMIN");
  }
});

test("un admin encore invité ne compte pas : le dernier admin actif ne se rétrograde toujours pas", async () => {
  const users = table(ME, { ...INVITED, role: "ADMIN" });
  assert.equal((await changeRole(json({ role: "USER" }, "PATCH"), ctx(ADMIN_ID))).status, 409);
  assert.equal(users.get(ADMIN_ID)!.role, "ADMIN");
});

test("avec un second admin actif, un admin peut se rétrograder", async () => {
  const users = table(ME, { ...ACTIVE_USER, role: "ADMIN" });
  assert.equal((await changeRole(json({ role: "GESTIONNAIRE" }, "PATCH"), ctx(ADMIN_ID))).status, 200);
  assert.equal(users.get(ADMIN_ID)!.role, "GESTIONNAIRE");
});

test("le dernier admin ne peut ni se supprimer, ni se désactiver, ni se remettre en première connexion", async () => {
  const users = table(ME);
  assert.equal((await removeUser(empty("DELETE"), ctx(ADMIN_ID))).status, 400);
  assert.equal((await disableUser(empty(), ctx(ADMIN_ID))).status, 400);
  assert.equal((await resetUser(empty(), ctx(ADMIN_ID))).status, 400);
  assert.deepEqual(users.get(ADMIN_ID), ME);
});

test("la règle se juge en base, dans la transaction : même un appel d'un admin rétrogradé entre-temps ne laisse pas zéro admin", async () => {
  // L'appelant a passé la garde, puis un autre admin l'a rétrogradé : il ne
  // reste qu'un admin actif, la cible. Ni la rétrograder, ni la désactiver, ni
  // la remettre à zéro.
  const target = { ...ACTIVE_USER, role: "ADMIN" };
  for (const [label, call] of [
    ["rôle", () => changeRole(json({ role: "USER" }, "PATCH"), ctx("u-jean"))],
    ["désactivation", () => disableUser(empty(), ctx("u-jean"))],
    ["remise à zéro", () => resetUser(empty(), ctx("u-jean"))],
  ] as const) {
    const users = table({ ...ME, role: "GESTIONNAIRE" }, target);
    const res = await call();
    assert.equal(res.status, 409, label);
    assert.match((await res.json()).error, LAST_ADMIN, label);
    assert.deepEqual(users.get("u-jean"), target, label);
  }
});

test("les changements de rôle et d'état passent par une transaction sérialisable", async () => {
  for (const call of [
    () => changeRole(json({ role: "ADMIN" }, "PATCH"), ctx("u-jean")),
    () => disableUser(empty(), ctx("u-jean")),
    () => resetUser(empty(), ctx("u-jean")),
  ]) {
    table(ME, ACTIVE_USER);
    assert.equal((await call()).status, 200);
    const tx = db.calls.find((c) => c.model === "$transaction");
    assert.deepEqual(tx?.args, [{ isolationLevel: "Serializable" }]);
  }
});

test("deux modifications concurrentes : le conflit de sérialisation rend 409, rien n'est tenu", async () => {
  const users = userTable([ME, { ...ACTIVE_USER, role: "ADMIN" }]);
  db.use({
    user: {
      ...users.methods,
      update: () => {
        throw Object.assign(new Error("Transaction failed due to a write conflict or a deadlock"), { code: "P2034" });
      },
    },
  });

  const res = await changeRole(json({ role: "USER" }, "PATCH"), ctx("u-jean"));

  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /réessayez/i);
  assert.equal(users.get("u-jean")!.role, "ADMIN");
});

// ── D4 : remettre en première connexion ──────────────────────────────

test("D4 : remettre en première connexion efface le mot de passe, coupe les sessions, garde rôle et nom", async () => {
  const users = table(ME, { ...ACTIVE_USER, role: "GESTIONNAIRE", session_version: 4 });

  const res = await resetUser(empty(), ctx("u-jean"));

  assert.equal(res.status, 200);
  const row = users.get("u-jean")!;
  assert.equal(row.status, "INVITED");
  assert.equal(row.password_hash, null);
  assert.equal(row.first_login_at, null);
  assert.equal(row.session_version, 5);
  assert.equal(row.role, "GESTIONNAIRE");
  assert.equal(row.display_name, "Jean Dupont");
  assert.equal(row.email, "jean.dupont@em-normandie.fr");
  assert.equal(await verifyCredentials("jean.dupont@em-normandie.fr", PASSWORD), null);
  assert.deepEqual(outgoing, []);
});

test("D4 : puis la personne refait sa première connexion, avec un nouveau mot de passe", async () => {
  const users = table(ME, ACTIVE_USER);
  assert.equal((await resetUser(empty(), ctx("u-jean"))).status, 200);

  const res = await firstLogin(
    json({ email: "jean.dupont@em-normandie.fr", password: "un-tout-nouveau-mot-de-passe", displayName: "Jean Dupont" })
  );

  assert.equal(res.status, 200);
  assert.equal(users.get("u-jean")!.status, "ACTIVE");
  assert.equal((await verifyCredentials("jean.dupont@em-normandie.fr", "un-tout-nouveau-mot-de-passe"))?.sessionVersion, 1);
  assert.equal(await verifyCredentials("jean.dupont@em-normandie.fr", PASSWORD), null);
});

test("D4 : un compte désactivé se réactive par la remise en première connexion", async () => {
  const users = table(ME, { ...ACTIVE_USER, status: "DISABLED", password_hash: null, session_version: 1 });
  assert.equal((await resetUser(empty(), ctx("u-jean"))).status, 200);
  assert.equal(users.get("u-jean")!.status, "INVITED");
  assert.equal(users.get("u-jean")!.session_version, 2);
});

test("D4 : un invité y est déjà (409) ; un compte sans adresse ne peut pas y être remis (D3, 400)", async () => {
  let users = table(ME, INVITED);
  assert.equal((await resetUser(empty(), ctx("u-invite"))).status, 409);
  assert.deepEqual(users.get("u-invite"), INVITED);

  users = table(ME, LEGACY);
  const res = await resetUser(empty(), ctx("u-legacy"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /adresse/);
  assert.deepEqual(users.get("u-legacy"), LEGACY);

  table(ME);
  assert.equal((await resetUser(empty(), ctx("u-absent"))).status, 404);
});

// ── D21 : désactiver ─────────────────────────────────────────────────

test("D21 : désactiver coupe la connexion et les sessions ; nom, adresse et date sont gardés", async () => {
  const users = table(ME, ACTIVE_USER);

  const res = await disableUser(empty(), ctx("u-jean"));

  assert.equal(res.status, 200);
  const row = users.get("u-jean")!;
  assert.equal(row.status, "DISABLED");
  assert.equal(row.password_hash, null);
  assert.equal(row.session_version, 1);
  assert.equal(row.display_name, "Jean Dupont");
  assert.equal(row.email, "jean.dupont@em-normandie.fr");
  assert.deepEqual(row.first_login_at, ACTIVE_USER.first_login_at);
  assert.equal(await verifyCredentials("jean.dupont@em-normandie.fr", PASSWORD), null);
});

test("D24 : un invité se désactive (un compte remis en première connexion doit pouvoir se fermer)", async () => {
  // Jusqu'à l'étape 5, un invité ne se désactivait pas (D21) : il se
  // retirait. Un invité qui a modifié des données ne se retire plus (D24).
  const reset = { ...ACTIVE_USER, status: "INVITED", password_hash: null, first_login_at: null, session_version: 1 };
  const users = tableWithAuthors(["u-jean"], ME, reset);

  const res = await disableUser(empty(), ctx("u-jean"));

  assert.equal(res.status, 200);
  const row = users.get("u-jean")!;
  assert.equal(row.status, "DISABLED");
  assert.equal(row.session_version, 2);
  assert.equal(row.display_name, "Jean Dupont", "le nom reste pour l'historique");
  const firstLoginRes = await firstLogin(
    json({ email: "jean.dupont@em-normandie.fr", password: PASSWORD, displayName: "Jean Dupont" })
  );
  assert.equal(firstLoginRes.status, 403, "un compte désactivé ne fait pas de première connexion");
});

test("D21 : un compte déjà désactivé l'est déjà", async () => {
  const disabled = { ...ACTIVE_USER, status: "DISABLED", password_hash: null };
  const users = table(ME, disabled);
  const res = await disableUser(empty(), ctx("u-jean"));
  assert.equal(res.status, 409);
  assert.deepEqual(users.get("u-jean"), disabled);
});

test("D21 : un compte d'avant la liste blanche, sans adresse, se désactive aussi", async () => {
  const users = table(ME, LEGACY);
  assert.equal((await disableUser(empty(), ctx("u-legacy"))).status, 200);
  assert.equal(users.get("u-legacy")!.status, "DISABLED");
  assert.equal(await verifyCredentials("gestion1", PASSWORD), null);
});

// ── D3 : l'adresse d'un compte d'avant la liste blanche ──────────────

test("D3 : renseigner l'adresse d'un compte qui n'en a pas ; l'ancien identifiant cesse de servir", async () => {
  const users = table(ME, LEGACY);
  assert.ok(await verifyCredentials("gestion1", PASSWORD));

  const res = await setEmail(json({ email: " Paul.Gestion@em-normandie.fr " }, "PATCH"), ctx("u-legacy"));

  assert.equal(res.status, 200);
  assert.equal(users.get("u-legacy")!.email, "paul.gestion@em-normandie.fr");
  assert.equal(await verifyCredentials("gestion1", PASSWORD), null);
  assert.equal((await verifyCredentials("paul.gestion@em-normandie.fr", PASSWORD))?.id, "u-legacy");
  // Rien d'autre ne change : ni le mot de passe, ni le rôle, ni les sessions.
  assert.equal(users.get("u-legacy")!.password_hash, HASH);
  assert.equal(users.get("u-legacy")!.role, "GESTIONNAIRE");
  assert.equal(users.get("u-legacy")!.session_version, 0);
});

test("D3 : l'admin renseigne la sienne", async () => {
  const users = table({ ...ME, email: null, username: "admin" });
  assert.equal((await setEmail(json({ email: "admin@em-normandie.fr" }, "PATCH"), ctx(ADMIN_ID))).status, 200);
  assert.equal(users.get(ADMIN_ID)!.email, "admin@em-normandie.fr");
});

test("D3 : un compte qui a déjà une adresse → 409 ; une adresse prise par un autre → 409 ; hors domaine → 400", async () => {
  let users = table(ME, ACTIVE_USER);
  assert.equal((await setEmail(json({ email: "autre@em-normandie.fr" }, "PATCH"), ctx("u-jean"))).status, 409);
  assert.equal(users.get("u-jean")!.email, "jean.dupont@em-normandie.fr");

  users = table(ME, ACTIVE_USER, LEGACY);
  const taken = await setEmail(json({ email: "jean.dupont@em-normandie.fr" }, "PATCH"), ctx("u-legacy"));
  assert.equal(taken.status, 409);
  assert.match((await taken.json()).error, /déjà utilisée/);
  assert.equal(users.get("u-legacy")!.email, null);

  users = table(ME, LEGACY);
  assert.equal((await setEmail(json({ email: "paul@gmail.com" }, "PATCH"), ctx("u-legacy"))).status, 400);
  assert.deepEqual(db.calls, []);
});
