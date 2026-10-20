/**
 * test/helpers/fake-users.ts — Une table User en mémoire, pour le faux Prisma
 *
 *     const users = userTable([userRow({ id: "u-1", email: "…", status: "INVITED" })]);
 *     db.use({ user: users.methods });
 *     // … appels des routes …
 *     assert.equal(users.get("u-1")?.status, "ACTIVE");
 *
 * Les routes des comptes enchaînent lecture, contrôle et écriture : une table
 * qui garde son état d'un appel à l'autre dit mieux qu'une suite de réponses
 * figées si un invité retiré peut encore se connecter (plan gestion-contenu,
 * étape 2). Elle tient ce que la base garantit : l'unicité de l'adresse et de
 * l'identifiant (erreur `P2002`, comme Prisma) et les contraintes CHECK de la
 * migration 20261016150000_whitelist_accounts. Une écriture qui viole une
 * contrainte lève et ne change rien.
 *
 * Elle tient aussi la clé `ON DELETE RESTRICT` des auteurs du contenu
 * (migration 20261019120000_content_provenance, D24) et des signalements
 * (migration 20261020120000_content_reports, D38) : un compte nommé dans
 * `authors` ne se supprime pas (erreur `P2003`, comme Prisma).
 *
 * Le faux n'a pas de transaction : `$transaction(fn)` appelle `fn` avec le
 * même client (test/helpers/fake-prisma.ts). Filtres compris : égalité et
 * `{ not: valeur }`. Données : valeurs et `{ increment: n }`.
 */

import { ACCOUNT_STATUSES } from "../../lib/accounts";

export interface UserRow {
  id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  password_hash: string | null;
  role: string;
  status: string;
  first_login_at: Date | null;
  session_version: number;
  createdAt: Date;
}

/** Une ligne, avec les défauts de la base (un compte créé sans précision est un invité USER). */
export function userRow(partial: Partial<UserRow> & { id: string }): UserRow {
  return {
    username: null,
    email: null,
    display_name: null,
    password_hash: null,
    role: "USER",
    status: "INVITED",
    first_login_at: null,
    session_version: 0,
    createdAt: new Date("2026-10-16T08:00:00Z"),
    ...partial,
  };
}

type Where = Record<string, unknown>;
type Select = Record<string, boolean> | undefined;

function matches(row: UserRow, where: Where = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const value = row[key as keyof UserRow];
    if (expected !== null && typeof expected === "object" && "not" in expected) {
      return value !== (expected as { not: unknown }).not;
    }
    return value === expected;
  });
}

function pick(row: UserRow, select: Select): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([key]) => [key, row[key as keyof UserRow]]));
}

function applied(row: UserRow, data: Record<string, unknown>): UserRow {
  const next: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === "object" && "increment" in value) {
      next[key] = (next[key] as number) + (value as { increment: number }).increment;
    } else {
      next[key] = value;
    }
  }
  return next as unknown as UserRow;
}

export class ConstraintError extends Error {
  constructor(
    public readonly constraint: string,
    public readonly code?: string
  ) {
    super(`Faux Prisma : contrainte ${constraint} violée`);
  }
}

/** Les contraintes de la base, sur l'état de la table après une écriture. */
function enforce(rows: UserRow[]) {
  for (const field of ["email", "username"] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      const value = row[field];
      if (value === null) continue;
      if (seen.has(value)) throw new ConstraintError(`User_${field}_key`, "P2002");
      seen.add(value);
    }
  }
  for (const row of rows) {
    if (!(ACCOUNT_STATUSES as readonly string[]).includes(row.status)) throw new ConstraintError("User_status_check");
    if ((row.status === "ACTIVE") !== (row.password_hash !== null)) throw new ConstraintError("User_password_status_check");
    if (row.status === "INVITED" && row.email === null) throw new ConstraintError("User_invited_email_check");
    if (row.email === null && row.username === null) throw new ConstraintError("User_identity_check");
    if (row.email !== null && row.email !== row.email.toLowerCase()) throw new ConstraintError("User_email_lower_check");
    if (!["USER", "GESTIONNAIRE", "ADMIN"].includes(row.role)) throw new ConstraintError("User_role_check");
  }
}

export interface UserTable {
  /** Les méthodes à passer au faux Prisma : `db.use({ user: users.methods })`. */
  methods: Record<string, (...args: never[]) => unknown>;
  rows: UserRow[];
  get(id: string): UserRow | undefined;
}

export function userTable(initial: UserRow[] = [], { authors = [] }: { authors?: string[] } = {}): UserTable {
  let rows = initial.map((row) => ({ ...row }));
  enforce(rows);
  let created = 0;

  /** Remplace la table, après contrôle des contraintes. */
  const commit = (next: UserRow[]) => {
    enforce(next);
    rows = next;
  };

  /** La clé des auteurs : un compte qui a modifié une donnée ne se supprime pas. */
  const restrict = (removed: UserRow[]) => {
    const author = removed.find((row) => authors.includes(row.id));
    if (author) throw new ConstraintError(`updated_by_id_fkey (${author.id})`, "P2003");
  };

  const methods = {
    findUnique({ where, select }: { where: Where; select?: Select }) {
      const row = rows.find((r) => matches(r, where));
      return row ? pick(row, select) : null;
    },
    findMany({ where, select }: { where?: Where; select?: Select } = {}) {
      return rows.filter((r) => matches(r, where)).map((r) => pick(r, select));
    },
    count({ where }: { where?: Where } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    create({ data, select }: { data: Partial<UserRow>; select?: Select }) {
      created += 1;
      const row = userRow({ id: `u-cree-${created}`, ...data });
      commit([...rows, row]);
      return pick(row, select);
    },
    update({ where, data, select }: { where: Where; data: Record<string, unknown>; select?: Select }) {
      const index = rows.findIndex((r) => matches(r, where));
      if (index < 0) throw Object.assign(new Error("Faux Prisma : ligne à modifier introuvable"), { code: "P2025" });
      const next = [...rows];
      next[index] = applied(rows[index], data);
      commit(next);
      return pick(next[index], select);
    },
    updateMany({ where, data }: { where: Where; data: Record<string, unknown> }) {
      let count = 0;
      const next = rows.map((r) => {
        if (!matches(r, where)) return r;
        count += 1;
        return applied(r, data);
      });
      commit(next);
      return { count };
    },
    delete({ where }: { where: Where }) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw Object.assign(new Error("Faux Prisma : ligne à supprimer introuvable"), { code: "P2025" });
      restrict([row]);
      commit(rows.filter((r) => r !== row));
      return { ...row };
    },
    deleteMany({ where }: { where: Where }) {
      const kept = rows.filter((r) => !matches(r, where));
      restrict(rows.filter((r) => matches(r, where)));
      const count = rows.length - kept.length;
      commit(kept);
      return { count };
    },
  };

  return {
    methods: methods as unknown as UserTable["methods"],
    get rows() {
      return rows;
    },
    get(id: string) {
      return rows.find((r) => r.id === id);
    },
  };
}
