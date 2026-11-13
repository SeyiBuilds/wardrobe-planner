import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { Inspiration } from "../lib/inspirations";
import { useStyle } from "../lib/style";
import { buildProfile } from "../lib/styleProfile";
import { StyleScreen } from "./StyleScreen";

vi.mock("../lib/style", () => ({ useStyle: vi.fn() }));

function inspiration(id: string, fields: Partial<Inspiration> = {}): Inspiration {
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
      { kind: "shoes", colour: "brown", patterned: false },
    ],
    created_at: "2026-11-13T10:00:00Z",
    updated_at: "2026-11-13T10:00:00Z",
    ...fields,
  };
}

function setup(overrides: Partial<ReturnType<typeof useStyle>> = {}) {
  const inspirations = overrides.inspirations ?? [];
  const done = (inspirations ?? []).filter((item) => item.status === "done");
  const value = {
    inspirations,
    loadError: null,
    unpacking: false,
    adding: null,
    addErrors: [],
    queue: { state: "idle" },
    overrides: {},
    profile: buildProfile(done),
    working: false,
    addPictures: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    setDayType: vi.fn(async () => {}),
    readAgain: vi.fn(async () => {}),
    resumeReading: vi.fn(),
    saveOverrides: vi.fn(async () => {}),
    clearAddErrors: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useStyle>;
  vi.mocked(useStyle).mockReturnValue(value);
  render(
    <MemoryRouter>
      <StyleScreen />
    </MemoryRouter>,
  );
  return value;
}

describe("Style tab", () => {
  it("invites your first pictures and explains what happens to them", () => {
    setup();

    expect(screen.getByLabelText("Choose pictures")).toHaveAttribute("accept", "image/*,.zip,application/zip");
    expect(screen.getByText(/deleted once it's been read/)).toBeInTheDocument();
    expect(screen.getByText(/Add a few pictures/)).toBeInTheDocument();
  });

  it("hands chosen pictures over to be read", async () => {
    const style = setup();
    const file = new File(["x"], "look.jpg", { type: "image/jpeg" });

    await userEvent.upload(screen.getByLabelText("Choose pictures"), file);

    expect(style.addPictures).toHaveBeenCalledWith([file]);
  });

  it("sums up your style for each kind of day", () => {
    setup({ inspirations: [inspiration("a"), inspiration("b"), inspiration("c", { day_type: "church" })] });

    const corporate = screen.getByRole("region", { name: /Corporate/ });
    expect(corporate).toHaveTextContent("2 pictures");
    expect(corporate).toHaveTextContent("White and navy");
    expect(corporate).toHaveTextContent("Strong contrast");
    expect(screen.getByRole("region", { name: /Church/ })).toHaveTextContent("1 picture");
  });

  it("lists each reading in words, and lets you change its kind of day", async () => {
    const style = setup({ inspirations: [inspiration("a")] });

    const item = screen.getByRole("listitem", { name: /White top/ });
    expect(item).toHaveTextContent("White top · Navy trousers · Brown shoes");
    await userEvent.selectOptions(within(item).getByLabelText("Kind of day"), "church");

    expect(style.setDayType).toHaveBeenCalledWith("a", "church");
  });

  it("removes a reading once you confirm", async () => {
    const style = setup({ inspirations: [inspiration("a")] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(style.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(style.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    confirm.mockRestore();
  });

  it("shows pictures waiting to be read, and offers another try for ones that failed", async () => {
    const style = setup({
      inspirations: [
        inspiration("w", { status: "waiting", photo_path: "u1/inspiration/w.jpg", pieces: [], day_type: null }),
        inspiration("f", { status: "failed", photo_path: "u1/inspiration/f.jpg", pieces: [], day_type: null }),
      ],
    });

    expect(screen.getByText("Waiting to be read")).toBeInTheDocument();
    expect(screen.getByText(/couldn't find an outfit/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(style.readAgain).toHaveBeenCalledWith("f");
  });

  it("lets you override how the planner uses your style", async () => {
    const style = setup({ inspirations: [inspiration("a")] });

    await userEvent.selectOptions(screen.getByLabelText("Tonal looks"), "always");
    await userEvent.selectOptions(screen.getByLabelText("Bold colours"), "less");

    expect(style.saveOverrides).toHaveBeenNthCalledWith(1, { tonal: "always" });
    expect(style.saveOverrides).toHaveBeenNthCalledWith(2, { bold: "less" });
  });

  it("explains when the free allowance has run out", () => {
    setup({
      inspirations: [inspiration("w", { status: "waiting", photo_path: "u1/inspiration/w.jpg", pieces: [] })],
      queue: { state: "paused", reason: "allowance" },
    });

    expect(screen.getByText(/free AI allowance has run out/)).toBeInTheDocument();
  });
});
