// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, OWNER, STRANGER } from "./testDb";

let db: PGlite;
let as: Awaited<ReturnType<typeof createTestDb>>["as"];

beforeAll(async () => {
  ({ db, as } = await createTestDb(["0001_wardrobe.sql", "0002_planner.sql"]));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("reset role; delete from public.outfits; delete from public.settings; delete from public.pieces;");
});

async function addPiece(userId: string, fields: { wears?: number | null; wearsSince?: number; inWash?: boolean } = {}) {
  const { rows } = await as(
    "authenticated",
    userId,
    `insert into public.pieces (photo_path, wears_before_wash, wears_since_wash, in_wash)
     values ('p.jpg', $1, $2, $3) returning id`,
    [fields.wears === undefined ? 1 : fields.wears, fields.wearsSince ?? 0, fields.inWash ?? false],
  );
  return rows[0].id as string;
}

async function addOutfit(userId: string, day: string, slots: { top?: string; trousers?: string; shoes?: string }) {
  const { rows } = await as(
    "authenticated",
    userId,
    `insert into public.outfits (user_id, day, day_type, top_id, trousers_id, shoes_id)
     values ($1, $2, 'corporate', $3, $4, $5) returning id`,
    [userId, day, slots.top ?? null, slots.trousers ?? null, slots.shoes ?? null],
  );
  return rows[0].id as string;
}

function finishCheck(userId: string, outfits: { id: string; worn: string[] }[], washed: string[] = []) {
  return as("authenticated", userId, "select public.finish_check($1::jsonb, $2::uuid[])", [
    JSON.stringify(outfits),
    washed,
  ]);
}

async function piece(id: string) {
  const { rows } = await db.query<{ wears_since_wash: number; in_wash: boolean }>(
    "select wears_since_wash, in_wash from public.pieces where id = $1",
    [id],
  );
  return rows[0];
}

describe("settings", () => {
  it("starts with weekdays corporate, Saturday casual and Sunday church", async () => {
    const { rows } = await as("authenticated", OWNER, "insert into public.settings default values returning usual_week");

    expect(rows[0].usual_week).toEqual([
      "corporate",
      "corporate",
      "corporate",
      "corporate",
      "corporate",
      "casual",
      "church",
    ]);
  });

  it("only takes seven days of known day types", async () => {
    const insert = "insert into public.settings (usual_week) values ($1)";

    await expect(as("authenticated", OWNER, insert, [["casual", "casual"]])).rejects.toThrow(/check constraint/);
    await expect(
      as("authenticated", OWNER, insert, [["beach", "casual", "casual", "casual", "casual", "casual", "casual"]]),
    ).rejects.toThrow(/check constraint/);
  });

  it("keeps your settings away from other users", async () => {
    await as("authenticated", OWNER, "insert into public.settings default values");

    const read = await as("authenticated", STRANGER, "select * from public.settings");
    const changed = await as("authenticated", STRANGER, "update public.settings set usual_week = usual_week");

    expect(read.rows).toHaveLength(0);
    expect(changed.affectedRows).toBe(0);
    await expect(as("anon", "", "select * from public.settings")).rejects.toThrow(/permission denied/);
  });
});

