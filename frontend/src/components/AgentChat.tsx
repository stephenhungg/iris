import { useCallback, useEffect, useRef } from "react";

import { useAgentStream } from "../hooks/useAgentStream";
import type { AgentMessage, SuggestedEdit, VariantPreview } from "../stores/agent";
import { AgentInput } from "./AgentInput";
import { ToolCallCard } from "./ToolCallCard";

// ─── types ────────────────────────────────────────────────────────────

interface AgentChatProps {
  projectId: string | null;
}

// ─── component ────────────────────────────────────────────────────────

export function AgentChat({ projectId }: AgentChatProps) {
  const { messages, streaming, sendMessage, clearChat } = useAgentStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]]);

  const handleSend = useCallback(
    (text: string) => {
      if (!projectId) return;
      void sendMessage({ projectId, message: text });
    },
    [projectId, sendMessage],
  );

  return (
    <>
      <style>{`
        @keyframes agent-cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .agent-chat {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg);
          border-left: 1px solid var(--edge);
          overflow: hidden;
        }
        .agent-chat__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid var(--edge);
          flex-shrink: 0;
        }
        .agent-chat__title {
          font-family: var(--f-mono);
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ink-fade);
        }
        .agent-chat__clear {
          font-family: var(--f-mono);
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-ghost);
          padding: 3px 8px;
          border-radius: 3px;
          border: 1px solid transparent;
          background: none;
          cursor: pointer;
          transition: all var(--dur-s) var(--ease);
        }
        .agent-chat__clear:hover {
          color: var(--ink-fade);
          border-color: var(--edge);
          background: rgba(255, 255, 255, 0.03);
        }
        .agent-chat__messages {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .agent-chat__messages::-webkit-scrollbar { width: 6px; }
        .agent-chat__messages::-webkit-scrollbar-track { background: transparent; }
        .agent-chat__messages::-webkit-scrollbar-thumb {
          background: var(--panel-3);
          border-radius: 3px;
        }
        .agent-chat__empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          gap: 8px;
          color: var(--ink-ghost);
          font-family: var(--f-mono);
          font-size: 11px;
          text-align: center;
          padding: 24px;
        }
        .agent-chat__empty-hint {
          font-size: 10px;
          color: var(--ink-fade);
          max-width: 200px;
          line-height: 1.5;
        }

        /* ── message bubbles ─────────────────────────── */

        .msg {
          max-width: 88%;
          word-break: break-word;
        }
        .msg--user {
          align-self: flex-end;
          background: var(--panel-2);
          border: 1px solid var(--edge);
          border-radius: 8px 8px 2px 8px;
          padding: 8px 10px;
          font-family: var(--f-mono);
          font-size: 12px;
          line-height: 1.5;
          color: var(--ink);
        }
        .msg--agent {
          align-self: flex-start;
          background: var(--panel);
          border: 1px solid var(--edge);
          border-radius: 8px 8px 8px 2px;
          padding: 8px 10px;
          font-family: var(--f-mono);
          font-size: 12px;
          line-height: 1.5;
          color: var(--ink-dim);
          white-space: pre-wrap;
        }
        .msg--agent-cursor {
          display: inline-block;
          width: 6px;
          height: 13px;
          background: var(--ink-fade);
          margin-left: 2px;
          vertical-align: text-bottom;
          animation: agent-cursor-blink 0.8s step-end infinite;
        }
        .msg--error {
          align-self: flex-start;
          background: rgba(255, 107, 107, 0.08);
          border: 1px solid rgba(255, 107, 107, 0.2);
          border-radius: 6px;
          padding: 8px 10px;
          font-family: var(--f-mono);
          font-size: 11px;
          line-height: 1.5;
          color: #ff6b6b;
        }
        .msg--tool {
          align-self: stretch;
          max-width: 100%;
        }
        .msg--suggestion {
          align-self: stretch;
          max-width: 100%;
        }

        /* ── suggestion card ─────────────────────────── */

        .suggestion-card {
          background: var(--panel);
          border: 1px solid var(--edge);
          border-left: 3px solid var(--ink-fade);
          border-radius: 4px;
          padding: 10px 12px;
        }
        .suggestion-card__label {
          font-family: var(--f-mono);
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ink-fade);
          margin-bottom: 6px;
        }
        .suggestion-card__text {
          font-family: var(--f-mono);
          font-size: 11px;
          line-height: 1.5;
          color: var(--ink-dim);
          margin: 0 0 6px 0;
        }
        .suggestion-card__rationale {
          font-family: var(--f-mono);
          font-size: 10px;
          color: var(--ink-ghost);
          line-height: 1.4;
          margin: 0 0 8px 0;
        }
        .suggestion-card__range {
          font-family: var(--f-mono);
          font-size: 9px;
          color: var(--ink-fade);
          margin-bottom: 8px;
        }
        .suggestion-card__actions {
          display: flex;
          gap: 6px;
        }
        .suggestion-card__btn {
          font-family: var(--f-mono);
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 3px;
          border: 1px solid var(--edge);
          background: transparent;
          color: var(--ink-dim);
          cursor: pointer;
          transition: all var(--dur-s) var(--ease);
        }
        .suggestion-card__btn:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: var(--edge-2);
        }
        .suggestion-card__btn--accept {
          background: rgba(126, 231, 135, 0.08);
          border-color: rgba(126, 231, 135, 0.2);
          color: rgba(126, 231, 135, 0.9);
        }
        .suggestion-card__btn--accept:hover {
          background: rgba(126, 231, 135, 0.15);
          border-color: rgba(126, 231, 135, 0.35);
        }
        .suggestion-card__resolved {
          font-family: var(--f-mono);
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 3px;
        }
        .suggestion-card__resolved--accepted {
          background: rgba(126, 231, 135, 0.1);
          color: rgba(126, 231, 135, 0.7);
        }
        .suggestion-card__resolved--dismissed {
          background: rgba(255, 255, 255, 0.04);
          color: var(--ink-ghost);
        }

        /* ── variant preview ─────────────────────────── */

        .variant-preview {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .variant-preview__label {
          font-family: var(--f-mono);
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ink-fade);
        }
        .variant-preview__grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 6px;
        }
        .variant-preview__thumb {
          aspect-ratio: 16 / 9;
          border-radius: 4px;
          background: var(--panel-2);
          border: 1px solid var(--edge);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .variant-preview__thumb video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .variant-preview__placeholder {
          font-family: var(--f-mono);
          font-size: 9px;
          color: var(--ink-ghost);
        }
        .variant-preview__desc {
          font-family: var(--f-mono);
          font-size: 9px;
          color: var(--ink-fade);
          text-align: center;
          margin-top: 2px;
        }
      `}</style>

      <div className="agent-chat">
        {/* header */}
        <div className="agent-chat__header">
          <span className="agent-chat__title">iris agent</span>
          {messages.length > 0 && (
            <button className="agent-chat__clear" onClick={clearChat}>
              clear
            </button>
          )}
        </div>

        {/* messages */}
        <div className="agent-chat__messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="agent-chat__empty">
              <span>no conversation yet</span>
              <span className="agent-chat__empty-hint">
                describe an edit you want to make and the agent will handle the rest
              </span>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageRenderer key={`${msg.type}-${msg.ts}-${i}`} message={msg} />
          ))}

          <div ref={bottomRef} />
        </div>

        {/* input */}
        <AgentInput
          onSend={handleSend}
          disabled={!projectId}
          streaming={streaming}
        />
      </div>
    </>
  );
}

