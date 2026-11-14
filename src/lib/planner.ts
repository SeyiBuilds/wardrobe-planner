import { beltMatchesShoes, readColour, sameAccent, standsOut, type ColourRead } from "./colourRules";
import { familyLabel, nearestFamily } from "./palette";
import type { Piece } from "./pieces";
import type { Occasion, PieceType } from "./pieceTypes";
import type { DayStyle, StyleOverrides, StyleProfile } from "./styleProfile";
import { addDays, dayName, daysBetween, parseDay } from "./week";

// The planner is plain code, not AI: it only ever picks from pieces that are clean, free that day
// and marked Good for that kind of day, then scores the combinations that pass the colour rules.

export type DayType = "casual" | "corporate" | "native" | "church" | "none";
export const DAY_TYPES: { id: DayType; label: string }[] = [
  { id: "corporate", label: "Corporate" },
  { id: "casual", label: "Casual" },
  { id: "native", label: "Native" },
  { id: "church", label: "Church" },
  { id: "none", label: "No outfit" },
];

export const SLOTS = ["top", "trousers", "suit", "native_set", "shoes", "watch", "belt"] as const;
export type Slot = (typeof SLOTS)[number];
export type Slots = Partial<Record<Slot, string>>;
// Notes say why a slot is empty or a combination repeats; a "why" note says why the outfit suits you.
export type Note = { slot?: Slot; text: string; kind?: "why" };
// Your style, if you've added inspiration: what the pictures show, and anything you've overridden.
export type StyleInput = { profile: StyleProfile; overrides: StyleOverrides };
export type DayPlan = { day: string; dayType: DayType; slots: Slots; notes: Note[] };
// Any outfit the planner should know about: earlier weeks, and days of this week it isn't planning.
// Unchecked ones still hold their pieces' wears.
export type KnownOutfit = { day: string; slots: Slots; checked: boolean };
export type PlannerPiece = Pick<
  Piece,
  "id" | "type" | "formality" | "occasions" | "pattern" | "colours" | "wears_before_wash" | "wears_since_wash" | "in_wash"
>;

const SLOT_TYPE: Record<Slot, PieceType> = {
  top: "top",
  trousers: "trousers",
  suit: "suit",
  native_set: "native_set",
  shoes: "shoes",
  watch: "watch",
  belt: "belt",
};
const NOUN: Record<Slot, string> = {
  top: "tops",
  trousers: "trousers",
  suit: "suits",
  native_set: "native sets",
  shoes: "shoes",
  watch: "watches",
  belt: "belts",
};
const LEVEL = { relaxed: 0, smart: 1, formal: 2 } as const;

// Tuning. Repeats and empty slots cost far more than any colour or freshness score can earn,
// so they only happen when there's no other way.
const RUNS = 8;
const PAIR_WINDOW = 21;
const OUTFIT_WINDOW = 28;
const FRESH_DAYS = 28;
const MISSING_MAIN = 1000;
const MISSING_SHOES = 400;
const MISSING_EXTRA = 15;
const REPEAT = 100;
const AVOID = 300;
const NOISE = 6;
const MAX_BASES = 30;

type Info = {
  piece: PlannerPiece;
  level: number | null;
  main: ColourRead | null;
  // The bold colour this piece brings, if any.
  accent: ColourRead | null;
  patterned: boolean;
  // Its main colour's family in the shared palette, to compare with your inspiration.
  family: string | null;
};
type Outfit = Partial<Record<Slot, Info>>;

function toInfo(piece: PlannerPiece): Info {
  const colours = [...piece.colours].sort((a, b) => b.share - a.share).map((c) => ({ ...c, read: readColour(c.hex) }));
  const main = colours[0]?.read ?? null;
  const patterned = piece.pattern === "patterned";
  const accent = patterned
    ? (colours.find((c) => c.share >= 0.15 && !c.read.neutral)?.read ?? null)
    : main && !main.neutral
      ? main
      : null;
  return {
    piece,
    level: piece.formality ? LEVEL[piece.formality] : null,
    main,
    accent,
    patterned,
    family: main ? nearestFamily(main.hex) : null,
  };
}

function isLabelled(piece: PlannerPiece) {
  return piece.formality !== null && piece.occasions.length > 0;
}

