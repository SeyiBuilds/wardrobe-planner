import { measureColours, type MeasuredColour } from "./colours";
import { blurArea, coverBox, findFaces } from "./faces";

export type PreparedPhoto = {
  blob: Blob;
  colours: MeasuredColour[];
  facesBlurred: number;
};

const LONG_EDGE = 1024;
const COLOUR_SAMPLE_EDGE = 96;
const MAX_BYTES = 600_000;

export class PhotoError extends Error {}

// Fits width × height inside a square of `edge`, never enlarging.
export function fitWithin(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Everything here runs on the phone. Only the result leaves it: smaller, with faces blurred,
// and redrawn from pixels, which drops location and camera details stored in the original file.
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("This file isn't a photo the app can open. Try a JPEG or PNG.");
  }

  const size = fitWithin(bitmap.width, bitmap.height, LONG_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  let faces;
  try {
    faces = await findFaces(canvas);
  } catch {
    // Without the face check, the photo doesn't leave the phone.
    throw new PhotoError("The face check couldn't load, so the photo wasn't sent. Check your connection and try again.");
  }
  for (const face of faces) blurArea(canvas, coverBox(face, canvas.width, canvas.height));

  const sample = fitWithin(canvas.width, canvas.height, COLOUR_SAMPLE_EDGE);
  const small = document.createElement("canvas");
  small.width = sample.width;
  small.height = sample.height;
  const smallContext = small.getContext("2d")!;
  smallContext.drawImage(canvas, 0, 0, sample.width, sample.height);
  const colours = measureColours(smallContext.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);

  let blob = await encode(canvas, 0.82);
  if (blob.size > MAX_BYTES) blob = await encode(canvas, 0.65);

  return { blob, colours, facesBlurred: faces.length };
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PhotoError("The photo couldn't be saved. Try again."))),
      "image/jpeg",
      quality,
    ),
  );
}
