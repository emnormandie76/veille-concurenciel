/**
 * test/api/first-login.test.ts — POST /api/first-login, la première connexion
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 2 (G5) : l'admin ajoute l'adresse d'un collègue
 * à la liste, sans envoi d'e-mail ; à sa première connexion, la personne saisit
 * cette adresse, choisit son mot de passe et son nom affiché (D6), et son
 * compte devient actif. Une adresse hors liste ne crée rien ; un compte déjà
 * actif ou désactivé ne se « réactive » pas par cette porte, et le refus est le
 * même dans tous ces cas.
 *
 * La route est ouverte sans session (proxy.ts) et partage le plafond de la
 * connexion (test/proxy.test.ts). bcryptjs est le vrai.
 */

import { afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { userRow, userTable, type UserRow } from "../helpers/fake-users";

const db = installFakePrisma();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
// Le journal d'audit de la route ([audit] …) n'est pas l'objet de ces tests.
mock.method(console, "log", () => {});

let firstLogin: (request: Request) => Promise<Response>;

before(async () => {
  ({ POST: firstLogin } = await import("../../app/api/first-login/route"));
});

const PASSWORD = "mon-premier-mot-de-passe";
const OLD_HASH = bcrypt.hashSync("ancien-mot-de-passe-1", 4);

const INVITED = userRow({ id: "u-invite", email: "jean.dupont@em-normandie.fr" });

function table(...rows: UserRow[]) {
  const users = userTable(rows);
  db.use({ user: users.methods });
  return users;
}

const post = (body: unknown) =>
  firstLogin(
    new Request("http://localhost/api/first-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

const valid = (overrides: Record<string, unknown> = {}) => ({
  email: "jean.dupont@em-normandie.fr",
  password: PASSWORD,
  displayName: "Jean Dupont",
  ...overrides,
});

const NO_INVITATION = /Aucune invitation en attente pour cette adresse/;

test("un invité choisit son mot de passe et son nom : son compte devient actif", async () => {
  const users = table(INVITED);
  const before = Date.now();

  const res = await post(valid({ displayName: "  Jean   Dupont " }));

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.password_hash, undefined);
  const row = users.get("u-invite")!;
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.display_name, "Jean Dupont");
  assert.ok(row.password_hash && (await bcrypt.compare(PASSWORD, row.password_hash)));
  assert.ok(row.first_login_at && row.first_login_at.getTime() >= before);
  // Le rôle et la version de session ne changent pas.
  assert.equal(row.role, "USER");
  assert.equal(row.session_version, 0);
});

test("G5 : il devient USER, ou garde le rôle que l'admin lui a donné avant", async () => {
  const users = table({ ...INVITED, role: "GESTIONNAIRE" });
  assert.equal((await post(valid())).status, 200);
  assert.equal(users.get("u-invite")!.role, "GESTIONNAIRE");
});

test("l'adresse saisie est rangée en minuscules et sans espaces", async () => {
  const users = table(INVITED);
  assert.equal((await post(valid({ email: "  Jean.Dupont@EM-Normandie.fr " }))).status, 200);
  assert.equal(users.get("u-invite")!.status, "ACTIVE");
});

test("un e-mail hors liste ne crée rien", async () => {
  const users = table(INVITED);

  const res = await post(valid({ email: "intrus@em-normandie.fr" }));

  assert.equal(res.status, 403);
  assert.match((await res.json()).error, NO_INVITATION);
  assert.equal(users.rows.length, 1);
  assert.equal(users.get("u-invite")!.status, "INVITED");
  assert.equal(db.calls.some((c) => ["create", "createMany", "upsert"].includes(c.method)), false);
});

test("un compte déjà actif ne choisit pas un nouveau mot de passe par cette porte : même refus", async () => {
  const users = table({ ...INVITED, status: "ACTIVE", password_hash: OLD_HASH, display_name: "Jean" });

  const res = await post(valid());

  assert.equal(res.status, 403);
  assert.match((await res.json()).error, NO_INVITATION);
  assert.equal(users.get("u-invite")!.password_hash, OLD_HASH);
  assert.equal(users.get("u-invite")!.display_name, "Jean");
});

test("D21 : un compte désactivé non plus", async () => {
  const users = table({ ...INVITED, status: "DISABLED" });
  assert.equal((await post(valid())).status, 403);
  assert.equal(users.get("u-invite")!.status, "DISABLED");
});

test("D5 : une adresse hors du domaine est refusée avant la base", async () => {
  table(INVITED);
  const res = await post(valid({ email: "jean.dupont@gmail.com" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /@em-normandie\.fr/);
  assert.deepEqual(db.calls, []);
});

test("la politique du mot de passe et le nom affiché sont contrôlés avant la base", async () => {
  for (const overrides of [
    { password: "court" },
    { password: undefined },
    { password: "🔑".repeat(19) },
    { displayName: "" },
    { displayName: "J" },
    { displayName: undefined },
    { email: undefined },
  ]) {
    table(INVITED);
    const res = await post(valid(overrides));
    assert.equal(res.status, 400, JSON.stringify(overrides));
    assert.deepEqual(db.calls, [], JSON.stringify(overrides));
  }
});

test("corps illisible → 400, rien de lu", async () => {
  table(INVITED);
  for (const body of ["{pas du json", "null", "[]", '"texte"']) {
    assert.equal((await post(body)).status, 400, body);
  }
  assert.deepEqual(db.calls, []);
});

test("deux premières connexions concurrentes : une seule l'emporte", async () => {
  // L'écriture vise l'invité dans l'état « invité » : la seconde ne trouve plus personne.
  const users = table(INVITED);
  assert.equal((await post(valid())).status, 200);
  const hash = users.get("u-invite")!.password_hash;

  assert.equal((await post(valid({ password: "un-autre-mot-de-passe" }))).status, 403);
  assert.equal(users.get("u-invite")!.password_hash, hash);
});
