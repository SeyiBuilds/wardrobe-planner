import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import type { Gesture, HandFrame } from "./gestures";
import { HandControlProvider, useGestures, useHandControl } from "./handControl";
import { HandError, type HandSource, type LoadStep } from "./hands";

// Stands in for the camera: frames are pushed in by the test.
function fakeCamera() {
  let onFrame: ((frame: HandFrame) => void) | null = null;
  const stop = vi.fn();
  const source = vi.fn<HandSource>(async (_video, options) => {
    onFrame = options.onFrame;
    return stop;
  });
  const push = (frame: HandFrame) => act(() => onFrame!(frame));
  return { source, stop, push };
}

// A quick move of the hand to the left, as the camera would see it.
function swipeLeft(push: (frame: HandFrame) => void, start = 0) {
  for (let i = 0; i <= 5; i++) push({ time: start + i * 66, hand: { x: 0.8 - i * 0.1, y: 0.5 }, thumbUp: false });
}

function DayPage({ onGesture }: { onGesture: (gesture: Gesture) => string | null }) {
  const hands = useHandControl();
  useGestures(onGesture);
  return (
    <>
      <button type="button" onClick={hands.start}>
        Use hand control
      </button>
      {hands.problem && <p>{hands.problem}</p>}
      <Link to="/wardrobe">Wardrobe</Link>
    </>
  );
}

function setup({ source = fakeCamera().source, idleAfter = 60_000, onGesture = vi.fn(() => "Next day") } = {}) {
  render(
    <MemoryRouter initialEntries={["/day/2026-11-11"]}>
      <HandControlProvider source={source} idleAfter={idleAfter}>
        <Routes>
          <Route path="/day/:day" element={<DayPage onGesture={onGesture} />} />
          <Route path="/wardrobe" element={<p>Your wardrobe</p>} />
        </Routes>
      </HandControlProvider>
    </MemoryRouter>,
  );
  return { onGesture };
}

describe("hand control", () => {
  it("is off until you ask for it", () => {
    const camera = fakeCamera();
    setup({ source: camera.source });

    expect(camera.source).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Hand control" })).not.toBeInTheDocument();
  });

  it("starts the camera, says when it sees your hand, and passes gestures to the page", async () => {
    const camera = fakeCamera();
    const { onGesture } = setup({ source: camera.source });

    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    const bar = await screen.findByRole("region", { name: "Hand control" });
    expect(bar).toHaveTextContent("Show your hand to the camera");

    camera.push({ time: 0, hand: { x: 0.8, y: 0.5 }, thumbUp: false });
    expect(bar).toHaveTextContent("I can see your hand");

    swipeLeft(camera.push, 66);
    expect(onGesture).toHaveBeenCalledWith("next");
    expect(onGesture).toHaveBeenCalledTimes(1);
    expect(bar).toHaveTextContent("Next day");
  });

  it("shows a thumbs up filling up while it's held", async () => {
    const camera = fakeCamera();
    setup({ source: camera.source });
    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    await screen.findByRole("region", { name: "Hand control" });

    for (let i = 0; i <= 6; i++) camera.push({ time: i * 66, hand: { x: 0.5, y: 0.5 }, thumbUp: true });

    expect(screen.getByRole("progressbar", { name: "Thumbs up held" })).toBeInTheDocument();
  });

  it("turns off from the bar", async () => {
    const camera = fakeCamera();
    setup({ source: camera.source });
    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    await screen.findByRole("region", { name: "Hand control" });

    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));

    expect(camera.stop).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Hand control" })).not.toBeInTheDocument();
  });

  it("turns off by itself after a while without seeing a hand", async () => {
    const camera = fakeCamera();
    setup({ source: camera.source, idleAfter: 150 });
    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    await screen.findByRole("region", { name: "Hand control" });

    await screen.findByText(/turned off after a while without seeing a hand/, {}, { timeout: 2500 });
    expect(camera.stop).toHaveBeenCalled();
  });

  it("turns off when you leave the day pages", async () => {
    const camera = fakeCamera();
    setup({ source: camera.source });
    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    await screen.findByRole("region", { name: "Hand control" });

    await userEvent.click(screen.getByRole("link", { name: "Wardrobe" }));

    expect(camera.stop).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Hand control" })).not.toBeInTheDocument();
  });

  it("turns off when you switch to another app", async () => {
    const camera = fakeCamera();
    setup({ source: camera.source });
    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    await screen.findByRole("region", { name: "Hand control" });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });

    expect(camera.stop).toHaveBeenCalled();
  });

  it("shows each step while hand tracking loads", async () => {
    const hooks: { onStep?: (step: LoadStep) => void; finish?: (stop: () => void) => void } = {};
    const source = vi.fn<HandSource>((_video, options) => {
      hooks.onStep = options.onStep;
      return new Promise((resolve) => {
        hooks.finish = resolve;
      });
    });
    setup({ source });

    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    const bar = await screen.findByRole("region", { name: "Hand control" });
    expect(bar).toHaveTextContent("Starting the camera…");

    act(() => hooks.onStep!({ step: "download", fraction: 0.4 }));
    expect(bar).toHaveTextContent("Loading hand tracking: 40%");
    expect(bar).toHaveTextContent("only slow the first time");

    act(() => hooks.onStep!({ step: "setup" }));
    expect(bar).toHaveTextContent("Getting hand tracking ready…");

    await act(async () => hooks.finish!(vi.fn()));
    expect(bar).toHaveTextContent("Show your hand to the camera");
  });

  it("stops loading when you turn it off", async () => {
    const hooks: { signal?: AbortSignal } = {};
    const source = vi.fn<HandSource>((_video, options) => {
      hooks.signal = options.signal;
      return new Promise(() => {});
    });
    setup({ source });
    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));
    await screen.findByRole("region", { name: "Hand control" });

    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));

    expect(hooks.signal!.aborted).toBe(true);
    expect(screen.queryByRole("region", { name: "Hand control" })).not.toBeInTheDocument();
  });

  it("says which step got stuck", async () => {
    const source = vi.fn<HandSource>(async () => {
      throw new HandError("setup");
    });
    setup({ source });

    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));

    expect(await screen.findByText(/stuck while getting ready/)).toBeInTheDocument();
  });

  it("explains when the camera isn't allowed", async () => {
    const source = vi.fn<HandSource>(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    setup({ source });

    await userEvent.click(screen.getByRole("button", { name: "Use hand control" }));

    expect(await screen.findByText(/allow the camera/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hand control" })).not.toBeInTheDocument();
  });
});
