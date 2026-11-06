import type { FaceDetector } from "@mediapipe/tasks-vision";

export type Box = { x: number; y: number; width: number; height: number };

// Both files are served from this app, never from a CDN.
const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/blaze_face_short_range.tflite";

let detector: Promise<FaceDetector> | null = null;

// Loaded only when the first photo is prepared, since the files are large.
function loadDetector(): Promise<FaceDetector> {
  detector ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    });
  })();
  detector.catch(() => {
    detector = null;
  });
  return detector;
}

// The detector is built for faces near the camera. Looking again at overlapping quarters of the
// photo, enlarged, also catches smaller faces further back. Overlapping finds are harmless:
// a face blurred twice is still just blurred.
export async function findFaces(canvas: HTMLCanvasElement): Promise<Box[]> {
  const faceDetector = await loadDetector();
  const faces = detectIn(faceDetector, canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  for (const tile of quarterTiles(canvas.width, canvas.height)) {
    faces.push(...detectIn(faceDetector, canvas, tile));
  }
  return faces;
}

// Four overlapping tiles, each 60% of the photo's width and height.
export function quarterTiles(width: number, height: number): Box[] {
  const tileWidth = Math.round(width * 0.6);
  const tileHeight = Math.round(height * 0.6);
  return [0, width - tileWidth].flatMap((x) =>
    [0, height - tileHeight].map((y) => ({ x, y, width: tileWidth, height: tileHeight })),
  );
}

function detectIn(faceDetector: FaceDetector, source: HTMLCanvasElement, area: Box): Box[] {
  let target = source;
  if (area.width !== source.width || area.height !== source.height) {
    target = document.createElement("canvas");
    target.width = area.width;
    target.height = area.height;
    target.getContext("2d")!.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  }
  return faceDetector.detect(target).detections.flatMap(({ boundingBox }) =>
    boundingBox
      ? [{ x: area.x + boundingBox.originX, y: area.y + boundingBox.originY, width: boundingBox.width, height: boundingBox.height }]
      : [],
  );
}

// The detector boxes the face tightly, so grow the box to cover hair, ears and chin.
export function coverBox(face: Box, imageWidth: number, imageHeight: number): Box {
  const growX = face.width * 0.35;
  const growTop = face.height * 0.5;
  const growBottom = face.height * 0.3;
  const x = Math.max(0, Math.floor(face.x - growX));
  const y = Math.max(0, Math.floor(face.y - growTop));
  const right = Math.min(imageWidth, Math.ceil(face.x + face.width + growX));
  const bottom = Math.min(imageHeight, Math.ceil(face.y + face.height + growBottom));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

// Shrinks the area to a few blocks and stretches it back, which can't be undone.
export function blurArea(canvas: HTMLCanvasElement, area: Box): void {
  if (area.width < 1 || area.height < 1) return;
  const blocks = document.createElement("canvas");
  blocks.width = Math.max(1, Math.round(area.width / 24));
  blocks.height = Math.max(1, Math.round(area.height / 24));
  const blockContext = blocks.getContext("2d")!;
  blockContext.drawImage(canvas, area.x, area.y, area.width, area.height, 0, 0, blocks.width, blocks.height);

  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = true;
  context.drawImage(blocks, 0, 0, blocks.width, blocks.height, area.x, area.y, area.width, area.height);
}