describe("outfits", () => {
  it("holds one outfit per day", async () => {
    await addOutfit(OWNER, "2026-11-16", {});

    await expect(addOutfit(OWNER, "2026-11-16", {})).rejects.toThrow(/duplicate key/);
  });

  it("keeps your outfits away from other users", async () => {
    await addOutfit(OWNER, "2026-11-16", {});

    const read = await as("authenticated", STRANGER, "select * from public.outfits");

    expect(read.rows).toHaveLength(0);
    await expect(
      as("authenticated", OWNER, "insert into public.outfits (user_id, day, day_type) values ($1, '2026-11-18', 'casual')", [
        STRANGER,
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(as("anon", "", "select * from public.outfits")).rejects.toThrow(/permission denied/);
  });

  it("empties a slot when its piece is deleted", async () => {
    const top = await addPiece(OWNER);
    const outfit = await addOutfit(OWNER, "2026-11-16", { top });

    await as("authenticated", OWNER, "delete from public.pieces where id = $1", [top]);

    const { rows } = await db.query<{ top_id: string | null }>("select top_id from public.outfits where id = $1", [outfit]);
    expect(rows[0].top_id).toBeNull();
  });

  it("rejects unknown day types", async () => {
    await expect(
      as("authenticated", OWNER, "insert into public.outfits (user_id, day, day_type) values ($1, '2026-11-16', 'beach')", [
        OWNER,
      ]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("finish_check", () => {
  it("counts a wear for each piece you wore", async () => {
    const trousers = await addPiece(OWNER, { wears: 2 });
    const outfit = await addOutfit(OWNER, "2026-11-16", { trousers });

    await finishCheck(OWNER, [{ id: outfit, worn: [trousers] }]);

    expect(await piece(trousers)).toEqual({ wears_since_wash: 1, in_wash: false });
  });

  it("sends a piece to the wash once its wears are used up", async () => {
    const top = await addPiece(OWNER, { wears: 1 });
    const outfit = await addOutfit(OWNER, "2026-11-16", { top });

    await finishCheck(OWNER, [{ id: outfit, worn: [top] }]);

    expect(await piece(top)).toEqual({ wears_since_wash: 1, in_wash: true });
  });

  it("counts trousers worn on two days as two wears", async () => {
    const trousers = await addPiece(OWNER, { wears: 2 });
    const monday = await addOutfit(OWNER, "2026-11-16", { trousers });
    const wednesday = await addOutfit(OWNER, "2026-11-18", { trousers });

    await finishCheck(OWNER, [
      { id: monday, worn: [trousers] },
      { id: wednesday, worn: [trousers] },
    ]);

    expect(await piece(trousers)).toEqual({ wears_since_wash: 2, in_wash: true });
  });

  it("leaves out what you didn't wear", async () => {
    const top = await addPiece(OWNER, { wears: 1 });
    const outfit = await addOutfit(OWNER, "2026-11-16", { top });

    await finishCheck(OWNER, [{ id: outfit, worn: [] }]);

    expect(await piece(top)).toEqual({ wears_since_wash: 0, in_wash: false });
    const { rows } = await db.query<{ worn: string[]; checked_at: Date | null }>(
      "select worn, checked_at from public.outfits where id = $1",
      [outfit],
    );
    expect(rows[0].worn).toEqual([]);
    expect(rows[0].checked_at).not.toBeNull();
  });

  it("ignores pieces that weren't in the outfit", async () => {
    const top = await addPiece(OWNER, { wears: 1 });
    const other = await addPiece(OWNER, { wears: 1 });
    const outfit = await addOutfit(OWNER, "2026-11-16", { top });

    await finishCheck(OWNER, [{ id: outfit, worn: [top, other] }]);

    expect(await piece(other)).toEqual({ wears_since_wash: 0, in_wash: false });
  });

  it("never counts the same day twice", async () => {
    const trousers = await addPiece(OWNER, { wears: 3 });
    const outfit = await addOutfit(OWNER, "2026-11-16", { trousers });

    await finishCheck(OWNER, [{ id: outfit, worn: [trousers] }]);
    await finishCheck(OWNER, [{ id: outfit, worn: [trousers] }]);

    expect((await piece(trousers)).wears_since_wash).toBe(1);
  });

  it("brings washed pieces back clean", async () => {
    const top = await addPiece(OWNER, { wears: 1, wearsSince: 1, inWash: true });

    await finishCheck(OWNER, [], [top]);

    expect(await piece(top)).toEqual({ wears_since_wash: 0, in_wash: false });
  });

  it("can wash a piece that was worn in the same check", async () => {
    const top = await addPiece(OWNER, { wears: 1 });
    const outfit = await addOutfit(OWNER, "2026-11-16", { top });

    await finishCheck(OWNER, [{ id: outfit, worn: [top] }], [top]);

    expect(await piece(top)).toEqual({ wears_since_wash: 0, in_wash: false });
  });

  it("can't touch another user's outfits or pieces", async () => {
    const top = await addPiece(OWNER, { wears: 1, wearsSince: 1, inWash: true });
    const trousers = await addPiece(OWNER, { wears: 2 });
    const outfit = await addOutfit(OWNER, "2026-11-16", { trousers });

    await finishCheck(STRANGER, [{ id: outfit, worn: [trousers] }], [top]);

    expect(await piece(top)).toEqual({ wears_since_wash: 1, in_wash: true });
    expect(await piece(trousers)).toEqual({ wears_since_wash: 0, in_wash: false });
  });

  it("refuses anyone who isn't signed in", async () => {
    await expect(as("anon", "", "select public.finish_check('[]'::jsonb, '{}'::uuid[])")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("pieces", () => {
  it("start out of the wash", async () => {
    const { rows } = await as("authenticated", OWNER, "insert into public.pieces (photo_path) values ('p.jpg') returning in_wash");

    expect(rows[0].in_wash).toBe(false);
  });
});
