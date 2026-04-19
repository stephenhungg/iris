/**
 * Agent — conversation state for the AI chat panel.
 *
 * Mirrors the Context + useReducer pattern from edl.tsx. The agent
 * maintains a linear message list (user turns, streamed agent replies,
 * tool calls, suggestions, errors) plus an optional VideoAnalysis
 * snapshot that the backend produces after ingesting a video.
 */
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

// ─── types ────────────────────────────────────────────────────────────

export interface SuggestedEdit {
  start_ts: number;
  end_ts: number;
  bbox_hint?: { x: number; y: number; w: number; h: number };
  suggestion: string;
  rationale?: string;
}

export interface VideoAnalysis {
  project_id: string;
  duration: number;
  overall_description: string;
  scenes: Array<{ start_ts: number; end_ts: number; description: string }>;
  entities: Array<{
    name: string;
    category: string;
    appearances: Array<{
      start_ts: number;
      end_ts: number;
      bbox_hint?: object;
    }>;
  }>;
  mood_arc: Array<{ ts: number; mood: string }>;
  suggested_edits: SuggestedEdit[];
}

export interface VariantPreview {
  id: string;
  index: number;
  url: string | null;
  description: string | null;
  visual_coherence: number | null;
  prompt_adherence: number | null;
}

export type AgentMessage =
  | { type: "user"; text: string; ts: number }
  | { type: "agent"; text: string; ts: number; streaming?: boolean }
  | {
      type: "tool_call";
      id: string;
      tool: string;
      args: unknown;
      status: "pending" | "running" | "done" | "error";
      result?: unknown;
      ts: number;
    }
  | { type: "analysis"; progress: number; total: number; ts: number }
  | {
      type: "variant_preview";
      jobId: string;
      variants: VariantPreview[];
      ts: number;
    }
  | { type: "suggestion"; edit: SuggestedEdit; accepted?: boolean; ts: number }
  | { type: "error"; message: string; ts: number };

export interface AgentState {
  messages: AgentMessage[];
  conversationId: string;
  streaming: boolean;
  analysis: VideoAnalysis | null;
}

// ─── actions ──────────────────────────────────────────────────────────

export type AgentAction =
  | { type: "add_user_message"; text: string }
  | { type: "start_stream" }
  | { type: "append_token"; text: string }
  | { type: "end_stream" }
  | { type: "tool_call_start"; id: string; tool: string; args: unknown }
  | { type: "tool_call_progress"; id: string; progress: string }
  | {
      type: "tool_call_end";
      id: string;
      result: unknown;
      status: "done" | "error";
    }
  | { type: "add_suggestion"; edit: SuggestedEdit }
  | { type: "accept_suggestion"; ts: number }
  | { type: "dismiss_suggestion"; ts: number }
  | {
      type: "add_variant_preview";
      jobId: string;
      variants: VariantPreview[];
    }
  | { type: "set_analysis"; analysis: VideoAnalysis }
  | { type: "add_error"; message: string }
  | { type: "clear_messages" }
  | { type: "set_conversation_id"; id: string }
  | { type: "hydrate_messages"; messages: AgentMessage[] };

// ─── reducer ──────────────────────────────────────────────────────────

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  const now = Date.now();

  switch (action.type) {
    case "add_user_message":
      return {
        ...state,
        messages: [
          ...state.messages,
          { type: "user", text: action.text, ts: now },
        ],
      };

    case "start_stream":
      return {
        ...state,
        streaming: true,
        messages: [
          ...state.messages,
          { type: "agent", text: "", ts: now, streaming: true },
        ],
      };

    case "append_token": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.type === "agent" && last.streaming) {
        msgs[msgs.length - 1] = { ...last, text: last.text + action.text };
      }
      return { ...state, messages: msgs };
    }

    case "end_stream": {
      const msgs = state.messages.map((m) =>
        m.type === "agent" && m.streaming ? { ...m, streaming: false } : m,
      );
      // Remove empty agent messages that never received tokens
      const filtered = msgs.filter(
        (m) => !(m.type === "agent" && m.text === ""),
      );
      return { ...state, streaming: false, messages: filtered };
    }

    case "tool_call_start":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            type: "tool_call",
            id: action.id,
            tool: action.tool,
            args: action.args,
            status: "running",
            ts: now,
          },
        ],
      };

    case "tool_call_progress": {
      // Progress updates are informational — no state mutation needed yet.
      return state;
    }

    case "tool_call_end": {
      const msgs = state.messages.map((m) =>
        m.type === "tool_call" && m.id === action.id
          ? { ...m, status: action.status, result: action.result }
          : m,
      );
      return { ...state, messages: msgs };
    }

    case "add_suggestion":
      return {
        ...state,
        messages: [
          ...state.messages,
          { type: "suggestion", edit: action.edit, ts: now },
        ],
      };

    case "accept_suggestion": {
      const msgs = state.messages.map((m) =>
        m.type === "suggestion" && m.ts === action.ts
          ? { ...m, accepted: true }
          : m,
      );
      return { ...state, messages: msgs };
    }

    case "dismiss_suggestion": {
      const msgs = state.messages.map((m) =>
        m.type === "suggestion" && m.ts === action.ts
          ? { ...m, accepted: false }
          : m,
      );
      return { ...state, messages: msgs };
    }

    case "add_variant_preview":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            type: "variant_preview",
            jobId: action.jobId,
            variants: action.variants,
            ts: now,
          },
        ],
      };

    case "set_analysis":
      return { ...state, analysis: action.analysis };

    case "add_error":
      return {
        ...state,
        streaming: false,
        messages: [
          ...state.messages,
          { type: "error", message: action.message, ts: now },
        ],
      };

    case "clear_messages":
      return { ...state, messages: [], analysis: null };

    case "set_conversation_id":
      return { ...state, conversationId: action.id };

    case "hydrate_messages":
      return { ...state, messages: action.messages };

    default:
      return state;
  }
}

// ─── context ──────────────────────────────────────────────────────────

const initialState: AgentState = {
  messages: [],
  conversationId: crypto.randomUUID(),
  streaming: false,
  analysis: null,
};

const AgentCtx = createContext<{
  state: AgentState;
  dispatch: Dispatch<AgentAction>;
} | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AgentCtx.Provider value={value}>{children}</AgentCtx.Provider>;
}

export function useAgent() {
  const ctx = useContext(AgentCtx);
  if (!ctx) throw new Error("useAgent must be inside AgentProvider");
  return ctx;
}
