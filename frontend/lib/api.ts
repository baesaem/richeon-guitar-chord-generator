import type { AnalysisResult, Health, JobStatus, ResultSummary } from "./types";

/**
 * API 주소.
 *
 * 기본은 빈 문자열 = 같은 오리진. next.config.ts의 rewrites가 /api/* 를 백엔드로 넘긴다.
 * 덕분에 폰은 :3000 하나만 알면 되고, 방화벽도 CORS도 신경 쓸 필요가 없다.
 */
export function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "";
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

export const listResults = () =>
  fetch(`${apiBase()}/api/results`).then(json<ResultSummary[]>);

export const deleteResult = (id: string) =>
  fetch(`${apiBase()}/api/results/${id}`, { method: "DELETE" }).then(
    json<{ deleted: string }>,
  );

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
