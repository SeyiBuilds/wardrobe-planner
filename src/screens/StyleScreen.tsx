import { useState, type ChangeEvent } from "react";
import { canChooseFolder } from "../lib/folderPicker";
import type { Inspiration } from "../lib/inspirations";
import { familyHex, paletteHex } from "../lib/palette";
import { OCCASIONS, type Occasion } from "../lib/pieceTypes";
import { useStyle } from "../lib/style";
import { describeStyle, type DayStyle } from "../lib/styleProfile";

const KIND_NOUNS: Record<string, string> = {
  top: "top",
  trousers: "trousers",
  suit: "suit",
  native_set: "native set",
  jacket: "jacket",
  shoes: "shoes",
  watch: "watch",
  belt: "belt",
  accessory: "accessory",
};

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function pictures(count: number) {
  return count === 1 ? "1 picture" : `${count} pictures`;
}

// "White top · Navy trousers · Brown shoes"
function readingInWords(item: Inspiration): string {
  return item.pieces.map((piece) => `${capitalise(piece.colour)} ${KIND_NOUNS[piece.kind] ?? piece.kind}`).join(" · ");
}

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <svg className="swatch" viewBox="0 0 10 10" role="img" aria-label={label}>
      <rect width="10" height="10" fill={hex} />
    </svg>
  );
}

function StyleCard({ title, style }: { title: string; style: DayStyle }) {
  const words = describeStyle(style);
  return (
    <section className="style-card" aria-label={`${title} style`}>
      <h3 className="style-card-title">
        {title} <span className="style-card-count">· {pictures(style.count)}</span>
      </h3>
      {words.pairs.length > 0 && <p>{words.pairs.join(", ")}</p>}
      <ul className="swatch-row" aria-label="Favourite colours">
        {words.colours.map((colour) => (
          <li key={colour}>
            <Swatch hex={familyHex(colour.toLowerCase())} label={colour} />
          </li>
        ))}
      </ul>
      <p className="hint">{[words.contrast, words.bold, words.patterns, words.formality].filter(Boolean).join(" · ")}</p>
    </section>
  );
}

