import type { EntityResp, PropagationResultResp } from "../../api/client";
import type { ContinuityDashboardController } from "./useContinuityDashboard";

function fmtTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function appearanceLabel(entity: EntityResp, appearanceId: string) {
  const appearance = entity.appearances.find((item) => item.id === appearanceId);
  if (!appearance) return "unknown appearance";
  return `${fmtTime(appearance.start_ts)}-${fmtTime(appearance.end_ts)}`;
}

function appearanceMeta(entity: EntityResp, appearanceId: string) {
  const appearance = entity.appearances.find((item) => item.id === appearanceId);
  if (!appearance) return null;
  return `${Math.round(appearance.confidence * 100)}% confidence`;
}

function resultTone(result: PropagationResultResp) {
  if (result.applied) return "rgba(126, 231, 135, 0.2)";
  if (result.status === "error") return "rgba(255, 107, 107, 0.2)";
  if (result.status === "done") return "rgba(255, 255, 255, 0.08)";
  return "rgba(255, 196, 87, 0.16)";
}

export function ContinuityPanel({
  continuity,
}: {
  continuity: ContinuityDashboardController;
}) {
  const {
    latestEntity,
    acceptedEdit,
    discovery,
    propagation,
    propagationCounts,
    hasPropagatableAppearances,
    startPropagation,
    applyPropagation,
    applyAllPropagation,
    clearLatestEntity,
  } = continuity;

  const readyToApply = propagation.results.filter(
    (result) => result.status === "done" && !result.applied,
  );

  return (
    <section
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div
            className="mono"
            style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-fade)" }}
          >
            continuity
          </div>
          <div style={{ fontSize: 13, color: "var(--ink)" }}>
            {discovery.status === "idle" && "accept a variant to build a continuity pack"}
            {discovery.status === "pending" && "continuity scan queued"}
            {discovery.status === "processing" && "scanning the reel for matching appearances"}
            {discovery.status === "ready" &&
              (latestEntity
                ? `${latestEntity.appearances.length} linked appearances ready`
                : "continuity entity loaded")}
            {discovery.status === "error" && "continuity scan failed"}
          </div>
        </div>

        {(latestEntity || discovery.status === "error") && (
          <button
            className="mono"
            onClick={clearLatestEntity}
            style={{
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "var(--ink-fade)",
              fontSize: 10,
              padding: "5px 9px",
              cursor: "pointer",
            }}
          >
            clear
          </button>
        )}
      </div>

      {acceptedEdit && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-fade)",
            display: "grid",
            gap: 4,
          }}
        >
          <span>segment {acceptedEdit.segmentId.slice(0, 8)}</span>
          <span>prompt: {acceptedEdit.prompt || "untitled edit"}</span>
        </div>
      )}

      {discovery.error && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "#ff9b9b",
            borderRadius: 8,
            border: "1px solid rgba(255, 107, 107, 0.2)",
            background: "rgba(255, 107, 107, 0.08)",
            padding: 10,
          }}
        >
          {discovery.error}
        </div>
      )}

      {latestEntity && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: latestEntity.reference_crop_url ? "72px 1fr" : "1fr",
              gap: 12,
              alignItems: "start",
            }}
          >
            {latestEntity.reference_crop_url && (
              <img
                src={latestEntity.reference_crop_url}
                alt={latestEntity.description}
                style={{
                  width: 72,
                  height: 72,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              />
            )}

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ color: "var(--ink)", fontSize: 13 }}>
                <strong>{latestEntity.description}</strong>
                {latestEntity.category && (
                  <span style={{ marginLeft: 8, color: "var(--ink-fade)" }}>
                    {latestEntity.category}
                  </span>
                )}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-fade)" }}>
                {latestEntity.appearances.length} downstream appearances found
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-fade)" }}>
                appearances
              </div>
              {hasPropagatableAppearances && (
                <button
                  className="mono"
                  onClick={() => void startPropagation()}
                  disabled={propagation.status === "pending" || propagation.status === "processing"}
                  style={{
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.06)",
                    color: "var(--ink)",
                    fontSize: 10,
                    padding: "6px 10px",
                    cursor:
                      propagation.status === "pending" || propagation.status === "processing"
                        ? "default"
                        : "pointer",
                    opacity:
                      propagation.status === "pending" || propagation.status === "processing"
                        ? 0.6
                        : 1,
                  }}
                >
                  {propagation.status === "idle" || propagation.status === "error"
                    ? "generate pack"
                    : propagation.status === "ready"
                      ? "regenerate pack"
                      : "building pack…"}
                </button>
              )}
            </div>

            {latestEntity.appearances.length === 0 ? (
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-fade)" }}>
                no extra appearances were found yet.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {latestEntity.appearances.slice(0, 6).map((appearance) => (
                  <div
                    key={appearance.id}
                    className="mono"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 11,
                      color: "var(--ink-fade)",
                      padding: "7px 9px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.04)",
                    }}
                  >
                    <span>{fmtTime(appearance.start_ts)}-{fmtTime(appearance.end_ts)}</span>
                    <span>{Math.round(appearance.confidence * 100)}%</span>
                  </div>
                ))}
                {latestEntity.appearances.length > 6 && (
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-fade)" }}>
                    +{latestEntity.appearances.length - 6} more appearances
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {(propagation.status !== "idle" || propagation.results.length > 0 || propagation.error) && (
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div>
              <div
                className="mono"
                style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-fade)" }}
              >
                continuity pack
              </div>
              <div style={{ fontSize: 12, color: "var(--ink)" }}>
                {propagation.status === "pending" && "queueing propagation jobs"}
                {propagation.status === "processing" &&
                  `processing ${propagationCounts.processing}/${propagationCounts.total || latestEntity?.appearances.length || 0}`}
                {propagation.status === "ready" &&
                  `${propagationCounts.ready} variants ready · ${propagationCounts.applied} applied`}
                {propagation.status === "error" && "propagation failed"}
              </div>
            </div>

            {readyToApply.length > 1 && (
              <button
                className="mono"
                onClick={() => void applyAllPropagation()}
                disabled={propagation.applyingIds.length > 0}
                style={{
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "var(--ink-fade)",
                  fontSize: 10,
                  padding: "5px 9px",
                  cursor: propagation.applyingIds.length > 0 ? "default" : "pointer",
                  opacity: propagation.applyingIds.length > 0 ? 0.65 : 1,
                }}
              >
                apply all ready
              </button>
            )}
          </div>

          {propagation.error && (
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "#ff9b9b",
                borderRadius: 8,
                border: "1px solid rgba(255, 107, 107, 0.2)",
                background: "rgba(255, 107, 107, 0.08)",
                padding: 10,
              }}
            >
              {propagation.error}
            </div>
          )}

          {latestEntity && propagation.results.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              {propagation.results.map((result) => {
                const isApplying = propagation.applyingIds.includes(result.id);
                return (
                  <div
                    key={result.id}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 10,
                      borderRadius: 10,
                      background: resultTone(result),
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--ink)" }}>
                          {appearanceLabel(latestEntity, result.appearance_id)}
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: "var(--ink-fade)" }}>
                          {appearanceMeta(latestEntity, result.appearance_id) || result.status}
                        </div>
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: "var(--ink-fade)" }}>
                        {result.applied ? "applied" : result.status}
                      </div>
                    </div>

                    {result.variant_url && (
                      <video
                        src={result.variant_url}
                        muted
                        loop
                        playsInline
                        controls
                        style={{
                          width: "100%",
                          borderRadius: 8,
                          background: "rgba(0,0,0,0.25)",
                        }}
                      />
                    )}

                    {result.status === "done" && !result.applied && (
                      <button
                        className="mono"
                        onClick={() => void applyPropagation(result.id)}
                        disabled={isApplying}
                        style={{
                          justifySelf: "start",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.08)",
                          color: "var(--ink)",
                          fontSize: 10,
                          padding: "6px 10px",
                          cursor: isApplying ? "default" : "pointer",
                          opacity: isApplying ? 0.65 : 1,
                        }}
                      >
                        {isApplying ? "applying…" : "apply to export timeline"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {propagation.results.length > 0 && (
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-fade)" }}>
              applied results are written to backend segment rows for export continuity. the live editor
              timeline is left alone so local edits don’t get stomped.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
