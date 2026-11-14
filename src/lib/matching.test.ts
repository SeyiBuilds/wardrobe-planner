import { afterMatch, type Piece } from "./pieces";

function piece(id: string, match_id: string | null = null): Piece {
  return {
    id,
    user_id: "u1",
    type: id.startsWith("top") ? "top" : "trousers",
    name: id,
    colour_name: "",
    colours: [],
    formality: "smart",
    occasions: ["native"],
    pattern: "plain",
    wears_before_wash: 1,
    wears_since_wash: 0,
    in_wash: false,
    match_id,
    photo_path: `u1/${id}.jpg`,
    label_status: "done",
    reviewed: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

const matches = (pieces: Piece[]) => Object.fromEntries(pieces.map((p) => [p.id, p.match_id ?? null]));

describe("afterMatch", () => {
  it("matches both halves", () => {
    expect(matches(afterMatch([piece("top"), piece("trousers")], "top", "trousers"))).toEqual({
      top: "trousers",
      trousers: "top",
    });
  });

  it("frees an old partner, just like the database does", () => {
    const before = [piece("top", "old"), piece("old", "top"), piece("new")];

    expect(matches(afterMatch(before, "new", "top"))).toEqual({ top: "new", old: null, new: "top" });
  });

  it("unmatches both halves", () => {
    expect(matches(afterMatch([piece("top", "trousers"), piece("trousers", "top")], "trousers", null))).toEqual({
      top: null,
      trousers: null,
    });
  });
});
