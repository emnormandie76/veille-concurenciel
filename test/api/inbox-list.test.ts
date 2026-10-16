/**
 * test/api/inbox-list.test.ts — GET /api/admin/inbox
 *
 *     npm run test:ts
 *
 * Tâche hors plan « trois sources » : pour plafonner à 3 le bloc « Sources »
 * d'un ticket du pipeline écrit avant la coupe, l'inbox range les URL du
 * domaine officiel de l'école juste après les URL citées
 * (lib/ticket-sources.ts). La liste ne rendait que le nom de l'école : elle
 * rend aussi son domaine, `schoolOfficialDomain`, lu dans la même requête.
 */

import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { installFakePrisma } from "../helpers/fake-prisma";
import { schemaErrors } from "../helpers/prisma-schema";
import { installSession } from "../helpers/session";

const db = installFakePrisma();

// Chaque requête reçue par le faux doit exister dans le vrai schéma Prisma
// (test/helpers/prisma-schema.ts).
afterEach(() => {
  assert.deepEqual(schemaErrors(db.calls), []);
});
const session = installSession();

type Handler = (request: Request) => Promise<Response>;
let GET: Handler;

before(async () => {
  ({ GET } = await import("../../app/api/admin/inbox/route"));
});

beforeEach(() => {
  session.as("ADMIN");
});

const call = (query = "") => GET(new Request(`http://localhost/api/admin/inbox${query}`));

const ESSCA_TICKET = {
  id: "28f121aa-cb27-4f38-8b51-6927e838d9b3",
  source_type: "Automated_AI",
  ai_category: "Program_Discovery",
  status: "Pending_Admin",
  schoolId: "school-essca",
  campusId: null,
  programId: null,
  urls: ["https://www.essca.eu/programmes"],
};
const ORPHAN_TICKET = { ...ESSCA_TICKET, id: "ticket-2", schoolId: null };

test("sans session : 401, et la base n'est jamais lue", async () => {
  session.as("none");
  db.use({});

  const res = await call();

  assert.equal(res.status, 401);
  assert.deepEqual(db.calls, []);
  assert.deepEqual(session.guards, ["guardAdmin"]);
});

test("l'inbox est réservée à l'admin : un USER ou un GESTIONNAIRE reçoit 403, rien de lu", async () => {
  for (const profile of ["USER", "GESTIONNAIRE"] as const) {
    session.as(profile);
    db.use({});
    assert.equal((await call()).status, 403, profile);
    assert.deepEqual(db.calls, []);
  }
});

test("chaque ticket porte le nom et le domaine officiel de son école", async () => {
  db.use({
    contributionInbox: {
      findMany: () => [ESSCA_TICKET, ORPHAN_TICKET],
      count: () => 2,
    },
    school: {
      findMany: () => [{ id: "school-essca", name: "ESSCA", official_domain: "www.essca.eu/" }],
    },
  });

  const res = await call();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data[0].schoolName, "ESSCA");
  assert.equal(body.data[0].schoolOfficialDomain, "www.essca.eu/");
  assert.equal(body.data[1].schoolName, null);
  assert.equal(body.data[1].schoolOfficialDomain, null);
  // Le ticket lui-même n'est pas touché : ses URL partent entières, la coupe
  // de l'écran se fait dans lib/ticket-sources.ts.
  assert.deepEqual(body.data[0].urls, ESSCA_TICKET.urls);

  const schoolQuery = db.calls.find((c) => c.model === "school");
  assert.deepEqual(schoolQuery?.args, [
    {
      where: { id: { in: ["school-essca"] } },
      select: { id: true, name: true, official_domain: true },
    },
  ]);
});