function goodFor(info: Info, dayType: DayType) {
  return (info.piece.occasions as string[]).includes(dayType);
}

function piecesOf(outfit: Outfit): Info[] {
  return SLOTS.flatMap((slot) => (outfit[slot] ? [outfit[slot]!] : []));
}

// The first rule an outfit breaks, worded for the piece in `changed`; null if it keeps them all.
// `allowTonal` lifts the top-stands-out rule, once your inspiration shows tonal looks.
function outfitProblem(outfit: Outfit, changed?: Slot, allowTonal = false): string | null {
  const parts = piecesOf(outfit);

  const levels = parts.flatMap((p) => (p.level === null ? [] : [p.level]));
  if (levels.length && Math.max(...levels) - Math.min(...levels) > 1) return "Too dressy or too casual for the rest";

  const accents: ColourRead[] = [];
  for (const p of parts) {
    if (p.accent && !accents.some((a) => sameAccent(a, p.accent!))) accents.push(p.accent);
  }
  if (accents.length > 1) return "Adds a second bold colour";

  if (parts.filter((p) => p.patterned).length > 1) return "Adds a second patterned piece";

  const top = outfit.top?.main;
  const bottomSlot = outfit.trousers ? "trousers" : "suit";
  const bottom = outfit[bottomSlot]?.main;
  if (top && bottom) {
    if (!top.neutral && !bottom.neutral) return "Needs a neutral top or trousers";
    if (!allowTonal && !standsOut(top, bottom)) {
      return changed === "top" ? `Too close to the ${bottomSlot === "suit" ? "suit's" : "trousers'"} colour` : "Too close to the top's colour";
    }
  }

  const shoes = outfit.shoes?.main;
  const belt = outfit.belt?.main;
  if (shoes && belt && !beltMatchesShoes(belt, shoes)) {
    return changed === "shoes" ? "Doesn't match the belt" : "Doesn't match the shoes";
  }
  return null;
}

// Keeps track of which days each piece is on and how many wears are held but not yet confirmed.
class Ledger {
  private days = new Map<string, Set<string>>();
  private held = new Map<string, number>();
  private planned = new Map<string, number>();
  readonly history: { day: string; pair: string | null; full: string | null }[] = [];

  constructor(known: KnownOutfit[]) {
    for (const outfit of known) {
      this.record(outfit.day, outfit.slots, !outfit.checked);
      this.history.push({ day: outfit.day, pair: pairKey(outfit.slots), full: fullKey(outfit.slots) });
    }
  }

  private record(day: string, slots: Slots, holds: boolean) {
    for (const id of Object.values(slots)) {
      if (!id) continue;
      if (!this.days.has(id)) this.days.set(id, new Set());
      this.days.get(id)!.add(day);
      if (holds) this.held.set(id, (this.held.get(id) ?? 0) + 1);
    }
  }

  assign(day: string, slots: Slots) {
    this.record(day, slots, true);
    for (const id of Object.values(slots)) if (id) this.planned.set(id, (this.planned.get(id) ?? 0) + 1);
  }

  remaining(piece: PlannerPiece): number {
    if (piece.in_wash) return 0;
    if (piece.wears_before_wash === null) return Infinity;
    return piece.wears_before_wash - piece.wears_since_wash - (this.held.get(piece.id) ?? 0);
  }

  usedOn(id: string, day: string) {
    return this.days.get(id)?.has(day) ?? false;
  }

  besideDay(id: string, day: string) {
    return this.usedOn(id, addDays(day, -1)) || this.usedOn(id, addDays(day, 1));
  }

  // 1 for a piece not worn in four weeks, down to near 0 for one worn the day before.
  freshness(id: string, day: string) {
    let gap = FRESH_DAYS;
    for (const used of this.days.get(id) ?? []) {
      const since = daysBetween(used, day);
      if (since > 0 && since < gap) gap = since;
    }
    return gap / FRESH_DAYS;
  }

  timesPlanned(id: string) {
    return this.planned.get(id) ?? 0;
  }
}

function pairKey(slots: Slots): string | null {
  const bottom = slots.trousers ?? slots.suit;
  return slots.top && bottom ? `${slots.top}|${bottom}` : null;
}

