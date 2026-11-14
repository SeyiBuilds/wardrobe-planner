import { cameraProblem, frameFrom, HandError } from "./hands";

// 21 hand points, all at one spot unless moved.
function landmarks(x: number, y: number) {
  return Array.from({ length: 21 }, () => ({ x, y, z: 0, visibility: 1 }));
}

function gesture(categoryName: string, score: number) {
  return [{ categoryName, score, index: 0, displayName: "" }];
}

describe("reading a camera frame", () => {
  it("finds the middle of your palm, as you'd see it in a mirror", () => {
    const points = landmarks(0, 0);
    // Wrist and the knuckles of the index, middle and little fingers.
    points[0] = { ...points[0], x: 0.2, y: 0.8 };
    points[5] = { ...points[5], x: 0.2, y: 0.6 };
    points[9] = { ...points[9], x: 0.3, y: 0.6 };
    points[17] = { ...points[17], x: 0.3, y: 0.8 };

    const frame = frameFrom({ landmarks: [points], gestures: [gesture("Open_Palm", 0.9)] }, 1000);

    expect(frame.time).toBe(1000);
    expect(frame.hand!.x).toBeCloseTo(0.75);
    expect(frame.hand!.y).toBeCloseTo(0.7);
    expect(frame.thumbUp).toBe(false);
  });

  it("says when there's no hand", () => {
    expect(frameFrom({ landmarks: [], gestures: [] }, 5)).toEqual({ time: 5, hand: null, thumbUp: false });
  });

  it("only trusts a confident thumbs up", () => {
    const sure = frameFrom({ landmarks: [landmarks(0.5, 0.5)], gestures: [gesture("Thumb_Up", 0.8)] }, 0);
    const unsure = frameFrom({ landmarks: [landmarks(0.5, 0.5)], gestures: [gesture("Thumb_Up", 0.4)] }, 0);

    expect(sure.thumbUp).toBe(true);
    expect(unsure.thumbUp).toBe(false);
  });
});

describe("camera problems", () => {
  it("explains a blocked camera in words", () => {
    expect(cameraProblem(new DOMException("no", "NotAllowedError"))).toMatch(/allow the camera/);
    expect(cameraProblem(new DOMException("none", "NotFoundError"))).toMatch(/couldn't find a camera/);
    expect(cameraProblem(new HandError("unsupported"))).toMatch(/browser can't use the camera/);
    expect(cameraProblem(new Error("model failed"))).toMatch(/couldn't start/);
  });
});
