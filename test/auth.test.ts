/**
 * test/auth.test.ts — Les gardes et la session (lib/auth.ts, lib/roles.ts)
 *
 *     npm run test:ts
 *
 * Toutes les routes admin en dépendent (docs/architecture/gestion-contenu.md
 * §2). Les tests de routes remplacent ce module par test/helpers/session.ts ;
 * ici, c'est la logique réelle de lib/auth.ts qui est testée, avec
 * `getServerSession` de next-auth, `redirect` de next/navigation et Prisma
 * remplacés.
 *
 * Plan gestion-contenu, étape 1 : trois rôles (USER, GESTIONNAIRE, ADMIN),
 * trois gardes (`guardSignedIn`, `guardManager`, `guardAdmin`), et D1 : le rôle
 * est relu en base à chaque appel, celui du jeton ne compte pas ; un compte
 * supprimé n'a plus de session.
 */

import { afterEach, before, test, mock } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma } from "./helpers/fake-prisma";
import { schemaErrors } from "./helpers/prisma-schema";

type Session = { user?: { id: string; name: string; email: string | null; role: string } } | null;

let current: Session = null;
/** Vrai : getServerSession lève, comme sur un cookie corrompu (JWEDecryptionFailed). */
let unreadable = false;
const received: unknown[] = [];
const AUTH_OPTIONS = { marker: "authOptions de la route NextAuth" };

mock.module("next-auth", {
  exports: {
    getServerSession: async (options: unknown) => {
      received.push(options);
      if (unreadable) throw new Error("JWEDecryptionFailed");
      return current;
    },
  },
});
// La vraie route NextAuth charge Prisma et bcrypt : seul son authOptions
// intéresse lib/auth.ts.
mock.module("@/app/api/auth/[...nextauth]/route", {
  exports: { authOptions: AUTH_OPTIONS },
});

/** `redirect` de Next lève ; ce faux lève une erreur qui porte la destination. */
class Redirected extends Error {
  constructor(public readonly url: string) {
    super(`redirection vers ${url}`);
  }
}
mock.module("next/navigation", {
  exports: {
    redirect: (url: string) => {
      throw new Redirected(url);
    },
  },
});

const db = installFakePrisma();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

let auth: typeof import("../lib/auth");
let roles: typeof import("../lib/roles");

before(async () => {
  auth = await import("../lib/auth");
  roles = await import("../lib/roles");
});

/** Une session NextAuth dont le jeton porte `tokenRole`. */
const sessionOf = (id: string, tokenRole: string): Session => ({
  user: { id, name: `compte-${id}`, email: null, role: tokenRole },
});

/** La base ne connaît que ces comptes. */
function accounts(rows: Record<string, string>) {
  db.use({
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        where.id in rows
          ? { id: where.id, username: `compte-${where.id}`, role: rows[where.id] }
          : null,
    },
  });
}

/** Connecte `id` avec, en base, le rôle `role` (le jeton dit la même chose). */
function signedInAs(role: string, id = `u-${role.toLowerCase()}`) {
  current = sessionOf(id, role);
  accounts({ [id]: role });
}

// ── Les rôles ─────────────────────────────────────────────────────────

test("trois rôles, et MODERATOR n'en est plus un", () => {
  assert.deepEqual([...roles.USER_ROLES], ["USER", "GESTIONNAIRE", "ADMIN"]);
  for (const role of ["USER", "GESTIONNAIRE", "ADMIN"]) assert.equal(roles.isUserRole(role), true);
  for (const role of ["MODERATOR", "admin", "", undefined, null, 1]) {
    assert.equal(roles.isUserRole(role), false, String(role));
  }
});