function fullKey(slots: Slots): string | null {
  const base = slots.native_set ?? pairKey(slots);
  return base && slots.shoes ? `${base}|${slots.shoes}` : null;
}

function idsOf(outfit: Outfit): Slots {
  const slots: Slots = {};
  for (const slot of SLOTS) if (outfit[slot]) slots[slot] = outfit[slot]!.piece.id;
  return slots;
}

function dateLabel(day: string) {
  const date = parseDay(day);
  return `${dayName(date)} ${date.getDate()} ${date.toLocaleDateString("en-GB", { month: "long" })}`;
}

type Context = {
  infos: Info[];
  ledger: Ledger;
  random: () => number;
  style?: StyleInput;
};

// Your style for one kind of day: that kind's own pictures, or all of them if it has none yet.
type DayStyleView = { style: DayStyle; ownPictures: boolean; weight: number; boldShare: number; patternShare: number };

// Style counts fully from 10 pictures, and only partly when borrowed from other kinds of day.
const FULL_STYLE_AT = 10;
const BORROWED_STYLE = 0.6;

function styleView(input: StyleInput | undefined, dayType: DayType): DayStyleView | null {
  if (!input || dayType === "none") return null;
  const own = input.profile.byDay[dayType as Occasion];
  const style = own.count > 0 ? own : input.profile.all;
  if (style.count === 0) return null;
  const share = (n: number) => n / style.count;
  const lean = (choice: "less" | "more" | undefined, n: number) => (choice === "less" ? 0 : choice === "more" ? 0.8 : share(n));
  return {
    style,
    ownPictures: own.count > 0,
    weight: (Math.min(style.count, FULL_STYLE_AT) / FULL_STYLE_AT) * (own.count > 0 ? 1 : BORROWED_STYLE),
    boldShare: lean(input.overrides.bold, style.bold),
    patternShare: lean(input.overrides.patterns, style.patterned),
  };
}

// Tonal looks are allowed if you say so, or once at least two pictures (a fifth or more) show them.
function tonalAllowed(input: StyleInput | undefined, dayType: DayType): boolean {
  if (input?.overrides.tonal === "always") return true;
  if (input?.overrides.tonal === "never") return false;
  const view = styleView(input, dayType);
  return !!view && view.style.tonal >= 2 && view.style.tonal / view.style.count >= 0.2;
}

// How closely an outfit matches your style, and a line saying why it suits you.
function styleScore(ctx: Context, outfit: Outfit, dayType: DayType): { score: number; why: string | null } {
  const view = styleView(ctx.style, dayType);
  if (!view) return { score: 0, why: null };
  const { style } = view;
  const parts = [outfit.top, outfit.trousers, outfit.suit, outfit.native_set].filter((p): p is Info => !!p);
  if (parts.length === 0) return { score: 0, why: null };

  let score = 0;
  let why: string | null = null;
  const where = view.ownPictures ? `your ${dayType} pictures` : "your pictures";

  const top = outfit.top;
  const bottom = outfit.trousers ?? outfit.suit;
  if (top?.family && bottom?.family) {
    const together = style.pairs[`${top.family}|${bottom.family}`] ?? 0;
    score += (together / style.count) * 10;
    if (together > 0) why = `${familyLabel(top.family)} and ${bottom.family}, like ${together} of ${where}.`;
  }

  const shares = parts.map((p) => (p.family ? (style.colours[p.family] ?? 0) / style.count : 0));
  score += (shares.reduce((sum, s) => sum + s, 0) / parts.length) * 6;
  if (!why) {
    const favourite = parts.find((p, i) => p.family && shares[i] >= 0.3);
    if (favourite) why = `${familyLabel(favourite.family!)} is one of your favourite colours.`;
  }

  if (top?.main && bottom?.main) {
    if (style.contrastCount) {
      const liked = style.contrastTotal / style.contrastCount;
      score += 3 * Math.max(0, 1 - Math.abs(Math.abs(top.main.lightness - bottom.main.lightness) - liked) / 40);
    }
    if (!standsOut(top.main, bottom.main)) score += (style.tonal / style.count) * 6;
  }

  if (parts.some((p) => p.accent)) score += (view.boldShare - 0.35) * 20;
  if (parts.some((p) => p.patterned)) score += (view.patternShare - 0.35) * 20;

  const levels = parts.flatMap((p) => (p.level === null ? [] : [p.level]));
  if (style.formalityCount && levels.length) {
    const average = levels.reduce((sum, l) => sum + l, 0) / levels.length;
    score += 3 * Math.max(0, 1 - Math.abs(average - style.formalityTotal / style.formalityCount));
  }

  return { score: score * view.weight, why };
}

