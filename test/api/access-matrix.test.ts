/**
 * test/api/access-matrix.test.ts — Chaque route du back-office, sous chaque rôle
 *
 *     npm run test:ts
 *
 * Plan gestion-contenu, étape 1 (pièges 1 et 3) : chaque handler de
 * `app/api/admin/**` est appelé sans session, puis en USER, en GESTIONNAIRE et
 * en ADMIN. L'attendu vient de test/helpers/access-policy.ts :
 * - sans session : 401, et rien n'est lu en base ;
 * - rôle insuffisant : 403 de la garde, et rien n'est lu hors la relecture du
 *   compte (D1) ;
 * - rôle suffisant : la garde laisse passer (la route répond ensuite ce qu'elle
 *   veut : 400, 404, 500 sur une base vide, 503 sans backend…).
 *
 * Contrairement aux autres tests de routes, `@/lib/auth` n'est pas remplacé :
 * c'est la vraie lib/auth.ts qui juge, avec `getServerSession` de next-auth
 * remplacé et le faux Prisma (test/helpers/fake-prisma.ts) qui rend le compte.
 * Les fichiers sont énumérés : une nouvelle route est couverte d'office.
 * Aucun appel réseau : `fetch` lève, et `FASTAPI_URL` est retirée.
 */

import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { installFakePrisma } from "../helpers/fake-prisma";
import { installContentCache } from "../helpers/provenance";
import { schemaErrors } from "../helpers/prisma-schema";
import { quietly } from "../helpers/requests";
import {
  ADMIN_ROOT,
  METHODS,
  adminRouteFiles,
  expectedLevel,
  routeKey,
  type AccessLevel,
} from "../helpers/access-policy";

