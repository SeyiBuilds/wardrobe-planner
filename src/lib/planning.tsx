import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listPieces, WardrobeError, type Piece } from "./pieces";
import { planDays, swapChoices, type DayType, type Slot, type Slots } from "./planner";
import {
  afterSwap,
  currentUserId,
  dayTypeFor,
  DEFAULT_WEEK,
  finishCheck as saveCheck,
  knownOutfits,
  listOutfits,
  loadUsualWeek,
  rowFromPlan,
  saveOutfits,
  saveUsualWeek as storeUsualWeek,
  slotsOf,
  updateOutfit,
  weekStatus,
  type Outfit,
  type WeekStatus,
} from "./plans";
import { useWardrobe } from "./wardrobe";
import { addDays, dayKey, weekOf } from "./week";

// Five weeks of history is enough for the planner to avoid recent repeats.
const HISTORY_DAYS = 35;

type Planning = {
  outfits: Outfit[] | null;
  usualWeek: DayType[];
  status: WeekStatus | null;
  loadError: string | null;
  working: boolean;
  error: string | null;
  clearError: () => void;
  reload: () => void;
  // Each action resolves to true when it worked; otherwise `error` says why.
  planMissing: () => Promise<boolean>;
  replanDay: (day: string) => Promise<boolean>;
  setDayType: (day: string, dayType: DayType) => Promise<boolean>;
  swap: (day: string, slot: Slot, pieceId: string | null) => Promise<boolean>;
  choicesFor: (day: string, slot: Slot) => { piece: Piece; clash: string | null }[];
  saveUsualWeek: (week: DayType[]) => Promise<boolean>;
  finishCheck: (worn: Record<string, string[]>, washed: string[]) => Promise<boolean>;
  markClean: (ids: string[]) => Promise<boolean>;
  sendToWash: (id: string) => Promise<boolean>;
};

const PlanningContext = createContext<Planning | null>(null);

function message(error: unknown, fallback: string): string {
  return error instanceof WardrobeError ? error.message : fallback;
}

