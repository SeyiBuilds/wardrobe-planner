import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { expandFiles } from "./expandFiles";
import { drainQueue } from "./labelQueue";
import { PhotoError, preparePhoto } from "./photo";
import {
  addPiece,
  afterMatch,
  listPieces,
  matchPieces,
  photoLinks,
  removePiece,
  requestLabel,
  savePiece,
  WardrobeError,
  type Piece,
  type PieceChanges,
} from "./pieces";

export type QueueState =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "paused"; reason: "allowance" | "unavailable" | "error"; message?: string };

type Wardrobe = {
  pieces: Piece[] | null;
  loadError: string | null;
  links: Record<string, string>;
  unpacking: boolean;
  adding: { done: number; total: number } | null;
  addErrors: string[];
  queue: QueueState;
  addPhotos: (files: File[]) => Promise<void>;
  save: (id: string, changes: PieceChanges) => Promise<Piece>;
  remove: (piece: Piece) => Promise<void>;
  // Matches a top with its own trousers, or unmatches it with null.
  setMatch: (id: string, partner: string | null) => Promise<void>;
  readAgain: (id: string) => Promise<void>;
  resumeReading: () => void;
  reload: () => void;
  clearAddErrors: () => void;
};

const WardrobeContext = createContext<Wardrobe | null>(null);

// Links last a day; refresh them when the app comes back after half that.
const LINK_REFRESH_MS = 12 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function message(error: unknown, fallback: string): string {
  return error instanceof WardrobeError || error instanceof PhotoError ? error.message : fallback;
}

// Holds the wardrobe for the whole signed-in app, so reading carries on while you switch tabs.
export function WardrobeProvider({ client, children }: { client: SupabaseClient; children: ReactNode }) {
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [unpacking, setUnpacking] = useState(false);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [addErrors, setAddErrors] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueState>({ state: "idle" });

  const piecesRef = useRef<Piece[]>([]);
  const draining = useRef(false);
  const mounted = useRef(true);
  const linksFetchedAt = useRef(0);

  const updatePieces = useCallback((next: (current: Piece[]) => Piece[]) => {
    piecesRef.current = next(piecesRef.current);
    setPieces(piecesRef.current);
  }, []);

  const upsert = useCallback(
    (piece: Piece) =>
      updatePieces((current) =>
        current.some((p) => p.id === piece.id) ? current.map((p) => (p.id === piece.id ? piece : p)) : [piece, ...current],
      ),
    [updatePieces],
  );

  const fetchLinks = useCallback(
    async (paths: string[]) => {
      const fresh = await photoLinks(client, paths);
      if (mounted.current) setLinks((current) => ({ ...current, ...fresh }));
    },
    [client],
  );

  const drain = useCallback(async () => {
    if (draining.current) return;
    if (!piecesRef.current.some((p) => p.label_status === "waiting" && !p.reviewed)) {
      setQueue({ state: "idle" });
      return;
    }
    draining.current = true;
    setQueue({ state: "reading" });
    try {
      const stop = await drainQueue({
        nextWaiting: () => piecesRef.current.find((p) => p.label_status === "waiting" && !p.reviewed),
        label: (id) => requestLabel(client, id),
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
      const loaded = await listPieces(client);
      if (!mounted.current) return;
      updatePieces(() => loaded);
      linksFetchedAt.current = Date.now();
      await fetchLinks(loaded.map((p) => p.photo_path));
      void drain();
    } catch (error) {
      if (mounted.current) setLoadError(message(error, "Your wardrobe couldn't be loaded. Check your connection and try again."));
    }
  }, [client, drain, fetchLinks, updatePieces]);

  useEffect(() => {
    mounted.current = true;
    void load();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - linksFetchedAt.current > LINK_REFRESH_MS) {
        linksFetchedAt.current = Date.now();
        void fetchLinks(piecesRef.current.map((p) => p.photo_path));
      }
      void drain();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, fetchLinks, drain]);

  const addPhotos = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAddErrors([]);

      // Zips and folders become a flat list of photos first.
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
          const prepared = await preparePhoto(file);
          const piece = await addPiece(client, prepared);
          upsert(piece);
          void fetchLinks([piece.photo_path]);
        } catch (error) {
          errors.push(`${file.name}: ${message(error, "Something went wrong. Try again.")}`);
        }
      }
      setAdding(null);
      setAddErrors(errors);
      void drain();
    },
    [client, drain, fetchLinks, upsert],
  );

  const save = useCallback(
    async (id: string, changes: PieceChanges) => {
      const piece = await savePiece(client, id, changes);
      upsert(piece);
      return piece;
    },
    [client, upsert],
  );

  const remove = useCallback(
    async (piece: Piece) => {
      await removePiece(client, piece);
      updatePieces((current) => current.filter((p) => p.id !== piece.id));
    },
    [client, updatePieces],
  );

  const setMatch = useCallback(
    async (id: string, partner: string | null) => {
      await matchPieces(client, id, partner);
      updatePieces((current) => afterMatch(current, id, partner));
    },
    [client, updatePieces],
  );

  const readAgain = useCallback(
    async (id: string) => {
      await save(id, { label_status: "waiting" });
      void drain();
    },
    [drain, save],
  );

  const value = useMemo<Wardrobe>(
    () => ({
      pieces,
      loadError,
      links,
      unpacking,
      adding,
      addErrors,
      queue,
      addPhotos,
      save,
      remove,
      setMatch,
      readAgain,
      resumeReading: () => void drain(),
      reload: () => void load(),
      clearAddErrors: () => setAddErrors([]),
    }),
    [pieces, loadError, links, unpacking, adding, addErrors, queue, addPhotos, save, remove, setMatch, readAgain, drain, load],
  );

  return <WardrobeContext.Provider value={value}>{children}</WardrobeContext.Provider>;
}

export function useWardrobe(): Wardrobe {
  const wardrobe = useContext(WardrobeContext);
  if (!wardrobe) throw new Error("useWardrobe must be used inside WardrobeProvider");
  return wardrobe;
}