// How much a repeat of a recent combination costs, and the note that explains it. Older repeats
// cost less, so when one can't be avoided the oldest wins.
function repeatCost(slots: Slots, day: string, ledger: Ledger): { cost: number; note: string | null } {
  const pair = pairKey(slots);
  const full = fullKey(slots);
  let pairAge: number | null = null;
  let pairDay = "";
  let fullAge: number | null = null;
  let fullDay = "";
  for (const past of ledger.history) {
    const age = daysBetween(past.day, day);
    if (age <= 0) continue;
    if (pair && past.pair === pair && age <= PAIR_WINDOW && (pairAge === null || age < pairAge)) {
      pairAge = age;
      pairDay = past.day;
    }
    if (full && past.full === full && age <= OUTFIT_WINDOW && (fullAge === null || age < fullAge)) {
      fullAge = age;
      fullDay = past.day;
    }
  }

  let cost = 0;
  let note: string | null = null;
  if (pairAge !== null) {
    cost += REPEAT + REPEAT * (1 - pairAge / PAIR_WINDOW);
    const bottom = slots.trousers ? "trousers" : "suit";
    note = `Same top and ${bottom} as on ${dateLabel(pairDay)}: there weren't enough clean pieces for a new pair.`;
  }
  if (fullAge !== null) {
    cost += REPEAT + REPEAT * (1 - fullAge / OUTFIT_WINDOW);
    note = `Same outfit as on ${dateLabel(fullDay)}: there weren't enough clean pieces for a new one.`;
  }
  return { cost, note };
}

function freeFor(ctx: Context, slot: Slot, day: string, dayType: DayType): Info[] {
  return ctx.infos.filter(
    (info) =>
      info.piece.type === SLOT_TYPE[slot] &&
      goodFor(info, dayType) &&
      ctx.ledger.remaining(info.piece) > 0 &&
      !ctx.ledger.besideDay(info.piece.id, day),
  );
}

function emptyReason(ctx: Context, slot: Slot, day: string, dayType: DayType): string {
  const marked = ctx.infos.filter((info) => info.piece.type === SLOT_TYPE[slot] && goodFor(info, dayType));
  if (marked.length === 0) return `None of your ${NOUN[slot]} are marked Good for ${dayType}.`;
  const free = marked.filter((info) => ctx.ledger.remaining(info.piece) > 0 && !ctx.ledger.besideDay(info.piece.id, day));
  if (free.length === 0) {
    return marked.every((info) => info.piece.wears_before_wash === null)
      ? `Your ${dayType} ${NOUN[slot]} were all worn the day before.`
      : `No clean ${NOUN[slot]} left for ${dayType} days.`;
  }
  return `None of your clean ${NOUN[slot]} go with the rest of this outfit.`;
}

// Picks the best extra for `slot` that keeps every rule, or none.
function bestAddition(ctx: Context, outfit: Outfit, slot: Slot, day: string, dayType: DayType, weight: number) {
  let best: { info: Info; score: number } | null = null;
  for (const info of freeFor(ctx, slot, day, dayType)) {
    if (outfitProblem({ ...outfit, [slot]: info }, slot, tonalAllowed(ctx.style, dayType))) continue;
    const score =
      ctx.ledger.freshness(info.piece.id, day) * weight - weight * ctx.ledger.timesPlanned(info.piece.id) + ctx.random();
    if (!best || score > best.score) best = { info, score };
  }
  return best;
}

type DayResult = { slots: Slots; notes: Note[]; score: number };

