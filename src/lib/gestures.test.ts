import { COOLDOWN, fingerSwipe, GestureTracker, THUMB_HOLD, type Gesture, type HandFrame } from "./gestures";

const FRAME = 66; // about 15 frames a second, like the camera loop

// A hand moving in a straight line from one point to another over `ms`, as the camera sees it.
function move(from: [number, number], to: [number, number], ms: number, start = 0): HandFrame[] {
  const steps = Math.max(1, Math.round(ms / FRAME));
  return Array.from({ length: steps + 1 }, (_, i) => ({
    time: start + i * FRAME,
    hand: { x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps },
    thumbUp: false,
  }));
}

function hold(at: [number, number], ms: number, start: number, thumbUp = false): HandFrame[] {
  return Array.from({ length: Math.round(ms / FRAME) + 1 }, (_, i) => ({
    time: start + i * FRAME,
    hand: { x: at[0], y: at[1] },
    thumbUp,
  }));
}

function run(frames: HandFrame[], tracker = new GestureTracker()): Gesture[] {
  return frames.flatMap((frame) => {
    const gesture = tracker.update(frame);
    return gesture ? [gesture] : [];
  });
}

describe("hand swipes", () => {
  it("moving your hand left goes to the next day, and right to the day before", () => {
    expect(run(move([0.75, 0.5], [0.3, 0.5], 300))).toEqual(["next"]);
    expect(run(move([0.3, 0.5], [0.75, 0.5], 300))).toEqual(["previous"]);
  });

  it("moving up asks for another outfit, and down goes back", () => {
    expect(run(move([0.5, 0.75], [0.5, 0.35], 300))).toEqual(["another"]);
    expect(run(move([0.5, 0.35], [0.5, 0.75], 300))).toEqual(["back"]);
  });

  it("ignores slow drifting and small shakes", () => {
    expect(run(move([0.8, 0.5], [0.2, 0.5], 2500))).toEqual([]);
    expect(run(move([0.5, 0.5], [0.56, 0.5], 150))).toEqual([]);
  });

  it("ignores moves that are as much sideways as up or down", () => {
    expect(run(move([0.3, 0.7], [0.6, 0.42], 300))).toEqual([]);
  });

  it("counts one swipe once, even when your hand comes straight back", () => {
    const out = move([0.75, 0.5], [0.3, 0.5], 300);
    const back = move([0.3, 0.5], [0.75, 0.5], 400, 300 + FRAME);

    expect(run([...out, ...back])).toEqual(["next"]);
  });

  it("is ready for the next swipe once your hand has calmly come back", () => {
    const first = move([0.75, 0.5], [0.3, 0.5], 300);
    const calmReturn = move([0.3, 0.5], [0.75, 0.5], COOLDOWN + 2000, 300 + FRAME);
    const second = move([0.75, 0.5], [0.3, 0.5], 300, 300 + 2 * FRAME + COOLDOWN + 2000);

    expect(run([...first, ...calmReturn, ...second])).toEqual(["next", "next"]);
  });

  it("doesn't join up movements from before your hand left the picture", () => {
    const tracker = new GestureTracker();
    run(move([0.75, 0.5], [0.6, 0.5], 130), tracker);
    for (let time = 200; time <= 500; time += FRAME) tracker.update({ time, hand: null, thumbUp: false });

    expect(run(move([0.6, 0.5], [0.45, 0.5], 130, 530), tracker)).toEqual([]);
  });

  it("keeps a quick swipe going when the camera loses your hand for a frame or two", () => {
    const frames = move([0.8, 0.5], [0.3, 0.5], 330);
    // A quick flick blurs, so the middle of it isn't seen.
    for (const i of [2, 3]) frames[i] = { ...frames[i], hand: null };

    expect(run(frames)).toEqual(["next"]);
  });
});

describe("thumbs up", () => {
  it("counts once it's been held for a moment", () => {
    const tracker = new GestureTracker();
    const frames = hold([0.5, 0.5], THUMB_HOLD + 300, 0, true);

    expect(run(frames, tracker)).toEqual(["thumbsUp"]);
  });

  it("shows how far through the hold you are", () => {
    const tracker = new GestureTracker();
    run(hold([0.5, 0.5], THUMB_HOLD / 2, 0, true), tracker);

    expect(tracker.thumbProgress).toBeGreaterThan(0.4);
    expect(tracker.thumbProgress).toBeLessThan(0.6);
  });

  it("doesn't count a quick thumbs up", () => {
    const frames = [...hold([0.5, 0.5], THUMB_HOLD / 2, 0, true), ...hold([0.5, 0.5], 600, THUMB_HOLD / 2 + FRAME)];

    expect(run(frames)).toEqual([]);
  });

  it("isn't thrown by the odd frame where the thumb isn't recognised", () => {
    const frames = hold([0.5, 0.5], THUMB_HOLD + 200, 0, true);
    frames[5] = { ...frames[5], thumbUp: false };

    expect(run(frames)).toEqual(["thumbsUp"]);
  });

  it("needs you to lower your thumb before it counts again", () => {
    const end = THUMB_HOLD * 3;
    const held = hold([0.5, 0.5], end, 0, true);
    const lowered = hold([0.5, 0.5], 500, end + FRAME);
    const again = hold([0.5, 0.5], THUMB_HOLD + 200, end + 600, true);

    expect(run([...held, ...lowered, ...again])).toEqual(["thumbsUp", "thumbsUp"]);
  });
});

describe("finger swipes on the screen", () => {
  it("swiping left goes to the next day, and right to the day before", () => {
    expect(fingerSwipe({ x: 300, y: 400, time: 0 }, { x: 150, y: 410, time: 250 })).toBe("next");
    expect(fingerSwipe({ x: 100, y: 400, time: 0 }, { x: 260, y: 380, time: 250 })).toBe("previous");
  });

  it("leaves taps, scrolls and slow drags alone", () => {
    expect(fingerSwipe({ x: 200, y: 400, time: 0 }, { x: 205, y: 402, time: 100 })).toBeNull();
    expect(fingerSwipe({ x: 200, y: 400, time: 0 }, { x: 140, y: 200, time: 250 })).toBeNull();
    expect(fingerSwipe({ x: 300, y: 400, time: 0 }, { x: 100, y: 400, time: 2000 })).toBeNull();
  });
});
