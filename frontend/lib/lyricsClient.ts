"use client";

import { parseLyricsText } from "./lrc";
import { searchQueries, songInfo } from "./llmClient";
import type { LyricLine } from "./types";

/**
 * 브라우저에서 직접 가사 찾기.
 *
 * 분석 서버가 없는 화면에서도 가사를 붙일 수 있게 하는 길이다. 서버가
 * 하던 일(LRCLIB 검색)을 그대로 옮겨 왔다 — LRCLIB은 키가 필요 없고
 * 다른 사이트에서 부르는 것도 막지 않아 브라우저에서 바로 된다.
 *
 * LLM 키가 이 기기에 있으면 검색어를 먼저 다듬는다. 한국 가요가 영문
 * 표기로 등록돼 있어 한글로는 못 찾는 경우를 메운다.
 */

const UA_NOTE = "richeon-guitar-chord-generator";

/** 영상 제목에서 걷어낼 홍보 문구 */
const NOISE =
  /(official|lyrics?|lyric video|m\/?v|music video|audio|visualizer|live|performance|가사|자막|공식|풀버전|full ver\.?|4k|hd|hq|remaster(ed)?|arttrack|art track|color coded)/gi;

/** 영상 제목 → 검색어 */
export function cleanTitle(title: string): string {
  let text = title.split("|")[0];
  text = text.replace(/\[[^\]]*\]/g, " ");
  text = text.replace(/\(([^)]*)\)/g, (m) => (NOISE.test(m) ? " " : m));
  text = text.replace(NOISE, " ");
  text = text.replace(/[-–—_/·]+/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 제목에서 뽑아낼 검색어 후보들.
 *
 * "이장희 - 그건 너"를 통째로 넣으면 못 찾고 "그건 너"만 넣으면 찾히는
 * 일이 흔하다. 가사 목록에 가수 이름이 다르게 적혀 있어서다. 그래서
 * 구분선 앞뒤를 따로도 던져 본다.
 */
export function titleVariants(title: string): string[] {
  const out = [cleanTitle(title)];
  const parts = title
    .split(/\s[-–—]\s/)
    .map((piece) => cleanTitle(piece))
    .filter((piece) => piece.length >= 2);
  // 뒤쪽이 곡명인 경우가 많다. 뒤에서부터 넣는다
  out.push(...parts.reverse());
  const seen = new Set<string>();
  return out.filter((q) => q && !seen.has(q) && seen.add(q));
}

interface Hit {
  syncedLyrics?: string | null;
  duration?: number | null;
}

async function lrclib(query: string, duration: number): Promise<LyricLine[]> {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "Lrclib-Client": UA_NOTE } });
  if (!res.ok) return [];

  const hits = (await res.json()) as Hit[];
  const synced = hits.filter((h) => h.syncedLyrics);
  if (synced.length === 0) return [];

  let best = synced[0];
  if (duration) {
    // 같은 제목의 다른 곡·다른 편곡을 가져다 붙이면 가사가 통째로
    // 어긋난다. 길이가 비슷한 것만 받아들인다.
    const near = synced
      .filter((h) => h.duration)
      .map((h) => ({ gap: Math.abs((h.duration ?? 0) - duration), h }))
      .filter((x) => x.gap <= 15)
      .sort((a, b) => a.gap - b.gap);
    if (near.length === 0) return [];
    best = near[0].h;
  }
  return parseLyricsText(best.syncedLyrics ?? "");
}

/**
 * 곡 제목으로 가사를 찾는다. 못 찾으면 빈 목록.
 *
 * query를 주면 그 검색어만 쓴다(사용자가 직접 넣은 경우). 아니면 제목을
 * 다듬고, LLM이 있으면 로마자 표기까지 만들어 차례로 시도한다.
 */
export async function findLyrics(
  title: string,
  duration: number,
  query = "",
): Promise<LyricLine[]> {
  if (query) {
    // 사용자가 곡을 특정한 상황이므로 길이 조건을 풀어 준다
    return lrclib(query, 0).catch(() => []);
  }

  const variants = titleVariants(title);
  const info = await songInfo(title);
  const attempts = [...searchQueries(info, variants[0]), ...variants.slice(1)];

  for (const q of attempts) {
    try {
      const lines = await lrclib(q, duration);
      if (lines.length) return lines;
    } catch {
      // 한 검색어가 막혀도 다음 것을 시도한다
    }
  }
  // 길이 조건 때문에 놓친 경우를 위해 조건 없이 한 번 더.
  // 라이브·리메이크는 원곡과 길이가 달라 여기서 걸린다.
  for (const q of attempts) {
    try {
      const lines = await lrclib(q, 0);
      if (lines.length) return lines;
    } catch {
      /* 무시 */
    }
  }
  return [];
}
