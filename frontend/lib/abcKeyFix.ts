"use client";

/**
 * 악보 파일로 붙인 멜로디를 **음원과 같은 조로** 옮겨 둔다.
 *
 * 악보 파일은 흔히 부르기 쉬운 조(G·C)로 적혀 있고 음원은 가수의 조다.
 * 화면에서만 옮겨 보이면 「원키 C (종이 악보 G)」처럼 표시가 붙고, 음높이
 * 0이 무엇을 뜻하는지도 곡마다 달라진다. 옮길 수 있는 악보는 글째 음원
 * 조로 옮겨 두면 표시가 필요 없고, 음높이 0이 늘 원곡 그대로다.
 *
 * **종이악보가 붙은 곡은 옮기지 않는다** — 악보 그림(PDF 쪽)이나 내 악보
 * (사진·PDF)가 있는 곡. 멜로디가 그 종이를 옮겨 적은 것이라, 종이와
 * 같은 조여야 나란히 놓고 본다. 그림 타브만 있는 곡은 종이악보가 아니다
 * (파일에서 만든 타브도 그 칸에 담긴다) — 옮긴다.
 *
 * 곡 화면에서 보이는 모습은 되도록 그대로 둔다. 타브 숫자(타브 보표·그림
 * 타브)가 있거나 음높이를 손으로 옮겨 둔 곡은 그만큼 음높이를 되돌려 같은
 * 조로 보이게 하고 — 숫자는 적힌 조로 박혀 있다 — 손대지 않은 곡은 음높이
 * 0(원곡 조)으로 연다.
 */

import { getAbc, saveAbc } from "./abcStore";
import { abcKeyGap, abcKeyName, transposeAbc } from "./abcTranspose";
import { getLocalSheet } from "./library";
import {
  DEFAULT_SETUP,
  clampPitch,
  hasSetup,
  loadSetup,
  saveSetup,
  type SongSetup,
} from "./perSong";
import type { AnalysisResult } from "./types";

export interface KeyFix {
  id: string;
  title: string;
  /** 옮기기 전 악보의 조(「G」) */
  from: string;
  /** 옮긴 뒤(음원의 조, 「C」) */
  to: string;
  at: number;
}

const LOG = "chordgen.keyFix";

/** 이 기기에서 음원 조로 옮긴 곡들(최근 것이 뒤) */
export function keyFixLog(): KeyFix[] {
  try {
    const all = JSON.parse(localStorage.getItem(LOG) ?? "[]") as KeyFix[];
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/** 종이악보가 붙은 곡인가 — 악보 그림 쪽이나 이 기기의 내 악보 */
async function hasPaper(result: AnalysisResult): Promise<boolean> {
  const pages = (result.sheet as { pages?: unknown[] } | null | undefined)?.pages;
  if (pages?.length) return true;
  return !!(await getLocalSheet(result.id).catch(() => null));
}

/**
 * 이 곡의 멜로디 악보가 음원과 다른 조면 음원 조로 옮긴다.
 * 옮겼으면 무엇을 옮겼는지, 아니면 null. 두 번 불러도 한 번만 옮긴다.
 */
export async function fitAbcToAudioKey(
  result: AnalysisResult | null,
): Promise<KeyFix | null> {
  if (!result?.id || !result.key) return null;
  const first = getAbc(result.id);
  if (!first?.abc?.trim() || !abcKeyGap(first.abc, result.key)) return null;
  if (await hasPaper(result)) return null;

  // 기기를 살피는 사이 다른 곳에서 옮겼을 수 있다 — 다시 읽는다
  const entry = getAbc(result.id);
  if (!entry?.abc?.trim()) return null;
  const gap = abcKeyGap(entry.abc, result.key);
  if (!gap) return null;
  const next = transposeAbc(entry.abc, -gap);
  if (!next || next === entry.abc) return null;

  // 되돌릴 수 있게 옮기기 전 것을 남긴다
  try {
    localStorage.setItem(`chordgen.abc.backup.${result.id}.key`, JSON.stringify(entry));
  } catch {
    /* 자리가 모자라도 옮기기는 한다 */
  }
  saveAbc(result.id, next, entry.barOffset ?? 0);

  /* 음높이. 화면 조 = 악보 조 − 음높이이므로, 악보를 −gap 옮긴 만큼
     음높이도 −gap 옮기면 보이는 것이 그대로다 */
  const had = hasSetup(result.id);
  const cur: SongSetup = had
    ? loadSetup(result.id)
    : {
        ...DEFAULT_SETUP,
        ...((result.setup ?? {}) as Partial<SongSetup>),
        loop: null,
        transpose: 0,
      };
  const frets = !!entry.tabScore || !!result.picked_tab;
  const keep = frets || cur.transpose !== 0;
  const t = keep ? clampPitch(cur.transpose - gap) : 0;
  if (t !== cur.transpose) saveSetup(result.id, { ...cur, transpose: t });

  const fix: KeyFix = {
    id: result.id,
    title: result.title || result.id,
    from: abcKeyName(entry.abc) ?? "?",
    to: abcKeyName(next) ?? "?",
    at: Date.now(),
  };
  try {
    const log = keyFixLog().filter((f) => f.id !== fix.id);
    localStorage.setItem(LOG, JSON.stringify([...log, fix].slice(-100)));
  } catch {
    /* 기록은 없어도 된다 */
  }
  return fix;
}
