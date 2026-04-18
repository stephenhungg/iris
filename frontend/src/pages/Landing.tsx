import { Aperture } from "../components/Aperture";
import "./landing.css";

export function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <main className="landing">
      {/* top bar: serial number / slate ticker / version */}
      <header className="landing__bar">
        <span className="label reveal" data-d="1">iris / v0.1 — reel 001</span>
        <span className="label reveal" data-d="1">
          2026 · four-eighteen · 14:32
        </span>
      </header>

      <section className="landing__hero">
        <div className="landing__aperture reveal" data-d="2">
          <Aperture size={520} />
          <span className="landing__fstop mono reveal" data-d="5">f / 1.4</span>
        </div>

        <div className="landing__copy">
          <p className="label reveal" data-d="1">
            prompt-driven · causal editing
          </p>

          <h1 className="display landing__title">
            <span className="reveal" data-d="2">rewrite</span>{" "}
            <span className="reveal landing__title--accent" data-d="3">
              reality,
            </span>
            <br />
            <span className="reveal" data-d="4">piece by piece.</span>
          </h1>

          <p className="landing__dek reveal" data-d="5">
            A video studio with an AI prompt on the side. Cut, split, trim, level —
            then describe a single edit and Iris rewrites that clip in place.
          </p>

          <div className="landing__actions reveal" data-d="6">
            <button className="cta" onClick={onEnter}>
              Open the studio
            </button>
            <a
              className="cta ghost"
              href="https://github.com/stephenhungg/iris"
              target="_blank"
              rel="noreferrer"
            >
              Source
            </a>
          </div>
        </div>
      </section>

      {/* spec sheet — three-column tech readout */}
      <section className="landing__spec">
        <hr className="rule" />
        <div className="landing__spec-grid">
          <Spec
            num="01"
            name="Assemble"
            body="Drop footage onto the reel. Scrub, split, trim, rearrange. Every edit is non-destructive — the source stays untouched."
          />
          <Spec
            num="02"
            name="Prompt"
            body="Select any clip. Write a sentence. Veo 3.1 generates one replacement, inheriting the clip's duration and place in the cut."
          />
          <Spec
            num="03"
            name="Export"
            body="Flatten the reel when it's done. Stitched at native framerate with crossfade handoffs — no AI slop seams."
          />
        </div>
        <hr className="rule" />
      </section>

      <footer className="landing__foot">
        <span className="label">
          shot on veo 3.1 · directed by gemini · voiced by elevenlabs
        </span>
        <span className="label">iris.tech</span>
      </footer>
    </main>
  );
}

function Spec({ num, name, body }: { num: string; name: string; body: string }) {
  return (
    <article className="spec">
      <header className="spec__head">
        <span className="spec__num mono">{num}</span>
        <h3 className="spec__name">{name}</h3>
      </header>
      <p className="spec__body">{body}</p>
    </article>
  );
}
