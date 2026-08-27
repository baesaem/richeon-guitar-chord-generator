"use client";

import type { SheetHit } from "./api";
import { getLocalSheet, saveLocal, saveLocalSheet } from "./library";
import { loadSetup, saveSetup, type SongSetup } from "./perSong";
import { loadSheets, saveSheets } from "./sheetCache";
import type { AnalysisResult } from "./types";

/**
 * 곡 꾸러미 — 한 곡에 딸린 모든 것을 한 파일에.
 *
 * 음원만 건네면 수강생 화면에는 코드도 가사도 없다. 결과 파일을 따로
 * 챙기게 하면 빠뜨린다. 그래서 한 곡에 관한 것을 전부 한 파일에 담는다.
 *
 *   - 분석 결과 (코드·비트·가사·파형)
 *   - 찾아 둔 웹 악보 목록
 *   - 등록해 둔 내 악보 (이미지·PDF)
 *   - 곡별 연주설정 (카포·빠르기·반복)
 *
 * 받는 쪽은 파일 하나만 가져오면 만든 사람과 같은 화면을 본다.
 */

const KIND = "richeon-song-bundle";

export interface SongBundle {
  kind: typeof KIND;
  version: 1;
  result: AnalysisResult;
  sheets?: { query: string; items: SheetHit[]; at: number };
  setup?: SongSetup;
  /** 내 악보. data URI로 담는다 — JSON 한 덩어리로 주고받기 위해 */
  mySheet?: { kind: "image" | "pdf"; dataUrl: string };
}

export function isBundle(data: unknown): data is SongBundle {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { kind?: string }).kind === KIND &&
    !!(data as { result?: unknown }).result
  );
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다"));
    reader.readAsDataURL(blob);
  });
}

async function fromDataUrl(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/**
 * 이 곡에 딸린 것을 모아 꾸러미로 만든다.
 *
 * 없는 것은 그냥 빠진다 — 악보를 등록하지 않았다고 내보내기가 실패하면
 * 안 된다.
 */
export async function makeBundle(
  result: AnalysisResult,
  /** 서버에 있는 내 악보를 받아 오는 함수. 없으면 기기 저장분만 담는다 */
  fetchServerSheet?: (id: string) => Promise<{ blob: Blob; kind: "image" | "pdf" } | null>,
): Promise<SongBundle> {
  const bundle: SongBundle = { kind: KIND, version: 1, result };

  const sheets = loadSheets(result.id);
  if (sheets) bundle.sheets = sheets;

  // loadSetup은 늘 값을 준다. 손대지 않은 기본값까지 담을 이유는 없다
  const setup = loadSetup(result.id);
  if (setup.transpose !== 0 || setup.rate !== 1 || setup.loop !== null) {
    bundle.setup = setup;
  }

  let sheet = await getLocalSheet(result.id).catch(() => null);
  if (!sheet && fetchServerSheet) {
    sheet = await fetchServerSheet(result.id).catch(() => null);
  }
  if (sheet) {
    bundle.mySheet = { kind: sheet.kind, dataUrl: await toDataUrl(sheet.blob) };
  }
  return bundle;
}

/**
 * 꾸러미를 이 기기에 푼다. 무엇이 들어왔는지 사람 말로 돌려준다.
 *
 * 한 조각이 실패해도 나머지는 들어간다 — 악보 이미지가 깨졌다고 코드까지
 * 못 받으면 곤란하다.
 */
export async function openBundle(bundle: SongBundle): Promise<string[]> {
  const got: string[] = [];

  await saveLocal(bundle.result);
  got.push("코드");
  if (bundle.result.lyrics?.length) got.push("가사");

  if (bundle.sheets) {
    try {
      saveSheets(bundle.result.id, bundle.sheets.query, bundle.sheets.items);
      got.push(`웹 악보 ${bundle.sheets.items.length}건`);
    } catch {
      /* 없어도 곡은 열린다 */
    }
  }
  if (bundle.setup) {
    try {
      saveSetup(bundle.result.id, bundle.setup);
      got.push("연주설정");
    } catch {
      /* 무시 */
    }
  }
  if (bundle.mySheet) {
    try {
      const blob = await fromDataUrl(bundle.mySheet.dataUrl);
      await saveLocalSheet(bundle.result.id, blob, bundle.mySheet.kind);
      got.push("내 악보");
    } catch {
      /* 무시 */
    }
  }
  return got;
}


/** 꾸러미를 파일로 내려받는다. 파일명: 리천 노래명(출처).{id}.rml */
export function downloadBundle(bundle: SongBundle): void {
  const result = bundle.result;
  const name = (result.title || result.id)
    .replace(/[\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 60);
  const source = result.source === "youtube" ? "YouTube" : "업로드";
  // application/json으로 주면 Chrome이 .rml 뒤에 .json을 덧붙인다
  const blob = new Blob([JSON.stringify(bundle)], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `리천 ${name}(${source}).${result.id}.rml`;
  a.click();
  URL.revokeObjectURL(url);
}
