/**
 * test/helpers/fake-prisma.ts — Faux client Prisma pour tester les routes Next.js
 *
 *     const db = installFakePrisma();          // avant d'importer la route
 *     db.use({ contributionInbox: { findUnique: () => ticket } });
 *     // … appel du handler …
 *     assert.deepEqual(db.calls, []);
 *
 * `installFakePrisma` remplace `@/lib/prisma` par `mock.module`. Chaque test ne
 * déclare que les méthodes dont il a besoin ; tout appel est enregistré dans
 * `calls`, y compris celui d'une méthode non déclarée, qui lève une erreur
 * explicite. `$transaction(fn)` appelle `fn` avec le même faux, et une
 * exception lancée dans `fn` remonte ; la forme tableau attend chaque requête
 * dans l'ordre.
 *
 * Le module doit être importé avant la route : la route est chargée par un
 * `import()` dynamique, après le remplacement (voir test/api/).
 */

import { mock } from "node:test";

// Garde-fou : si un test chargeait par erreur le vrai lib/prisma, celui-ci
// viserait une adresse locale morte, jamais Neon. dotenv ne remplace pas une
// variable déjà posée, donc `.env.local` ne reprend pas la main.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:9/test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeMethod = (...args: any[]) => unknown;
export type FakeModels = Record<string, Record<string, FakeMethod>>;

export interface FakePrismaCall {
  model: string;
  method: string;
  args: unknown[];
}

export interface FakePrisma {
  /** Le client que reçoivent les routes à la place de `prisma`. */
  prisma: Record<string, unknown>;
  /** Appels reçus depuis le dernier `use()`, dans l'ordre. */
  calls: FakePrismaCall[];
  /** Remplace les méthodes déclarées et vide le journal des appels. */
  use(models: FakeModels): void;
}

export function createFakePrisma(initial: FakeModels = {}): FakePrisma {
  let models = initial;
  const calls: FakePrismaCall[] = [];

  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get(_target, method) {
          if (typeof method !== "string" || method === "then") return undefined;
          return async (...args: unknown[]) => {
            calls.push({ model, method, args });
            const impl = models[model]?.[method];
            if (!impl) {
              throw new Error(
                `Faux Prisma : ${model}.${method} n'est pas déclaré par ce test.`
              );
            }
            return impl(...args);
          };
        },
      }
    );

  async function transaction(arg: unknown): Promise<unknown> {
    if (typeof arg === "function") {
      calls.push({ model: "$transaction", method: "callback", args: [] });
      return arg(prisma);
    }
    if (Array.isArray(arg)) {
      calls.push({ model: "$transaction", method: "array", args: [] });
      const results: unknown[] = [];
      for (const query of arg) results.push(await query);
      return results;
    }
    throw new TypeError("Faux Prisma : $transaction attend une fonction ou un tableau.");
  }

  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "$transaction") return transaction;
        // `then` absent : le client ne doit pas passer pour une promesse.
        if (typeof prop !== "string" || prop === "then") return undefined;
        return modelProxy(prop);
      },
    }
  );

  return {
    prisma,
    calls,
    use(next) {
      models = next;
      calls.length = 0;
    },
  };
}

/** Crée le faux et l'installe à la place de `@/lib/prisma`. */
export function installFakePrisma(initial: FakeModels = {}): FakePrisma {
  const db = createFakePrisma(initial);
  mock.module("@/lib/prisma", { exports: { prisma: db.prisma } });
  return db;
}
