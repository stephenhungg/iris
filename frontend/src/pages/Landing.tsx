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
            Draw a box around anything. Say what changes.
            Iris finds every other frame it appears in and keeps the story consistent.
          </p>

          <div className="landing__actions reveal" data-d="6">
            <button className="cta" onClick={onEnter}>
              Open the editor
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
            name="Select"
            body="Scrub the timeline. Pick a 4-second window. Draw a rectangle around the thing you want to change."
          />
          <Spec
            num="02"
            name="Prompt"
            body="Describe the edit in a sentence. Gemini structures it into three distinct variants — tone, grade, emphasis."
          />
          <Spec
            num="03"
            name="Propagate"
            body="Accept one. Iris tracks that entity across the rest of the video and offers a continuity pack, frame-matched."
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
