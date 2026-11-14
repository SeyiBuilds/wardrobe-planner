import type { SupabaseClient } from "@supabase/supabase-js";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Piece } from "./pieces";
import { PlanningProvider, usePlanning } from "./planning";
import type { Outfit } from "./plans";
import { useStyleInput } from "./style";
import { buildProfile } from "./styleProfile";
import { useWardrobe } from "./wardrobe";

vi.mock("./wardrobe", () => ({ useWardrobe: vi.fn() }));
vi.mock("./style", () => ({ useStyleInput: vi.fn(() => undefined) }));

let n = 0;
function piece(type: Piece["type"], hex: string, fields: Partial<Piece> = {}): Piece {
  n++;
  return {
    id: `${type}-${n}`,
    user_id: "u1",
    type,
    name: `${type} ${n}`,
    colour_name: "",
    colours: [{ hex, share: 1 }],
    formality: "smart",
    occasions: ["casual", "corporate", "church"],
    pattern: "plain",
    wears_before_wash: type === "top" ? 1 : type === "trousers" ? 2 : null,
    wears_since_wash: 0,
    in_wash: false,
    photo_path: `u1/${n}.jpg`,
    label_status: "done",
    reviewed: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...fields,
  };
}

const PIECES = [
  ...["#f5f5f5", "#c6d8ee", "#808080", "#f5f5f5", "#c6d8ee", "#55603a", "#f5f5f5"].map((hex) => piece("top", hex)),
  piece("trousers", "#1b2a4a"),
  piece("trousers", "#151515"),
  piece("trousers", "#c49a6c"),
  piece("trousers", "#808080"),
  piece("shoes", "#151515"),
  piece("shoes", "#5a3a22"),
];

// Just enough of Supabase for the planner: the outfits and settings tables, the pieces list and the check.
function fakeSupabase(outfits: Outfit[] = []) {
  const db = { outfits: [...outfits], usualWeek: null as string[] | null, pieces: PIECES };
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: null, error: null }));
  let nextId = 1;

  function respond(table: string, ops: [string, ...unknown[]][]) {
    const op = (name: string) => ops.find(([method]) => method === name);
    if (table === "pieces") return { data: db.pieces, error: null };
    if (table === "settings") {
      const upsert = op("upsert");
      if (upsert) db.usualWeek = (upsert[1] as { usual_week: string[] }).usual_week;
      return { data: db.usualWeek ? { usual_week: db.usualWeek } : null, error: null };
    }
    const upsert = op("upsert");
    if (upsert) {
      const saved = (upsert[1] as Partial<Outfit>[]).map((row) => {
        const existing = db.outfits.find((o) => o.day === row.day);
        const outfit = { ...(existing ?? { id: `new-${nextId++}`, worn: null, checked_at: null }), ...row } as Outfit;
        db.outfits = [...db.outfits.filter((o) => o.day !== row.day), outfit];
        return outfit;
      });
      return { data: saved, error: null };
    }
    const update = op("update");
    if (update) {
      const id = op("eq")![2];
      const outfit = { ...db.outfits.find((o) => o.id === id)!, ...(update[1] as Partial<Outfit>) };
      db.outfits = db.outfits.map((o) => (o.id === id ? outfit : o));
      return { data: outfit, error: null };
    }
    return { data: [...db.outfits].sort((a, b) => a.day.localeCompare(b.day)), error: null };
  }

  function from(table: string) {
    const ops: [string, ...unknown[]][] = [];
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
              Promise.resolve(respond(table, ops)).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            ops.push([prop, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  }

  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from,
    rpc,
  } as unknown as SupabaseClient;
  return { client, db, rpc };
}

function outfit(day: string, fields: Partial<Outfit> = {}): Outfit {
  return {
    id: `saved-${day}`,
    user_id: "u1",
    day,
    day_type: "corporate",
    top_id: PIECES[0].id,
    trousers_id: PIECES[7].id,
    suit_id: null,
    native_set_id: null,
    shoes_id: PIECES[11].id,
    watch_id: null,
    belt_id: null,
    notes: [],
    worn: null,
    checked_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...fields,
  };
}

const reload = vi.fn();
const save = vi.fn(async () => PIECES[0]);

function setup(now: Date, outfits: Outfit[] = [], { pieces = PIECES, undoTime = 5000 } = {}) {
  vi.mocked(useWardrobe).mockReturnValue({ pieces, reload, save } as unknown as ReturnType<typeof useWardrobe>);
  const supabase = fakeSupabase(outfits);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlanningProvider client={supabase.client} now={() => now} random={() => 0.5} undoTime={undoTime}>
      {children}
    </PlanningProvider>
  );
  const hook = renderHook(() => usePlanning(), { wrapper });
  return { ...supabase, hook };
}

