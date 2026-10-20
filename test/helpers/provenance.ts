/**
 * test/helpers/provenance.ts — La provenance dans les tests de routes (plan gestion-contenu, étape 5)
 *
 *     const cache = installContentCache();   // avant d'importer la route
 *     assert.deepEqual(contentOf(data, "test-gestionnaire"), { name: "Caen", city: null });
 *
 * Depuis l'étape 5, chaque écriture du contenu porte `updated_by_id`,
 * `updated_at` et `updated_via` (lib/provenance.ts). `contentOf` les vérifie
 * (l'auteur de la session, une date posée par le serveur, l'origine), puis
 * rend le reste : l'attendu d'un test dit toujours ce que la route écrit du
 * contenu. Chaque écriture est vérifiée une à une dans
 * test/api/provenance.test.ts.
 *
 * `installContentCache` remplace `next/cache` : hors de Next, `revalidatePath`
 * lève (pas de magasin de rendu), et lib/content-cache.ts le journaliserait.
 * Remplacé, il note ses appels.
 */

import assert from "node:assert/strict";
import { mock } from "node:test";

/** Les champs écrits, sans la provenance, une fois celle-ci vérifiée. */
export function contentOf(data: unknown, userId: string, via = "MANUAL"): Record<string, unknown> {
  const { updated_at, updated_by_id, updated_via, ...rest } = (data ?? {}) as Record<string, unknown>;
  assert.equal(updated_by_id, userId, "l'auteur est le compte de la session");
  assert.equal(updated_via, via, "l'origine de la modification");
  assert.ok(updated_at instanceof Date, "la date est posée par le serveur");
  return rest;
}

/** Remplace `next/cache` ; rend la liste des appels à `revalidatePath`. */
export function installContentCache(): unknown[][] {
  const calls: unknown[][] = [];
  mock.module("next/cache", {
    exports: {
      revalidatePath: (...args: unknown[]) => {
        calls.push(args);
      },
    },
  });
  return calls;
}
