"use client";

import type { AnalysisResult, ResultSummary } from "./types";

/**
 * 기기(브라우저) 저장 음원목록.
 *
 * 분석 결과를 IndexedDB에 통째로 저장한다. 서버(PC)가 꺼져도 목록이 남고,
 * YouTube 곡은 IFrame 재생이라 코드 화면까지 그대로 동작한다.
 * 업로드 곡은 오디오가 서버에 있으므로 코드만 보이고 소리는 안 난다.
 *
 * 결과가 곡당 50~100KB(파형 포함)라 localStorage 한도로는 수십 곡을 못 담는다.
 * 그래서 IndexedDB를 쓴다.
 */

const DB_NAME = "chordgen";
const STORE = "results";
// 공유받은 음원(오디오 blob). 업로드 곡도 서버 없이 재생할 수 있게 한다.
const AUDIO_STORE = "audio";
// 내가 가진 악보(이미지·PDF). 서버 없는 수강생 기기에도 남아야 한다.
const SHEET_STORE = "sheets";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!req.result.objectStoreNames.contains(AUDIO_STORE)) {
        req.result.createObjectStore(AUDIO_STORE, { keyPath: "id" });
      }
      if (!req.result.objectStoreNames.contains(SHEET_STORE)) {
        req.result.createObjectStore(SHEET_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB를 열 수 없습니다"));
  });
}

function requestAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 요청 실패"));
  });
}

interface StoredResult {
  id: string;
  savedAt: number;
  result: AnalysisResult;
}

export async function saveLocal(result: AnalysisResult): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const record: StoredResult = { id: result.id, savedAt: Date.now(), result };
  await requestAsPromise(tx.objectStore(STORE).put(record));
  db.close();
}

export async function getLocal(id: string): Promise<AnalysisResult | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const record = (await requestAsPromise(tx.objectStore(STORE).get(id))) as
    | StoredResult
    | undefined;
  db.close();
  return record?.result ?? null;
}

export async function removeLocal(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await requestAsPromise(tx.objectStore(STORE).delete(id));
  db.close();
}

/** 저장된 곡의 요약 목록. 서버 목록과 같은 모양이라 화면을 공유할 수 있다. */
export async function listLocal(): Promise<ResultSummary[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const records = (await requestAsPromise(
    tx.objectStore(STORE).getAll(),
  )) as StoredResult[];
  db.close();

  return records
    .map((r) => ({
      id: r.result.id,
      source: r.result.source,
      title: r.result.title,
      duration: r.result.duration,
      bpm: r.result.bpm,
      key: r.result.key,
      chord_count: r.result.chords.length,
      pipeline_version: r.result.meta.pipeline_version,
      analyzed_at: r.savedAt / 1000,
    }))
    .sort((a, b) => b.analyzed_at - a.analyzed_at);
}

export async function localIds(): Promise<Set<string>> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const keys = (await requestAsPromise(tx.objectStore(STORE).getAllKeys())) as string[];
  db.close();
  return new Set(keys);
}

// ---- 음원(오디오) 저장 ----

/** 공유받은 음원을 기기에 저장한다. id는 분석 결과의 id와 같다. */
export async function saveLocalAudio(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(AUDIO_STORE, "readwrite");
  await requestAsPromise(tx.objectStore(AUDIO_STORE).put({ id, blob }));
  db.close();
}

/** 기기에 저장된 음원. 없으면 null — 그때는 서버 스트리밍으로 폴백한다. */
export async function getLocalAudio(id: string): Promise<Blob | null> {
  const db = await openDb();
  const tx = db.transaction(AUDIO_STORE, "readonly");
  const record = (await requestAsPromise(tx.objectStore(AUDIO_STORE).get(id))) as
    | { id: string; blob: Blob }
    | undefined;
  db.close();
  return record?.blob ?? null;
}

export async function removeLocalAudio(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(AUDIO_STORE, "readwrite");
  await requestAsPromise(tx.objectStore(AUDIO_STORE).delete(id));
  db.close();
}

/** 내가 가진 악보를 기기에 담는다. kind는 "image" 또는 "pdf". */
export async function saveLocalSheet(
  id: string,
  blob: Blob,
  kind: "image" | "pdf",
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SHEET_STORE, "readwrite");
  await requestAsPromise(tx.objectStore(SHEET_STORE).put({ id, blob, kind }));
  db.close();
}

