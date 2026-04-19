import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { listProjects, type ProjectListItem } from "../api/client";
import {
  hasCompletedOnboarding,
  markOnboardingComplete,
} from "../features/onboarding/storage";
import { useAuth } from "../lib/useAuth";
import "./start.css";

type StartIntent = "new" | "library" | "edit" | null;

function parseIntent(value: string | null): StartIntent {
  if (value === "new" || value === "library" || value === "edit") return value;
  return null;
}

export function StartRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { status, user, signInWithGoogle } = useAuth();
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const intent = parseIntent(searchParams.get("intent"));
  const requestedProjectId = searchParams.get("projectId");
  const authPrompt = searchParams.get("auth") === "1";

  useEffect(() => {
    if (status !== "authed") {
      setItems(null);
      setErr(null);
      return;
    }

    let active = true;
    setErr(null);
    listProjects()
      .then((projects) => {
        if (!active) return;
        setItems(projects);
      })
      .catch((error) => {
        if (!active) return;
        setErr(error instanceof Error ? error.message : String(error));
        setItems([]);
      });

    return () => {
      active = false;
    };
  }, [status]);

  const onboardingComplete = hasCompletedOnboarding(user?.id);
  const isFirstTimeUser =
    status === "authed" &&
    items !== null &&
    items.length === 0 &&
    !err &&
    !onboardingComplete;

  useEffect(() => {
    if (status !== "authed" || items === null || err || isFirstTimeUser) return;
    if (intent === "library") {
      navigate("/projects", { replace: true });
      return;
    }
    if (intent === "edit" && requestedProjectId) {
      navigate(`/editor/${requestedProjectId}`, { replace: true });
      return;
    }
    if (intent === "new") {
      navigate("/editor", { replace: true });
    }
  }, [err, intent, isFirstTimeUser, items, navigate, requestedProjectId, status]);

  const displayName = useMemo(() => {
    return user?.user_metadata?.full_name
      || user?.user_metadata?.name
      || user?.email?.split("@")[0]
      || "editor";
  }, [user]);

  const continueTo = useCallback(
    (path: string) => {
      if (user?.id) markOnboardingComplete(user.id);
      navigate(path);
    },
    [navigate, user?.id],
  );

  if (status === "loading" || (status === "authed" && items === null)) {
    return (
      <div className="start-route">
        <div className="start-route__shell">
          <section className="start-route__state">
            <div className="start-route__state-inner">
              <div className="start-route__eyebrow">preparing flow</div>
              <div className="start-route__state-title">one sec</div>
              <p className="start-route__state-copy">
                lining up your reels, session state, and whatever chaos you left in the editor.
              </p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (status === "anon") {
    return (
      <div className="start-route">
        <div className="start-route__shell">
          <div className="start-route__topbar">
            <button className="start-route__brand" onClick={() => navigate("/")}>
              <span className="start-route__brand-mark" aria-hidden />
              <span>back to landing</span>
            </button>
            <div className="start-route__session">
              {authPrompt ? "sign in required for library + editor" : "sign in to start editing"}
            </div>
          </div>

          <section className="start-route__hero">
            <div className="start-route__panel">
              <div className="start-route__eyebrow">onboarding gate</div>
              <h1 className="start-route__title">
                sign in
                <br />
                then rewrite reality
              </h1>
              <p className="start-route__subtitle">
                iris makes way more sense once we know who you are. sign in, then we’ll
                drop first-time users into a guided setup instead of throwing the entire dashboard
                at their face.
              </p>
              <div className="start-route__actions">
                <button
                  className="start-route__primary"
                  onClick={async () => {
                    setSigningIn(true);
                    try {
                      await signInWithGoogle();
                    } finally {
                      setSigningIn(false);
                    }
                  }}
                >
                  {signingIn ? "opening google…" : "continue with google"}
                </button>
                <button className="start-route__ghost" onClick={() => navigate("/")}>
                  not right now
                </button>
              </div>

              <div className="start-route__metrics">
                <div className="start-route__metric">
                  <div className="start-route__metric-value">1</div>
                  <div className="start-route__metric-label">identity</div>
                </div>
                <div className="start-route__metric">
                  <div className="start-route__metric-value">4</div>
                  <div className="start-route__metric-label">guided steps</div>
                </div>
                <div className="start-route__metric">
                  <div className="start-route__metric-value">1 loop</div>
                  <div className="start-route__metric-label">scrub → prompt → replace</div>
                </div>
              </div>
            </div>

            <aside className="start-route__sidepanel">
              <div className="start-route__side-title">what happens after sign-in</div>
              <p className="start-route__side-copy">
                no massive product tour, no fake complexity. just the shortest path to the magic trick.
              </p>
              <div className="start-route__steps">
                {[
                  ["upload a reel", "bring in footage or reopen an existing edit."],
                  ["pick one moment", "scrub the timeline until the exact frame is on screen."],
                  ["box the subject", "tell iris what object or person the edit should follow."],
                  ["compare, accept, export", "choose the best variant, then propagate or ship it."],
                ].map(([label, copy], index) => (
                  <div key={label} className="start-route__step">
                    <div className="start-route__step-index">{index + 1}</div>
                    <div>
                      <div className="start-route__step-label">{label}</div>
                      <div className="start-route__step-copy">{copy}</div>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </section>
        </div>
      </div>
    );
  }

  if (isFirstTimeUser) {
    return (
      <div className="start-route">
        <div className="start-route__shell">
          <div className="start-route__topbar">
            <button className="start-route__brand" onClick={() => navigate("/")}>
              <span className="start-route__brand-mark" aria-hidden />
              <span>iris start</span>
            </button>
            <div className="start-route__session">first session for {String(displayName).toLowerCase()}</div>
          </div>

          <section className="start-route__hero">
            <div className="start-route__panel">
              <div className="start-route__eyebrow">first-time onboarding</div>
              <h1 className="start-route__title">
                alright,
                <br />
                here&apos;s the flow
              </h1>
              <p className="start-route__subtitle">
                iris is strongest when it behaves like a guided rewrite, not a random pile of panels.
                we’re gonna get you to one clean before/after moment first, then continuity, then export.
              </p>
              <div className="start-route__actions">
                <button className="start-route__primary" onClick={() => continueTo("/editor")}>
                  enter studio
                </button>
                <button className="start-route__ghost" onClick={() => continueTo("/projects")}>
                  open library later
                </button>
              </div>
              <div className="start-route__metrics">
                <div className="start-route__metric">
                  <div className="start-route__metric-value">hero</div>
                  <div className="start-route__metric-label">land one insane before/after</div>
                </div>
                <div className="start-route__metric">
                  <div className="start-route__metric-value">continuity</div>
                  <div className="start-route__metric-label">propagate the same world change</div>
                </div>
                <div className="start-route__metric">
                  <div className="start-route__metric-value">export</div>
                  <div className="start-route__metric-label">render the cut when it feels real</div>
                </div>
              </div>
            </div>

            <aside className="start-route__sidepanel">
              <div className="start-route__side-title">what to do in the editor</div>
              <div className="start-route__checklist">
                {[
                  ["load one source clip", "don’t start with a whole library full of junk. get one reel in."],
                  ["scrub until the important frame is visible", "the box should be drawn on the exact moment you care about."],
                  ["write the prompt as a fact change", "not “make it cooler”, more like “turn the silver sedan into deep cherry red.”"],
                  ["accept one variant and watch for continuity", "once the change lands, iris can search the rest of the reel for the same entity."],
                ].map(([label, copy]) => (
                  <div key={label} className="start-route__check">
                    <div className="start-route__check-icon">✓</div>
                    <div>
                      <div className="start-route__check-label">{label}</div>
                      <div className="start-route__check-copy">{copy}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="start-route__step-cta" onClick={() => continueTo("/editor")}>
                start with the core loop
              </button>
            </aside>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="start-route">
      <div className="start-route__shell">
        <div className="start-route__topbar">
          <button className="start-route__brand" onClick={() => navigate("/")}>
            <span className="start-route__brand-mark" aria-hidden />
            <span>iris start</span>
          </button>
          <div className="start-route__session">
            {String(displayName).toLowerCase()} · {items?.length ?? 0} reel{items?.length === 1 ? "" : "s"}
          </div>
        </div>

        <section className="start-route__hero">
          <div className="start-route__panel">
            <div className="start-route__eyebrow">start hub</div>
            <h1 className="start-route__title">
              choose the
              <br />
              next move
            </h1>
            <p className="start-route__subtitle">
              one place to start from, then a straight shot into the part of iris you actually meant to use.
              no more bouncing between landing, library, and editor with zero context.
            </p>
            <div className="start-route__tiles">
              <button className="start-route__tile" onClick={() => navigate("/editor")}>
                <div className="start-route__tile-title">new edit</div>
                <div className="start-route__tile-copy">
                  jump into the studio with a clean slate and build a new before/after moment.
                </div>
                <div className="start-route__tile-meta">upload → prompt → compare → replace</div>
              </button>
              <button className="start-route__tile" onClick={() => navigate("/projects")}>
                <div className="start-route__tile-title">open library</div>
                <div className="start-route__tile-copy">
                  reopen an existing reel, continue a continuity pass, or export something that’s close.
                </div>
                <div className="start-route__tile-meta">library → reopen → polish → export</div>
              </button>
            </div>
            {err && <p className="start-route__footnote">library status: {err}</p>}
          </div>

          <aside className="start-route__sidepanel">
            <div className="start-route__side-title">best-practice version of this flow</div>
            <p className="start-route__side-copy">
              tight onboarding works when it focuses on one outcome, uses progressive disclosure,
              and keeps the next action inside the product instead of hiding it in docs.
            </p>
            <div className="start-route__steps">
              {[
                ["one obvious entry point", "landing always routes here first, so users don’t have to guess where work starts."],
                ["auth before complexity", "library and editor are gated, so identity is settled before project state matters."],
                ["first-time orientation", "new users get a brief setup narrative instead of a blank dashboard."],
                ["context in the editor", "the studio now carries a live checklist so the ui teaches the loop while you work."],
              ].map(([label, copy], index) => (
                <div key={label} className="start-route__step">
                  <div className="start-route__step-index">{index + 1}</div>
                  <div>
                    <div className="start-route__step-label">{label}</div>
                    <div className="start-route__step-copy">{copy}</div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
