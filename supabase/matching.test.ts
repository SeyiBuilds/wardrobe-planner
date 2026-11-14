// @vitest-environment node
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, OWNER, STRANGER } from "./testDb";

let db: PGlite;
let as: Awaited<ReturnType<typeof createTestDb>>["as"];

beforeAll(async () => {
  ({ db, as } = await createTestDb(["0001_wardrobe.sql", "0002_planner.sql", "0003_style.sql", "0004_matching_sets.sql"]));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("reset role; delete from public.pieces;");
});

async function addPiece(userId: string, type: string): Promise<string> {
  const { rows } = await as(
    "authenticated",
    userId,
    "insert into public.pieces (photo_path, type) values ($1, $2) returning id",
    [`${userId}/${type}.jpg`, type],
  );
  return rows[0].id as string;
}

async function matchOf(id: string): Promise<string | null> {
  const { rows } = await as("authenticated", OWNER, "select match_id from public.pieces where id = $1", [id]);
  return rows[0].match_id as string | null;
}

const setMatch = (userId: string, piece: string, partner: string | null) =>
  as("authenticated", userId, "select public.set_match($1, $2)", [piece, partner]);

describe("matching sets", () => {
  it("matches a top and its trousers both ways", async () => {
    const top = await addPiece(OWNER, "top");
    const trousers = await addPiece(OWNER, "trousers");

    await setMatch(OWNER, top, trousers);

    expect(await matchOf(top)).toBe(trousers);
    expect(await matchOf(trousers)).toBe(top);
  });

  it("frees the old partner when a piece is matched again", async () => {
    const top = await addPiece(OWNER, "top");
    const first = await addPiece(OWNER, "trousers");
    const second = await addPiece(OWNER, "trousers");
    await setMatch(OWNER, top, first);

    await setMatch(OWNER, second, top);

    expect(await matchOf(top)).toBe(second);
    expect(await matchOf(second)).toBe(top);
    expect(await matchOf(first)).toBeNull();
  });

  it("unmatches both halves", async () => {
    const top = await addPiece(OWNER, "top");
    const trousers = await addPiece(OWNER, "trousers");
    await setMatch(OWNER, top, trousers);

    await setMatch(OWNER, trousers, null);

    expect(await matchOf(top)).toBeNull();
    expect(await matchOf(trousers)).toBeNull();
  });

  it("only matches a top with trousers", async () => {
    const top = await addPiece(OWNER, "top");
    const otherTop = await addPiece(OWNER, "top");
    const shoes = await addPiece(OWNER, "shoes");

    await expect(setMatch(OWNER, top, otherTop)).rejects.toThrow(/a top with trousers/);
    await expect(setMatch(OWNER, top, shoes)).rejects.toThrow(/a top with trousers/);
    await expect(setMatch(OWNER, top, top)).rejects.toThrow(/a top with trousers/);
  });

  it("can't reach someone else's clothes", async () => {
    const mine = await addPiece(OWNER, "top");
    const theirs = await addPiece(STRANGER, "trousers");

    await expect(setMatch(OWNER, mine, theirs)).rejects.toThrow(/not found/);
    await expect(as("anon", "", "select public.set_match($1, $2)", [mine, null])).rejects.toThrow(/permission denied/);
  });

  it("forgets the match when one half is deleted", async () => {
    const top = await addPiece(OWNER, "top");
    const trousers = await addPiece(OWNER, "trousers");
    await setMatch(OWNER, top, trousers);

    await as("authenticated", OWNER, "delete from public.pieces where id = $1", [trousers]);

    expect(await matchOf(top)).toBeNull();
  });
});
