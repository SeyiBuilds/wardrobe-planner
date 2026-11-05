import { drainQueue, type LabelResponse } from "./labelQueue";
import type { Piece } from "./pieces";

function piece(id: string, label_status: Piece["label_status"] = "waiting"): Piece {
  return { id, label_status, name: "", reviewed: false } as Piece;
}

// Runs the queue over `pieces`, answering each request from `responses` in order.
function run(pieces: Piece[], responses: LabelResponse[], stopAfter = Infinity) {
  const store = new Map(pieces.map((p) => [p.id, p]));
  const answers = [...responses];
  const waits: number[] = [];
  const labelled: string[] = [];
  let calls = 0;

  const done = drainQueue({
    nextWaiting: () => [...store.values()].find((p) => p.label_status === "waiting"),
    label: async (id) => {
      calls++;
      labelled.push(id);
      return answers.shift() ?? { status: "error", reason: "no more answers" };
    },
    onReading: () => {},
    onPiece: (updated) => store.set(updated.id, updated),
    wait: async (ms) => {
      waits.push(ms);
    },
    isStopped: () => calls >= stopAfter,
  });

  return { done, waits, labelled, store };
}

describe("drainQueue", () => {
  it("reads every waiting photo, spaced out, then finishes", async () => {
    const { done, waits, labelled } = run(
      [piece("a"), piece("b"), piece("c", "done")],
      [
        { status: "done", piece: piece("a", "done") },
        { status: "done", piece: piece("b", "done") },
      ],
    );

    expect(await done).toEqual({ reason: "finished" });
    expect(labelled).toEqual(["a", "b"]);
    expect(waits).toEqual([4000]);
  });

  it("moves past a photo the AI couldn't read", async () => {
    const { done, labelled } = run(
      [piece("a"), piece("b")],
      [
        { status: "failed", reason: "declined", piece: piece("a", "failed") },
        { status: "done", piece: piece("b", "done") },
      ],
    );

    expect(await done).toEqual({ reason: "finished" });
    expect(labelled).toEqual(["a", "b"]);
  });

  it("waits out a short per-minute limit and retries the same photo", async () => {
    const { done, waits, labelled } = run(
      [piece("a")],
      [
        { status: "waiting", retryAfterSeconds: 30, daily: false },
        { status: "done", piece: piece("a", "done") },
      ],
    );

    expect(await done).toEqual({ reason: "finished" });
    expect(waits).toEqual([30_500]);
    expect(labelled).toEqual(["a", "a"]);
  });

  it("stops for the day when the daily allowance is used up", async () => {
    const { done, waits } = run([piece("a")], [{ status: "waiting", retryAfterSeconds: 20, daily: true }]);

    expect(await done).toEqual({ reason: "allowance" });
    expect(waits).toEqual([]);
  });

  it("stops when the suggested wait is long or missing", async () => {
    expect(await run([piece("a")], [{ status: "waiting", retryAfterSeconds: 3600, daily: false }]).done).toEqual({
      reason: "allowance",
    });
    expect(await run([piece("a")], [{ status: "waiting", retryAfterSeconds: null, daily: false }]).done).toEqual({
      reason: "allowance",
    });
  });

  it("gives up after a few short waits in a row", async () => {
    const short: LabelResponse = { status: "waiting", retryAfterSeconds: 10, daily: false };
    const { done, waits } = run([piece("a")], [short, short, short, short]);

    expect(await done).toEqual({ reason: "allowance" });
    expect(waits).toHaveLength(3);
  });

  it("stops when the AI isn't connected yet", async () => {
    expect(await run([piece("a")], [{ status: "unavailable" }]).done).toEqual({ reason: "unavailable" });
  });

  it("stops with the reason when something else goes wrong", async () => {
    expect(await run([piece("a")], [{ status: "error", reason: "offline" }]).done).toEqual({
      reason: "error",
      message: "offline",
    });
  });

  it("stops quietly when told to", async () => {
    const { done } = run([piece("a"), piece("b")], [{ status: "done", piece: piece("a", "done") }], 1);

    expect(await done).toEqual({ reason: "stopped" });
  });
});