// Holds the week's outfits and the usual week for the signed-in app, and does the planning.
export function PlanningProvider({
  client,
  now = () => new Date(),
  random = Math.random,
  children,
}: {
  client: SupabaseClient;
  now?: () => Date;
  random?: () => number;
  children: ReactNode;
}) {
  const wardrobe = useWardrobe();
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [usualWeek, setUsualWeek] = useState<DayType[]>(DEFAULT_WEEK);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Actions read the latest values through refs, so a slow save never works from stale ones.
  const outfitsRef = useRef<Outfit[]>([]);
  const weekRef = useRef(usualWeek);
  const piecesRef = useRef(wardrobe.pieces);
  const nowRef = useRef(now);
  const randomRef = useRef(random);
  weekRef.current = usualWeek;
  piecesRef.current = wardrobe.pieces;
  nowRef.current = now;
  randomRef.current = random;

  const replaceAll = useCallback((next: Outfit[]) => {
    outfitsRef.current = next;
    setOutfits(next);
  }, []);

  const merge = useCallback(
    (saved: Outfit[]) => {
      const byDay = new Map(outfitsRef.current.map((o) => [o.day, o]));
      for (const outfit of saved) byDay.set(outfit.day, outfit);
      replaceAll([...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)));
    },
    [replaceAll],
  );

  const historyStart = useCallback(() => addDays(dayKey(weekOf(nowRef.current())[0]), -HISTORY_DAYS), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [week, list] = await Promise.all([loadUsualWeek(client), listOutfits(client, historyStart())]);
      weekRef.current = week;
      setUsualWeek(week);
      replaceAll(list);
    } catch (err) {
      setLoadError(message(err, "Your week couldn't be loaded. Check your connection and try again."));
    }
  }, [client, historyStart, replaceAll]);

  useEffect(() => {
    void load();
  }, [load]);

  // Time moves on while the app is open, so look again every minute and whenever it comes back.
  useEffect(() => {
    const tick = () => setTick((value) => value + 1);
    const timer = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(message(err, "Something went wrong. Try again."));
      return false;
    } finally {
      setWorking(false);
    }
  }, []);

  const requirePieces = useCallback((): Piece[] => {
    if (!piecesRef.current) throw new WardrobeError("Your wardrobe is still loading. Try again in a moment.");
    return piecesRef.current;
  }, []);

  const planAndSave = useCallback(
    async (days: { day: string; dayType: DayType }[], pieces: Piece[], saved: Outfit[], avoid: Record<string, Slots> = {}) => {
      if (days.length === 0) return;
      const plans = planDays({ days, pieces, outfits: knownOutfits(saved), random: randomRef.current, avoid });
      const userId = await currentUserId(client);
      merge(await saveOutfits(client, plans.map((plan) => rowFromPlan(plan, userId))));
    },
    [client, merge],
  );

  const planMissing = useCallback(
    () =>
      run(async () => {
        const status = weekStatus(nowRef.current(), outfitsRef.current, weekRef.current);
        await planAndSave(status.toPlan, requirePieces(), outfitsRef.current);
      }),
    [planAndSave, requirePieces, run],
  );

  const replan = useCallback(
    async (day: string, dayType: DayType, avoid?: Slots) => {
      const others = outfitsRef.current.filter((o) => o.day !== day);
      await planAndSave([{ day, dayType }], requirePieces(), others, avoid ? { [day]: avoid } : {});
    },
    [planAndSave, requirePieces],
  );

  const replanDay = useCallback(
    (day: string) =>
      run(async () => {
        const outfit = outfitsRef.current.find((o) => o.day === day);
        await replan(day, outfit?.day_type ?? dayTypeFor(day, weekRef.current), outfit ? slotsOf(outfit) : undefined);
      }),
    [replan, run],
  );

  const setDayType = useCallback(
    (day: string, dayType: DayType) => run(() => replan(day, dayType)),
    [replan, run],
  );

  const swap = useCallback(
    (day: string, slot: Slot, pieceId: string | null) =>
      run(async () => {
        const outfit = outfitsRef.current.find((o) => o.day === day);
        if (!outfit) throw new WardrobeError("That day hasn't been planned yet.");
        merge([await updateOutfit(client, outfit.id, afterSwap(outfit, slot, pieceId))]);
      }),
    [client, merge, run],
  );

  const choicesFor = useCallback(
    (day: string, slot: Slot) => {
      const outfit = outfitsRef.current.find((o) => o.day === day);
      const pieces = piecesRef.current;
      if (!outfit || !pieces) return [];
      const byId = new Map(pieces.map((p) => [p.id, p]));
      return swapChoices({
        day,
        dayType: outfit.day_type,
        slots: slotsOf(outfit),
        slot,
        pieces,
        outfits: knownOutfits(outfitsRef.current, day),
      }).map((choice) => ({ piece: byId.get(choice.id)!, clash: choice.clash }));
    },
    // Recomputed when outfits or pieces change.
    [outfits, wardrobe.pieces],
  );

  const saveUsualWeek = useCallback(
    (week: DayType[]) =>
      run(async () => {
        const saved = await storeUsualWeek(client, week);
        weekRef.current = saved;
        setUsualWeek(saved);
      }),
    [client, run],
  );

  const finishCheck = useCallback(
    (worn: Record<string, string[]>, washed: string[]) =>
      run(async () => {
        await saveCheck(client, worn, washed);
        // Plan from fresh pieces and outfits, since the check just changed both.
        const [pieces, list] = await Promise.all([listPieces(client), listOutfits(client, historyStart())]);
        replaceAll(list);
        wardrobe.reload();
        const status = weekStatus(nowRef.current(), list, weekRef.current);
        await planAndSave(status.toPlan, pieces, list);
      }),
    [client, historyStart, planAndSave, replaceAll, run, wardrobe],
  );

  const markClean = useCallback(
    (ids: string[]) =>
      run(async () => {
        await saveCheck(client, {}, ids);
        wardrobe.reload();
      }),
    [client, run, wardrobe],
  );

  const sendToWash = useCallback(
    (id: string) =>
      run(async () => {
        await wardrobe.save(id, { in_wash: true });
      }),
    [run, wardrobe],
  );

  const status = outfits ? weekStatus(now(), outfits, usualWeek) : null;

  const value = useMemo<Planning>(
    () => ({
      outfits,
      usualWeek,
      status,
      loadError,
      working,
      error,
      clearError: () => setError(null),
      reload: () => void load(),
      planMissing,
      replanDay,
      setDayType,
      swap,
      choicesFor,
      saveUsualWeek,
      finishCheck,
      markClean,
      sendToWash,
    }),
    // `status` follows outfits, the usual week and the clock tick.
    [outfits, usualWeek, status?.window.today, status?.window.sundayEvening, loadError, working, error, load, planMissing, replanDay, setDayType, swap, choicesFor, saveUsualWeek, finishCheck, markClean, sendToWash],
  );

  return <PlanningContext.Provider value={value}>{children}</PlanningContext.Provider>;
}

export function usePlanning(): Planning {
  const planning = useContext(PlanningContext);
  if (!planning) throw new Error("usePlanning must be used inside PlanningProvider");
  return planning;
}
