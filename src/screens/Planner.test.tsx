import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Piece } from "../lib/pieces";
import { usePlanning } from "../lib/planning";
import { DEFAULT_WEEK, weekStatus, type Outfit } from "../lib/plans";
import { useWardrobe } from "../lib/wardrobe";
import { CheckScreen } from "./CheckScreen";
import { DayScreen } from "./DayScreen";
import { LaundryScreen } from "./LaundryScreen";
import { PieceScreen } from "./PieceScreen";
import { UsualWeekScreen } from "./UsualWeekScreen";
import { WeekScreen } from "./WeekScreen";

vi.mock("../lib/wardrobe", () => ({ useWardrobe: vi.fn() }));
vi.mock("../lib/planning", () => ({ usePlanning: vi.fn() }));

function piece(id: string, fields: Partial<Piece> = {}): Piece {
  return {
    id,
    user_id: "u1",
    type: "top",
    name: id,
    colour_name: "",
    colours: [{ hex: "#f5f5f5", share: 1 }],
    formality: "smart",
    occasions: ["corporate"],
    pattern: "plain",
    wears_before_wash: 1,
    wears_since_wash: 0,
    in_wash: false,
    photo_path: `u1/${id}.jpg`,
    label_status: "done",
    reviewed: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...fields,
  };
}

const TOP = piece("White shirt");
const TOP_B = piece("Blue shirt");
const TROUSERS = piece("Navy chinos", { type: "trousers", wears_before_wash: 2 });
const WHITE_TROUSERS = piece("White trousers", { type: "trousers", wears_before_wash: 2 });
const SHOES = piece("Brown loafers", { type: "shoes", wears_before_wash: null });
const WASHING = piece("Olive polo", { in_wash: true, wears_since_wash: 1 });
const PIECES = [TOP, TOP_B, TROUSERS, WHITE_TROUSERS, SHOES, WASHING];

function outfit(day: string, fields: Partial<Outfit> = {}): Outfit {
  return {
    id: `outfit-${day}`,
    user_id: "u1",
    day,
    day_type: "corporate",
    top_id: null,
    trousers_id: null,
    suit_id: null,
    native_set_id: null,
    shoes_id: null,
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

const WEDNESDAY = new Date(2026, 10, 11, 9);
const SUNDAY_EVENING = new Date(2026, 10, 15, 18);
const MONDAY = "2026-11-09";
const DRESSED = { top_id: TOP.id, trousers_id: TROUSERS.id, shoes_id: SHOES.id };

function setup({ now = WEDNESDAY, outfits = [] as Outfit[], pieces = PIECES, planning = {} } = {}) {
  vi.mocked(useWardrobe).mockReturnValue({
    pieces,
    links: Object.fromEntries(pieces.map((p) => [p.photo_path, `https://example.test/${p.id}.jpg`])),
    save: vi.fn(),
  } as unknown as ReturnType<typeof useWardrobe>);
  const value = {
    outfits,
    usualWeek: DEFAULT_WEEK,
    status: weekStatus(now, outfits, DEFAULT_WEEK),
    loadError: null,
    working: false,
    error: null,
    clearError: vi.fn(),
    reload: vi.fn(),
    planMissing: vi.fn(async () => true),
    replanDay: vi.fn(async () => true),
    setDayType: vi.fn(async () => true),
    swap: vi.fn(async () => true),
    choicesFor: vi.fn(() => []),
    saveUsualWeek: vi.fn(async () => true),
    finishCheck: vi.fn(async () => true),
    markClean: vi.fn(async () => true),
    sendToWash: vi.fn(async () => true),
    ...planning,
  } as ReturnType<typeof usePlanning>;
  vi.mocked(usePlanning).mockReturnValue(value);
  return value;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<WeekScreen />} />
        <Route path="/day/:day" element={<DayScreen />} />
        <Route path="/week/usual" element={<UsualWeekScreen />} />
        <Route path="/check" element={<CheckScreen />} />
        <Route path="/laundry" element={<LaundryScreen />} />
        <Route path="/wardrobe/:pieceId" element={<PieceScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("This week", () => {
  it("shows each day with its kind of day and outfit photos", () => {
    setup({ outfits: [outfit(MONDAY, DRESSED), outfit("2026-11-10", { day_type: "none" })] });
    renderAt("/");

    const monday = screen.getByRole("link", { name: /Monday/ });
    expect(monday).toHaveAttribute("href", `/day/${MONDAY}`);
    expect(monday).toHaveTextContent("Corporate");
    expect(within(monday).getAllByRole("img")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Tuesday/ })).toHaveTextContent("No outfit");
    expect(screen.getByRole("link", { name: /Thursday/ })).toHaveTextContent("Not planned yet");
  });

  it("doesn't call a day that's already gone 'not planned yet'", () => {
    setup();
    renderAt("/");

    expect(screen.getByRole("link", { name: /Monday/ })).toHaveTextContent("Not planned");
    expect(screen.getByRole("link", { name: /Monday/ })).not.toHaveTextContent("Not planned yet");
  });

  it("marks today", () => {
    setup();
    renderAt("/");

    expect(screen.getByRole("link", { name: /Wednesday/ })).toHaveTextContent("Today");
  });

  it("offers to plan the days still to plan", async () => {
    const planning = setup();
    renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: "Plan the rest of this week" }));

    expect(planning.planMissing).toHaveBeenCalled();
  });

  it("asks for your clothes before planning an empty wardrobe", () => {
    setup({ pieces: [] });
    renderAt("/");

    expect(screen.getByText(/Add your clothes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Plan/ })).not.toBeInTheDocument();
  });

  it("opens the weekly check on Sunday evening", () => {
    const week = ["09", "10", "11", "12", "13", "14", "15"].map((d) => outfit(`2026-11-${d}`, DRESSED));
    setup({ now: SUNDAY_EVENING, outfits: week });
    renderAt("/");

    expect(screen.getByRole("link", { name: "Start the check" })).toHaveAttribute("href", "/check");
    expect(screen.queryByRole("button", { name: /Plan/ })).not.toBeInTheDocument();
  });

  it("shows next week once it's planned", () => {
    setup({ now: SUNDAY_EVENING, outfits: [outfit("2026-11-16", DRESSED)] });
    renderAt("/");

    expect(screen.getByRole("heading", { name: "Next week" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Monday/ })).toHaveAttribute("href", "/day/2026-11-16");
  });

  it("links to your usual week", () => {
    setup();
    renderAt("/");

    expect(screen.getByRole("link", { name: "Change your usual week" })).toHaveAttribute("href", "/week/usual");
  });
});

