import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Piece } from "../lib/pieces";
import { useWardrobe } from "../lib/wardrobe";
import { PieceScreen } from "./PieceScreen";
import { WardrobeScreen } from "./WardrobeScreen";

vi.mock("../lib/wardrobe", () => ({ useWardrobe: vi.fn() }));

function piece(overrides: Partial<Piece>): Piece {
  return {
    id: "p1",
    user_id: "u1",
    type: "top",
    name: "Navy Oxford shirt",
    colour_name: "navy",
    colours: [{ hex: "#1b2a4a", share: 1 }],
    formality: "smart",
    occasions: ["corporate"],
    pattern: "plain",
    wears_before_wash: 1,
    wears_since_wash: 0,
    photo_path: "u1/p1.jpg",
    label_status: "done",
    reviewed: true,
    created_at: "2026-11-05T10:00:00Z",
    updated_at: "2026-11-05T10:00:00Z",
    ...overrides,
  };
}

function wardrobe(overrides: Partial<ReturnType<typeof useWardrobe>> = {}) {
  const value = {
    pieces: [],
    loadError: null,
    links: {},
    unpacking: false,
    adding: null,
    addErrors: [],
    queue: { state: "idle" },
    addPhotos: vi.fn(async () => {}),
    save: vi.fn(async () => piece({})),
    remove: vi.fn(async () => {}),
    readAgain: vi.fn(async () => {}),
    resumeReading: vi.fn(),
    reload: vi.fn(),
    clearAddErrors: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useWardrobe>;
  vi.mocked(useWardrobe).mockReturnValue(value);
  return value;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/wardrobe" element={<WardrobeScreen />} />
        <Route path="/wardrobe/:pieceId" element={<PieceScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Wardrobe screen", () => {
  it("invites you to add your first piece when it's empty", () => {
    wardrobe();
    renderAt("/wardrobe");

    expect(screen.getByText(/Your wardrobe is empty/)).toBeInTheDocument();
    expect(screen.getByLabelText("Take a photo")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Choose photos")).toHaveAttribute("multiple");
  });

  it("accepts zips as well as photos", () => {
    wardrobe();
    renderAt("/wardrobe");

    expect(screen.getByLabelText("Choose photos")).toHaveAttribute("accept", "image/*,.zip,application/zip");
    expect(screen.getByText(/a \.zip of photos/)).toBeInTheDocument();
  });

  it("offers a folder picker where the device has one", () => {
    // The test browser has no folder picker, so give inputs one, as desktop browsers do.
    const values = new WeakMap<HTMLInputElement, boolean>();
    Object.defineProperty(HTMLInputElement.prototype, "webkitdirectory", {
      configurable: true,
      get(this: HTMLInputElement) {
        return values.get(this) ?? false;
      },
      set(this: HTMLInputElement, value: boolean) {
        values.set(this, value);
      },
    });
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    vi.stubGlobal("matchMedia", matchMedia);
    wardrobe();
    renderAt("/wardrobe");

    const folder = screen.getByLabelText("Choose a folder") as HTMLInputElement;
    expect(folder.webkitdirectory).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(pointer: fine)");
    expect(screen.getByText(/or a whole folder/)).toBeInTheDocument();

    vi.unstubAllGlobals();
    delete (HTMLInputElement.prototype as { webkitdirectory?: boolean }).webkitdirectory;
  });

  it("leaves out the folder picker on phones", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }) as MediaQueryList));
    wardrobe();
    renderAt("/wardrobe");

    expect(screen.queryByLabelText("Choose a folder")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("says when it's opening a zip or folder", () => {
    wardrobe({ unpacking: true });
    renderAt("/wardrobe");

    expect(screen.getByText("Opening your files…")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose photos")).toBeDisabled();
  });

  it("hands chosen photos over to be added", async () => {
    const value = wardrobe();
    renderAt("/wardrobe");
    const file = new File(["x"], "shirt.jpg", { type: "image/jpeg" });

    await userEvent.upload(screen.getByLabelText("Choose photos"), file);

    expect(value.addPhotos).toHaveBeenCalledWith([file]);
  });

  it("shows each piece with what still needs doing", () => {
    wardrobe({
      pieces: [
        piece({ id: "a", name: "Navy Oxford shirt" }),
        piece({ id: "b", name: "", label_status: "waiting", reviewed: false, type: "trousers" }),
        piece({ id: "c", name: "Tan loafers", reviewed: false, type: "shoes" }),
        piece({ id: "d", name: "", label_status: "failed", reviewed: false }),
      ],
    });
    renderAt("/wardrobe");

    expect(screen.getByText("4 pieces")).toBeInTheDocument();
    expect(screen.getByText("Waiting to be read")).toBeInTheDocument();
    expect(screen.getByText("Check this")).toBeInTheDocument();
    expect(screen.getByText("Fill this in")).toBeInTheDocument();
    expect(screen.getAllByText("Not read yet")).toHaveLength(2);
  });

  it("filters by type, offering only types you own", async () => {
    const user = userEvent.setup();
    wardrobe({
      pieces: [piece({ id: "a", name: "Navy Oxford shirt" }), piece({ id: "b", name: "Tan loafers", type: "shoes" })],
    });
    renderAt("/wardrobe");

    expect(screen.queryByRole("button", { name: /Watches/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Shoes/ }));

    expect(screen.getByText("Tan loafers")).toBeInTheDocument();
    expect(screen.queryByText("Navy Oxford shirt")).not.toBeInTheDocument();
  });

  it("explains when the free allowance has run out, and lets you try again", async () => {
    const value = wardrobe({
      pieces: [piece({ label_status: "waiting", reviewed: false })],
      queue: { state: "paused", reason: "allowance" },
    });
    renderAt("/wardrobe");

    expect(screen.getByText(/free AI allowance has run out/)).toHaveTextContent("1 photo will be read");
    await userEvent.click(screen.getByRole("button", { name: "Try now" }));
    expect(value.resumeReading).toHaveBeenCalled();
  });

  it("explains when AI reading isn't connected yet", () => {
    wardrobe({
      pieces: [piece({ label_status: "waiting", reviewed: false })],
      queue: { state: "paused", reason: "unavailable" },
    });
    renderAt("/wardrobe");

    expect(screen.getByText(/isn't connected yet/)).toBeInTheDocument();
  });

  it("lists photos that couldn't be added", () => {
    wardrobe({ addErrors: ["scan.pdf: This file isn't a photo the app can open."] });
    renderAt("/wardrobe");

    expect(screen.getByRole("alert")).toHaveTextContent("scan.pdf");
  });
});

describe("Piece screen", () => {
  it("saves your corrections and marks the piece as checked", async () => {
    const user = userEvent.setup();
    const value = wardrobe({ pieces: [piece({ reviewed: false })] });
    renderAt("/wardrobe/p1");

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Blue Oxford shirt");
    await user.click(screen.getByLabelText("Church"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(value.save).toHaveBeenCalledWith("p1", {
      name: "Blue Oxford shirt",
      type: "top",
      colour_name: "navy",
      formality: "smart",
      occasions: ["corporate", "church"],
      pattern: "plain",
      wears_before_wash: 1,
      reviewed: true,
    });
  });

  it("uses the new type's usual wear count when you change the type", async () => {
    const user = userEvent.setup();
    wardrobe({ pieces: [piece({})] });
    renderAt("/wardrobe/p1");

    await user.selectOptions(screen.getByLabelText("Type"), "trousers");
    expect(screen.getByLabelText("Wears before washing")).toHaveValue("2");

    await user.selectOptions(screen.getByLabelText("Type"), "shoes");
    expect(screen.getByLabelText("Wears before washing")).toHaveValue("repeat");
  });

  it("keeps a wear count you chose yourself when the type changes", async () => {
    const user = userEvent.setup();
    wardrobe({ pieces: [piece({})] });
    renderAt("/wardrobe/p1");

    await user.selectOptions(screen.getByLabelText("Wears before washing"), "3");
    await user.selectOptions(screen.getByLabelText("Type"), "trousers");

    expect(screen.getByLabelText("Wears before washing")).toHaveValue("3");
  });

  it("deletes only after you confirm", async () => {
    const user = userEvent.setup();
    const value = wardrobe({ pieces: [piece({})] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderAt("/wardrobe/p1");

    await user.click(screen.getByRole("button", { name: "Delete piece" }));
    expect(value.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete piece" }));
    expect(value.remove).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("offers another try when the AI couldn't read the photo", async () => {
    const value = wardrobe({ pieces: [piece({ name: "", label_status: "failed", reviewed: false })] });
    renderAt("/wardrobe/p1");

    await userEvent.click(screen.getByRole("button", { name: "Try reading again" }));

    expect(value.readAgain).toHaveBeenCalledWith("p1");
  });

  it("shows the colours measured from the photo", () => {
    wardrobe({ pieces: [piece({ colours: [{ hex: "#1b2a4a", share: 0.7 }, { hex: "#c49a6c", share: 0.3 }] })] });
    renderAt("/wardrobe/p1");

    expect(screen.getByRole("img", { name: "#1b2a4a" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "#c49a6c" })).toBeInTheDocument();
  });

  it("says so when the piece no longer exists", () => {
    wardrobe({ pieces: [] });
    renderAt("/wardrobe/missing");

    expect(screen.getByText(/isn't in your wardrobe any more/)).toBeInTheDocument();
  });
});