// ─── message renderer ─────────────────────────────────────────────────

function MessageRenderer({ message }: { message: AgentMessage }) {
  switch (message.type) {
    case "user":
      return (
        <div className="msg msg--user">{message.text}</div>
      );

    case "agent":
      return (
        <div className="msg msg--agent">
          {message.text}
          {message.streaming && <span className="msg--agent-cursor" />}
        </div>
      );

    case "tool_call":
      return (
        <div className="msg msg--tool">
          <ToolCallCard
            id={message.id}
            tool={message.tool}
            args={message.args}
            status={message.status}
            result={message.result}
          />
        </div>
      );

    case "variant_preview":
      return (
        <div className="msg msg--tool">
          <VariantPreviewCard variants={message.variants} />
        </div>
      );

    case "suggestion":
      return (
        <div className="msg msg--suggestion">
          <SuggestionCard edit={message.edit} accepted={message.accepted} />
        </div>
      );

    case "error":
      return (
        <div className="msg msg--error">{message.message}</div>
      );

    case "analysis":
      return null;

    default:
      return null;
  }
}

// ─── suggestion card ──────────────────────────────────────────────────

function SuggestionCard({
  edit,
  accepted,
}: {
  edit: SuggestedEdit;
  accepted?: boolean;
}) {
  const resolved = accepted != null;

  return (
    <div className="suggestion-card">
      <p className="suggestion-card__label">suggested edit</p>
      <p className="suggestion-card__text">{edit.suggestion}</p>
      {edit.rationale && (
        <p className="suggestion-card__rationale">{edit.rationale}</p>
      )}
      <p className="suggestion-card__range">
        {formatTimestamp(edit.start_ts)} - {formatTimestamp(edit.end_ts)}
      </p>

      {resolved ? (
        <span
          className={`suggestion-card__resolved ${
            accepted
              ? "suggestion-card__resolved--accepted"
              : "suggestion-card__resolved--dismissed"
          }`}
        >
          {accepted ? "accepted" : "dismissed"}
        </span>
      ) : (
        <div className="suggestion-card__actions">
          <button className="suggestion-card__btn suggestion-card__btn--accept">
            accept
          </button>
          <button className="suggestion-card__btn">dismiss</button>
        </div>
      )}
    </div>
  );
}

// ─── variant preview ──────────────────────────────────────────────────

function VariantPreviewCard({ variants }: { variants: VariantPreview[] }) {
  return (
    <div className="variant-preview">
      <span className="variant-preview__label">
        {variants.length} variant{variants.length !== 1 ? "s" : ""} ready
      </span>
      <div className="variant-preview__grid">
        {variants.map((v) => (
          <div key={v.id}>
            <div className="variant-preview__thumb">
              {v.url ? (
                <video
                  src={v.url}
                  muted
                  loop
                  playsInline
                  onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                  onMouseLeave={(e) => {
                    e.currentTarget.pause();
                    e.currentTarget.currentTime = 0;
                  }}
                />
              ) : (
                <span className="variant-preview__placeholder">loading...</span>
              )}
            </div>
            {v.description && (
              <p className="variant-preview__desc">{v.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