export async function getLocalSheet(
  id: string,
): Promise<{ blob: Blob; kind: "image" | "pdf" } | null> {
  const db = await openDb();
  const tx = db.transaction(SHEET_STORE, "readonly");
  const record = (await requestAsPromise(tx.objectStore(SHEET_STORE).get(id))) as
    | { id: string; blob: Blob; kind: "image" | "pdf" }
    | undefined;
  db.close();
  return record ? { blob: record.blob, kind: record.kind } : null;
}

/**
 * 악보 그림의 쪽. 서버가 PDF를 펴 둔 것을 기기에도 담는다.
 *
 * 수강생 화면에는 분석 서버가 없다. 곡 파일에 실어 보내 두지 않으면
 * 「악보」 화면이 빈 칸이 된다 — 코드와 가사는 오는데 악보만 안 온다.
 * 쪽마다 따로 담는다(id__p0, id__p1 …).
 */
export const sheetPageKey = (id: string, index: number) => `${id}__p${index}`;

export async function saveSheetPage(
  id: string,
  index: number,
  blob: Blob,
): Promise<void> {
  await saveLocalSheet(sheetPageKey(id, index), blob, "image");
}

export async function getSheetPage(id: string, index: number): Promise<Blob | null> {
  const got = await getLocalSheet(sheetPageKey(id, index));
  return got?.blob ?? null;
}

export async function removeSheetPages(id: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await removeLocalSheet(sheetPageKey(id, i));
  }
}

export async function removeLocalSheet(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SHEET_STORE, "readwrite");
  await requestAsPromise(tx.objectStore(SHEET_STORE).delete(id));
  db.close();
}

// ---- 파일 내보내기 / 가져오기 ----

function download(name: string, payload: unknown): void {
  // application/json으로 주면 Chrome이 .rml 뒤에 .json을 덧붙인다.
  // 내용은 JSON이지만 타입은 자체 확장자를 지키도록 octet-stream으로.
  const blob = new Blob([JSON.stringify(payload, null, 1)], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60);
}

function sourceLabel(result: AnalysisResult): string {
  return result.source === "youtube" ? "YouTube" : "업로드";
}

/**
 * 결과 한 곡을 파일로 내려받는다. 파일명: 리천 노래명(출처).rml
 *
 * 코드·비트·가사·파형까지 결과 전부가 들어간다. 이 파일 하나면 다른
 * 기기에서 같은 화면을 그대로 연다.
 *
 * withId를 주면 파일명에 결과 id를 넣는다. 음원과 나란히 둘 때 쓴다 —
 * 이름이 같아야 수강생 앱이 둘을 한 곡으로 묶는다.
 */
export function exportToFile(result: AnalysisResult, withId = false): void {
  const name = safeName(result.title || result.id);
  const tail = withId ? `.${result.id}` : "";
  download(`리천 ${name}(${sourceLabel(result)})${tail}.rml`, result);
}

/** 오늘 날짜를 YYYY-MM-DD로 */
function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 기기 저장 음원목록 전체를 한 파일로 내려받는다. 저장된 곡 수를 돌려준다. */
export async function exportAllToFile(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const records = (await requestAsPromise(
    tx.objectStore(STORE).getAll(),
  )) as StoredResult[];
  db.close();

  if (records.length === 0) return 0;
  download(`리천기타코드목록 ${today()}.rml`, {
    app: "richeon-guitar-chord",
    exported: today(),
    results: records.map((r) => r.result),
  });
  return records.length;
}

/** rml/JSON 텍스트(한 곡 또는 묶음)를 결과 목록으로 파싱한다. 실패하면 예외. */
export function parseResultsText(text: string): AnalysisResult[] {
  const data = JSON.parse(text) as
    | AnalysisResult
    | { results?: AnalysisResult[]; result?: AnalysisResult };

  // 곡 꾸러미(한 곡에 딸린 모든 것)는 result 안에 분석이 들어 있다
  const single = (data as { result?: AnalysisResult }).result;
  const list = single
    ? [single]
    : Array.isArray((data as { results?: unknown }).results)
      ? (data as { results: AnalysisResult[] }).results
      : [data as AnalysisResult];

  const valid = list.filter(
    (r) => r && r.id && Array.isArray(r.chords) && Array.isArray(r.beats),
  );
  if (valid.length === 0) throw new Error("코드 분석 파일이 아닙니다");
  return valid;
}

/** 내보낸 파일을 읽어 결과 목록으로 돌려준다. */
export async function importFromFile(file: File): Promise<AnalysisResult[]> {
  return parseResultsText(await file.text());
}
