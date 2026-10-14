/**
 * test/migration-plan.test.ts — Migrations Prisma appliquées par WebSocket
 *
 *     npm run test:ts
 *
 * Sur le réseau de l'établissement, le 5432 de Neon est fermé et la CLI Prisma
 * ne peut ni lire ni appliquer les migrations. `npm run db:status` et
 * `npm run db:migrate` passent alors par `@neondatabase/serverless`
 * (`DB_DRIVER=neon-ws`) et refont le travail de Prisma : comparer le dossier
 * `prisma/migrations` à la table `_prisma_migrations`, puis appliquer ce qui
 * manque.
 *
 * L'empreinte est le sha256 des octets du fichier. Git peut extraire un
 * `migration.sql` en CRLF sous Windows alors que la base a enregistré
 * l'empreinte en LF : les deux formes valent. Aucun test ne touche la base :
 * le client SQL est un faux qui enregistre ses requêtes.
 * Voir docs/features/backend-local.md, étape 2.2.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  deployBlockers,
  planMigrations,
  type MigrationFolder,
  type MigrationRow,
} from "../scripts/lib/migration-plan";
import {
  applyMigrations,
  connectionHost,
  describeError,
  migrationUrl,
  redactSecrets,
  resolveDriver,
  type SqlClient,
} from "../scripts/lib/migration-runner";

const sha256 = (text: string) =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

const INIT_LF = '-- init\nCREATE TABLE "School" ("id" TEXT);\n';
const INIT_CRLF = INIT_LF.replace(/\n/g, "\r\n");
const GROUP_LF = 'ALTER TABLE "School" ADD COLUMN "group" TEXT;\n';
const INDEX_LF = 'CREATE INDEX "School_group_idx" ON "School"("group");\n';

function folder(name: string, sql: string): MigrationFolder {
  return { name, bytes: Buffer.from(sql, "utf8") };
}

function row(
  name: string,
  sql: string,
  overrides: Partial<MigrationRow> = {},
): MigrationRow {
  return {
    migration_name: name,
    checksum: sha256(sql),
    finished_at: new Date("2026-09-01T10:00:00Z"),
    rolled_back_at: null,
    ...overrides,
  };
}

const EMPTY = {
  applied: [],
  pending: [],
  checksumMismatch: [],
  failed: [],
  unknownInDb: [],
};

// ── planMigrations ──────────────────────────────────────────────────

test("répertoire et base identiques : tout est appliqué", () => {
  const plan = planMigrations(
    [folder("20260520_init", INIT_LF), folder("20260521_group", GROUP_LF)],
    [row("20260520_init", INIT_LF), row("20260521_group", GROUP_LF)],
  );
  assert.deepEqual(plan, {
    ...EMPTY,
    applied: ["20260520_init", "20260521_group"],
  });
  assert.deepEqual(deployBlockers(plan), []);
});

test("dossier absent de la base : en attente, dans l'ordre des noms", () => {
  const plan = planMigrations(
    [
      folder("20260903_index", INDEX_LF),
      folder("20260520_init", INIT_LF),
      folder("20260521_group", GROUP_LF),
    ],
    [row("20260520_init", INIT_LF)],
  );
  assert.deepEqual(plan.applied, ["20260520_init"]);
  assert.deepEqual(plan.pending, ["20260521_group", "20260903_index"]);
  assert.deepEqual(deployBlockers(plan), []);
});

test("empreinte en LF ou en CRLF : appliquée, quelle que soit la forme du fichier", () => {
  // Fichier extrait en CRLF, empreinte enregistrée en LF (le cas de trois
  // migrations relevé le 14 octobre 2026), et l'inverse.
  const plan = planMigrations(
    [folder("a_crlf_file", INIT_CRLF), folder("b_lf_file", INIT_LF), folder("c_raw", GROUP_LF)],
    [
      row("a_crlf_file", INIT_LF),
      row("b_lf_file", INIT_CRLF),
      row("c_raw", GROUP_LF),
    ],
  );
  assert.deepEqual(plan, { ...EMPTY, applied: ["a_crlf_file", "b_lf_file", "c_raw"] });
});

test("contenu réellement différent : empreinte divergente, et le déploiement refuse", () => {
  const plan = planMigrations(
    [folder("20260520_init", INIT_LF + "-- retouché\n")],
    [row("20260520_init", INIT_LF)],
  );
  assert.deepEqual(plan, { ...EMPTY, checksumMismatch: ["20260520_init"] });
  const blockers = deployBlockers(plan);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /20260520_init/);
});

test("ligne sans finished_at ni rolled_back_at : migration en échec, et le déploiement refuse", () => {
  const plan = planMigrations(
    [folder("20260520_init", INIT_LF), folder("20260521_group", GROUP_LF)],
    [
      row("20260520_init", INIT_LF),
      row("20260521_group", GROUP_LF, { finished_at: null }),
    ],
  );
  assert.deepEqual(plan, {
    ...EMPTY,
    applied: ["20260520_init"],
    failed: ["20260521_group"],
  });
  assert.equal(deployBlockers(plan).length, 1);
  assert.match(deployBlockers(plan)[0], /20260521_group/);
});

test("ligne annulée (rolled_back_at) seule : la migration est de nouveau en attente", () => {
  const plan = planMigrations(
    [folder("20260521_group", GROUP_LF)],
    [
      row("20260521_group", GROUP_LF, {
        finished_at: null,
        rolled_back_at: new Date("2026-09-02T10:00:00Z"),
      }),
    ],
  );
  assert.deepEqual(plan, { ...EMPTY, pending: ["20260521_group"] });
});

test("échec annulé puis rejoué avec succès : appliquée", () => {
  const plan = planMigrations(
    [folder("20260521_group", GROUP_LF)],
    [
      row("20260521_group", GROUP_LF, {
        finished_at: null,
        rolled_back_at: new Date("2026-09-02T10:00:00Z"),
      }),
      row("20260521_group", GROUP_LF),
    ],
  );
  assert.deepEqual(plan, { ...EMPTY, applied: ["20260521_group"] });
});

test("ligne en base sans dossier : inconnue du dépôt, signalée sans bloquer", () => {
  const plan = planMigrations(
    [folder("20260520_init", INIT_LF)],
    [row("20260520_init", INIT_LF), row("20261001_other_branch", GROUP_LF)],
  );
  assert.deepEqual(plan, {
    ...EMPTY,
    applied: ["20260520_init"],
    unknownInDb: ["20261001_other_branch"],
  });
  assert.deepEqual(deployBlockers(plan), []);
});

test("les dates arrivent aussi en chaînes (pilote sans conversion de type)", () => {
  const plan = planMigrations(
    [folder("20260520_init", INIT_LF), folder("20260521_group", GROUP_LF)],
    [
      row("20260520_init", INIT_LF, { finished_at: "2026-09-01 10:00:00+00" }),
      row("20260521_group", GROUP_LF, { finished_at: null }),
    ],
  );
  assert.deepEqual(plan.applied, ["20260520_init"]);
  assert.deepEqual(plan.failed, ["20260521_group"]);
});

// ── applyMigrations ─────────────────────────────────────────────────

class FakeClient implements SqlClient {
  readonly calls: { text: string; params?: unknown[] }[] = [];
  constructor(private readonly failOn?: string) {}
  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    if (this.failOn && text === this.failOn) {
      throw new Error('relation "School" already exists');
    }
    return { rows: [] };
  }
  get texts() {
    return this.calls.map((c) => (c.text.startsWith("INSERT INTO") ? "INSERT" : c.text));
  }
}

const PENDING = [
  { name: "20260521_group", sql: GROUP_LF, checksum: sha256(GROUP_LF) },
  { name: "20260903_index", sql: INDEX_LF, checksum: sha256(INDEX_LF) },
];

test("deploy : une transaction par migration, inscrite dans _prisma_migrations", async () => {
  const client = new FakeClient();
  let n = 0;
  const done = await applyMigrations(client, PENDING, {
    dryRun: false,
    newId: () => `id-${++n}`,
  });

  assert.deepEqual(done, ["20260521_group", "20260903_index"]);
  assert.deepEqual(client.texts, [
    "BEGIN", GROUP_LF, "INSERT", "COMMIT",
    "BEGIN", INDEX_LF, "INSERT", "COMMIT",
  ]);
  const insert = client.calls.find((c) => c.text.startsWith("INSERT INTO"))!;
  assert.match(insert.text, /"_prisma_migrations"/);
  assert.match(insert.text, /now\(\), now\(\), 1, NULL, NULL/);
  assert.deepEqual(insert.params, ["id-1", sha256(GROUP_LF), "20260521_group"]);
});

test("deploy --dry-run : tout dans une transaction terminée par ROLLBACK, aucun COMMIT", async () => {
  const client = new FakeClient();
  const done = await applyMigrations(client, PENDING, { dryRun: true });

  assert.deepEqual(done, ["20260521_group", "20260903_index"]);
  assert.deepEqual(client.texts, [
    "BEGIN", GROUP_LF, "INSERT", INDEX_LF, "INSERT", "ROLLBACK",
  ]);
  assert.ok(!client.texts.includes("COMMIT"));
});

test("une migration qui échoue : ROLLBACK, arrêt, et les suivantes ne partent pas", async () => {
  const client = new FakeClient(GROUP_LF);
  await assert.rejects(
    applyMigrations(client, PENDING, { dryRun: false }),
    /20260521_group.*relation "School" already exists/,
  );
  assert.deepEqual(client.texts, ["BEGIN", GROUP_LF, "ROLLBACK"]);
});

test("dry-run qui échoue : ROLLBACK aussi", async () => {
  const client = new FakeClient(INDEX_LF);
  await assert.rejects(applyMigrations(client, PENDING, { dryRun: true }), /20260903_index/);
  assert.deepEqual(client.texts, ["BEGIN", GROUP_LF, "INSERT", INDEX_LF, "ROLLBACK"]);
});

// ── Pilote, URL et affichage ────────────────────────────────────────

test("resolveDriver : absente ou vide → CLI Prisma ; neon-ws ; toute autre valeur refusée", () => {
  assert.equal(resolveDriver(undefined), null);
  assert.equal(resolveDriver(""), null);
  assert.equal(resolveDriver("  "), null);
  assert.equal(resolveDriver("neon-ws"), "neon-ws");
  assert.equal(resolveDriver(" NEON-WS "), "neon-ws");
  assert.throws(() => resolveDriver("neon-http"), /neon-http.*neon-ws/);
});

test("migrationUrl : DIRECT_URL d'abord, repli sur DATABASE_URL, comme prisma.config.ts", () => {
  assert.deepEqual(
    migrationUrl({ DIRECT_URL: "postgresql://d", DATABASE_URL: "postgresql://p" }),
    { name: "DIRECT_URL", url: "postgresql://d" },
  );
  assert.deepEqual(migrationUrl({ DATABASE_URL: "postgresql://p" }), {
    name: "DATABASE_URL",
    url: "postgresql://p",
  });
  assert.deepEqual(migrationUrl({ DIRECT_URL: "", DATABASE_URL: "postgresql://p" }), {
    name: "DATABASE_URL",
    url: "postgresql://p",
  });
  assert.throws(() => migrationUrl({}), /DIRECT_URL.*DATABASE_URL/);
});

test("connectionHost : l'hôte seul, jamais les identifiants", () => {
  const url =
    "postgresql://neondb_owner:p%40ss%2Fw0rd@ep-test-123.eu-west-2.aws.neon.tech/neondb?sslmode=require";
  assert.equal(connectionHost(url), "ep-test-123.eu-west-2.aws.neon.tech");
  const unreadable = connectionHost("pas une url p@ss/w0rd");
  assert.ok(!unreadable.includes("p@ss"));
  assert.ok(!unreadable.includes("w0rd"));
});

test("describeError : une Error, un événement ws (ErrorEvent) ou autre chose, jamais « [object Object] »", () => {
  assert.equal(describeError(new Error("boom")), "boom");
  // Ce que rejette @neondatabase/serverless quand le WebSocket ne s'ouvre pas.
  const event = { type: "error", error: new Error("connect ECONNREFUSED 127.0.0.1:443") };
  assert.equal(describeError(event), "connect ECONNREFUSED 127.0.0.1:443");
  assert.equal(describeError({ type: "error", message: "refusé" }), "refusé");
  assert.match(describeError({ type: "close" }), /close/);
  assert.equal(describeError("texte"), "texte");
});

test("redactSecrets : ni l'URL ni le mot de passe, encodé ou non, ne restent dans un message", () => {
  const url = "postgresql://owner:p%40ss%2Fw0rd@ep-test-123.neon.tech/neondb";
  const message =
    `connexion à ${url} refusée ; mot de passe p%40ss%2Fw0rd, soit p@ss/w0rd ; hôte ep-test-123.neon.tech`;
  const clean = redactSecrets(message, url);
  assert.ok(!clean.includes(url));
  assert.ok(!clean.includes("p%40ss%2Fw0rd"));
  assert.ok(!clean.includes("p@ss/w0rd"));
  assert.match(clean, /ep-test-123\.neon\.tech/);
  assert.equal(redactSecrets("rien à cacher", url), "rien à cacher");
});
