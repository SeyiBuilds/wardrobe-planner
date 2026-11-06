import { unzipSync } from "fflate";

export type Expanded = { photos: File[]; skipped: string[] };

const PHOTO_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

// A zip is read into memory in one go, so keep it to a size a phone can hold.
export const MAX_ZIP_BYTES = 250 * 1024 * 1024;
export const MAX_UNZIPPED_BYTES = 400 * 1024 * 1024;
export const MAX_PHOTOS = 500;

function extension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

// Hidden files and the extra folders that Macs and Windows add to zips aren't photos.
function isJunk(path: string): boolean {
  return path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX") || /thumbs\.db$/i.test(path);
}

export function isZip(file: File): boolean {
  return extension(file.name) === "zip" || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

function isPhoto(file: File): boolean {
  return file.type.startsWith("image/") || extension(file.name) in PHOTO_TYPES;
}

// Turns whatever was picked (photos, zips of photos, or a whole folder) into a flat list of photos,
// noting anything left out and why.
export async function expandFiles(files: File[]): Promise<Expanded> {
  const photos: File[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (isJunk(path)) continue;

    if (isZip(file)) {
      const result = await unpackZip(file);
      photos.push(...result.photos);
      skipped.push(...result.skipped);
    } else if (isPhoto(file)) {
      photos.push(file);
    } else {
      skipped.push(`${file.name}: not a photo, so it was skipped.`);
    }
  }

  if (photos.length > MAX_PHOTOS) {
    skipped.push(
      `Only the first ${MAX_PHOTOS} photos were added this time. Add the other ${photos.length - MAX_PHOTOS} in another go.`,
    );
    photos.length = MAX_PHOTOS;
  }

  return { photos, skipped };
}

async function unpackZip(zip: File): Promise<Expanded> {
  if (zip.size > MAX_ZIP_BYTES) {
    return { photos: [], skipped: [`${zip.name}: too big to open on a phone. Split it into smaller zips.`] };
  }

  const skipped: string[] = [];
  let unzippedBytes = 0;
  let tooBig = false;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await zip.arrayBuffer()), {
      filter: (entry) => {
        if (entry.name.endsWith("/") || isJunk(entry.name)) return false;
        if (!(extension(entry.name) in PHOTO_TYPES)) {
          skipped.push(`${zip.name} › ${baseName(entry.name)}: not a photo, so it was skipped.`);
          return false;
        }
        // Checked before anything is unpacked, so a zip that expands hugely can't freeze the phone.
        unzippedBytes += entry.originalSize;
        if (unzippedBytes > MAX_UNZIPPED_BYTES) {
          tooBig = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    return { photos: [], skipped: [`${zip.name}: couldn't be opened. It may be damaged or not really a zip.`] };
  }

  if (tooBig) {
    skipped.push(`${zip.name}: holds more than a phone can unpack at once, so only part of it was added. Split it into smaller zips.`);
  }

  const photos = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    // fflate's output is always backed by a plain ArrayBuffer.
    .map(([path, bytes]) => new File([bytes as Uint8Array<ArrayBuffer>], baseName(path), { type: PHOTO_TYPES[extension(path)] }));

  return { photos, skipped };
}