function finish(ctx: Context, base: Outfit, baseScore: number, day: string, dayType: DayType): DayResult {
  const outfit: Outfit = { ...base };
  let score = baseScore;
  const notes: Note[] = [];

  const shoes = bestAddition(ctx, outfit, "shoes", day, dayType, 3);
  if (shoes) {
    outfit.shoes = shoes.info;
    score += shoes.score;
  } else {
    score -= MISSING_SHOES;
    notes.push({ slot: "shoes", text: emptyReason(ctx, "shoes", day, dayType) });
  }

  // Native outfits don't take a belt.
  if (outfit.trousers || outfit.suit) {
    const belt = bestAddition(ctx, outfit, "belt", day, dayType, 2);
    if (belt) {
      outfit.belt = belt.info;
      score += belt.score;
    } else score -= MISSING_EXTRA;
  }

  const watch = bestAddition(ctx, outfit, "watch", day, dayType, 2);
  if (watch) {
    outfit.watch = watch.info;
    score += watch.score;
  } else score -= MISSING_EXTRA;

  const slots = idsOf(outfit);
  const repeat = repeatCost(slots, day, ctx.ledger);
  if (repeat.note) notes.unshift({ text: repeat.note });
  const { why } = styleScore(ctx, outfit, dayType);
  if (why) notes.push({ kind: "why", text: why });
  return { slots, notes, score: score - repeat.cost };
}

function baseScore(ctx: Context, outfit: Outfit, day: string, dayType: DayType, avoid: Slots[]): number {
  const parts = piecesOf(outfit);
  let score = 0;

  const top = outfit.top?.main;
  const bottom = (outfit.trousers ?? outfit.suit)?.main;
  if (top && bottom) score += (Math.min(Math.abs(top.lightness - bottom.lightness), 40) / 40) * 8;

  const levels = new Set(parts.map((p) => p.level));
  if (levels.size === 1) score += 3;

  const freshness = parts.reduce((sum, p) => sum + ctx.ledger.freshness(p.piece.id, day), 0) / parts.length;
  score += freshness * 12;

  if (avoid.length > 0) {
    const slots = idsOf(outfit);
    if (avoid.some((old) => sameBase(slots, old))) score -= AVOID;
  }

  score += styleScore(ctx, outfit, dayType).score;
  return score + ctx.random() * NOISE;
}

function planDay(ctx: Context, day: string, dayType: DayType, avoid: Slots[]): DayResult {
  if (dayType === "none") return { slots: {}, notes: [], score: 0 };

  const tops = freeFor(ctx, "top", day, dayType);
  const bottoms = [...freeFor(ctx, "trousers", day, dayType), ...freeFor(ctx, "suit", day, dayType)];
  const natives = freeFor(ctx, "native_set", day, dayType);

  const allowTonal = tonalAllowed(ctx.style, dayType);
  const bases: { outfit: Outfit; score: number }[] = [];
  for (const top of tops) {
    for (const bottom of bottoms) {
      const outfit: Outfit = { top, [bottom.piece.type === "suit" ? "suit" : "trousers"]: bottom };
      if (!outfitProblem(outfit, undefined, allowTonal)) bases.push({ outfit, score: baseScore(ctx, outfit, day, dayType, avoid) });
    }
  }
  for (const native of natives) {
    const outfit: Outfit = { native_set: native };
    bases.push({ outfit, score: baseScore(ctx, outfit, day, dayType, avoid) });
  }

  if (bases.length > 0) {
    bases.sort((a, b) => b.score - a.score);
    let best: DayResult | null = null;
    for (const base of bases.slice(0, MAX_BASES)) {
      const result = finish(ctx, base.outfit, base.score, day, dayType);
      if (!best || result.score > best.score) best = result;
    }
    return best!;
  }

  // Nothing makes a full outfit, so dress what can be dressed and say what's missing.
  if (dayType === "native" && tops.length === 0) {
    const result = finish(ctx, {}, -MISSING_MAIN, day, dayType);
    return { ...result, notes: [{ slot: "native_set", text: emptyReason(ctx, "native_set", day, dayType) }, ...result.notes] };
  }
  const freshest = (list: Info[]) =>
    [...list].sort((a, b) => ctx.ledger.freshness(b.piece.id, day) - ctx.ledger.freshness(a.piece.id, day))[0];
  const partial: Outfit = {};
  const notes: Note[] = [];
  let score = 0;
  if (tops.length) partial.top = freshest(tops);
  else {
    notes.push({ slot: "top", text: emptyReason(ctx, "top", day, dayType) });
    score -= MISSING_MAIN;
  }
  if (!partial.top && bottoms.length) {
    const bottom = freshest(bottoms);
    partial[bottom.piece.type === "suit" ? "suit" : "trousers"] = bottom;
  } else {
    notes.push({ slot: "trousers", text: emptyReason(ctx, "trousers", day, dayType) });
    score -= MISSING_MAIN;
  }
  const result = finish(ctx, partial, score, day, dayType);
  return { ...result, notes: [...notes, ...result.notes] };
}

