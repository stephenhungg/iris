import { useState } from "react";
import { Landing } from "./pages/Landing";
import { Studio } from "./pages/Studio";

type View = "landing" | "studio";

export function App() {
  const [view, setView] = useState<View>("landing");

  return view === "landing" ? (
    <Landing onEnter={() => setView("studio")} />
  ) : (
    <Studio onExit={() => setView("landing")} />
  );
}
