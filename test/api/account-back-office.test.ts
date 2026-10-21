/**
 * test/api/account-back-office.test.ts — GET /api/admin/account/back-office : le lien « Back-office » de la barre
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 10, D104 (revient sur D57) : l'accueil, les
 * deux fiches (cache ISR) et /api-docs ne lisent pas la session ; leur barre
 * demande à cette route si le compte a accès au back-office. Toute session
 * (`guardSignedIn`) ; un USER reçoit « non », un gestionnaire et un admin
 * « oui » ; rien d'autre ne part (ni identifiant, ni nom, ni adresse, ni
 * rôle), et la réponse n'est jamais mise en cache.
 *
 * Comme test/api/access-matrix.test.ts, `@/lib/auth` n'est pas remplacé :
 * la vraie lib/auth.ts juge, avec `getServerSession` de next-auth remplacé
 * et le faux Prisma qui rend le compte. Le jeton peut ainsi dire un autre
 * rôle que la base : c'est la base qui compte (D1), et un compte qui n'est
 * plus actif n'a plus de session (D20).
 */

import { afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { quietly } from "../helpers/requests";

globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Appel réseau interdit dans ce test : ${String(input)}`);
}) as typeof fetch;

/** Le jeton de la session : son compte, le rôle qu'il a copié, sa version (D20). */
let token: { id: string; role: string; sessionVersion: number } | null = null;

mock.module("next-auth", {
  exports: {
    getServerSession: async () =>
      token && {
        user: { id: token.id, name: "jeton", email: null, role: token.role, sessionVersion: token.sessionVersion },
        expires: "2099-01-01T00:00:00.000Z",
      },
  },
});
// La vraie route NextAuth charge Prisma et bcrypt : seul son authOptions
// intéresse lib/auth.ts.
mock.module("@/app/api/auth/[...nextauth]/route", {
  exports: { authOptions: { marker: "authOptions" } },
});

const db = installFakePrisma();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

let backOffice: () => Promise<Response>;

before(async () => {
  ({ GET: backOffice } = (await import("../../app/api/admin/account/back-office/route")) as unknown as {
    GET: () => Promise<Response>;
  });
});

/** Le compte en base, tel que lib/auth.ts le relit. */
function account(role: string, status = "ACTIVE", session_version = 0) {
  return {
    username: null,
    email: "camille.martin@em-normandie.fr",
    display_name: "Camille Martin",
    role,
    status,
    session_version,
  };
}

/** Le jeton dit `tokenRole`, la base `dbRole` ; rend la réponse de la route. */
async function ask(tokenRole: string, dbRole: string, status = "ACTIVE") {
  token = { id: "u-camille", role: tokenRole, sessionVersion: 0 };
  db.use({ user: { findUnique: () => account(dbRole, status) } });
  return quietly(() => backOffice());
}

test("sans session : 401, rien de lu en base", async () => {
  token = null;
  db.use({ user: { findUnique: () => account("ADMIN") } });
  const res = await backOffice();
  assert.equal(res.status, 401);
  assert.deepEqual(db.calls, []);
});

test("un USER : « non »", async () => {
  const res = await ask("USER", "USER");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { backOffice: false });
});

test("un gestionnaire et un admin : « oui »", async () => {
  for (const role of ["GESTIONNAIRE", "ADMIN"]) {
    const res = await ask(role, role);
    assert.equal(res.status, 200, role);
    assert.deepEqual(await res.json(), { backOffice: true }, role);
  }
});

test("D1 : le rôle de la base compte, jamais celui du jeton", async () => {
  // Un gestionnaire rétrogradé en USER depuis sa connexion : plus de lien.
  assert.deepEqual(await (await ask("GESTIONNAIRE", "USER")).json(), { backOffice: false });
  assert.deepEqual(await (await ask("ADMIN", "USER")).json(), { backOffice: false });
  // Un USER promu depuis sa connexion : le lien, sans se reconnecter.
  assert.deepEqual(await (await ask("USER", "GESTIONNAIRE")).json(), { backOffice: true });
  // Un rôle inconnu en base ne vaut que USER.
  assert.deepEqual(await (await ask("ADMIN", "MODERATOR")).json(), { backOffice: false });
});

test("D20 : un compte qui n'est plus actif, ou remis à zéro depuis le jeton, n'a plus de session : 401", async () => {
  for (const status of ["INVITED", "DISABLED"]) {
    assert.equal((await ask("ADMIN", "ADMIN", status)).status, 401, status);
  }
  token = { id: "u-camille", role: "ADMIN", sessionVersion: 0 };
  db.use({ user: { findUnique: () => account("ADMIN", "ACTIVE", 1) } });
  assert.equal((await quietly(() => backOffice())).status, 401, "version de session changée");
  token = { id: "u-disparu", role: "ADMIN", sessionVersion: 0 };
  db.use({ user: { findUnique: () => null } });
  assert.equal((await quietly(() => backOffice())).status, 401, "compte supprimé");
});

test("la réponse ne dit que oui ou non, et ne se met jamais en cache", async () => {
  for (const role of ["USER", "GESTIONNAIRE", "ADMIN"]) {
    const res = await ask(role, role);
    assert.deepEqual(Object.keys(await res.json()), ["backOffice"], role);
    const cacheControl = res.headers.get("cache-control") ?? "";
    assert.match(cacheControl, /\bno-store\b/, role);
    assert.match(cacheControl, /\bprivate\b/, role);
  }
});

test("la base n'est lue que pour relire le compte de la session, par son identifiant", async () => {
  await ask("GESTIONNAIRE", "GESTIONNAIRE");
  assert.deepEqual(
    db.calls.map((c) => `${c.model}.${c.method}`),
    ["user.findUnique"],
  );
  assert.deepEqual((db.calls[0].args[0] as { where: unknown }).where, { id: "u-camille" });
});