// Two outfits are the same look when their main pieces match; shoes and extras don't count.
export function sameBase(a: Slots, b: Slots): boolean {
  return (["top", "trousers", "suit", "native_set"] as const).every((slot) => a[slot] === b[slot]);
}

function shuffle<T>(list: T[], random: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Plans each of `days`. Several runs try the days in different orders, and the best week wins.
export function planDays({
  days,
  pieces,
  outfits,
  random = Math.random,
  avoid = {},
  style,
}: {
  days: { day: string; dayType: DayType }[];
  pieces: PlannerPiece[];
  outfits: KnownOutfit[];
  random?: () => number;
  // Outfits to steer away from on a day: the one being replaced, or every one already seen.
  avoid?: Record<string, Slots | Slots[]>;
  style?: StyleInput;
}): DayPlan[] {
  const planning = new Set(days.map((d) => d.day));
  const known = outfits.filter((outfit) => !planning.has(outfit.day));
  const infos = pieces.filter(isLabelled).map(toInfo);

  let best: { total: number; results: Map<string, DayResult> } | null = null;
  for (let run = 0; run < RUNS; run++) {
    const ctx: Context = { infos, ledger: new Ledger(known), random, style };
    const order = run === 0 ? [...days] : shuffle([...days], random);
    const results = new Map<string, DayResult>();
    let total = 0;
    for (const { day, dayType } of order) {
      const result = planDay(ctx, day, dayType, [avoid[day] ?? []].flat());
      ctx.ledger.assign(day, result.slots);
      results.set(day, result);
      total += result.score;
    }
    if (!best || total > best.total) best = { total, results };
  }

  return days.map(({ day, dayType }) => {
    const { slots, notes } = best!.results.get(day)!;
    return { day, dayType, slots, notes };
  });
}

// Every piece that could go in `slot` on `day`, best first. Pieces that break a rule are still
// offered, with the reason, because your choice beats the rules. Pieces in the wash or with no
// wears left aren't offered at all.
export function swapChoices({
  day,
  dayType,
  slots,
  slot,
  pieces,
  outfits,
  style,
}: {
  day: string;
  dayType: DayType;
  slots: Slots;
  slot: Slot;
  pieces: PlannerPiece[];
  outfits: KnownOutfit[];
  style?: StyleInput;
}): { id: string; clash: string | null }[] {
  const ledger = new Ledger(outfits.filter((outfit) => outfit.day !== day));
  const infos = pieces.map(toInfo);
  const byId = new Map(infos.map((info) => [info.piece.id, info]));

  const rest: Outfit = {};
  for (const other of SLOTS) {
    const id = slots[other];
    if (other !== slot && id && byId.has(id)) rest[other] = byId.get(id);
  }

  const clashFor = (info: Info): string | null => {
    if (!goodFor(info, dayType)) return `Not marked Good for ${dayType}`;
    if (ledger.usedOn(info.piece.id, addDays(day, -1))) return "Worn the day before";
    if (ledger.usedOn(info.piece.id, addDays(day, 1))) return "Planned for the next day";
    return outfitProblem({ ...rest, [slot]: info }, slot, tonalAllowed(style, dayType));
  };

  return infos
    .filter((info) => info.piece.type === SLOT_TYPE[slot] && ledger.remaining(info.piece) > 0)
    .map((info) => ({ id: info.piece.id, clash: clashFor(info), fresh: ledger.freshness(info.piece.id, day) }))
    .sort((a, b) => Number(a.clash !== null) - Number(b.clash !== null) || b.fresh - a.fresh)
    .map(({ id, clash }) => ({ id, clash }));
}
