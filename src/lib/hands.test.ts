import { cameraProblem, downloadEngine, frameFrom, HandError, withinTime } from "./hands";

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

describe("downloading hand tracking", () => {
  const FILES = { wasm: { path: "/w.wasm", bytes: 30 }, model: { path: "/m.task", bytes: 20 } };

  // A response that sends its body in pieces, optionally stopping partway without finishing.
  function streamed(chunks: number[], { hang = false } = {}) {
    let fill = 1;
    return new Response(
      new ReadableStream({
        async start(controller) {
          for (const size of chunks) {
            controller.enqueue(new Uint8Array(size).fill(fill++));
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          if (!hang) controller.close();
        },
      }),
    );
  }

  it("downloads both files, showing progress, and keeps the model", async () => {
    const progress: number[] = [];
    const fetch = vi.fn(async (path: string) => (path === "/w.wasm" ? streamed([10, 10, 10]) : streamed([12, 8])));

    const model = await downloadEngine({ files: FILES, fetch, onProgress: (fraction) => progress.push(fraction) });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(model).toHaveLength(20);
    expect(Array.from(model.slice(0, 12)).every((byte) => byte === 1)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, i) => i === 0 || value >= progress[i - 1])).toBe(true);
  });

  it("gives up when the download stops coming in", async () => {
    const fetch = vi.fn(async (path: string) => (path === "/w.wasm" ? streamed([30]) : streamed([5], { hang: true })));

    await expect(downloadEngine({ files: FILES, fetch, onProgress: () => {}, stallAfter: 60 })).rejects.toMatchObject({
      kind: "stalled",
    });
  });

  it("says when a file can't be downloaded", async () => {
    const fetch = vi.fn(async () => new Response("missing", { status: 404 }));

    await expect(downloadEngine({ files: FILES, fetch, onProgress: () => {} })).rejects.toMatchObject({ kind: "download" });
  });
});

describe("time limits", () => {
  it("passes on work that finishes in time", async () => {
    await expect(withinTime(Promise.resolve("ready"), 50, () => new HandError("setup"))).resolves.toBe("ready");
  });

  it("stops waiting for work that takes too long", async () => {
    const never = new Promise<string>(() => {});

    await expect(withinTime(never, 30, () => new HandError("setup"))).rejects.toMatchObject({ kind: "setup" });
  });
});

describe("hand tracking problems", () => {
  it("says which step went wrong", () => {
    expect(cameraProblem(new HandError("stalled"))).toMatch(/download stopped/);
    expect(cameraProblem(new HandError("download"))).toMatch(/couldn't download/);
    expect(cameraProblem(new HandError("setup"))).toMatch(/stuck while getting ready/);
    expect(cameraProblem(new WebAssembly.CompileError("no simd"))).toMatch(/can't run hand tracking/);
  });
});
