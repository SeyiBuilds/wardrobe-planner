import type { SupabaseClient } from "@supabase/supabase-js";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Inspiration } from "./inspirations";
import { StyleProvider, useStyle, useStyleInput } from "./style";

vi.mock("./photo", () => ({
  PhotoError: class PhotoError extends Error {},
  preparePhoto: vi.fn(async () => ({ blob: new Blob(["jpeg"], { type: "image/jpeg" }), colours: [] })),
}));

function reading(id: string, fields: Partial<Inspiration> = {}): Inspiration {
  return {
    id,
    user_id: "u1",
    photo_path: null,
    status: "done",
    day_type: "corporate",
    formality: "smart",
    pieces: [
      { kind: "top", colour: "white", patterned: false },
      { kind: "trousers", colour: "navy", patterned: false },
    ],
    created_at: "2026-11-13T10:00:00Z",
    updated_at: "2026-11-13T10:00:00Z",
    ...fields,
  };
}

// Just enough of Supabase for the Style tab: the inspirations and settings tables and the photo bucket.
function fakeSupabase(rows: Inspiration[] = [], style: Record<string, string> = {}) {
  const db = { rows: [...rows], style: { ...style } as Record<string, string> | null };
  const uploads: string[] = [];
  const removedFiles: string[] = [];

  function respond(table: string, ops: [string, ...unknown[]][]) {
    const op = (name: string) => ops.find(([method]) => method === name);
    if (table === "settings") {
      const upsert = op("upsert");
      if (upsert) db.style = (upsert[1] as { style: Record<string, string> }).style;
      return { data: { style: db.style }, error: null };
    }
    const eq = op("eq");
    const id = eq ? (eq[2] as string) : null;
    const insert = op("insert");
    if (insert) {
      const row = reading((insert[1] as { id: string }).id, {
        ...(insert[1] as Partial<Inspiration>),
        status: "waiting",
        pieces: [],
        day_type: null,
      });
      db.rows.unshift(row);
      return { data: row, error: null };
    }
    const update = op("update");
    if (update) {
      db.rows = db.rows.map((r) => (r.id === id ? { ...r, ...(update[1] as Partial<Inspiration>) } : r));
      return { data: db.rows.find((r) => r.id === id), error: null };
    }
    if (op("delete")) {
      db.rows = db.rows.filter((r) => r.id !== id);
      return { data: null, error: null };
    }
    return { data: db.rows, error: null };
  }

  function from(table: string) {
    const ops: [string, ...unknown[]][] = [];
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            return (resolve: (value: unknown) => void) => resolve(respond(table, ops));
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
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "token" } } }) },
    from,
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          removedFiles.push(...paths);
          return { data: [], error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, db, uploads, removedFiles };
}

function setup(rows: Inspiration[] = [], style: Record<string, string> = {}) {
  const supabase = fakeSupabase(rows, style);
  const wrapper = ({ children }: { children: ReactNode }) => <StyleProvider client={supabase.client}>{children}</StyleProvider>;
  const hook = renderHook(() => ({ style: useStyle(), input: useStyleInput() }), { wrapper });
  return { ...supabase, hook };
}

// The AI reader answers with a church reading for whatever picture it's sent.
function fakeReader() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { inspirationId } = JSON.parse(init.body as string);
    const done = reading(inspirationId, { day_type: "church", photo_path: null });
    return new Response(JSON.stringify({ status: "done", inspiration: done }), { status: 200 });
  });
}

describe("StyleProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads your readings and builds your style from the finished ones", async () => {
    const { hook } = setup([reading("a"), reading("b", { status: "failed", photo_path: "u1/inspiration/b.jpg" })], {
      bold: "less",
    });

    await waitFor(() => expect(hook.result.current.style.inspirations).toHaveLength(2));
    expect(hook.result.current.style.profile.all.count).toBe(1);
    expect(hook.result.current.input).toEqual({ profile: hook.result.current.style.profile, overrides: { bold: "less" } });
  });

  it("adds pictures, then reads them and keeps only the reading", async () => {
    const reader = fakeReader();
    vi.stubGlobal("fetch", reader);
    const { hook, uploads } = setup();
    await waitFor(() => expect(hook.result.current.style.inspirations).toEqual([]));

    await act(() => hook.result.current.style.addPictures([new File(["x"], "look.jpg", { type: "image/jpeg" })]));

    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(/^u1\/inspiration\/.+\.jpg$/);
    await waitFor(() => expect(hook.result.current.style.profile.byDay.church.count).toBe(1));
    expect(reader).toHaveBeenCalledWith("/api/read-inspiration", expect.objectContaining({ method: "POST" }));
    expect(hook.result.current.style.inspirations![0]).toMatchObject({ status: "done", photo_path: null });
  });

  it("changes a reading's kind of day", async () => {
    const { hook, db } = setup([reading("a")]);
    await waitFor(() => expect(hook.result.current.style.inspirations).toHaveLength(1));

    await act(() => hook.result.current.style.setDayType("a", "casual"));

    expect(db.rows[0].day_type).toBe("casual");
    expect(hook.result.current.style.profile.byDay.casual.count).toBe(1);
  });

  it("removes a reading, and any picture still waiting", async () => {
    const { hook, db, removedFiles } = setup([reading("a", { status: "failed", photo_path: "u1/inspiration/a.jpg" })]);
    await waitFor(() => expect(hook.result.current.style.inspirations).toHaveLength(1));

    await act(() => hook.result.current.style.remove(hook.result.current.style.inspirations![0]));

    expect(db.rows).toEqual([]);
    expect(removedFiles).toEqual(["u1/inspiration/a.jpg"]);
    expect(hook.result.current.style.inspirations).toEqual([]);
  });

  it("tries a failed picture again", async () => {
    vi.stubGlobal("fetch", fakeReader());
    const { hook } = setup([reading("f", { status: "failed", photo_path: "u1/inspiration/f.jpg", pieces: [], day_type: null })]);
    await waitFor(() => expect(hook.result.current.style.inspirations).toHaveLength(1));

    await act(() => hook.result.current.style.readAgain("f"));

    await waitFor(() => expect(hook.result.current.style.inspirations![0].status).toBe("done"));
  });

  it("saves your overrides, keeping the others", async () => {
    const { hook, db } = setup([], { bold: "less" });
    await waitFor(() => expect(hook.result.current.style.overrides).toEqual({ bold: "less" }));

    await act(() => hook.result.current.style.saveOverrides({ tonal: "always" }));

    expect(db.style).toEqual({ bold: "less", tonal: "always" });
    expect(hook.result.current.style.overrides).toEqual({ bold: "less", tonal: "always" });
  });

  it("goes back to the pictures when you choose that", async () => {
    const { hook, db } = setup([], { bold: "less", tonal: "always" });
    await waitFor(() => expect(hook.result.current.style.overrides).toEqual({ bold: "less", tonal: "always" }));

    await act(() => hook.result.current.style.saveOverrides({ bold: undefined }));

    expect(db.style).toEqual({ tonal: "always" });
  });

  it("gives the planner nothing outside the provider", () => {
    const { result } = renderHook(() => useStyleInput());

    expect(result.current).toBeUndefined();
  });
});
