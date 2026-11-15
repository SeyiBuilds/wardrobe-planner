import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listPieces, WardrobeError, type Piece } from "./pieces";
import { planDays, sameBase, SLOTS, swapChoices, type DayType, type Note, type Slot, type Slots } from "./planner";
import {
  afterSwap,
  currentUserId,
  dayTypeFor,
  DEFAULT_WEEK,
  finishCheck as saveCheck,
  knownOutfits,
  listOutfits,
  loadUsualWeek,
  outfitChanges,
  rowFromPlan,
  saveOutfits,
  saveUsualWeek as storeUsualWeek,
  slotsOf,
  updateOutfit,
  weekStatus,
  type Outfit,
  type WeekStatus,
} from "./plans";
import { useStyleInput } from "./style";
import { useWardrobe } from "./wardrobe";
import { addDays, dayKey, weekOf } from "./week";

// Five weeks of history is enough for the planner to avoid recent repeats.
const HISTORY_DAYS = 35;

// The outfits you've flicked through for one day, and which one is showing.
type Seen = { slots: Slots; notes: Note[] };
type Trail = { list: Seen[]; at: number };

const sameSlots = (a: Slots, b: Slots) => SLOTS.every((slot) => a[slot] === b[slot]);

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
  // Flicking through other outfits for a day: forward makes a new one once you've seen them all.
  anotherOutfit: (day: string) => Promise<boolean>;
  previousOutfit: (day: string) => Promise<boolean>;
  canGoBack: (day: string) => boolean;
  // Marking a day worn waits a few seconds, so a misread thumbs up can be undone.
  pendingWorn: string | null;
  markWorn: (day: string) => void;
  undoWorn: () => void;
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
  undoTime = 5000,
  children,
}: {
  client: SupabaseClient;
  now?: () => Date;
  random?: () => number;
  undoTime?: number;
  children: ReactNode;
}) {
  const wardrobe = useWardrobe();
  const [outfits, setOutfits] = useState<Outfit[] | null>(null);
  const [usualWeek, setUsualWeek] = useState<DayType[]>(DEFAULT_WEEK);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [trailTick, setTrailTick] = useState(0);
  const [pendingWorn, setPendingWorn] = useState<string | null>(null);
  const trails = useRef(new Map<string, Trail>());
  const pendingRef = useRef<string | null>(null);
  const wornTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitWornRef = useRef<() => Promise<void>>(async () => {});

  // Actions read the latest values through refs, so a slow save never works from stale ones.
  const outfitsRef = useRef<Outfit[]>([]);
  const weekRef = useRef(usualWeek);
  const piecesRef = useRef(wardrobe.pieces);
  const nowRef = useRef(now);
  const randomRef = useRef(random);
  // Your style, if you have one, steers every plan and swap list.
  const style = useStyleInput();
  const styleRef = useRef(style);
  weekRef.current = usualWeek;
  piecesRef.current = wardrobe.pieces;
  nowRef.current = now;
  randomRef.current = random;
  styleRef.current = style;

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
      // Leaving the app saves a day marked worn straight away rather than risk losing it.
      else void commitWornRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void commitWornRef.current();
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
      const plans = planDays({
        days,
        pieces,
        outfits: knownOutfits(saved),
        random: randomRef.current,
        avoid,
        style: styleRef.current,
      });
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

  // A day you can still change, or a reason why not.
  const editableOutfit = useCallback((day: string): Outfit => {
    const outfit = outfitsRef.current.find((o) => o.day === day);
    if (!outfit) throw new WardrobeError("That day hasn't been planned yet.");
    if (outfit.checked_at) throw new WardrobeError("This day is done, so it can't be changed.");
    return outfit;
  }, []);

  // The trail for a day, as long as it's still showing what the day has. Changing a piece
  // yourself starts a new trail from what you chose.
  const trailFor = useCallback((outfit: Outfit): Trail => {
    const slots = slotsOf(outfit);
    const trail = trails.current.get(outfit.day);
    if (trail && sameSlots(trail.list[trail.at].slots, slots)) return trail;
    return { list: [{ slots, notes: outfit.notes }], at: 0 };
  }, []);

  // Flicking through outfits shows each one straight away. Saves follow one at a time, in the
  // order they were made, so a slow connection never leaves you waiting or saves them out of order.
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const showFromTrail = useCallback(
    async (outfit: Outfit, trail: Trail, at: number) => {
      const next = trail.list[at];
      const changes = outfitChanges(next.slots, next.notes);
      merge([{ ...outfit, ...changes } as Outfit]);
      trail.at = at;
      trails.current.set(outfit.day, trail);
      setTrailTick((value) => value + 1);

      const save = saving.current.then(() => updateOutfit(client, outfit.id, changes));
      saving.current = save.catch(() => {});
      try {
        const saved = await save;
        // A later change may be showing by now; only take the saved row if this one still is.
        if (trails.current.get(outfit.day) === trail && trail.at === at) merge([saved]);
      } catch (error) {
        // Show what's really saved again, and start the trail afresh from it.
        trails.current.delete(outfit.day);
        setTrailTick((value) => value + 1);
        try {
          replaceAll(await listOutfits(client, historyStart()));
        } catch {
          // Offline: keep what's showing; the error below says what went wrong.
        }
        throw error;
      }
    },
    [client, historyStart, merge, replaceAll],
  );

  const anotherOutfit = useCallback(
    (day: string) =>
      run(async () => {
        const outfit = editableOutfit(day);
        const trail = trailFor(outfit);
        if (trail.at === trail.list.length - 1) {
          const [plan] = planDays({
            days: [{ day, dayType: outfit.day_type }],
            pieces: requirePieces(),
            outfits: knownOutfits(outfitsRef.current, day),
            random: randomRef.current,
            avoid: { [day]: trail.list.map((seen) => seen.slots) },
            style: styleRef.current,
          });
          if (trail.list.some((seen) => sameBase(seen.slots, plan.slots))) {
            throw new WardrobeError(
              "There's no other outfit that works for this day right now. More clean clothes give the planner more to choose from.",
            );
          }
          trail.list.push({ slots: plan.slots, notes: plan.notes });
        }
        await showFromTrail(outfit, trail, trail.at + 1);
      }),
    [editableOutfit, requirePieces, run, showFromTrail, trailFor],
  );

  const previousOutfit = useCallback(
    (day: string) =>
      run(async () => {
        const outfit = editableOutfit(day);
        const trail = trailFor(outfit);
        if (trail.at === 0) throw new WardrobeError("There's no earlier outfit to go back to.");
        await showFromTrail(outfit, trail, trail.at - 1);
      }),
    [editableOutfit, run, showFromTrail, trailFor],
  );

  const canGoBack = useCallback(
    (day: string) => {
      const outfit = outfitsRef.current.find((o) => o.day === day);
      if (!outfit || outfit.checked_at) return false;
      return trailFor(outfit).at > 0;
    },
    // Recomputed when outfits or the trails change.
    [outfits, trailTick, trailFor],
  );

  // Saves a day marked worn: every piece in it counts as worn, like the weekly check.
  const commitWorn = useCallback(async () => {
    const day = pendingRef.current;
    clearTimeout(wornTimer.current);
    if (!day) return;
    pendingRef.current = null;
    setPendingWorn(null);
    await run(async () => {
      const outfit = outfitsRef.current.find((o) => o.day === day);
      if (!outfit || outfit.checked_at) return;
      await saveCheck(client, { [outfit.id]: Object.values(slotsOf(outfit)) }, []);
      replaceAll(await listOutfits(client, historyStart()));
      wardrobe.reload();
    });
  }, [client, historyStart, replaceAll, run, wardrobe]);
  commitWornRef.current = commitWorn;

  const markWorn = useCallback(
    (day: string) => {
      if (pendingRef.current && pendingRef.current !== day) void commitWornRef.current();
      clearTimeout(wornTimer.current);
      pendingRef.current = day;
      setPendingWorn(day);
      wornTimer.current = setTimeout(() => void commitWornRef.current(), undoTime);
    },
    [undoTime],
  );

  const undoWorn = useCallback(() => {
    clearTimeout(wornTimer.current);
    pendingRef.current = null;
    setPendingWorn(null);
  }, []);

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
        style: styleRef.current,
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
      anotherOutfit,
      previousOutfit,
      canGoBack,
      pendingWorn,
      markWorn,
      undoWorn,
      setDayType,
      swap,
      choicesFor,
      saveUsualWeek,
      finishCheck,
      markClean,
      sendToWash,
    }),
    // `status` follows outfits, the usual week and the clock tick.
    [outfits, usualWeek, status?.window.today, status?.window.sundayEvening, loadError, working, error, load, planMissing, replanDay, anotherOutfit, previousOutfit, canGoBack, pendingWorn, markWorn, undoWorn, setDayType, swap, choicesFor, saveUsualWeek, finishCheck, markClean, sendToWash],
  );

  return <PlanningContext.Provider value={value}>{children}</PlanningContext.Provider>;
}

export function usePlanning(): Planning {
  const planning = useContext(PlanningContext);
  if (!planning) throw new Error("usePlanning must be used inside PlanningProvider");
  return planning;
}
