/**
 * test/api/inbox-ticket.test.ts — Le banc des routes, sur GET /api/admin/inbox/[id]
 *
 *     npm run test:ts
 *
 * La route est importée telle quelle et appelée avec une `Request` et des
 * `params` en promesse, comme Next 16 le fait. `@/lib/auth` et `@/lib/prisma`
 * sont remplacés avant l'import (test/helpers/). Le premier test est celui du
 * plan backend-local (étape 1) : sans session, 401 et aucun appel à la base.
 * Les deux suivants prouvent que le faux Prisma est bien celui que lit la
 * route : sans eux, un remplacement raté passerait inaperçu.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma } from "../helpers/fake-prisma";
import { installSession } from "../helpers/session";

const db = installFakePrisma();
const session = installSession();

type Handler = (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

let GET: Handler;

before(async () => {
  ({ GET } = await import("../../app/api/admin/inbox/[id]/route"));
});

const TICKET_ID = "11111111-2222-3333-4444-555555555555";

function call(id: string) {
  return GET(new Request(`http://localhost/api/admin/inbox/${id}`), {
    params: Promise.resolve({ id }),
  });
}

test("sans session : 401, et la base n'est jamais lue", async () => {
  session.as("none");
  db.use({});

  const res = await call(TICKET_ID);

  assert.equal(res.status, 401);
  assert.deepEqual(db.calls, []);
  assert.deepEqual(session.guards, ["guardAuth"]);
});

test("un MODERATOR lit le ticket que rend la base", async () => {
  session.as("MODERATOR");
  db.use({
    contributionInbox: {
      findUnique: ({ where }: { where: { id: string } }) => ({
        id: where.id,
        status: "Pending_Admin",
      }),
    },
  });

  const res = await call(TICKET_ID);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: TICKET_ID, status: "Pending_Admin" });
  assert.deepEqual(db.calls, [
    {
      model: "contributionInbox",
      method: "findUnique",
      args: [{ where: { id: TICKET_ID } }],
    },
  ]);
});

test("un ticket absent : 404", async () => {
  session.as("ADMIN");
  db.use({ contributionInbox: { findUnique: () => null } });

  const res = await call(TICKET_ID);

  assert.equal(res.status, 404);
  assert.equal(db.calls.length, 1);
});