const WEDNESDAY = new Date(2026, 10, 11, 9);
const SUNDAY_EVENING = new Date(2026, 10, 15, 18);
const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

describe("PlanningProvider", () => {
  beforeEach(() => {
    reload.mockClear();
    save.mockClear();
  });

  it("loads the week and offers to plan the rest of it", async () => {
    const { hook } = setup(WEDNESDAY);

    await waitFor(() => expect(hook.result.current.outfits).toEqual([]));
    expect(hook.result.current.status?.toPlan.map((d) => d.day)).toEqual(WEEK.slice(2));
  });

  it("plans and saves the days still to plan", async () => {
    const { hook, db } = setup(WEDNESDAY);
    await waitFor(() => expect(hook.result.current.outfits).not.toBeNull());

    await act(() => hook.result.current.planMissing());

    expect(db.outfits.map((o) => o.day)).toEqual(WEEK.slice(2));
    expect(db.outfits.every((o) => o.top_id && o.trousers_id && o.shoes_id)).toBe(true);
    expect(hook.result.current.status?.toPlan).toEqual([]);
  });

  it("saves the check, then plans next week", async () => {
    const { hook, db, rpc } = setup(SUNDAY_EVENING, WEEK.map((day) => outfit(day)));
    await waitFor(() => expect(hook.result.current.status?.due).toHaveLength(7));

    await act(() => hook.result.current.finishCheck({ "saved-2026-11-09": [PIECES[0].id] }, [PIECES[0].id]));

    expect(rpc).toHaveBeenCalledWith("finish_check", {
      checked: [{ id: "saved-2026-11-09", worn: [PIECES[0].id] }],
      washed: [PIECES[0].id],
    });
    expect(reload).toHaveBeenCalled();
    expect(db.outfits.filter((o) => o.day >= "2026-11-16")).toHaveLength(7);
  });

  it("re-plans a day with a different outfit", async () => {
    const { hook, db } = setup(WEDNESDAY, [outfit("2026-11-11")]);
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    await act(() => hook.result.current.replanDay("2026-11-11"));

    const after = db.outfits.find((o) => o.day === "2026-11-11")!;
    expect([after.top_id, after.trousers_id]).not.toEqual([PIECES[0].id, PIECES[7].id]);
  });

  it("changes one day's type and plans it again", async () => {
    const { hook, db } = setup(WEDNESDAY, [outfit("2026-11-11")]);
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    await act(() => hook.result.current.setDayType("2026-11-11", "none"));

    expect(db.outfits.find((o) => o.day === "2026-11-11")).toMatchObject({ day_type: "none", top_id: null, shoes_id: null });
  });

  it("swaps one piece", async () => {
    const { hook, db } = setup(WEDNESDAY, [outfit("2026-11-11")]);
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    await act(() => hook.result.current.swap("2026-11-11", "trousers", PIECES[8].id));

    expect(db.outfits[0].trousers_id).toBe(PIECES[8].id);
  });

  it("offers swap choices as pieces", async () => {
    const { hook } = setup(WEDNESDAY, [outfit("2026-11-11")]);
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    const choices = hook.result.current.choicesFor("2026-11-11", "shoes");

    expect(choices.map((choice) => choice.piece.id)).toEqual(expect.arrayContaining([PIECES[11].id, PIECES[12].id]));
  });

  it("saves your usual week", async () => {
    const { hook, db } = setup(WEDNESDAY);
    await waitFor(() => expect(hook.result.current.outfits).not.toBeNull());
    const week = ["corporate", "corporate", "corporate", "corporate", "native", "casual", "church"] as const;

    await act(() => hook.result.current.saveUsualWeek([...week]));

    expect(db.usualWeek).toEqual(week);
    expect(hook.result.current.usualWeek).toEqual(week);
  });

  it("marks laundry clean through the check, and sends pieces to the wash", async () => {
    const { hook, rpc } = setup(WEDNESDAY);
    await waitFor(() => expect(hook.result.current.outfits).not.toBeNull());

    await act(() => hook.result.current.markClean([PIECES[0].id]));
    await act(() => hook.result.current.sendToWash(PIECES[1].id));

    expect(rpc).toHaveBeenCalledWith("finish_check", { checked: [], washed: [PIECES[0].id] });
    expect(reload).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(PIECES[1].id, { in_wash: true });
  });
});