delete process.env.FASTAPI_URL;
delete process.env.INTERNAL_API_TOKEN;
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Appel réseau interdit dans ce test : ${String(input)}`);
}) as typeof fetch;

type Profile = "none" | "USER" | "GESTIONNAIRE" | "ADMIN";
const PROFILES: Profile[] = ["none", "USER", "GESTIONNAIRE", "ADMIN"];

// Comptes actifs, en version de session 0 comme leur jeton (D20).
const ACCOUNTS: Record<Exclude<Profile, "none">, { id: string; username: string; role: string }> = {
  USER: { id: "u-user", username: "utilisateur", role: "USER" },
  GESTIONNAIRE: { id: "u-gest", username: "gestionnaire", role: "GESTIONNAIRE" },
  ADMIN: { id: "u-admin", username: "admin", role: "ADMIN" },
};

let profile: Profile = "none";

mock.module("next-auth", {
  exports: {
    getServerSession: async () => {
      if (profile === "none") return null;
      const account = ACCOUNTS[profile];
      return {
        user: { id: account.id, name: account.username, email: null, role: account.role, sessionVersion: 0 },
        expires: "2099-01-01T00:00:00.000Z",
      };
    },
  },
});
// La vraie route NextAuth charge Prisma et bcrypt : seul son authOptions
// intéresse lib/auth.ts.
mock.module("@/app/api/auth/[...nextauth]/route", {
  exports: { authOptions: { marker: "authOptions" } },
});

const db = installFakePrisma();
// Étape 5 : les écritures revalident les fiches (lib/content-cache.ts).
installContentCache();

afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});

/** Le compte que relit lib/auth.ts (D1) ; un autre identifiant n'existe pas. */
function accountRow({ where }: { where: { id?: string } }) {
  const account = Object.values(ACCOUNTS).find((a) => a.id === where.id);
  return account
    ? {
        ...account,
        email: null,
        display_name: null,
        status: "ACTIVE",
        session_version: 0,
        password_hash: "x",
        createdAt: new Date(0),
      }
    : null;
}

const ALLOWED: Record<AccessLevel, Profile[]> = {
  signedIn: ["USER", "GESTIONNAIRE", "ADMIN"],
  manager: ["GESTIONNAIRE", "ADMIN"],
  admin: ["ADMIN"],
};

const UNAUTHENTICATED = "Non authentifié. Veuillez vous connecter.";
/** Les refus des gardes, à distinguer des 403 qu'une route rend elle-même. */
const GUARD_REFUSALS = new Set([
  "Accès refusé. Droits GESTIONNAIRE requis.",
  "Accès refusé. Droits ADMIN requis.",
]);

type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface Outcome {
  status: number | "thrown";
  error?: unknown;
}

async function call(handler: Handler, method: string): Promise<Outcome> {
  const request = new Request("http://localhost/api/admin/x?confirmName=x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });
  const ctx = { params: Promise.resolve({ id: "cible-1", recordId: "fiche-1" }) };
  try {
    const res = await quietly(() => handler(request, ctx));
    let error: unknown;
    try {
      error = ((await res.clone().json()) as { error?: unknown })?.error;
    } catch {
      error = undefined;
    }
    return { status: res.status, error };
  } catch {
    // Une garde ne lève pas : un handler qui lève l'a donc passée.
    return { status: "thrown" };
  }
}

/** Appels en base autres que la relecture du compte connecté. */
function dataCalls() {
  return db.calls.filter(
    (c) =>
      !(
        c.model === "user" &&
        c.method === "findUnique" &&
        Object.values(ACCOUNTS).some(
          (a) => (c.args[0] as { where?: { id?: string } })?.where?.id === a.id
        )
      )
  );
}

const files = adminRouteFiles();
let handlerCount = 0;

test("l'énumération descend dans tous les sous-dossiers du back-office", () => {
  assert.ok(files.includes("inbox/[id]/validate/route.ts"));
  assert.ok(files.includes("schools/[id]/stats/[recordId]/route.ts"));
});

for (const rel of files) {
  test(`app/api/admin/${rel}`, async (t) => {
    const mod = (await import(pathToFileURL(path.join(ADMIN_ROOT, rel)).href)) as Record<string, unknown>;
    const methods = METHODS.filter((m) => typeof mod[m] === "function");
    assert.ok(methods.length > 0, "aucun handler exporté");

    for (const method of methods) {
      handlerCount += 1;
      const handler = mod[method] as Handler;
      const key = `${method} ${routeKey(rel)}`;
      const level = expectedLevel(key);

      for (const p of PROFILES) {
        const allowed = p !== "none" && ALLOWED[level].includes(p);
        const expectation = p === "none" ? "401" : allowed ? "passe" : "403";

        await t.test(`${method} [${level}] en ${p} → ${expectation}`, async () => {
          profile = p;
          db.use({ user: { findUnique: accountRow } });
          const outcome = await call(handler, method);

          if (p === "none") {
            assert.equal(outcome.status, 401);
            assert.equal(outcome.error, UNAUTHENTICATED);
            assert.deepEqual(db.calls, [], "la base est lue sans session");
          } else if (!allowed) {
            assert.equal(outcome.status, 403);
            assert.ok(GUARD_REFUSALS.has(String(outcome.error)), `refus inattendu : ${String(outcome.error)}`);
            assert.deepEqual(dataCalls(), [], "la base est lue malgré le refus");
          } else {
            const refused =
              outcome.status === 401 ||
              (outcome.status === 403 && GUARD_REFUSALS.has(String(outcome.error)));
            assert.equal(refused, false, `refusé par la garde (${outcome.status})`);
          }
        });
      }
    }
  });
}

test("toutes les méthodes du back-office ont été appelées", () => {
  // 48 à la fin de l'étape 1 (16 octobre 2026) ; 53 à l'étape 2 : quatre
  // routes des comptes (rôle, remise à zéro, désactivation, adresse) et deux
  // de « Mon compte » ; la route du mot de passe d'un tiers a disparu (D4).
  // 56 à l'étape 6 (les trois méthodes des signalements) ; 60 à l'étape 8 :
  // les quatre des admissions (D50) ; 61 à l'étape 10 : la question du lien
  // « Back-office » (D104).
  assert.ok(handlerCount >= 61, `seulement ${handlerCount} handlers appelés`);
});
