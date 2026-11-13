// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, OWNER, STRANGER } from "./testDb";

let db: PGlite;
let as: Awaited<ReturnType<typeof createTestDb>>["as"];

beforeAll(async () => {
  ({ db, as } = await createTestDb(["0001_wardrobe.sql", "0002_planner.sql", "0003_style.sql"]));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("reset role; delete from public.inspirations; delete from public.settings;");
});

function addInspiration(userId: string) {
  return as(
    "authenticated",
    userId,
    "insert into public.inspirations (photo_path) values ($1) returning id, user_id, status, pieces",
    [`${userId}/inspiration/a.jpg`],
  );
}

describe("inspirations", () => {
  it("files a new picture under you, waiting to be read", async () => {
    const { rows } = await addInspiration(OWNER);

    expect(rows[0]).toMatchObject({ user_id: OWNER, status: "waiting", pieces: [] });
  });

  it("keeps your readings away from other users and anyone signed out", async () => {
    const { rows } = await addInspiration(OWNER);

    const read = await as("authenticated", STRANGER, "select id from public.inspirations");
    const removed = await as("authenticated", STRANGER, "delete from public.inspirations where id = $1", [rows[0].id]);

    expect(read.rows).toHaveLength(0);
    expect(removed.affectedRows).toBe(0);
    await expect(as("anon", "", "select id from public.inspirations")).rejects.toThrow(/permission denied/);
    await expect(
      as("authenticated", OWNER, "insert into public.inspirations (user_id, photo_path) values ($1, 'x')", [STRANGER]),
    ).rejects.toThrow(/row-level security/);
  });

  it("saves a reading and forgets the picture", async () => {
    const { rows } = await addInspiration(OWNER);

    const saved = await as(
      "authenticated",
      OWNER,
      `update public.inspirations
       set status = 'done', photo_path = null, day_type = 'corporate', formality = 'smart',
           pieces = '[{"kind":"top","colour":"navy","patterned":false}]'
       where id = $1 returning photo_path, day_type`,
      [rows[0].id],
    );

    expect(saved.rows[0]).toEqual({ photo_path: null, day_type: "corporate" });
  });

  it("lets you remove a reading", async () => {
    const { rows } = await addInspiration(OWNER);

    const removed = await as("authenticated", OWNER, "delete from public.inspirations where id = $1", [rows[0].id]);

    expect(removed.affectedRows).toBe(1);
  });

  it("rejects values outside the agreed lists", async () => {
    const { rows } = await addInspiration(OWNER);
    const update = (sql: string) => as("authenticated", OWNER, `update public.inspirations set ${sql} where id = $1`, [rows[0].id]);

    await expect(update("day_type = 'beach'")).rejects.toThrow(/check constraint/);
    await expect(update("formality = 'black tie'")).rejects.toThrow(/check constraint/);
    await expect(update("status = 'maybe'")).rejects.toThrow(/check constraint/);
    await expect(update(`pieces = '{"kind":"top"}'`)).rejects.toThrow(/check constraint/);
  });
});

describe("style settings", () => {
  it("start empty, meaning: go by the pictures", async () => {
    const { rows } = await as("authenticated", OWNER, "insert into public.settings default values returning style");

    expect(rows[0].style).toEqual({});
  });
});
