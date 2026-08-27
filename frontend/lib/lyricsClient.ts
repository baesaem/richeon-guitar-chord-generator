"use client";

import { parseLyricsText } from "./lrc";
import {
  artistNames,
  lyricsFromAi,
  moreQueries,
  searchQueries,
  songInfo,
} from "./llmClient";
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
  plainLyrics?: string | null;
  duration?: number | null;
  artistName?: string | null;
  trackName?: string | null;
}

/** 곡을 맞춰 볼 단서. 가수 이름들과 원래 제목 */
interface Expect {
  artists: string[];
  title: string;
}

const tokens = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[0-9a-z가-힣]+/g) ?? []).filter((t) => t.length >= 2));

const overlaps = (a: string, b: string): boolean => {
  const left = tokens(a);
  for (const t of tokens(b)) if (left.has(t)) return true;
  return false;
};

/**
 * 이 검색 결과가 우리가 찾던 곡인가.
 *
 * 로마자로 찾으면 엉뚱한 곡이 잘 걸린다. 실측: "이장희 - 그건 너"의 영어
 * 번역 제목 "That's You"로 검색하니 Lucky Daye·Gold Revere 등 무관한
 * 영어 곡이 20건 나왔고, 그중 하나는 길이가 3초 차이라 그대로 붙었다.
 *
 * 가수만 봐도 안 된다. 옛 가요는 동기화 가사가 리메이크한 가수 이름으로
 * 올라 있다 — "그건 너"의 동기화 가사는 민해경으로 등록돼 있다.
 *
 * 그래서 가수가 맞거나, 원래 제목(한글)이 맞으면 받아들인다. 번역 제목으로
 * 맞추면 "That's You"가 다시 통과한다.
 */
function songMatches(hit: Hit, expect: Expect | null): boolean {
  if (!expect) return true;
  const artists = expect.artists.filter(Boolean);
  if (!artists.length && !expect.title) return true;
  if (artists.some((name) => overlaps(name, hit.artistName ?? ""))) return true;
  return !!expect.title && overlaps(expect.title, hit.trackName ?? "");
}

/**
 * 시각 없는 가사에 시각을 붙인다.
 *
 * 노래 길이에 고르게 편다. 맞을 리는 없지만, 악보에 아예 못 붙이는 것보다
 * 낫다는 판단이다. 앞뒤로 전주·후주를 조금 비워 둔다.
 */
function spread(lines: string[], duration: number): LyricLine[] {
  if (!lines.length) return [];
  const start = duration ? duration * 0.08 : 0;
  const end = duration ? duration * 0.92 : lines.length * 4;
  const step = Math.max((end - start) / lines.length, 0.5);
  return lines.map((text, i) => ({
    t: Math.round((start + i * step) * 100) / 100,
    end: Math.round((start + (i + 1) * step) * 100) / 100,
    text,
  }));
}

/** 시각 없는 가사 본문. 동기화 가사가 없을 때의 차선책. */
async function lrclibPlain(
  query: string,
  duration: number,
  expect: Expect | null = null,
): Promise<string[]> {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "Lrclib-Client": UA_NOTE } });
  if (!res.ok) return [];
  const hits = (await res.json()) as Hit[];
  const plain = hits.filter((h) => h.plainLyrics && songMatches(h, expect));
  if (!plain.length) return [];

  let best = plain[0];
  if (duration) {
    const near = plain
      .filter((h) => h.duration)
      .map((h) => ({ gap: Math.abs((h.duration ?? 0) - duration), h }))
      .filter((x) => x.gap <= 15)
      .sort((a, b) => a.gap - b.gap);
    if (!near.length) return [];
    best = near[0].h;
  }
  return String(best.plainLyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function lrclib(
  query: string,
  duration: number,
  expect: Expect | null = null,
): Promise<LyricLine[]> {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "Lrclib-Client": UA_NOTE } });
  if (!res.ok) return [];

  const hits = (await res.json()) as Hit[];
  const synced = hits.filter((h) => h.syncedLyrics && songMatches(h, expect));
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
export interface FoundLyrics {
  lines: LyricLine[];
  /** 시각이 어림인가. 줄을 고르게 편 경우 참 */
  approx: boolean;
}

export async function findLyrics(
  title: string,
  duration: number,
  query = "",
): Promise<FoundLyrics> {
  if (query) {
    // 사용자가 곡을 특정한 상황이므로 길이 조건을 풀어 준다
    const lines = await lrclib(query, 0).catch(() => []);
    if (lines.length) return { lines, approx: false };
    const plain = await lrclibPlain(query, 0).catch(() => []);
    return { lines: spread(plain, duration), approx: plain.length > 0 };
  }

  const variants = titleVariants(title);
  const info = await songInfo(title);
  const attempts = [...searchQueries(info, variants[0]), ...variants.slice(1)];
  const expect: Expect | null = info
    ? { artists: artistNames(info), title: info.title }
    : null;

  for (const q of attempts) {
    try {
      const lines = await lrclib(q, duration, expect);
      if (lines.length) return { lines, approx: false };
    } catch {
      // 한 검색어가 막혀도 다음 것을 시도한다
    }
  }
  // 길이 조건 때문에 놓친 경우를 위해 조건 없이 한 번 더.
  // 라이브·리메이크는 원곡과 길이가 달라 여기서 걸린다.
  for (const q of attempts) {
    try {
      const lines = await lrclib(q, 0, expect);
      if (lines.length) return { lines, approx: false };
    } catch {
      /* 무시 */
    }
  }

  // 표기가 달라 못 찾았을 수 있다. AI에게 다른 표기를 받아 다시 훑는다.
  const extra = (await moreQueries(info)).filter((q) => !attempts.includes(q));
  for (const q of extra) {
    try {
      const lines = await lrclib(q, 0, expect);
      if (lines.length) return { lines, approx: false };
    } catch {
      /* 무시 */
    }
  }

  // 여기부터는 시각이 어림이다. 못 붙이는 것보다 낫다는 판단.
  for (const q of [...attempts, ...extra]) {
    try {
      const plain = await lrclibPlain(q, duration, expect);
      if (plain.length) return { lines: spread(plain, duration), approx: true };
    } catch {
      /* 무시 */
    }
  }

  // 마지막으로 AI에게 가사를 물어본다. 대개 저작권을 이유로 거부한다.
  const ai = await lyricsFromAi(info);
  return { lines: spread(ai, duration), approx: ai.length > 0 };
}