function QueueNote() {
  const style = useStyle();
  const waiting = (style.inspirations ?? []).filter((item) => item.status === "waiting").length;
  if (waiting === 0) return null;
  const { queue } = style;

  if (queue.state === "paused" && queue.reason === "allowance") {
    return (
      <div className="note" role="status">
        <p>
          The free AI allowance has run out for now. {pictures(waiting)} will be read the next time you open the app after
          it resets.
        </p>
        <button type="button" className="text-button is-strong" onClick={style.resumeReading}>
          Try now
        </button>
      </div>
    );
  }
  if (queue.state === "paused" && queue.reason === "unavailable") {
    return (
      <p className="note" role="status">
        AI reading isn't connected yet. Your pictures are waiting and will be read once it is.
      </p>
    );
  }
  if (queue.state === "paused") {
    return (
      <div className="note" role="status">
        <p>{queue.message}</p>
        <button type="button" className="text-button is-strong" onClick={style.resumeReading}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <p className="note" role="status">
      Reading {pictures(waiting)} with AI…
    </p>
  );
}

const SETTINGS = [
  {
    key: "tonal",
    label: "Tonal looks",
    options: [
      ["always", "Always allow"],
      ["never", "Never"],
    ],
  },
  {
    key: "bold",
    label: "Bold colours",
    options: [
      ["less", "Use less"],
      ["more", "Use more"],
    ],
  },
  {
    key: "patterns",
    label: "Patterns",
    options: [
      ["less", "Use less"],
      ["more", "Use more"],
    ],
  },
] as const;

export function StyleScreen() {
  const style = useStyle();
  const [folderPicker] = useState(canChooseFolder);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void style.addPictures(files);
  }

  function handleRemove(item: Inspiration) {
    const question =
      item.status === "done"
        ? "Remove this reading? The picture is already deleted, so it can't be read again."
        : "Remove this picture?";
    if (window.confirm(question)) void style.remove(item);
  }

  const items = style.inspirations ?? [];
  const read = items.filter((item) => item.status === "done");
  const busy = style.adding !== null || style.unpacking;
  const kinds = OCCASIONS.filter((occasion) => style.profile.byDay[occasion.id].count > 0);

  return (
    <>
      <h1 className="screen-title">Style</h1>
      <p className="screen-subtitle">{style.inspirations === null ? "Loading…" : `${pictures(read.length)} read`}</p>

      <div className="add-row">
        <label className={busy ? "action-button is-disabled" : "action-button"}>
          <input
            className="file-input"
            type="file"
            accept="image/*,.zip,application/zip"
            multiple
            disabled={busy}
            onChange={handleFiles}
          />
          Choose pictures
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
        Pick screenshots of outfits you like. Faces are blurred on your phone, and each picture is deleted once it's been
        read. Only what was learned is kept.
      </p>
      <p className="hint">Crop to the outfit if you can. The AI ignores text, but busy screenshots read less well.</p>

      {style.unpacking && (
        <p className="note" role="status">
          Opening your files…
        </p>
      )}
      {style.adding && (
        <p className="note" role="status">
          Preparing picture {style.adding.done + 1} of {style.adding.total}…
        </p>
      )}
      {style.addErrors.length > 0 && (
        <div className="note is-alert" role="alert">
          <ul>
            {style.addErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <button type="button" className="text-button" onClick={style.clearAddErrors}>
            Dismiss
          </button>
        </div>
      )}
      <QueueNote />
      {style.loadError && (
        <div className="note is-alert" role="alert">
          <p>{style.loadError}</p>
          <button type="button" className="text-button is-strong" onClick={style.reload}>
            Try again
          </button>
        </div>
      )}

      <h2 className="section-title style-heading">Your style</h2>
      {read.length === 0 ? (
        <p className="placeholder-body">
          Add a few pictures and your style shows up here. Around 10 for each kind of day gives the planner a clear
          picture.
        </p>
      ) : (
        <div className="style-cards">
          {kinds.map((occasion) => (
            <StyleCard key={occasion.id} title={occasion.label} style={style.profile.byDay[occasion.id]} />
          ))}
        </div>
      )}

      {read.length > 0 && (
        <>
          <h2 className="section-title style-heading">How the planner uses it</h2>
          <p className="hint">These follow your pictures unless you choose otherwise.</p>
          <div className="piece-form">
            {SETTINGS.map((setting) => (
              <label key={setting.key} className="form-field">
                <span className="form-label">{setting.label}</span>
                <select
                  value={style.overrides[setting.key] ?? "pictures"}
                  disabled={style.working}
                  onChange={(event) =>
                    void style.saveOverrides({
                      [setting.key]: event.target.value === "pictures" ? undefined : event.target.value,
                    })
                  }
                >
                  <option value="pictures">As my pictures show</option>
                  {setting.options.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </>
      )}

      {items.length > 0 && (
        <>
          <h2 className="section-title style-heading">Your pictures</h2>
          <ul className="reading-list">
            {items.map((item) => {
              const words = item.status === "done" ? readingInWords(item) : "";
              return (
                <li key={item.id} className="reading" aria-label={words || "Picture"}>
                  {item.status === "done" ? (
                    <>
                      <ul className="swatch-row" aria-hidden="true">
                        {item.pieces.map((piece, index) => (
                          <li key={index}>
                            <Swatch hex={paletteHex(piece.colour)} label={piece.colour} />
                          </li>
                        ))}
                      </ul>
                      <p className="reading-text">{words}</p>
                      <label className="form-field">
                        <span className="form-label">Kind of day</span>
                        <select
                          value={item.day_type ?? "casual"}
                          disabled={style.working}
                          onChange={(event) => void style.setDayType(item.id, event.target.value as Occasion)}
                        >
                          {OCCASIONS.map((occasion) => (
                            <option key={occasion.id} value={occasion.id}>
                              {occasion.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : item.status === "waiting" ? (
                    <p className="reading-text is-pending">Waiting to be read</p>
                  ) : (
                    <>
                      <p className="reading-text is-pending">
                        The AI couldn't find an outfit in this picture. Try again, or remove it.
                      </p>
                      <button
                        type="button"
                        className="text-button is-strong"
                        disabled={style.working}
                        onClick={() => void style.readAgain(item.id)}
                      >
                        Try again
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="text-button is-danger"
                    disabled={style.working}
                    onClick={() => handleRemove(item)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
