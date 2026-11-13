import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { expandFiles } from "./expandFiles";
import {
  addInspiration,
  listInspirations,
  loadOverrides,
  removeInspiration,
  requestRead,
  saveOverrides as storeOverrides,
  updateInspiration,
  type Inspiration,
} from "./inspirations";
import { drainQueue } from "./labelQueue";
import { PhotoError, preparePhoto } from "./photo";
import { WardrobeError } from "./pieces";
import type { Occasion } from "./pieceTypes";
import type { StyleInput } from "./planner";
import { buildProfile, type StyleOverrides, type StyleProfile } from "./styleProfile";
import type { QueueState } from "./wardrobe";

type Style = {
  inspirations: Inspiration[] | null;
  loadError: string | null;
  unpacking: boolean;
  adding: { done: number; total: number } | null;
  addErrors: string[];
  queue: QueueState;
  overrides: StyleOverrides;
  profile: StyleProfile;
  working: boolean;
  addPictures: (files: File[]) => Promise<void>;
  remove: (item: Inspiration) => Promise<void>;
  setDayType: (id: string, dayType: Occasion) => Promise<void>;
  readAgain: (id: string) => Promise<void>;
  resumeReading: () => void;
  // Pass undefined for a setting to go back to what the pictures show.
  saveOverrides: (changes: { [K in keyof StyleOverrides]?: StyleOverrides[K] | undefined }) => Promise<void>;
  clearAddErrors: () => void;
  reload: () => void;
};

type StyleContextValue = Style & { input: StyleInput };

const StyleContext = createContext<StyleContextValue | null>(null);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function message(error: unknown, fallback: string): string {
  return error instanceof WardrobeError || error instanceof PhotoError ? error.message : fallback;
}

// Holds your inspiration readings and style settings, and reads waiting pictures in the background.
export function StyleProvider({ client, children }: { client: SupabaseClient; children: ReactNode }) {
  const [inspirations, setInspirations] = useState<Inspiration[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unpacking, setUnpacking] = useState(false);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [addErrors, setAddErrors] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueState>({ state: "idle" });
  const [overrides, setOverrides] = useState<StyleOverrides>({});
  const [working, setWorking] = useState(false);

  const itemsRef = useRef<Inspiration[]>([]);
  const overridesRef = useRef<StyleOverrides>({});
  const draining = useRef(false);
  const mounted = useRef(true);

  const update = useCallback((next: (current: Inspiration[]) => Inspiration[]) => {
    itemsRef.current = next(itemsRef.current);
    setInspirations(itemsRef.current);
  }, []);

  const upsert = useCallback(
    (item: Inspiration) =>
      update((current) =>
        current.some((i) => i.id === item.id) ? current.map((i) => (i.id === item.id ? item : i)) : [item, ...current],
      ),
    [update],
  );

  const waiting = () => itemsRef.current.find((item) => item.status === "waiting");

  const drain = useCallback(async () => {
    if (draining.current) return;
    if (!waiting()) {
      setQueue({ state: "idle" });
      return;
    }
    draining.current = true;
    setQueue({ state: "reading" });
    try {
      const stop = await drainQueue<Inspiration>({
        nextWaiting: waiting,
        label: (id) => requestRead(client, id),
        onReading: () => {},
        onPiece: upsert,
        wait: sleep,
        isStopped: () => !mounted.current,
      });
      if (!mounted.current) return;
      if (stop.reason === "finished" || stop.reason === "stopped") setQueue({ state: "idle" });
      else if (stop.reason === "error") setQueue({ state: "paused", reason: "error", message: stop.message });
      else setQueue({ state: "paused", reason: stop.reason });
    } finally {
      draining.current = false;
    }
  }, [client, upsert]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [items, saved] = await Promise.all([listInspirations(client), loadOverrides(client)]);
      if (!mounted.current) return;
      update(() => items);
      overridesRef.current = saved;
      setOverrides(saved);
      void drain();
    } catch (error) {
      if (mounted.current) setLoadError(message(error, "Your inspiration couldn't be loaded. Check your connection and try again."));
    }
  }, [client, drain, update]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void drain();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, drain]);

  const addPictures = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAddErrors([]);
      setUnpacking(true);
      let photos: File[];
      const errors: string[] = [];
      try {
        const expanded = await expandFiles(files);
        photos = expanded.photos;
        errors.push(...expanded.skipped);
      } finally {
        setUnpacking(false);
      }

      for (const [index, file] of photos.entries()) {
        setAdding({ done: index, total: photos.length });
        try {
          // Faces are blurred on the phone before anything leaves it.
          upsert(await addInspiration(client, await preparePhoto(file)));
        } catch (error) {
          errors.push(`${file.name}: ${message(error, "Something went wrong. Try again.")}`);
        }
      }
      setAdding(null);
      setAddErrors(errors);
      void drain();
    },
    [client, drain, upsert],
  );

  // Simple changes share one busy flag; a failure shows up as an add error, where messages live.
  const act = useCallback(async (action: () => Promise<void>) => {
    setWorking(true);
    try {
      await action();
    } catch (error) {
      setAddErrors([message(error, "Something went wrong. Try again.")]);
    } finally {
      setWorking(false);
    }
  }, []);

  const remove = useCallback(
    (item: Inspiration) =>
      act(async () => {
        await removeInspiration(client, item);
        update((current) => current.filter((i) => i.id !== item.id));
      }),
    [act, client, update],
  );

  const setDayType = useCallback(
    (id: string, dayType: Occasion) => act(async () => upsert(await updateInspiration(client, id, { day_type: dayType }))),
    [act, client, upsert],
  );

  const readAgain = useCallback(
    (id: string) =>
      act(async () => {
        upsert(await updateInspiration(client, id, { status: "waiting" }));
        void drain();
      }),
    [act, client, drain, upsert],
  );

  const saveOverrides = useCallback(
    (changes: { [K in keyof StyleOverrides]?: StyleOverrides[K] | undefined }) =>
      act(async () => {
        const merged = { ...overridesRef.current, ...changes } as Record<string, string | undefined>;
        const cleaned = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as StyleOverrides;
        const saved = await storeOverrides(client, cleaned);
        overridesRef.current = saved;
        setOverrides(saved);
      }),
    [act, client],
  );

  const profile = useMemo(
    () => buildProfile((inspirations ?? []).filter((item) => item.status === "done")),
    [inspirations],
  );

  const value = useMemo<StyleContextValue>(
    () => ({
      inspirations,
      loadError,
      unpacking,
      adding,
      addErrors,
      queue,
      overrides,
      profile,
      working,
      addPictures,
      remove,
      setDayType,
      readAgain,
      resumeReading: () => void drain(),
      saveOverrides,
      clearAddErrors: () => setAddErrors([]),
      reload: () => void load(),
      input: { profile, overrides },
    }),
    [inspirations, loadError, unpacking, adding, addErrors, queue, overrides, profile, working, addPictures, remove, setDayType, readAgain, drain, saveOverrides, load],
  );

  return <StyleContext.Provider value={value}>{children}</StyleContext.Provider>;
}

export function useStyle(): Style {
  const style = useContext(StyleContext);
  if (!style) throw new Error("useStyle must be used inside StyleProvider");
  return style;
}

// What the planner needs from your style, or nothing when there's no style to use.
export function useStyleInput(): StyleInput | undefined {
  return useContext(StyleContext)?.input;
}
