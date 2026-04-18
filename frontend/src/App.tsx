import { useState } from "react";
import { Landing } from "./pages/Landing";
import { Editor } from "./pages/Editor";

type View = "landing" | "editor";

export function App() {
  const [view, setView] = useState<View>("landing");

  return view === "landing" ? (
    <Landing onEnter={() => setView("editor")} />
  ) : (
    <Editor onExit={() => setView("landing")} />
  );
}