describe("Other outfits for a day", () => {
  const DAY = "2026-11-11";
  const base = (o: Outfit | undefined) => [o?.top_id, o?.trousers_id, o?.suit_id, o?.native_set_id].join();

  it("shows a new outfit each time, and goes back through the ones you've seen", async () => {
    const { hook, db } = setup(WEDNESDAY, [outfit(DAY)]);
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));
    const first = base(db.outfits[0]);
    expect(hook.result.current.canGoBack(DAY)).toBe(false);

    await act(() => hook.result.current.anotherOutfit(DAY));
    const second = base(db.outfits[0]);
    await act(() => hook.result.current.anotherOutfit(DAY));
    const third = base(db.outfits[0]);

    expect(new Set([first, second, third]).size).toBe(3);
    expect(hook.result.current.canGoBack(DAY)).toBe(true);

    await act(() => hook.result.current.previousOutfit(DAY));
    expect(base(db.outfits[0])).toBe(second);
    await act(() => hook.result.current.previousOutfit(DAY));
    expect(base(db.outfits[0])).toBe(first);
    expect(hook.result.current.canGoBack(DAY)).toBe(false);

    // Forward again goes through the same ones before making new ones.
    await act(() => hook.result.current.anotherOutfit(DAY));
    expect(base(db.outfits[0])).toBe(second);
  });

  it("says when there's no other outfit", async () => {
    const few = [PIECES[0], PIECES[7], PIECES[11]];
    const { hook, db } = setup(WEDNESDAY, [outfit(DAY)], { pieces: few });
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    let worked = true;
    await act(async () => {
      worked = await hook.result.current.anotherOutfit(DAY);
    });

    expect(worked).toBe(false);
    expect(hook.result.current.error).toMatch(/no other outfit/);
    expect(db.outfits[0].top_id).toBe(PIECES[0].id);
  });

  it("starts afresh after you change a piece yourself", async () => {
    const { hook } = setup(WEDNESDAY, [outfit(DAY)]);
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    await act(() => hook.result.current.anotherOutfit(DAY));
    await act(() => hook.result.current.swap(DAY, "shoes", PIECES[12].id));

    expect(hook.result.current.canGoBack(DAY)).toBe(false);
  });

  it("leaves days you've worn alone", async () => {
    const { hook, db } = setup(WEDNESDAY, [outfit(DAY, { checked_at: "2026-11-11T20:00:00Z", worn: [PIECES[0].id] })]);
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    await act(() => hook.result.current.anotherOutfit(DAY));

    expect(db.outfits[0].top_id).toBe(PIECES[0].id);
    expect(hook.result.current.error).toMatch(/can't be changed/);
  });
});

describe("Marking today worn", () => {
  const DAY = "2026-11-11";

  it("counts what you wore once the undo time is up", async () => {
    const { hook, rpc } = setup(WEDNESDAY, [outfit(DAY)], { undoTime: 50 });
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    act(() => hook.result.current.markWorn(DAY));
    expect(hook.result.current.pendingWorn).toBe(DAY);
    expect(rpc).not.toHaveBeenCalled();

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [name, args] = rpc.mock.calls[0] as [string, { checked: { id: string; worn: string[] }[]; washed: string[] }];
    expect(name).toBe("finish_check");
    expect(args.checked).toHaveLength(1);
    expect(args.checked[0].id).toBe(`saved-${DAY}`);
    expect([...args.checked[0].worn].sort()).toEqual([PIECES[0].id, PIECES[7].id, PIECES[11].id].sort());
    expect(args.washed).toEqual([]);
    await waitFor(() => expect(hook.result.current.pendingWorn).toBeNull());
    expect(reload).toHaveBeenCalled();
  });

  it("does nothing if you undo in time", async () => {
    const { hook, rpc } = setup(WEDNESDAY, [outfit(DAY)], { undoTime: 50 });
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    act(() => hook.result.current.markWorn(DAY));
    act(() => hook.result.current.undoWorn());
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(rpc).not.toHaveBeenCalled();
    expect(hook.result.current.pendingWorn).toBeNull();
  });

  it("saves straight away if you leave the app before the undo time is up", async () => {
    const { hook, rpc } = setup(WEDNESDAY, [outfit(DAY)], { undoTime: 60_000 });
    await waitFor(() => expect(hook.result.current.outfits).toHaveLength(1));

    act(() => hook.result.current.markWorn(DAY));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("finish_check", expect.anything()));
  });
});

describe("PlanningProvider with your style", () => {
  afterEach(() => vi.mocked(useStyleInput).mockReturnValue(undefined));

  it("plans with your style and says why", async () => {
    const readings = Array.from({ length: 10 }, () => ({
      day_type: "corporate" as const,
      formality: "smart" as const,
      pieces: [
        { kind: "top", colour: "white", patterned: false },
        { kind: "trousers", colour: "navy", patterned: false },
      ],
    }));
    vi.mocked(useStyleInput).mockReturnValue({ profile: buildProfile(readings), overrides: {} });
    const { hook, db } = setup(WEDNESDAY);
    await waitFor(() => expect(hook.result.current.outfits).not.toBeNull());

    await act(() => hook.result.current.planMissing());

    const wednesday = db.outfits.find((o) => o.day === "2026-11-11")!;
    expect(wednesday.notes).toContainEqual({ kind: "why", text: "White and navy, like 10 of your corporate pictures." });
  });
});
