"use client";

import type { LyricLine } from "./types";

/**
 * LRC / 자막 텍스트 → 가사 줄 목록.
 *
 * 서버가 없는 수강생 기기에서도 가사 파일을 넣을 수 있어야 해서
 * 파싱을 프론트에도 둔다(백엔드 lyrics.py와 같은 규칙).
 */

// [mm:ss.xx] — 한 줄 앞에 여러 개가 붙기도 한다
const LRC_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
// 00:00:12.345 --> 00:00:15.678
const VTT_CUE =
  /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function finish(rows: { t: number; text: string }[]): LyricLine[] {
  rows.sort((a, b) => a.t - b.t);
  return rows.map((row, i) => ({
    t: Math.round(row.t * 100) / 100,
    end: i + 1 < rows.length ? Math.round(rows[i + 1].t * 100) / 100 : 0,
    text: row.text,
  }));
}

function parseLrc(text: string): LyricLine[] {
  const rows: { t: number; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(LRC_TAG)];
    if (tags.length === 0) continue;
    const last = tags[tags.length - 1];
    const body = raw.slice((last.index ?? 0) + last[0].length).trim();
    if (!body) continue; // 간주 표시는 넣지 않는다
    for (const tag of tags) {
      const frac = tag[3];
      // [mm:ss.xx]의 xx는 1/100초, [mm:ss.xxx]는 1/1000초
      const sub = frac ? Number(frac) / (frac.length === 3 ? 1000 : 100) : 0;
      rows.push({ t: Number(tag[1]) * 60 + Number(tag[2]) + sub, text: body });
    }
  }
  return finish(rows);
}

/** 자막 한 줄에서 태그·엔티티·효과음 표기를 걷어낸다. */
function cleanCaption(line: string): string {
  const el = document.createElement("textarea"); // &gt; 같은 엔티티 해석
  el.innerHTML = line.replace(/<[^>]+>/g, "");
  return el.value
    .replace(/[[(](?:음악|노래|박수|웃음|Music|Applause|Laughter)[\])]/gi, " ")
    .replace(/>>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 앞 줄 끝과 겹치는 부분을 뒤 줄 앞에서 잘라낸다.
 *
 * 자동 자막은 창을 밀어 가며 같은 말을 반복 송출한다. 짧은 겹침(조사
 * 정도)은 우연일 수 있어 네 글자 이상일 때만 자른다.
 */
function stripOverlap(prev: string, cur: string): string {
  for (let n = Math.min(prev.length, cur.length); n > 3; n--) {
    if (prev.endsWith(cur.slice(0, n))) return cur.slice(n).trim();
  }
  return cur;
}

function parseVtt(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let start: number | null = null;
  let end = 0;
  let buffer: string[] = [];

  const flush = () => {
    if (start !== null && buffer.length) {
      const body = buffer.join(" ").trim();
      if (body) lines.push({ t: start, end, text: body });
    }
    start = null;
    end = 0;
    buffer = [];
  };

  const secs = (h: string, m: string, s: string, ms: string) =>
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

  for (const raw of text.split(/\r?\n/)) {
    const cue = VTT_CUE.exec(raw);
    if (cue) {
      flush();
      start = secs(cue[1], cue[2], cue[3], cue[4]);
      end = secs(cue[5], cue[6], cue[7], cue[8]);
      continue;
    }
    if (!raw.trim()) {
      flush();
      continue;
    }
    if (/^(WEBVTT|Kind:|Language:|NOTE|STYLE)/.test(raw)) continue;
    const cleaned = cleanCaption(raw);
    if (cleaned) buffer.push(cleaned);
  }
  flush();

  // 자동 자막의 롤업 중복 제거
  const out: LyricLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1]?.text;
    let text = line.text;
    if (prev !== undefined) {
      if (text === prev || prev.includes(text)) continue;
      // 앞 줄이 통째로 들어 있으면 늘어난 부분만, 아니면 겹친 앞머리만 자른다
      text = text.includes(prev)
        ? text.replace(prev, "").trim()
        : stripOverlap(prev, text);
      if (!text) continue;
    }
    out.push({ t: line.t, end: line.end, text });
  }
  return out;
}

/**
 * 시간이 없는 맨 가사를 곡 길이에 고르게 펼친다.
 *
 * 타이밍이 아예 없는 것보다는 낫다는 절충이다. 간주가 있는 곡에서는
 * 어긋나므로, 정확한 동기화가 필요하면 .lrc를 넣어야 한다.
 */
function spread(text: string, duration: number): LyricLine[] {
  const rows = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rows.length || !duration) return [];
  const step = duration / rows.length;
  return rows.map((body, i) => ({
    t: Math.round(i * step * 100) / 100,
    end: Math.round((i + 1) * step * 100) / 100,
    text: body,
  }));
}

/** 붙여넣은 텍스트나 파일 내용을 형식에 맞게 해석한다. */
export function parseLyricsText(text: string, duration = 0): LyricLine[] {
  if (VTT_CUE.test(text)) return parseVtt(text);
  const lrc = parseLrc(text);
  if (lrc.length) return lrc;
  return spread(text, duration);
}

/** 지금 시각에 해당하는 줄 번호. 없으면 -1. */
export function lyricIndexAt(lines: LyricLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
