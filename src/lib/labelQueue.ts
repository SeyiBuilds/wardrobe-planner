import type { Piece } from "./pieces";

export type LabelResponse =
  | { status: "done"; piece: Piece }
  | { status: "failed"; reason: string; piece?: Piece }
  | { status: "waiting"; retryAfterSeconds: number | null; daily: boolean }
  | { status: "unavailable" }
  | { status: "error"; reason: string };

export type QueueStop =
  | { reason: "finished" }
  | { reason: "allowance" }
  | { reason: "unavailable" }
  | { reason: "error"; message: string }
  | { reason: "stopped" };

type DrainOptions = {
  nextWaiting: () => Piece | undefined;
  label: (pieceId: string) => Promise<LabelResponse>;
  onReading: (piece: Piece) => void;
  onPiece: (piece: Piece) => void;
  wait: (ms: number) => Promise<void>;
  isStopped: () => boolean;
  // Free-tier limits are per minute as well as per day, so space the requests out.
  spacingMs?: number;
  // Waits longer than this mean the allowance is gone for now.
  maxShortWaitSeconds?: number;
  maxShortWaits?: number;
};

// Reads waiting photos one at a time until none are left or the AI can't take more.
export async function drainQueue({
  nextWaiting,
  label,
  onReading,
  onPiece,
  wait,
  isStopped,
  spacingMs = 4000,
  maxShortWaitSeconds = 90,
  maxShortWaits = 3,
}: DrainOptions): Promise<QueueStop> {
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
