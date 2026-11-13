// Phones don't offer a folder picker, so only show the button where one exists.
export function canChooseFolder(): boolean {
  return (
    "webkitdirectory" in HTMLInputElement.prototype &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches
  );
}
