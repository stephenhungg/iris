import { useRef, useState } from "react";
import { useEDL, type Clip } from "../stores/edl";
import { Icon, type IconName } from "./Icon";
import "./library.css";

/**
 * Left sidebar — tabbed header (Media / Audio / Effects / Adjust), body
 * is tab content. Only "Media" is active for now; the other tabs exist to
 * establish the layout (and act as hints for what the studio will grow).
 */
type Tab = "media" | "audio" | "effects" | "adjust";

export function Library({
  onUpload,
  uploading,
}: {
  onUpload: (f: File) => void;
  uploading: boolean;
}) {
  const [tab, setTab] = useState<Tab>("media");

  return (
    <div className="lib">
      <nav className="lib__tabs">
        <TabBtn active={tab === "media"} onClick={() => setTab("media")} icon="media" label="Media" />
        <TabBtn disabled icon="audio" label="Audio" />
        <TabBtn disabled icon="effects" label="Effects" />
        <TabBtn disabled icon="adjust" label="Adjust" />
      </nav>

      <div className="lib__body">
        {tab === "media" && <MediaTab onUpload={onUpload} uploading={uploading} />}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  icon: IconName;
  label: string;
}) {
  return (
    <button
      className={`lib__tab ${active ? "lib__tab--on" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? `${label} — coming soon` : label}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
    </button>
  );
}

function MediaTab({
  onUpload,
  uploading,
}: {
  onUpload: (f: File) => void;
  uploading: boolean;
}) {
  const { state } = useEDL();
  const fileRef = useRef<HTMLInputElement>(null);

  // derive imported source videos from the EDL (unique by url)
  const imports: Clip[] = Array.from(
    new Map<string, Clip>(
      state.clips
        .filter((c: Clip) => c.kind === "source")
        .map((c: Clip): [string, Clip] => [c.url, c]),
    ).values(),
  );

  return (
    <>
      <div className="lib__head">
        <span className="label">Library</span>
        <button
          className="lib__add"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="import media"
        >
          <Icon name="plus" size={13} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      {imports.length === 0 ? (
        <div className="lib__empty">
          <p className="lib__empty-text">
            drop a clip on the viewer or tap <Icon name="plus" size={11} /> to import
          </p>
        </div>
      ) : (
        <ul className="lib__grid">
          {imports.map((c) => (
            <li key={c.url} className="asset">
              <div className="asset__thumb">
                <video
                  src={c.url}
                  muted
                  preload="metadata"
                  className="asset__video"
                />
                <span className="asset__dur mono">
                  {fmtTime(c.sourceEnd - c.sourceStart)}
                </span>
              </div>
              <span className="asset__name" title={c.label ?? ""}>
                {c.label ?? "untitled"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {uploading && <div className="lib__busy mono">importing…</div>}
    </>
  );
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
