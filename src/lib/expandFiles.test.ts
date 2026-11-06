import { strToU8, zipSync, type Zippable } from "fflate";
import { expandFiles, MAX_PHOTOS } from "./expandFiles";

function zip(name: string, contents: Zippable): File {
  return new File([zipSync(contents)], name, { type: "application/zip" });
}

function photo(name: string, type = "image/jpeg", path?: string): File {
  const file = new File(["x"], name, { type });
  if (path) Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

const pixels = strToU8("pretend photo");

describe("expandFiles", () => {
  it("passes photos straight through", async () => {
    const shirt = photo("shirt.jpg");

    expect(await expandFiles([shirt])).toEqual({ photos: [shirt], skipped: [] });
  });

  it("unpacks the photos in a zip, in name order, including subfolders", async () => {
    const { photos, skipped } = await expandFiles([
      zip("wardrobe.zip", {
        "tops/b-shirt.jpg": pixels,
        "tops/a-tee.PNG": pixels,
        "shoes/loafers.jpeg": pixels,
      }),
    ]);

    expect(photos.map((file) => [file.name, file.type])).toEqual([
      ["loafers.jpeg", "image/jpeg"],
      ["a-tee.PNG", "image/png"],
      ["b-shirt.jpg", "image/jpeg"],
    ]);
    expect(skipped).toEqual([]);
  });

  it("notes files in a zip that aren't photos", async () => {
    const { photos, skipped } = await expandFiles([
      zip("mixed.zip", { "shirt.jpg": pixels, "notes.txt": strToU8("hi") }),
    ]);

    expect(photos).toHaveLength(1);
    expect(skipped).toEqual(["mixed.zip › notes.txt: not a photo, so it was skipped."]);
  });

  it("quietly ignores the extra files Macs and Windows add", async () => {
    const { photos, skipped } = await expandFiles([
      zip("from-mac.zip", {
        "shirt.jpg": pixels,
        "__MACOSX/._shirt.jpg": pixels,
        ".DS_Store": pixels,
        "Thumbs.db": pixels,
      }),
    ]);

    expect(photos.map((file) => file.name)).toEqual(["shirt.jpg"]);
    expect(skipped).toEqual([]);
  });

  it("handles a chosen folder, keeping the photos and noting the rest", async () => {
    const { photos, skipped } = await expandFiles([
      photo("shirt.jpg", "image/jpeg", "Clothes/shirt.jpg"),
      photo("IMG_2041.HEIC", "", "Clothes/IMG_2041.HEIC"),
      photo("list.pdf", "application/pdf", "Clothes/list.pdf"),
      photo(".hidden.jpg", "image/jpeg", "Clothes/.hidden.jpg"),
    ]);

    expect(photos.map((file) => file.name)).toEqual(["shirt.jpg", "IMG_2041.HEIC"]);
    expect(skipped).toEqual(["list.pdf: not a photo, so it was skipped."]);
  });

  it("mixes zips and loose photos", async () => {
    const { photos } = await expandFiles([photo("watch.jpg"), zip("more.zip", { "belt.jpg": pixels })]);

    expect(photos.map((file) => file.name)).toEqual(["watch.jpg", "belt.jpg"]);
  });

  it("explains a zip that can't be opened", async () => {
    const broken = new File(["not really a zip"], "broken.zip", { type: "application/zip" });

    expect(await expandFiles([broken])).toEqual({
      photos: [],
      skipped: ["broken.zip: couldn't be opened. It may be damaged or not really a zip."],
    });
  });

  it("refuses a zip too big for a phone without reading it", async () => {
    const huge = new File(["x"], "huge.zip", { type: "application/zip" });
    Object.defineProperty(huge, "size", { value: 300 * 1024 * 1024 });

    const { photos, skipped } = await expandFiles([huge]);

    expect(photos).toEqual([]);
    expect(skipped[0]).toMatch(/too big/);
  });

  it(`adds at most ${MAX_PHOTOS} photos in one go`, async () => {
    const many = Array.from({ length: MAX_PHOTOS + 3 }, (_, i) => photo(`p${i}.jpg`));

    const { photos, skipped } = await expandFiles(many);

    expect(photos).toHaveLength(MAX_PHOTOS);
    expect(skipped).toEqual([`Only the first ${MAX_PHOTOS} photos were added this time. Add the other 3 in another go.`]);
  });
});
