import { useState, type ChangeEvent } from "react";

// Phones don't offer a folder picker, so only show the button where one exists.
function canChooseFolder(): boolean {
  return (
    "webkitdirectory" in HTMLInputElement.prototype &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches
  );
}
import { Link } from "react-router";
import type { Piece } from "../lib/pieces";
import { PIECE_TYPES, singularLabel, type PieceType } from "../lib/pieceTypes";
import { useWardrobe, type QueueState } from "../lib/wardrobe";

function waitingCount(pieces: Piece[]) {
  return pieces.filter((p) => p.label_status === "waiting" && !p.reviewed).length;
}

function photos(count: number) {
  return count === 1 ? "1 photo" : `${count} photos`;
}

function pieceState(piece: Piece): string {
  if (piece.reviewed) return singularLabel(piece.type);
  if (piece.label_status === "waiting") return "Waiting to be read";
  if (piece.label_status === "failed") return "Fill this in";
  return "Check this";
}

function QueueNote({ queue, waiting, onRetry }: { queue: QueueState; waiting: number; onRetry: () => void }) {
  if (waiting === 0) return null;

  if (queue.state === "paused" && queue.reason === "allowance") {
    return (
      <div className="note" role="status">
        <p>
          The free AI allowance has run out for now. {photos(waiting)} will be read the next time you open the app
          after it resets.
        </p>
        <button type="button" className="text-button is-strong" onClick={onRetry}>
          Try now
        </button>
      </div>
    );
  }
  if (queue.state === "paused" && queue.reason === "unavailable") {
    return (
      <p className="note" role="status">
        AI reading isn't connected yet. Your photos are saved and will be read once it is.
      </p>
    );
  }
  if (queue.state === "paused") {
    return (
      <div className="note" role="status">
        <p>{queue.message}</p>
        <button type="button" className="text-button is-strong" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <p className="note" role="status">
      Reading {photos(waiting)} with AI…
    </p>
  );
}

export function WardrobeScreen() {
  const wardrobe = useWardrobe();
  const [filter, setFilter] = useState<PieceType | "all">("all");
  const [folderPicker] = useState(canChooseFolder);
  const { pieces } = wardrobe;

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void wardrobe.addPhotos(files);
  }

  const counts = new Map<PieceType, number>();
  for (const piece of pieces ?? []) counts.set(piece.type, (counts.get(piece.type) ?? 0) + 1);
  const shown = (pieces ?? []).filter((piece) => filter === "all" || piece.type === filter);
  const busy = wardrobe.adding !== null || wardrobe.unpacking;

  return (
    <>
      <h1 className="screen-title">Wardrobe</h1>
      <p className="screen-subtitle">
        {pieces === null ? "Loading…" : pieces.length === 1 ? "1 piece" : `${pieces.length} pieces`}
      </p>

      <div className="add-row">
        <label className={busy ? "action-button is-disabled" : "action-button"}>
          <input
            className="file-input"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={handleFiles}
          />
          Take a photo
        </label>
        <label className={busy ? "action-button is-quiet is-disabled" : "action-button is-quiet"}>
          <input
            className="file-input"
            type="file"
            accept="image/*,.zip,application/zip"
            multiple
            disabled={busy}
            onChange={handleFiles}
          />
          Choose photos
        </label>
        {folderPicker && (
          <label className={busy ? "action-button is-quiet is-disabled" : "action-button is-quiet"}>
            <input
              className="file-input"
              type="file"
              multiple
              disabled={busy}
              onChange={handleFiles}
              ref={(input) => {
                if (input) input.webkitdirectory = true;
              }}
            />
            Choose a folder
          </label>
        )}
      </div>
      <p className="hint">
        Lay each piece flat or hang it against a plain wall, in good light. Keep faces and anything personal out of
        the shot.
      </p>
      <p className="hint">
        {folderPicker
          ? "You can pick several photos at once, a .zip of photos, or a whole folder."
          : "You can pick several photos at once, or a .zip of photos."}
      </p>

      {wardrobe.unpacking && (
        <p className="note" role="status">
          Opening your files…
        </p>
      )}

      {wardrobe.adding && (
        <p className="note" role="status">
          Preparing photo {wardrobe.adding.done + 1} of {wardrobe.adding.total}…
        </p>
      )}

      {wardrobe.addErrors.length > 0 && (
        <div className="note is-alert" role="alert">
          <p>{wardrobe.addErrors.length === 1 ? "One thing wasn't added." : "Some things weren't added."}</p>
          <ul>
            {wardrobe.addErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <button type="button" className="text-button" onClick={wardrobe.clearAddErrors}>
            Dismiss
          </button>
        </div>
      )}

      {pieces && <QueueNote queue={wardrobe.queue} waiting={waitingCount(pieces)} onRetry={wardrobe.resumeReading} />}

      {wardrobe.loadError && (
        <div className="note is-alert" role="alert">
          <p>{wardrobe.loadError}</p>
          <button type="button" className="text-button is-strong" onClick={wardrobe.reload}>
            Try again
          </button>
        </div>
      )}

      {pieces && pieces.length === 0 && !busy && wardrobe.addErrors.length === 0 && (
        <p className="placeholder-body">Your wardrobe is empty. Add your first piece with a photo.</p>
      )}

      {pieces && pieces.length > 0 && (
        <>
          <div className="filters" role="group" aria-label="Show">
            <button type="button" className="filter" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All <span className="filter-count">{pieces.length}</span>
            </button>
            {PIECE_TYPES.filter((type) => counts.has(type.id)).map((type) => (
              <button
                key={type.id}
                type="button"
                className="filter"
                aria-pressed={filter === type.id}
                onClick={() => setFilter(type.id)}
              >
                {type.label} <span className="filter-count">{counts.get(type.id)}</span>
              </button>
            ))}
          </div>

          <ul className="pieces">
            {shown.map((piece) => (
              <li key={piece.id}>
                <Link to={`/wardrobe/${piece.id}`} className="piece">
                  <span className="piece-photo">
                    {wardrobe.links[piece.photo_path] && <img src={wardrobe.links[piece.photo_path]} alt="" loading="lazy" />}
                  </span>
                  <span className="piece-name">{piece.name || "Not read yet"}</span>
                  <span className={piece.reviewed ? "piece-state" : "piece-state is-pending"}>{pieceState(piece)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