test("hasAccess : chaque niveau et les rôles qui l'atteignent", () => {
  const table: [string, string, boolean][] = [
    ["USER", "signedIn", true],
    ["USER", "manager", false],
    ["USER", "admin", false],
    ["GESTIONNAIRE", "signedIn", true],
    ["GESTIONNAIRE", "manager", true],
    ["GESTIONNAIRE", "admin", false],
    ["ADMIN", "signedIn", true],
    ["ADMIN", "manager", true],
    ["ADMIN", "admin", true],
  ];
  for (const [role, level, expected] of table) {
    assert.equal(
      roles.hasAccess(role as never, level as never),
      expected,
      `${role} sur ${level}`
    );
  }
});

// ── getSession : le rôle relu en base (D1) ────────────────────────────

test("getSession lit la session avec les options de la route NextAuth", async () => {
  signedInAs("GESTIONNAIRE", "u-gest");
  received.length = 0;

  const session = await auth.getSession();
  assert.deepEqual(session, {
    user: { id: "u-gest", name: "compte-u-gest", email: null, role: "GESTIONNAIRE" },
  });
  assert.deepEqual(received, [AUTH_OPTIONS]);
});

test("sans session, ou une session sans utilisateur : null, et la base n'est pas lue", async () => {
  for (const s of [null, {}, { user: { name: "sans-id", email: null, role: "ADMIN" } }] as Session[]) {
    current = s;
    accounts({});
    assert.equal(await auth.getSession(), null);
    assert.deepEqual(db.calls, []);
  }
});

test("un cookie illisible vaut absence de session : null, 401, et la base n'est pas lue", async () => {
  unreadable = true;
  accounts({});
  try {
    assert.equal(await auth.getSession(), null);
    assert.equal((await auth.guardSignedIn()).error?.status, 401);
    assert.deepEqual(db.calls, []);
  } finally {
    unreadable = false;
  }
});

test("une panne de la base remonte : elle ne se déguise ni en refus ni en session", async () => {
  current = sessionOf("u-1", "ADMIN");
  db.use({
    user: {
      findUnique: () => {
        throw new Error("base injoignable");
      },
    },
  });
  await assert.rejects(() => auth.getSession(), /base injoignable/);
  await assert.rejects(() => auth.guardAdmin(), /base injoignable/);
});

test("D1 : le rôle vient de la base, pas du jeton", async () => {
  // Jeton émis quand le compte était ADMIN ; il a été rétrogradé depuis.
  current = sessionOf("u-1", "ADMIN");
  accounts({ "u-1": "GESTIONNAIRE" });

  const session = await auth.getSession();
  assert.equal(session?.user.role, "GESTIONNAIRE");
  assert.equal((await auth.guardAdmin()).error?.status, 403);

  // Et dans l'autre sens : promu depuis la connexion.
  current = sessionOf("u-2", "USER");
  accounts({ "u-2": "ADMIN" });
  assert.equal((await auth.guardAdmin()).error, null);
});

test("D1 : la relecture vise le compte du jeton, par son identifiant", async () => {
  signedInAs("USER", "u-lu");
  await auth.getSession();

  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].model, "user");
  assert.equal(db.calls[0].method, "findUnique");
  assert.deepEqual((db.calls[0].args[0] as { where: unknown }).where, { id: "u-lu" });
});

test("D1 : un compte supprimé n'a plus de session, même avec un jeton valide", async () => {
  current = sessionOf("u-supprime", "ADMIN");
  accounts({});

  assert.equal(await auth.getSession(), null);
  for (const guard of [auth.guardSignedIn, auth.guardManager, auth.guardAdmin]) {
    assert.equal((await guard()).error?.status, 401);
  }
});

test("un rôle inconnu en base ne donne que les droits d'un USER", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    for (const role of ["MODERATOR", "admin", ""]) {
      current = sessionOf("u-x", "ADMIN");
      accounts({ "u-x": role });

      assert.equal((await auth.getSession())?.user.role, "USER", role);
      assert.equal((await auth.guardSignedIn()).error, null, role);
      assert.equal((await auth.guardManager()).error?.status, 403, role);
      assert.equal((await auth.guardAdmin()).error?.status, 403, role);
    }
  } finally {
    warn.mock.restore();
  }
});

