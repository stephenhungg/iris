/**
 * useAgentStream — SSE streaming hook for the agent chat endpoint.
 *
 * Connects to POST /api/agent/chat and dispatches parsed SSE events
 * into the AgentProvider reducer. Handles abort/cleanup, auth headers
 * (same pattern as api/client.ts), and incremental token streaming.
 */
import { useCallback, useEffect, useRef } from "react";

import {
  createConversation,
  getConversationMessages,
  getSessionId,
  listConversations,
  type ChatMessageResp,
} from "../api/client";
import { supabase } from "../lib/supabase";
import {
  useAgent,
  type AgentAction,
  type AgentMessage,
  type SuggestedEdit,
  type VariantPreview,
} from "../stores/agent";

// ─── types ────────────────────────────────────────────────────────────

interface SendMessageOptions {
  projectId: string;
  message: string;
}

// ─── hook ─────────────────────────────────────────────────────────────

export function useAgentStream(projectId?: string | null) {
  const { state, dispatch } = useAgent();
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef<string | null>(null);

  // hydrate the most recent conversation for this project on mount
  useEffect(() => {
    if (!projectId || loadedRef.current === projectId) return;
    loadedRef.current = projectId;

    (async () => {
      try {
        const convos = await listConversations(projectId);
        if (convos.length === 0) {
          // create a fresh conversation
          const convo = await createConversation(projectId);
          dispatch({ type: "set_conversation_id", id: convo.id });
          return;
        }

        // load the most recent conversation
        const latest = convos[0];
        dispatch({ type: "set_conversation_id", id: latest.id });

        if (latest.message_count > 0) {
          const msgs = await getConversationMessages(latest.id);
          const hydrated = msgs.map(dbMessageToAgentMessage).filter(Boolean) as AgentMessage[];
          dispatch({ type: "hydrate_messages", messages: hydrated });
        }
      } catch (err) {
        // non-fatal — just start fresh
        console.warn("[agent] failed to load conversation:", err);
      }
    })();
  }, [projectId, dispatch]);

  const sendMessage = useCallback(
    async ({ projectId, message }: SendMessageOptions) => {
      // Abort any existing stream before starting a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Optimistic UI: show the user message immediately
      dispatch({ type: "add_user_message", text: message });
      dispatch({ type: "start_stream" });

      try {
        // ── auth headers (mirrors api/client.ts) ──────────────────
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Session-Id": getSessionId(),
        };

        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) headers["Authorization"] = `Bearer ${token}`;
        } catch {
          // supabase client not ready — fall through as anonymous
        }

        // Build conversation history from messages already in state.
        // We snapshot *before* the user message we just dispatched
        // (reducer runs async from our perspective) so we send the
        // full prior context.  The backend receives `message` as the
        // new turn plus `history` for context.
        const history = state.messages
          .filter(
            (m) =>
              m.type === "user" || (m.type === "agent" && !m.streaming),
          )
          .map((m) => ({
            role: m.type === "user" ? ("user" as const) : ("assistant" as const),
            text: (m as { text: string }).text,
          }));

        const response = await fetch("/api/agent/chat", {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            project_id: projectId,
            message,
            conversation_id: state.conversationId,
            history,
          }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`${response.status}: ${text}`);
        }

        if (!response.body) {
          throw new Error("Response body is empty — streaming not supported");
        }

        // ── SSE stream parser ─────────────────────────────────────
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last (possibly incomplete) line in the buffer
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              try {
                const data = JSON.parse(dataStr) as Record<string, unknown>;
                handleSSEEvent(dispatch, currentEvent, data);
              } catch {
                // Skip malformed JSON lines — the stream may include
                // partial writes or keepalive comments.
              }
              currentEvent = "";
            }
            // Blank lines delimit SSE events (spec). We just reset
            // currentEvent on data consumption above, which is sufficient.
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          dispatch({
            type: "add_error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        dispatch({ type: "end_stream" });
        abortRef.current = null;
      }
    },
    [state.messages, state.conversationId, dispatch],
  );

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "end_stream" });
  }, [dispatch]);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "clear_messages" });
    dispatch({ type: "set_conversation_id", id: crypto.randomUUID() });
  }, [dispatch]);

  return {
    messages: state.messages,
    streaming: state.streaming,
    analysis: state.analysis,
    conversationId: state.conversationId,
    sendMessage,
    stopStream,
    clearChat,
  };
}

// ─── DB message → AgentMessage converter ─────────────────────────────

function dbMessageToAgentMessage(msg: ChatMessageResp): AgentMessage | null {
  const content = msg.content as Record<string, unknown>;
  const ts = new Date(msg.created_at).getTime();

  switch (msg.role) {
    case "user":
      return { type: "user", text: (content.text as string) ?? "", ts };
    case "agent":
      return {
        type: "agent",
        text: (content.text as string) ?? "",
        ts,
        streaming: false,
      };
    case "tool_call":
      return {
        type: "tool_call",
        id: (content.id as string) ?? "",
        tool: (content.tool as string) ?? "",
        args: content.args,
        status: (content.status as "done" | "error") ?? "done",
        result: content.result,
        ts,
      };
    case "suggestion":
      return {
        type: "suggestion",
        edit: content.edit as SuggestedEdit,
        ts,
      };
    case "error":
      return {
        type: "error",
        message: (content.message as string) ?? "",
        ts,
      };
    default:
      return null;
  }
}

// ─── SSE event dispatcher ─────────────────────────────────────────────

function handleSSEEvent(
  dispatch: React.Dispatch<AgentAction>,
  event: string,
  data: Record<string, unknown>,
): void {
  switch (event) {
    case "token":
      dispatch({ type: "append_token", text: data.text as string });
      break;

    case "tool_call_start":
      dispatch({
        type: "tool_call_start",
        id: data.id as string,
        tool: data.tool as string,
        args: data.args,
      });
      break;

    case "tool_call_progress":
      dispatch({
        type: "tool_call_progress",
        id: data.id as string,
        progress: data.progress as string,
      });
      break;

    case "tool_call_end":
      dispatch({
        type: "tool_call_end",
        id: data.id as string,
        result: data.result,
        status: data.status as "done" | "error",
      });
      break;

    case "suggestion":
      dispatch({
        type: "add_suggestion",
        edit: data.edit as SuggestedEdit,
      });
      break;

    case "variant_ready":
      dispatch({
        type: "add_variant_preview",
        jobId: data.job_id as string,
        variants: data.variants as VariantPreview[],
      });
      break;

    case "done":
      // Stream finished — end_stream is called in the finally block
      break;

    case "error":
      dispatch({ type: "add_error", message: data.message as string });
      break;
  }
}

