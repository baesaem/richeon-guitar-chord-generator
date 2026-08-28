import { getSettings } from "./settings";
import type {
  AnalysisResult,
  Chord,
  Health,
  JobStatus,
  LyricLine,
  ResultSummary,
} from "./types";

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

/**
 * 이미 등록된 곡을 다시 분석한다.
 *
 * 기본은 받아 둔 음원을 그대로 쓴다 — 내려받기 단계가 빠져 훨씬 빠르다.
 * refetch를 주면 음원부터 다시 받는다(YouTube 곡만).
 */
export const reanalyze = (
  id: string,
  separate: boolean,
  refetch = false,
  /** 서버에 결과가 없을 때 되살릴 단서. 기기에만 남은 곡을 위한 것 */
  hint?: { source: string; title: string },
) =>
  fetch(`${apiBase()}/api/results/${id}/reanalyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ separate, refetch, ...hint }),
  }).then(json<{ job_id: string }>);

export const getResult = (id: string) =>
  fetch(`${apiBase()}/api/results/${id}`).then(json<AnalysisResult>);

export const listResults = () =>
  fetch(`${apiBase()}/api/results`).then(json<ResultSummary[]>);

export interface SharedFile {
  id: string;
  name: string;
}

/** 반별 공유 폴더(구글드라이브)의 파일 목록. 서버가 프록시한다. */
export const listShared = (folderId: string) =>
  fetch(`${apiBase()}/api/shared?folder=${encodeURIComponent(folderId)}`).then(
    json<SharedFile[]>,
  );

async function sharedResponse(id: string): Promise<Response> {
  const res = await fetch(`${apiBase()}/api/shared/${id}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { detail?: string }).detail ?? `${res.status} ${res.statusText}`,
    );
  }
  return res;
}

/** 공유 파일 내용(rml 텍스트) */
export const downloadShared = async (id: string): Promise<string> =>
  (await sharedResponse(id)).text();

/** 공유 파일 내용(음원 등 바이너리) */
export const downloadSharedBlob = async (id: string): Promise<Blob> =>
  (await sharedResponse(id)).blob();

/**
 * 보컬을 뺀 반주 트랙을 준비시킨다.
 *
 * 이미 만들어 뒀으면 즉시 돌아오고, 없으면 그 자리에서 분리한다
 * (GPU에서 4분 곡이 20초 안쪽). 그동안 요청을 붙잡고 있으므로
 * 호출하는 쪽에서 진행 표시를 해 준다.
 */
export const makeInstrumental = (id: string) =>
  fetch(`${apiBase()}/api/audio/${id}/instrumental`, { method: "POST" }).then(
    json<{ ready: boolean; cached: boolean }>,
  );

/** 보컬만 남긴 트랙을 준비시킨다. 노래 연습용. */
export const makeVocals = (id: string) =>
  fetch(`${apiBase()}/api/audio/${id}/vocals`, { method: "POST" }).then(
    json<{ ready: boolean; cached: boolean }>,
  );

/** 곡 이름 바꾸기. YouTube 제목은 대괄호 범벅이라 다듬게 둔다 */
export const renameResult = (id: string, title: string) =>
  fetch(`${apiBase()}/api/results/${id}/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then(json<AnalysisResult>);

/**
 * 구글 드라이브에 바로 올리기 (관리자 PC).
 *
 * 「내보내기 → 내려받기 → 드라이브 웹에서 올리기」 세 걸음을 한 번으로
 * 줄인다. 서버가 강사님 계정으로 올리므로 파일 주인도 강사님이다.
 */
export const driveStatus = () =>
  fetch(`${apiBase()}/api/drive/status`).then(json<{ connected: boolean }>);

/** 동의 화면 주소를 받는다. 이 주소를 열면 구글이 계정을 묻는다. */
export const driveConnect = () =>
  fetch(`${apiBase()}/api/drive/connect`, { method: "POST" }).then(
    json<{ url: string }>,
  );

/** 동의가 끝나기를 기다린다(최대 3분). */
export const driveConnectWait = () =>
  fetch(`${apiBase()}/api/drive/connect/wait`, { method: "POST" }).then(
    json<{ connected: boolean }>,
  );

export const driveDisconnect = () =>
  fetch(`${apiBase()}/api/drive/connect`, { method: "DELETE" }).then(
    json<{ connected: boolean }>,
  );

/** 공유 폴더에 파일 하나를 올린다. 같은 이름이 있으면 갈아 끼운다. */
export const driveUpload = (folder: string, name: string, blob: Blob) => {
  const fd = new FormData();
  fd.append("folder", folder);
  fd.append("name", name);
  fd.append("file", blob, name);
  return fetch(`${apiBase()}/api/drive/upload`, { method: "POST", body: fd }).then(
    json<{ id: string; name: string; replaced: boolean }>,
  );
};

export interface LlmSettings {
  configured: boolean;
  /** 앞뒤만 남기고 가린 키. 저장된 값이 있는지 확인하는 용도 */
  masked_key: string;
  base_url: string;
  model: string;
}

/** 가사 도우미(AI) 설정 읽기. 키 자체는 서버 밖으로 나오지 않는다. */
export const getLlmSettings = () =>
  fetch(`${apiBase()}/api/settings/llm`).then(json<LlmSettings>);

/** 설정 저장. 값을 빼면 그대로 두고, 빈 문자열을 주면 지운다. */
export const putLlmSettings = (body: {
  api_key?: string;
  base_url?: string;
  model?: string;
}) =>
  fetch(`${apiBase()}/api/settings/llm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<LlmSettings>);

