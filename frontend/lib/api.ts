import { getSettings } from "./settings";
import type { AnalysisResult, Health, JobStatus, ResultSummary } from "./types";

/**
 * API 주소. 우선순위는 설정 > 빌드 시 주입값 > 같은 오리진.
 *
 * 같은 오리진일 때는 next.config.ts의 rewrites가 /api/* 를 백엔드로 넘긴다.
 * 덕분에 집 안에서는 폰이 :3000 하나만 알면 되고 방화벽도 CORS도 필요 없다.
 * 정적 배포본에는 프록시가 없으므로 설정에서 서버 주소를 직접 넣는다.
 */
export function apiBase(): string {
  const configured = getSettings().apiBase.trim();
  if (configured) return configured.replace(/\/+$/, "");
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

export interface SharedFile {
  id: string;
  name: string;
}

/** 강상기타반 공유 폴더(구글드라이브)의 파일 목록. 서버가 프록시한다. */
export const listShared = () =>
  fetch(`${apiBase()}/api/shared`).then(json<SharedFile[]>);

/** 공유 파일 내용(rml 텍스트) */
export const downloadShared = async (id: string): Promise<string> => {
  const res = await fetch(`${apiBase()}/api/shared/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string }).detail ?? `${res.status} ${res.statusText}`,
    );
  }
  return res.text();
};

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
