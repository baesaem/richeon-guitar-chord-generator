"use client";

import type { AnalysisResult, ResultSummary } from "./types";

/**
 * 기기(브라우저) 저장 재생목록.
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
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

// ---- 파일 내보내기 / 가져오기 ----

/** 결과를 JSON 파일로 내려받는다. 다른 기기나 백업용. */
export function exportToFile(result: AnalysisResult): void {
  const blob = new Blob([JSON.stringify(result, null, 1)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = (result.title || result.id).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  a.download = `${name}.chord.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 내보낸 JSON 파일을 읽어 검증한다. 실패하면 예외. */
export async function importFromFile(file: File): Promise<AnalysisResult> {
  const text = await file.text();
  const data = JSON.parse(text) as AnalysisResult;
  if (!data.id || !Array.isArray(data.chords) || !Array.isArray(data.beats)) {
    throw new Error("코드 분석 파일이 아닙니다");
  }
  return data;
}