export interface LlmProbe {
  ok: boolean;
  model_available: boolean;
  message: string;
  /** 쓸 수 있는 대화 모델. 새로 나온 것부터 */
  models: string[];
  /** 가사 정리에 알맞은 모델. 비어 있을 수 있다 */
  recommended: string;
}

/** 저장된 키로 실제 호출해 보고, 쓸 수 있는 모델 목록을 받는다. */
export const testLlmSettings = () =>
  fetch(`${apiBase()}/api/settings/llm/test`, { method: "POST" }).then(json<LlmProbe>);

export interface SheetHit {
  title: string;
  url: string;
  site: string;
}

/**
 * 이 곡의 코드 악보가 올라와 있는 페이지들을 찾는다.
 *
 * 악보 자체를 받아 오지 않는다 — 남이 만든 악보를 복제해 보여주면
 * 저작권에 걸린다. 어디에 있는지만 알려 주고 사용자가 그 사이트에서 본다.
 */
export const findSheets = (id: string) =>
  fetch(`${apiBase()}/api/sheets/${id}`).then(
    json<{ query: string; items: SheetHit[] }>,
  );

/** 내가 가진 악보 주소. 브라우저가 바로 열 수 있는 URL이다. */
export const mySheetUrl = (id: string) => `${apiBase()}/api/sheets/${id}/mine`;

/** 등록된 악보가 있는지 확인한다. */
export const hasMySheet = async (id: string): Promise<boolean> => {
  try {
    const res = await fetch(mySheetUrl(id), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
};

/** 악보 파일(이미지·PDF)을 곡에 붙인다. */
export const uploadMySheet = (id: string, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return fetch(mySheetUrl(id), { method: "POST", body: fd }).then(
    json<{ ok: boolean; kind: "image" | "pdf" }>,
  );
};

export const deleteMySheet = (id: string) =>
  fetch(mySheetUrl(id), { method: "DELETE" }).then(json<{ deleted: string }>);

/** 서버가 가사를 찾아 결과에 붙인다. q를 주면 그 검색어로 다시 찾는다. */
export const fetchLyrics = (id: string, q = "") =>
  fetch(
    `${apiBase()}/api/results/${id}/lyrics${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    { method: "POST" },
  ).then(json<AnalysisResult>);

/**
 * 붙여넣은 가사에 AI가 시각을 붙인다.
 *
 * 이 곡에 이미 시각이 붙은 글(자동 자막)이 있으면 그것을 자로 쓴다.
 * 글자는 틀려도 언제 부르는지는 맞기 때문이다.
 */
export const alignLyrics = (id: string, texts: string[]) =>
  fetch(`${apiBase()}/api/results/${id}/lyrics/align`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(texts),
  }).then(json<AnalysisResult>);

/**
 * 이 곡에서 노래가 시작하는 자리들(초).
 *
 * 시간 표시가 없는 가사를 붙여넣었을 때 어디에 놓을지 정하는 데 쓴다.
 * 음원 분리를 쓴 곡에만 있다.
 */
export const songPhrases = (id: string, lines = 0) =>
  fetch(`${apiBase()}/api/results/${id}/phrases?lines=${lines}`).then(
    json<{ starts: number[] }>,
  );

/**
 * 붙어 있는 가사를 AI로 다듬는다.
 *
 * 자동 자막에서 온 가사는 토막나 있고 글자가 틀린다. 없는 가사를
 * 지어내는 것이 아니라 이미 있는 글을 고쳐 쓰는 일이라 잘 된다.
 */
export const tidyLyrics = (id: string) =>
  fetch(`${apiBase()}/api/results/${id}/lyrics/tidy`, { method: "POST" }).then(
    json<AnalysisResult>,
  );

/** 붙어 있는 가사를 지운다. 수동 표식도 함께 걷힌다. */
export const deleteLyrics = (id: string) =>
  fetch(`${apiBase()}/api/results/${id}/lyrics`, { method: "DELETE" }).then(
    json<AnalysisResult>,
  );

/** 사용자가 넣은 가사를 서버 결과에 저장한다. */
export const putLyrics = (id: string, lyrics: LyricLine[]) =>
  fetch(`${apiBase()}/api/results/${id}/lyrics`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lyrics),
  }).then(json<AnalysisResult>);

/** 손으로 고친 코드를 서버 결과에 저장한다. */
export const putChords = (id: string, chords: Chord[]) =>
  fetch(`${apiBase()}/api/results/${id}/chords`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chords),
  }).then(json<AnalysisResult>);

export const deleteResult = (id: string) =>
  fetch(`${apiBase()}/api/results/${id}`, { method: "DELETE" }).then(
    json<{ deleted: string }>,
  );

/**
 * 진행률을 1초 간격 폴링으로 받는다. 반환값을 호출하면 멈춘다.
 *
 * 원래 SSE였는데, 실측: Next 개발 프록시(:3000/api)가 SSE 응답을
 * 통째로 버퍼링해 모든 이벤트가 작업이 끝난 순간 한꺼번에 도착했다 —
 * 화면은 0%에 멈춘 것처럼 보이다 갑자기 완료로 건너뛴다. 폴링은
 * 요청 하나하나가 짧게 끝나므로 어떤 프록시 뒤에서도 똑같이 돈다.
 */
export function watchJob(
  jobId: string,
  onStatus: (s: JobStatus) => void,
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch(`${apiBase()}/api/jobs/${jobId}`);
      if (res.ok) {
        const status = (await res.json()) as JobStatus;
        onStatus(status);
        if (status.stage === "done" || status.stage === "failed") return;
      }
    } catch {
      // 서버가 잠깐 안 보여도 다음 폴에서 다시 본다
    }
    if (!stopped) setTimeout(tick, 1000);
  };
  tick();
  return () => {
    stopped = true;
  };
}
