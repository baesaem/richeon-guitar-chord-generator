import type { AnalysisResult, Health, JobStatus } from "./types";

// 폰에서 접속할 때도 동작하도록, 기본값은 현재 접속한 호스트의 8000 포트를 쓴다.
export function apiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
  if (fromEnv) return fromEnv;
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  return `http://${window.location.hostname}:8000`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const getHealth = () => fetch(`${apiBase()}/api/health`).then(json<Health>);

export const analyzeUrl = (url: string, separate: boolean, force = false) =>
  fetch(`${apiBase()}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, separate, force }),
  }).then(json<{ job_id: string }>);

export const analyzeUpload = (file: File, separate: boolean, force = false) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("separate", String(separate));
  fd.append("force", String(force));
  return fetch(`${apiBase()}/api/analyze/upload`, { method: "POST", body: fd }).then(
    json<{ job_id: string }>,
  );
};

export const getResult = (id: string) =>
  fetch(`${apiBase()}/api/results/${id}`).then(json<AnalysisResult>);

/** SSE로 진행률을 구독한다. 반환값을 호출하면 구독을 끊는다. */
export function watchJob(
  jobId: string,
  onStatus: (s: JobStatus) => void,
): () => void {
  const es = new EventSource(`${apiBase()}/api/jobs/${jobId}/events`);
  es.addEventListener("status", (ev) => {
    const status = JSON.parse((ev as MessageEvent).data) as JobStatus;
    onStatus(status);
    if (status.stage === "done" || status.stage === "failed") es.close();
  });
  es.onerror = () => es.close();
  return () => es.close();
}
