// Turns what the camera sees of your hand into a few gestures. Nothing here touches the camera,
// so the rules can be tested with made-up movements and tuned without a phone.

export type Gesture = "next" | "previous" | "another" | "back" | "thumbsUp";

// One camera frame. `hand` is the middle of your palm from 0 to 1 across and down the picture,
// as you see yourself in a mirror, or null when no hand is in view.
export type HandFrame = { time: number; hand: { x: number; y: number } | null; thumbUp: boolean };

export type Touch = { x: number; y: number; time: number };

// A swipe is your hand crossing a fifth of the picture within about half a second.
export const SWIPE_DISTANCE = 0.2;
export const SWIPE_TIME = 450;
// The main direction has to be clearly bigger than the other one.
const DIRECTION_RATIO = 1.5;
// After a swipe, give your hand time to come back without that counting as a swipe too.
export const COOLDOWN = 900;
// A quick flick blurs, and the camera can lose the hand for a frame or two. Only a longer
// gap means the hand has really gone.
const HAND_GRACE = 250;
// How long a thumbs up is held before it counts, and how long a missed frame is forgiven.
export const THUMB_HOLD = 800;
const THUMB_GRACE = 250;

type Point = { x: number; y: number; time: number };

export class GestureTracker {
  private trail: Point[] = [];
  private lastSeen = -Infinity;
  private quietUntil = -Infinity;
  private thumbSince: number | null = null;
  private thumbLastSeen = -Infinity;
  private thumbCounted = false;

  // 0 to 1: how much of the thumbs-up hold is done, for showing progress.
  thumbProgress = 0;

  update(frame: HandFrame): Gesture | null {
    const thumb = this.trackThumb(frame);
    if (thumb) return thumb;
    return this.trackSwipe(frame);
  }

  private trackSwipe({ time, hand }: HandFrame): Gesture | null {
    if (!hand) {
      if (time - this.lastSeen > HAND_GRACE) this.trail = [];
      return null;
    }
    this.lastSeen = time;
    if (time < this.quietUntil) return null;

    this.trail.push({ x: hand.x, y: hand.y, time });
    this.trail = this.trail.filter((point) => time - point.time <= SWIPE_TIME);

    const start = this.trail[0];
    const dx = hand.x - start.x;
    const dy = hand.y - start.y;
    let gesture: Gesture | null = null;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) >= DIRECTION_RATIO * Math.abs(dy)) {
      gesture = dx < 0 ? "next" : "previous";
    } else if (Math.abs(dy) >= SWIPE_DISTANCE && Math.abs(dy) >= DIRECTION_RATIO * Math.abs(dx)) {
      gesture = dy < 0 ? "another" : "back";
    }
    if (gesture) this.rest(time);
    return gesture;
  }

  private trackThumb({ time, hand, thumbUp }: HandFrame): Gesture | null {
    if (hand && thumbUp) {
      this.thumbSince ??= time;
      this.thumbLastSeen = time;
    } else if (time - this.thumbLastSeen > THUMB_GRACE) {
      this.thumbSince = null;
      this.thumbCounted = false;
    }

    this.thumbProgress = this.thumbSince === null || this.thumbCounted ? 0 : Math.min(1, (time - this.thumbSince) / THUMB_HOLD);
    if (this.thumbProgress < 1) return null;

    this.thumbCounted = true;
    this.thumbProgress = 0;
    this.rest(time);
    return "thumbsUp";
  }

  private rest(time: number) {
    this.quietUntil = time + COOLDOWN;
    this.trail = [];
  }
}

// A finger swipe across the screen: left for the next day, right for the day before.
// Up and down are left to scrolling.
const FINGER_DISTANCE = 60;
const FINGER_TIME = 700;

export function fingerSwipe(start: Touch, end: Touch): "next" | "previous" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.time - start.time > FINGER_TIME) return null;
  if (Math.abs(dx) < FINGER_DISTANCE || Math.abs(dx) < DIRECTION_RATIO * Math.abs(dy)) return null;
  return dx < 0 ? "next" : "previous";
}