describe("Day page", () => {
  const DAY = "2026-11-11";

  it("shows the outfit and why a slot is empty", () => {
    setup({
      outfits: [outfit(DAY, { top_id: TOP.id, shoes_id: SHOES.id, notes: [{ slot: "trousers", text: "No clean trousers left for corporate days." }] })],
    });
    renderAt(`/day/${DAY}`);

    expect(screen.getByRole("heading", { name: "Wednesday" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Change top/ })).toHaveTextContent("White shirt");
    expect(screen.getByRole("button", { name: /Change trousers/ })).toHaveTextContent("Empty");
    expect(screen.getByText("No clean trousers left for corporate days.")).toBeInTheDocument();
  });

  it("says why the outfit suits you, apart from the notes", () => {
    setup({
      outfits: [outfit(DAY, { ...DRESSED, notes: [{ kind: "why", text: "White and navy, like 4 of your corporate pictures." }] })],
    });
    renderAt(`/day/${DAY}`);

    expect(screen.getByText("White and navy, like 4 of your corporate pictures.")).toHaveClass("why-line");
  });

  it("changes the kind of day for this week only", async () => {
    const planning = setup({ outfits: [outfit(DAY, DRESSED)] });
    renderAt(`/day/${DAY}`);

    await userEvent.selectOptions(screen.getByLabelText("Kind of day"), "native");

    expect(planning.setDayType).toHaveBeenCalledWith(DAY, "native");
  });

  it("swaps a piece, showing which choices break a rule", async () => {
    const planning = setup({
      outfits: [outfit(DAY, DRESSED)],
      planning: {
        choicesFor: vi.fn(() => [
          { piece: TROUSERS, clash: null },
          { piece: WHITE_TROUSERS, clash: "Too close to the top's colour" },
        ]),
      },
    });
    renderAt(`/day/${DAY}`);

    await userEvent.click(screen.getByRole("button", { name: /Change trousers/ }));
    expect(screen.getByText("Too close to the top's colour")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /White trousers/ }));

    expect(planning.choicesFor).toHaveBeenCalledWith(DAY, "trousers");
    expect(planning.swap).toHaveBeenCalledWith(DAY, "trousers", WHITE_TROUSERS.id);
  });

  it("can leave a slot empty", async () => {
    const planning = setup({ outfits: [outfit(DAY, DRESSED)] });
    renderAt(`/day/${DAY}`);

    await userEvent.click(screen.getByRole("button", { name: /Change shoes/ }));
    await userEvent.click(screen.getByRole("button", { name: "Leave it empty" }));

    expect(planning.swap).toHaveBeenCalledWith(DAY, "shoes", null);
  });

  it("plans the day again", async () => {
    const planning = setup({ outfits: [outfit(DAY, DRESSED)] });
    renderAt(`/day/${DAY}`);

    await userEvent.click(screen.getByRole("button", { name: "Plan this day again" }));

    expect(planning.replanDay).toHaveBeenCalledWith(DAY);
  });

  it("offers to plan a day that hasn't been planned", async () => {
    const planning = setup();
    renderAt(`/day/${DAY}`);

    await userEvent.click(screen.getByRole("button", { name: "Plan this day" }));

    expect(planning.replanDay).toHaveBeenCalledWith(DAY);
  });

  it("warns when a planned piece is in the wash", () => {
    setup({ outfits: [outfit(DAY, { top_id: WASHING.id })] });
    renderAt(`/day/${DAY}`);

    expect(screen.getByRole("button", { name: /Change top/ })).toHaveTextContent("In the wash");
  });

  it("shows checked days without changing them", () => {
    setup({ outfits: [outfit(MONDAY, { ...DRESSED, checked_at: "2026-11-15T18:00:00Z", worn: [TOP.id] })] });
    renderAt(`/day/${MONDAY}`);

    expect(screen.queryByRole("button", { name: /Change/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Kind of day")).not.toBeInTheDocument();
    expect(screen.getByText("White shirt")).toBeInTheDocument();
  });
});

describe("Usual week", () => {
  it("saves the kind of each day", async () => {
    const planning = setup();
    renderAt("/week/usual");

    expect(screen.getByLabelText("Monday")).toHaveValue("corporate");
    await userEvent.selectOptions(screen.getByLabelText("Friday"), "native");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(planning.saveUsualWeek).toHaveBeenCalledWith(["corporate", "corporate", "corporate", "corporate", "native", "casual", "church"]);
  });
});

describe("Weekly check", () => {
  it("asks what you wore, then what's been washed, then plans", async () => {
    const monday = outfit(MONDAY, DRESSED);
    const tuesday = outfit("2026-11-10", { top_id: TOP_B.id });
    const planning = setup({ now: SUNDAY_EVENING, outfits: [monday, tuesday] });
    renderAt("/check");

    expect(screen.getByRole("checkbox", { name: /White shirt/ })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: /Blue shirt/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    // The worn white shirt has used its one wear, and the polo was already waiting.
    const washList = screen.getByRole("group", { name: /washed/ });
    expect(within(washList).getAllByRole("checkbox").map((box) => box.getAttribute("name"))).toEqual([
      TOP.id,
      WASHING.id,
    ]);
    await userEvent.click(screen.getByRole("checkbox", { name: /White shirt/ }));
    await userEvent.click(screen.getByRole("button", { name: "Finish and plan" }));

    expect(planning.finishCheck).toHaveBeenCalledWith(
      { [monday.id]: [TOP.id, TROUSERS.id, SHOES.id], [tuesday.id]: [] },
      [TOP.id],
    );
    expect(await screen.findByRole("heading", { name: /week/i })).toBeInTheDocument();
  });

  it("says when there's nothing to check", () => {
    setup();
    renderAt("/check");

    expect(screen.getByText(/nothing to check/i)).toBeInTheDocument();
  });
});

describe("Laundry", () => {
  it("marks the pieces you tick clean", async () => {
    const planning = setup();
    renderAt("/laundry");

    await userEvent.click(screen.getByRole("checkbox", { name: /Olive polo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Mark clean" }));

    expect(planning.markClean).toHaveBeenCalledWith([WASHING.id]);
  });

  it("says when nothing's in the wash", () => {
    setup({ pieces: [TOP] });
    renderAt("/laundry");

    expect(screen.getByText(/Nothing's in the wash/)).toBeInTheDocument();
  });
});

describe("Piece page laundry", () => {
  it("sends a piece to the wash", async () => {
    const planning = setup();
    renderAt(`/wardrobe/${TROUSERS.id}`);

    await userEvent.click(screen.getByRole("button", { name: "Send to the wash" }));

    expect(planning.sendToWash).toHaveBeenCalledWith(TROUSERS.id);
  });

  it("marks a piece in the wash clean", async () => {
    const planning = setup();
    renderAt(`/wardrobe/${WASHING.id}`);

    expect(screen.getByText(/In the wash/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark clean" }));

    expect(planning.markClean).toHaveBeenCalledWith([WASHING.id]);
  });

  it("doesn't offer washing for pieces that repeat", () => {
    setup();
    renderAt(`/wardrobe/${SHOES.id}`);

    expect(screen.queryByRole("button", { name: "Send to the wash" })).not.toBeInTheDocument();
  });
});
