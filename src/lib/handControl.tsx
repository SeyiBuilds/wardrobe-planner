import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { GestureTracker, type Gesture, type HandFrame } from "./gestures";
import { cameraProblem, cameraSource, type HandSource, type LoadStep } from "./hands";

type Status = "off" | "starting" | "on";

type HandControl = {
  status: Status;
  // Why hand control stopped or couldn't start, if it did.
  problem: string | null;
  start: () => void;
  stop: () => void;
};

// A page's answer to a gesture: what to show the user, or null to show nothing.
type GestureHandler = (gesture: Gesture) => string | null;

const HandContext = createContext<{ control: HandControl; setHandler: (handler: GestureHandler | null) => void } | null>(null);

const FLASH_TIME = 1500;
// Hand control only works on the day pages.
const isDayPage = (path: string) => path.startsWith("/day/");

// Runs the camera while hand control is on, and passes each gesture to the page that's open.
export function HandControlProvider({
  source = cameraSource,
  idleAfter = 60_000,
  children,
}: {
  source?: HandSource;
  idleAfter?: number;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>("off");
  const [problem, setProblem] = useState<string | null>(null);
  const [handSeen, setHandSeen] = useState(false);
  const [thumbProgress, setThumbProgress] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  // Where starting has got to: the camera, the download, or getting ready.
  const [loading, setLoading] = useState<LoadStep | null>(null);
  const abort = useRef<AbortController | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const videoRef = useRef<HTMLVideoElement>(null);
  const stopCamera = useRef<(() => void) | null>(null);
  // Bumped on every start and stop, so a slow start that's no longer wanted shuts itself down.
  const attempt = useRef(0);
  const tracker = useRef(new GestureTracker());
  const handler = useRef<GestureHandler | null>(null);
  const lastHand = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = useCallback((reason: string | null = null) => {
    attempt.current++;
    abort.current?.abort();
    abort.current = null;
    stopCamera.current?.();
    stopCamera.current = null;
    setLoading(null);
    setStatus("off");
    setProblem(reason);
    setHandSeen(false);
    setThumbProgress(0);
    setFlash(null);
  }, []);

  const onFrame = useCallback((frame: HandFrame) => {
    if (frame.hand) lastHand.current = Date.now();
    setHandSeen(frame.hand !== null);

    const gesture = tracker.current.update(frame);
    // Tenths are plenty for the progress bar, and save redrawing on every frame.
    setThumbProgress(Math.round(tracker.current.thumbProgress * 10) / 10);
    if (!gesture) return;

    const shown = handler.current?.(gesture) ?? null;
    if (shown) {
      setFlash(shown);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_TIME);
    }
  }, []);

  const start = useCallback(async () => {
    if (stopCamera.current || !videoRef.current) return;
    const mine = ++attempt.current;
    const controller = new AbortController();
    abort.current = controller;
    setStatus("starting");
    setProblem(null);
    setLoading({ step: "camera" });
    tracker.current = new GestureTracker();
    try {
      const stopThis = await source(videoRef.current, {
        onFrame: (frame) => {
          if (attempt.current === mine) onFrame(frame);
        },
        onStep: (step) => {
          // Whole percents are enough, and save redrawing for every piece of the download.
          if (attempt.current === mine) setLoading((current) => (sameStep(current, step) ? current : step));
        },
        signal: controller.signal,
      });
      if (attempt.current !== mine) {
        stopThis();
        return;
      }
      stopCamera.current = stopThis;
      abort.current = null;
      lastHand.current = Date.now();
      setLoading(null);
      setStatus("on");
    } catch (error) {
      if (attempt.current === mine) stop(cameraProblem(error));
    }
  }, [onFrame, source, stop]);

  // Turn off after a while without a hand, to save the battery.
  useEffect(() => {
    if (status !== "on") return;
    const timer = setInterval(
      () => {
        if (Date.now() - lastHand.current >= idleAfter) {
          stop("Hand control turned off after a while without seeing a hand. Turn it on again when you need it.");
        }
      },
      Math.min(1000, idleAfter),
    );
    return () => clearInterval(timer);
  }, [idleAfter, status, stop]);

  // Turn off when the app goes into the background.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && statusRef.current !== "off") stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [stop]);

  // Turn off when you leave the day pages.
  const { pathname } = useLocation();
  useEffect(() => {
    if (!isDayPage(pathname) && statusRef.current !== "off") stop();
  }, [pathname, stop]);

  // Turn the camera off if the whole app closes.
  useEffect(
    () => () => {
      attempt.current++;
      stopCamera.current?.();
      clearTimeout(flashTimer.current);
    },
    [],
  );

  const control = useMemo<HandControl>(
    () => ({ status, problem, start: () => void start(), stop: () => stop() }),
    [problem, start, status, stop],
  );
  const value = useMemo(
    () => ({
      control,
      setHandler: (next: GestureHandler | null) => {
        handler.current = next;
      },
    }),
    [control],
  );

  const showing = status !== "off" && isDayPage(pathname);
  let message = "Starting the camera…";
  if (status === "starting" && loading?.step === "download") {
    message = `Loading hand tracking: ${Math.round(loading.fraction * 100)}%`;
  } else if (status === "starting" && loading?.step === "setup") {
    message = "Getting hand tracking ready…";
  } else if (status === "on") {
    message = flash ?? (thumbProgress > 0 ? "Keep holding…" : handSeen ? "I can see your hand" : "Show your hand to the camera");
  }

  return (
    <HandContext.Provider value={value}>
      {children}
      <section className="hand-bar" aria-label="Hand control" hidden={!showing}>
        <video ref={videoRef} className="hand-preview" muted playsInline aria-hidden="true" />
        <div className="hand-text">
          <p className="hand-status" role="status">
            {message}
          </p>
          {thumbProgress > 0 && (
            <progress className="hand-progress" value={thumbProgress} max={1} aria-label="Thumbs up held" />
          )}
          <p className="hand-help">
            {status === "starting" && loading?.step === "download"
              ? "It's only slow the first time. After that, your phone keeps it."
              : "Point a finger or two. Swipe left or right for days, up for another outfit, down to go back. Thumbs up when you've worn today's."}
          </p>
        </div>
        <button type="button" className="text-button is-strong" onClick={() => stop()}>
          Turn off
        </button>
      </section>
    </HandContext.Provider>
  );
}

function sameStep(a: LoadStep | null, b: LoadStep): boolean {
  if (!a || a.step !== b.step) return false;
  if (a.step === "download" && b.step === "download") return Math.round(a.fraction * 100) === Math.round(b.fraction * 100);
  return true;
}

export function useHandControl(): HandControl {
  const hands = useContext(HandContext);
  if (!hands) throw new Error("useHandControl must be used inside HandControlProvider");
  return hands.control;
}

// Lets the open page answer gestures. The latest handler is always used.
export function useGestures(onGesture: GestureHandler) {
  const hands = useContext(HandContext);
  if (!hands) throw new Error("useGestures must be used inside HandControlProvider");
  const latest = useRef(onGesture);
  latest.current = onGesture;
  const { setHandler } = hands;
  useEffect(() => {
    setHandler((gesture) => latest.current(gesture));
    return () => setHandler(null);
  }, [setHandler]);
}
