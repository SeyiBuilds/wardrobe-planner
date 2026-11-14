import type { Category, GestureRecognizer, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { HandFrame } from "./gestures";

// Both files are served from this app, never from a CDN. The camera picture is read on the
// phone and never saved or sent anywhere.
const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/gesture_recognizer.task";

// About 15 readings a second: smooth enough for swipes, easy on the battery.
const FRAME_GAP = 66;
// How sure the model has to be that it's a thumbs up.
const THUMB_SCORE = 0.6;
// The wrist and the knuckles of the index, middle and little fingers: their middle is the palm.
const PALM_POINTS = [0, 5, 9, 17];

export class HandError extends Error {
  constructor(readonly kind: "unsupported") {
    super(kind);
  }
}

// Starts reading hands from the camera into `video`, calling `onFrame` for each reading.
// Resolves to a function that stops the camera.
export type HandSource = (video: HTMLVideoElement, onFrame: (frame: HandFrame) => void) => Promise<() => void>;

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
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is busy. Close any other app using it, then try again.";
  }
  if (error instanceof HandError) return "This browser can't use the camera here, so hand control isn't available.";
  return "Hand control couldn't start. Check your connection and try again.";
}

let recognizer: Promise<GestureRecognizer> | null = null;

// Loaded only when hand control is first turned on, since the files are large.
function loadRecognizer(): Promise<GestureRecognizer> {
  recognizer ??= (async () => {
    const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 1,
    });
  })();
  recognizer.catch(() => {
    recognizer = null;
  });
  return recognizer;
}

// The front camera, read by MediaPipe on the phone.
export const cameraSource: HandSource = async (video, onFrame) => {
  if (!navigator.mediaDevices?.getUserMedia) throw new HandError("unsupported");

  // Ask for the camera first, so the permission question shows straight away.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
  });
  const stopStream = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  let reader: GestureRecognizer;
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    reader = await loadRecognizer();
  } catch (error) {
    stopStream();
    throw error;
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