// ── Les trois gardes ──────────────────────────────────────────────────

test("sans session : 401 sur les trois gardes", async () => {
  current = null;
  accounts({});
  for (const guard of [auth.guardSignedIn, auth.guardManager, auth.guardAdmin]) {
    const { session, error } = await guard();
    assert.equal(session, null);
    assert.equal(error?.status, 401);
    assert.deepEqual(await error?.json(), { error: "Non authentifié. Veuillez vous connecter." });
  }
});

test("guardSignedIn : toute session passe", async () => {
  for (const role of ["USER", "GESTIONNAIRE", "ADMIN"]) {
    signedInAs(role);
    const { session, error } = await auth.guardSignedIn();
    assert.equal(error, null, role);
    assert.equal(session?.user.role, role);
  }
});

test("guardManager : un USER → 403 ; GESTIONNAIRE et ADMIN passent", async () => {
  signedInAs("USER");
  const refused = await auth.guardManager();
  assert.equal(refused.session, null);
  assert.equal(refused.error?.status, 403);
  assert.deepEqual(await refused.error?.json(), { error: "Accès refusé. Droits GESTIONNAIRE requis." });

  for (const role of ["GESTIONNAIRE", "ADMIN"]) {
    signedInAs(role);
    const { session, error } = await auth.guardManager();
    assert.equal(error, null, role);
    assert.equal(session?.user.role, role);
  }
});

test("guardAdmin : USER et GESTIONNAIRE → 403 ; ADMIN passe", async () => {
  for (const role of ["USER", "GESTIONNAIRE"]) {
    signedInAs(role);
    const { session, error } = await auth.guardAdmin();
    assert.equal(session, null);
    assert.equal(error?.status, 403, role);
    assert.deepEqual(await error?.json(), { error: "Accès refusé. Droits ADMIN requis." });
  }
  signedInAs("ADMIN");
  const { session, error } = await auth.guardAdmin();
  assert.equal(error, null);
  assert.equal(session?.user.role, "ADMIN");
});

test("piège 1 : l'ancienne garde « toute session » n'est plus exportée", () => {
  const exported = Object.keys(auth);
  assert.equal(exported.includes("guardAuth"), false);
  assert.equal(exported.includes("requireAuth"), false);
});

// ── Les pages : requirePage ───────────────────────────────────────────

async function destination(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    if (error instanceof Redirected) return error.url;
    throw error;
  }
}

test("requirePage : sans session, vers la connexion", async () => {
  current = null;
  accounts({});
  for (const level of ["signedIn", "manager", "admin"] as const) {
    assert.equal(await destination(() => auth.requirePage(level)), "/admin/login");
  }
});

test("requirePage : un cookie illisible renvoie aussi vers la connexion", async () => {
  unreadable = true;
  accounts({});
  try {
    assert.equal(await destination(() => auth.requirePage("manager")), "/admin/login");
  } finally {
    unreadable = false;
  }
});

test("requirePage : un USER est renvoyé vers le site ; un GESTIONNAIRE hors de l'IA vers les écoles", async () => {
  signedInAs("USER");
  assert.equal(await destination(() => auth.requirePage("manager")), "/");
  assert.equal(await destination(() => auth.requirePage("admin")), "/");

  signedInAs("GESTIONNAIRE");
  assert.equal(await destination(() => auth.requirePage("admin")), "/admin/schools");
});

test("requirePage : le rôle suffisant rend la session", async () => {
  const cases: [string, "signedIn" | "manager" | "admin"][] = [
    ["USER", "signedIn"],
    ["GESTIONNAIRE", "manager"],
    ["ADMIN", "manager"],
    ["ADMIN", "admin"],
  ];
  for (const [role, level] of cases) {
    signedInAs(role);
    const session = await auth.requirePage(level);
    assert.equal(session.user.role, role, `${role} sur ${level}`);
  }
});
