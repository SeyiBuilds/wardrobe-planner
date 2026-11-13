import type { Piece } from "./pieces";

export type LabelResponse<T = Piece> =
  | { status: "done"; piece: T }
  | { status: "failed"; reason: string; piece?: T }
  | { status: "waiting"; retryAfterSeconds: number | null; daily: boolean }
  | { status: "unavailable" }
  | { status: "error"; reason: string };

export type QueueStop =
  | { reason: "finished" }
  | { reason: "allowance" }
  | { reason: "unavailable" }
  | { reason: "error"; message: string }
  | { reason: "stopped" };

type DrainOptions<T> = {
  nextWaiting: () => T | undefined;
  label: (id: string) => Promise<LabelResponse<T>>;
  onReading: (item: T) => void;
  onPiece: (item: T) => void;
  wait: (ms: number) => Promise<void>;
  isStopped: () => boolean;
  // Free-tier limits are per minute as well as per day, so space the requests out.
  spacingMs?: number;
  // Waits longer than this mean the allowance is gone for now.
  maxShortWaitSeconds?: number;
  maxShortWaits?: number;
};

// Reads waiting photos one at a time until none are left or the AI can't take more.
export async function drainQueue<T extends { id: string }>({
  nextWaiting,
  label,
  onReading,
  onPiece,
  wait,
  isStopped,
  spacingMs = 4000,
  maxShortWaitSeconds = 90,
  maxShortWaits = 3,
}: DrainOptions<T>): Promise<QueueStop> {
  let shortWaits = 0;

  while (!isStopped()) {
    const piece = nextWaiting();
    if (!piece) return { reason: "finished" };

    onReading(piece);
    const result = await label(piece.id);
    if (isStopped()) return { reason: "stopped" };

    switch (result.status) {
      case "done":
        shortWaits = 0;
        onPiece(result.piece);
        break;
      case "failed":
        if (!result.piece) return { reason: "error", message: result.reason || "The AI reader had a problem." };
        shortWaits = 0;
        onPiece(result.piece);
        break;
      case "waiting": {
        const seconds = result.retryAfterSeconds;
        const brief = !result.daily && seconds !== null && seconds <= maxShortWaitSeconds;
        if (!brief || shortWaits >= maxShortWaits) return { reason: "allowance" };
        shortWaits++;
        await wait(seconds * 1000 + 500);
        continue;
      }
      case "unavailable":
        return { reason: "unavailable" };
      case "error":
        return { reason: "error", message: result.reason };
    }

    if (nextWaiting()) await wait(spacingMs);
  }

  return { reason: "stopped" };
}
