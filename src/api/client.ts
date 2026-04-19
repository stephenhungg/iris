/**
 * thin wrapper around backend fetch. calls carry:
 *   - X-Session-Id: anonymous per-browser id for the backend Session row
 *   - Authorization: Bearer <supabase access token> if the user is signed in
 */

import { supabase } from "../lib/supabase";

const SESSION_KEY = "iris.session_id";

export function getSessionId(): string {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Session-Id", getSessionId());
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  // attach the supabase JWT when we have one. backend can verify it with
  // SUPABASE_JWT_SECRET (HS256) and trust user_id / email from the claims.
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    // supabase client not ready — fall through as anonymous.
  }

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

// ─── types (subset, matches backend schemas) ──────────────────────────

export type BBox = { x: number; y: number; w: number; h: number };

export type UploadResp = {
  project_id: string;
  video_url: string;
  duration: number;
  fps: number;
};

export type Me = {
  session_id: string;
  user_id: string | null;
  email: string | null;
  signed_in: boolean;
};

export type ProjectListItem = {
  project_id: string;
  video_url: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  created_at: string;
};

export type JobStatus = "pending" | "processing" | "done" | "error";

export type Variant = {
  url: string;
  description: string;
  visual_coherence: number | null;
  prompt_adherence: number | null;
};

export type JobResp = {
  job_id: string;
  status: JobStatus;
  variants: Variant[];
  error: string | null;
};

export type GenerateReq = {
  project_id: string;
  start_ts: number;
  end_ts: number;
  bbox: BBox;
  prompt: string;
  reference_frame_ts: number;
};

export type AcceptResp = { segment_id: string; entity_id: string | null };

export type TimelineSegment = {
  start_ts: number;
  end_ts: number;
  source: "original" | "generated";
  url: string;
  audio: boolean;
};

export type TimelineResp = {
  project_id: string;
  duration: number;
  segments: TimelineSegment[];
};

export type MaskResp = {
  contour: [number, number][]; // normalized 0-1 points forming the mask outline
};

export type IdentifyResp = {
  description: string;    // "silver sedan car"
  category: string;       // "vehicle"
  attributes: string;     // "silver paint, 4-door"
  mask?: { contour: [number, number][] };  // SAM mask if GPU available
};

// ─── endpoints ────────────────────────────────────────────────────────

export function me(): Promise<Me> {
  return request<Me>("/api/me");
}

export function listProjects(): Promise<ProjectListItem[]> {
  return request<ProjectListItem[]>("/api/projects");
}

export async function upload(file: File): Promise<UploadResp> {
  const fd = new FormData();
  fd.append("file", file);
  return request<UploadResp>("/api/upload", { method: "POST", body: fd });
}

export function generate(req: GenerateReq): Promise<{ job_id: string }> {
  return request("/api/generate", { method: "POST", body: JSON.stringify(req) });
}

export function getJob(id: string): Promise<JobResp> {
  return request(`/api/jobs/${id}`);
}

export function accept(job_id: string, variant_index: number): Promise<AcceptResp> {
  return request("/api/accept", {
    method: "POST",
    body: JSON.stringify({ job_id, variant_index }),
  });
}

export function getTimeline(project_id: string): Promise<TimelineResp> {
  return request(`/api/timeline/${project_id}`);
}

export function getMask(
  projectId: string,
  frameTs: number,
  bbox: BBox,
): Promise<MaskResp> {
  return request<MaskResp>("/api/mask", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, frame_ts: frameTs, bbox }),
  });
}

/** identify the object inside a bbox region — gemini vision + optional SAM mask */
export function identifyRegion(
  projectId: string,
  frameTs: number,
  bbox: BBox,
): Promise<IdentifyResp> {
  return request<IdentifyResp>("/api/identify", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, frame_ts: frameTs, bbox }),
  });
}

/** poll a job until it reaches done|error, emitting intermediate states. */
export async function pollJob(
  id: string,
  onUpdate: (j: JobResp) => void,
  intervalMs = 800,
): Promise<JobResp> {
  while (true) {
    const j = await getJob(id);
    onUpdate(j);
    if (j.status === "done" || j.status === "error") return j;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
