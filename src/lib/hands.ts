import type { Category, GestureRecognizer, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandFrame } from "./gestures";

// Every file is served from this app, never from a CDN. The camera picture is read on the
// phone and never saved or sent anywhere.
const WASM_PATH = "/mediapipe/wasm";

// The hand tracking engine and its model. Sizes are the files as stored, before the server
// compresses them, so progress can be shown while they download.
export const ENGINE_FILES = {
  wasm: { path: `${WASM_PATH}/vision_wasm_internal.wasm`, bytes: 14_603_354 },
  model: { path: "/models/gesture_recognizer.task", bytes: 8_373_440 },
};

// A download that sends nothing new for this long has stalled. A slow one that keeps
// coming is left to finish.
const STALL_AFTER = 30_000;
// How long the phone may take to get hand tracking running once it's downloaded.
const SETUP_LIMIT = 60_000;
// About 15 readings a second: smooth enough for swipes, easy on the battery.
const FRAME_GAP = 66;
// How sure the model has to be that it's a thumbs up.
const THUMB_SCORE = 0.6;
// The wrist and the knuckles of the index, middle and little fingers: their middle is the palm.
const PALM_POINTS = [0, 5, 9, 17];

export class HandError extends Error {
  constructor(readonly kind: "unsupported" | "stalled" | "download" | "setup") {
    super(kind);
  }
}

// Where hand control has got to while it starts, for showing in the bar.
export type LoadStep = { step: "camera" } | { step: "download"; fraction: number } | { step: "setup" };

// Starts reading hands from the camera into `video`, calling `onFrame` for each reading.
// Resolves to a function that stops the camera. Aborting `signal` gives up on starting.
export type HandSource = (
  video: HTMLVideoElement,
  options: { onFrame: (frame: HandFrame) => void; onStep: (step: LoadStep) => void; signal: AbortSignal },
) => Promise<() => void>;

type Reading = { landmarks: NormalizedLandmark[][]; gestures: Category[][] };

export function frameFrom(reading: Reading, time: number): HandFrame {
  const points = reading.landmarks[0];
  if (!points || points.length < 21) return { time, hand: null, thumbUp: false };

  const palm = PALM_POINTS.map((index) => points[index]);
  const x = palm.reduce((sum, point) => sum + point.x, 0) / palm.length;
  const y = palm.reduce((sum, point) => sum + point.y, 0) / palm.length;
  const best = reading.gestures[0]?.[0];
  return {
    time,
    // The camera sees you the other way round; flipping makes left your left.
    hand: { x: 1 - x, y },
    thumbUp: best?.categoryName === "Thumb_Up" && best.score >= THUMB_SCORE,
  };
}

export function cameraProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera isn't allowed. To use hand control, allow the camera for this site in your browser's settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "The app couldn't find a camera on this device.";
  }
  if (name === "NotReadableError") {
    return "The camera is busy. Close any other app using it, then try again.";
  }
  if (error instanceof HandError) {
    switch (error.kind) {
      case "unsupported":
        return "This browser can't use the camera here, so hand control isn't available.";
      case "stalled":
        return "The hand tracking download stopped. Check your connection, then try again.";
      case "download":
        return "Hand tracking couldn't download. Check your connection, then try again.";
      case "setup":
        return "Hand tracking downloaded, but it got stuck while getting ready on this phone.";
    }
  }
  if (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.RuntimeError) {
    return "This phone's browser can't run hand tracking.";
  }
  return "Hand control couldn't start. Check your connection and try again.";
}

// Rejects with `error()` if `work` hasn't finished within `ms`.
export function withinTime<T>(work: Promise<T>, ms: number, error: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

type EngineFile = { path: string; bytes: number };

// Downloads the engine and the model, reporting progress from 0 to 1. The engine is only read
// so the browser keeps it, ready for MediaPipe to load; the model's bytes are returned.
export async function downloadEngine({
  files = ENGINE_FILES,
  fetch = globalThis.fetch,
  onProgress,
  stallAfter = STALL_AFTER,
  signal,
}: {
  files?: { wasm: EngineFile; model: EngineFile };
  fetch?: (path: string, init?: RequestInit) => Promise<Response>;
  onProgress: (fraction: number) => void;
  stallAfter?: number;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const total = files.wasm.bytes + files.model.bytes;
  const received = { wasm: 0, model: 0 };
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const controller = new AbortController();
  const report = () => onProgress(Math.min(1, (received.wasm + received.model) / total));

  let giveUp: (error: unknown) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    giveUp = (error) => {
      controller.abort();
      for (const reader of readers) void reader.cancel().catch(() => {});
      reject(error);
    };
  });
  stopped.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stillComing = () => {
    clearTimeout(timer);
    timer = setTimeout(() => giveUp(new HandError("stalled")), stallAfter);
  };
  const onAbort = () => giveUp(new DOMException("Hand control was turned off.", "AbortError"));
  signal?.addEventListener("abort", onAbort, { once: true });

  async function read(name: "wasm" | "model", keep: boolean): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(files[name].path, { signal: controller.signal });
    } catch {
      throw new HandError("download");
    }
    if (!response.ok || !response.body) throw new HandError("download");
    const reader = response.body.getReader();
    readers.push(reader);
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (keep) chunks.push(value);
      received[name] += value.length;
      stillComing();
      report();
    }
    received[name] = files[name].bytes;
    report();

    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  stillComing();
  try {
    const [, model] = await Promise.race([Promise.all([read("wasm", false), read("model", true)]), stopped]);
    return model;
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

let recognizer: Promise<GestureRecognizer> | null = null;

function createRecognizer(model: Uint8Array): Promise<GestureRecognizer> {
  const loading = (async () => {
    const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 1,
    });
  })();
  loading.catch(() => {
    if (recognizer === loading) recognizer = null;
  });
  return loading;
}

// The front camera, read by MediaPipe on the phone. The download starts at the same time as
// the camera, and is only needed the first time: after that the recognizer is kept.
export const cameraSource: HandSource = async (video, { onFrame, onStep, signal }) => {
  if (!navigator.mediaDevices?.getUserMedia) throw new HandError("unsupported");

  onStep({ step: "camera" });
  const engine = recognizer
    ? null
    : downloadEngine({ onProgress: (fraction) => onStep({ step: "download", fraction }), signal });
  engine?.catch(() => {});

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
  });
  const stopStream = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  signal.addEventListener("abort", stopStream, { once: true });

  let reader: GestureRecognizer;
  try {
    if (signal.aborted) throw new DOMException("Hand control was turned off.", "AbortError");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (engine) {
      const model = await engine;
      recognizer ??= createRecognizer(model);
    }
    onStep({ step: "setup" });
    reader = await withinTime(recognizer!, SETUP_LIMIT, () => new HandError("setup"));
    if (signal.aborted) throw new DOMException("Hand control was turned off.", "AbortError");
  } catch (error) {
    stopStream();
    throw error;
  } finally {
    signal.removeEventListener("abort", stopStream);
  }

  let stopped = false;
  let last = -Infinity;
  let handle = 0;
  const step = () => {
    if (stopped) return;
    const now = performance.now();
    if (now - last >= FRAME_GAP && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      last = now;
      onFrame(frameFrom(reader.recognizeForVideo(video, now), now));
    }
    handle = requestAnimationFrame(step);
  };
  handle = requestAnimationFrame(step);

  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
    stopStream();
  };
};
