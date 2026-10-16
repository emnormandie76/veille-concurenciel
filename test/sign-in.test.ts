/**
 * test/sign-in.test.ts — Les identifiants de la connexion (lib/sign-in.ts)
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 2 : la connexion se fait par l'adresse de
 * travail et le mot de passe (G5).
 * - D3 : l'ancien identifiant ne vaut que pour un compte qui n'a pas encore
 *   d'adresse ; dès qu'elle est posée, il cesse de servir ;
 * - un invité (pas encore de mot de passe) et un compte désactivé (D21) ne se
 *   connectent pas ;
 * - D20 : la version de session du compte part dans le jeton, que
 *   lib/auth.ts compare ensuite à chaque requête.
 *
 * NextAuth lui-même n'est pas chargé : la route ne fait que brancher
 * `verifyCredentials` et `authCallbacks`. bcryptjs est le vrai, avec un coût
 * faible pour les empreintes de test.
 */

import { afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import { installFakePrisma } from "./helpers/fake-prisma";
import { schemaErrors } from "./helpers/prisma-schema";
import { userRow, userTable } from "./helpers/fake-users";

const db = installFakePrisma();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

let signIn: typeof import("../lib/sign-in");

before(async () => {
  signIn = await import("../lib/sign-in");
});

const PASSWORD = "un-mot-de-passe-solide";
const HASH = bcrypt.hashSync(PASSWORD, 4);

const ACTIVE = userRow({
  id: "u-jean",
  email: "jean.dupont@em-normandie.fr",
  display_name: "Jean Dupont",
  password_hash: HASH,
  role: "GESTIONNAIRE",
  status: "ACTIVE",
  session_version: 3,
});
// Un compte d'avant la liste blanche : un identifiant, pas d'adresse (D3).
const LEGACY = userRow({ id: "u-admin", username: "admin", password_hash: HASH, role: "ADMIN", status: "ACTIVE" });

function table(...rows: ReturnType<typeof userRow>[]) {
  const users = userTable(rows);
  db.use({ user: users.methods });
  return users;
}

test("par l'adresse : le compte actif est reconnu, avec son nom, son rôle et sa version de session", async () => {
  table(ACTIVE);
  assert.deepEqual(await signIn.verifyCredentials("jean.dupont@em-normandie.fr", PASSWORD), {
    id: "u-jean",
    name: "Jean Dupont",
    email: "jean.dupont@em-normandie.fr",
    role: "GESTIONNAIRE",
    sessionVersion: 3,
  });
});

test("l'adresse saisie est rangée en minuscules et sans espaces avant la recherche", async () => {
  table(ACTIVE);
  assert.equal((await signIn.verifyCredentials("  Jean.Dupont@EM-Normandie.fr ", PASSWORD))?.id, "u-jean");
});

test("D3 : l'ancien identifiant vaut pour un compte sans adresse", async () => {
  table(LEGACY);
  const account = await signIn.verifyCredentials("admin", PASSWORD);
  assert.equal(account?.id, "u-admin");
  assert.equal(account?.name, "admin");
  assert.equal(account?.email, null);
});

test("D3 : dès que l'adresse est posée, l'identifiant cesse de servir ; l'adresse, elle, vaut", async () => {
  table({ ...LEGACY, email: "admin.veille@em-normandie.fr" });
  assert.equal(await signIn.verifyCredentials("admin", PASSWORD), null);
  assert.equal((await signIn.verifyCredentials("admin.veille@em-normandie.fr", PASSWORD))?.id, "u-admin");
});

test("un invité (sans mot de passe) ne se connecte pas", async () => {
  table(userRow({ id: "u-invite", email: "invite@em-normandie.fr" }));
  for (const password of [PASSWORD, "", "null"]) {
    assert.equal(await signIn.verifyCredentials("invite@em-normandie.fr", password), null);
  }
});

test("D21 : un compte désactivé ne se connecte pas", async () => {
  table({ ...ACTIVE, status: "DISABLED", password_hash: null });
  assert.equal(await signIn.verifyCredentials("jean.dupont@em-normandie.fr", PASSWORD), null);
});

test("mauvais mot de passe, compte inconnu, champs absents ou vides : refus silencieux", async () => {
  table(ACTIVE, LEGACY);
  const cases: [unknown, unknown][] = [
    ["jean.dupont@em-normandie.fr", "pas-le-bon-mot-de-passe"],
    ["inconnu@em-normandie.fr", PASSWORD],
    ["inconnu", PASSWORD],
    ["", PASSWORD],
    ["   ", PASSWORD],
    ["jean.dupont@em-normandie.fr", ""],
    [undefined, PASSWORD],
    ["jean.dupont@em-normandie.fr", undefined],
    [{ email: "jean.dupont@em-normandie.fr" }, PASSWORD],
  ];
  for (const [login, password] of cases) {
    assert.equal(await signIn.verifyCredentials(login, password), null, `${String(login)} / ${String(password)}`);
  }
});

test("un rôle inconnu en base ne vaut que USER", async () => {
  // La table refuse un rôle hors liste, comme la base : on le force après coup.
  const users = table(ACTIVE);
  users.get("u-jean")!.role = "MODERATOR";
  assert.equal((await signIn.verifyCredentials("jean.dupont@em-normandie.fr", PASSWORD))?.role, "USER");
});

test("D20 : la version de session passe du compte au jeton, puis à la session", async () => {
  // Les objets de NextAuth sont plus riches : seuls comptent ici les champs lus.
  const token = await signIn.authCallbacks.jwt({
    token: { sub: "u-jean" } as never,
    user: { id: "u-jean", role: "GESTIONNAIRE", sessionVersion: 3 } as never,
  });
  assert.deepEqual(token, { sub: "u-jean", id: "u-jean", role: "GESTIONNAIRE", sessionVersion: 3 });

  // Les appels suivants (pas de `user`) gardent le jeton tel quel.
  assert.deepEqual(await signIn.authCallbacks.jwt({ token }), token);

  const session = await signIn.authCallbacks.session({
    session: { user: { name: "Jean Dupont", email: "jean.dupont@em-normandie.fr" }, expires: "2099-01-01" } as never,
    token,
  });
  assert.deepEqual(session.user, {
    name: "Jean Dupont",
    email: "jean.dupont@em-normandie.fr",
    id: "u-jean",
    role: "GESTIONNAIRE",
    sessionVersion: 3,
  });
});
