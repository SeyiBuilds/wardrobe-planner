import type { SupabaseClient } from "@supabase/supabase-js";
import { WardrobeError, type Piece } from "./pieces";
import { SLOTS, type DayPlan, type DayType, type KnownOutfit, type Note, type Slot, type Slots } from "./planner";
import { dayKey, parseDay, planWindow, weekOf } from "./week";

// One saved day, as stored in the outfits table.
export type Outfit = {
  id: string;
  user_id: string;
  day: string;
  day_type: DayType;
  top_id: string | null;
  trousers_id: string | null;
  suit_id: string | null;
  native_set_id: string | null;
  shoes_id: string | null;
  watch_id: string | null;
  belt_id: string | null;
  notes: Note[];
  worn: string[] | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
};

type SlotColumn = `${Slot}_id`;
const column = (slot: Slot) => `${slot}_id` as SlotColumn;

// Monday first, matching the settings table's default.
export const DEFAULT_WEEK: DayType[] = ["corporate", "corporate", "corporate", "corporate", "corporate", "casual", "church"];

export function slotsOf(outfit: Outfit): Slots {
  const slots: Slots = {};
  for (const slot of SLOTS) {
    const id = outfit[column(slot)];
    if (id) slots[slot] = id;
  }
  return slots;
}

export function rowFromPlan(plan: DayPlan, userId: string) {
  return { user_id: userId, day: plan.day, day_type: plan.dayType, ...outfitChanges(plan.slots, plan.notes) };
}

// Every piece column and the notes, for putting a whole outfit on a day that's already saved.
export function outfitChanges(slots: Slots, notes: Note[]): Record<string, unknown> {
  const changes: Record<string, unknown> = { notes };
  for (const slot of SLOTS) changes[column(slot)] = slots[slot] ?? null;
  return changes;
}

// What the planner needs to know about saved days: checked days count only what was really worn.
export function knownOutfits(outfits: Outfit[], exceptDay?: string): KnownOutfit[] {
  return outfits
    .filter((outfit) => outfit.day !== exceptDay)
    .map((outfit) => {
      const slots = slotsOf(outfit);
      if (!outfit.checked_at) return { day: outfit.day, slots, checked: false };
      const worn = new Set(outfit.worn ?? []);
      const wornSlots: Slots = {};
      for (const slot of SLOTS) if (slots[slot] && worn.has(slots[slot]!)) wornSlots[slot] = slots[slot];
      return { day: outfit.day, slots: wornSlots, checked: true };
    });
}

// Choosing a piece yourself settles that slot, and any note about a repeat no longer applies.
export function afterSwap(outfit: Outfit, slot: Slot, id: string | null) {
  return { [column(slot)]: id, notes: outfit.notes.filter((note) => note.slot && note.slot !== slot) };
}

export function dayTypeFor(day: string, week: DayType[]): DayType {
  return week[(parseDay(day).getDay() + 6) % 7];
}

export type WeekStatus = ReturnType<typeof weekStatus>;

// What the week needs right now: days waiting for the weekly check, days still to plan,
// and which week to show.
export function weekStatus(now: Date, outfits: Outfit[], week: DayType[]) {
  const window = planWindow(now);
  const due = outfits.filter((o) => !o.checked_at && o.day <= window.checkUpTo).sort((a, b) => a.day.localeCompare(b.day));
  const saved = new Set(outfits.map((o) => o.day));
  const toPlan = window.days
    .filter((day) => day >= window.planFrom && !saved.has(day))
    .map((day) => ({ day, dayType: dayTypeFor(day, week) }));
  // From Sunday evening, next week takes over once it has been planned.
  const showingNextWeek = window.sundayEvening && window.days.some((day) => saved.has(day));
  const shownDays = showingNextWeek ? window.days : weekOf(now).map(dayKey);
  return { window, due, toPlan, shownDays, showingNextWeek };
}

// Pieces the weekly check's second step asks about: what's already waiting, plus anything this
// week's wears use up. Shoes, watches and belts never need washing.
export function laundryAfterCheck(pieces: Piece[], worn: Record<string, string[]>): Piece[] {
  const times = new Map<string, number>();
  for (const ids of Object.values(worn)) for (const id of ids) times.set(id, (times.get(id) ?? 0) + 1);
  return pieces.filter((piece) => {
    if (piece.in_wash) return true;
    const count = times.get(piece.id) ?? 0;
    return count > 0 && piece.wears_before_wash !== null && piece.wears_since_wash + count >= piece.wears_before_wash;
  });
}

// Talking to Supabase.

const CONNECTION = "Check your connection and try again.";

export async function currentUserId(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new WardrobeError("You've been signed out. Sign in again.");
  return id;
}

export async function listOutfits(client: SupabaseClient, from: string): Promise<Outfit[]> {
  const { data, error } = await client.from("outfits").select("*").gte("day", from).order("day");
  if (error) throw new WardrobeError(`Your week couldn't be loaded. ${CONNECTION}`);
  return data as Outfit[];
}

export async function saveOutfits(client: SupabaseClient, rows: Record<string, unknown>[]): Promise<Outfit[]> {
  if (rows.length === 0) return [];
  const { data, error } = await client.from("outfits").upsert(rows, { onConflict: "user_id,day" }).select("*");
  if (error || !data) throw new WardrobeError(`Your plan couldn't be saved. ${CONNECTION}`);
  return data as Outfit[];
}

export async function updateOutfit(client: SupabaseClient, id: string, changes: Record<string, unknown>): Promise<Outfit> {
  const { data, error } = await client.from("outfits").update(changes).eq("id", id).select("*").single();
  if (error || !data) throw new WardrobeError(`That change couldn't be saved. ${CONNECTION}`);
  return data as Outfit;
}

export async function loadUsualWeek(client: SupabaseClient): Promise<DayType[]> {
  const { data, error } = await client.from("settings").select("usual_week").maybeSingle();
  if (error) throw new WardrobeError(`Your usual week couldn't be loaded. ${CONNECTION}`);
  return (data?.usual_week as DayType[] | undefined) ?? DEFAULT_WEEK;
}

export async function saveUsualWeek(client: SupabaseClient, week: DayType[]): Promise<DayType[]> {
  const userId = await currentUserId(client);
  const { data, error } = await client
    .from("settings")
    .upsert({ user_id: userId, usual_week: week }, { onConflict: "user_id" })
    .select("usual_week")
    .single();
  if (error || !data) throw new WardrobeError(`Your usual week couldn't be saved. ${CONNECTION}`);
  return data.usual_week as DayType[];
}

// Saves the weekly check in one go: what was worn each day, and what's been washed.
export async function finishCheck(client: SupabaseClient, worn: Record<string, string[]>, washed: string[]): Promise<void> {
  const checked = Object.entries(worn).map(([id, pieces]) => ({ id, worn: pieces }));
  const { error } = await client.rpc("finish_check", { checked, washed });
  if (error) throw new WardrobeError(`The check couldn't be saved. ${CONNECTION}`);
}
