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
 * Le faux n'a pas de base, donc pas de rollback réel. Il retient en revanche
 * ce qu'une transaction en échec a annulé : les appels faits pendant un
 * `$transaction(fn)` qui lève, et toutes les requêtes d'un `$transaction([…])`
 * dont l'une échoue. Attention : dans la forme tableau, le faux exécute chaque
 * requête dès sa construction (Prisma, lui, attend la transaction). Une
 * écriture vue dans `calls` n'est donc pas forcément tenue : `writes()` rend
 * les seules écritures qu'une base aurait gardées.
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
  /** Appels annulés par une transaction en échec, depuis le dernier `use()`. */
  rolledBack: Set<FakePrismaCall>;
  /** Les écritures qu'une base aurait gardées : hors transaction annulée. */
  writes(): FakePrismaCall[];
  /** Remplace les méthodes déclarées et vide le journal des appels. */
  use(models: FakeModels): void;
}

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

export function createFakePrisma(initial: FakeModels = {}): FakePrisma {
  let models = initial;
  const calls: FakePrismaCall[] = [];
  const rolledBack = new Set<FakePrismaCall>();
  // Requête → appel, pour retrouver les membres d'un `$transaction([…])`.
  const callOf = new WeakMap<Promise<unknown>, FakePrismaCall>();

  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get(_target, method) {
          if (typeof method !== "string" || method === "then") return undefined;
          return (...args: unknown[]) => {
            const call: FakePrismaCall = { model, method, args };
            calls.push(call);
            const query = (async () => {
              const impl = models[model]?.[method];
              if (!impl) {
                throw new Error(
                  `Faux Prisma : ${model}.${method} n'est pas déclaré par ce test.`
                );
              }
              return impl(...args);
            })();
            callOf.set(query, call);
            return query;
          };
        },
      }
    );

  async function transaction(arg: unknown): Promise<unknown> {
    if (typeof arg === "function") {
      calls.push({ model: "$transaction", method: "callback", args: [] });
      const start = calls.length;
      try {
        return await arg(prisma);
      } catch (error) {
        for (const call of calls.slice(start)) rolledBack.add(call);
        throw error;
      }
    }
    if (Array.isArray(arg)) {
      calls.push({ model: "$transaction", method: "array", args: [] });
      // Toutes les requêtes sont réglées avant de conclure : une seconde
      // requête en échec ne doit pas finir en rejet non intercepté.
      const settled = await Promise.allSettled(arg);
      const failure = settled.find((s) => s.status === "rejected");
      if (failure) {
        for (const query of arg) {
          const call = callOf.get(query);
          if (call) rolledBack.add(call);
        }
        throw (failure as PromiseRejectedResult).reason;
      }
      return settled.map((s) => (s as PromiseFulfilledResult<unknown>).value);
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
    rolledBack,
    writes() {
      return calls.filter((c) => WRITE_METHODS.has(c.method) && !rolledBack.has(c));
    },
    use(next) {
      models = next;
      calls.length = 0;
      rolledBack.clear();
    },
  };
}

/** Crée le faux et l'installe à la place de `@/lib/prisma`. */
export function installFakePrisma(initial: FakeModels = {}): FakePrisma {
  const db = createFakePrisma(initial);
  mock.module("@/lib/prisma", { exports: { prisma: db.prisma } });
  return db;
}
