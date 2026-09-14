/**
 * 악보 가사로 가사 줄을 짓는다 — **악보에 가사가 있으면 악보가 먼저다**.
 *
 * 가사 탭·노래방·그리드의 가사는 분석할 때 보컬을 받아 적은 것이었다.
 * 받아 적기는 글자가 틀리고(「풀잎들처럼」→「풀립들처럼」), 부르지 않은 말을
 * 지어내고(끝에 「아멘」「감사합니다」), 줄을 소절 한가운데서 끊는다. 악보를
 * 붙여도 가사는 그대로여서 「잊혀지는 것」의 가사가 엉망이었다.
 *
 * 악보 가사를 **부르는 차례대로** 편다. 도돌이·되돌이를 따라가며 회차마다
 * 그 절의 가사를 고르고, 음표 자리를 음원의 박에 얹어 시각을 매긴다. 줄은
 * 숨 쉬는 자리(길게 끄는 음·쉼표)에서 끊는다.
 *
 * 악보 가사는 음표마다 한 음절이라 띄어쓰기가 없다. 받아 적은 가사는 글자는
 * 틀려도 띄어쓰기는 대개 맞으니, 글자끼리 짝을 지어 그 띄어쓰기를 빌려 온다.
 * 받아 적은 것이 없으면 숨 쉬는 자리에서만 띄운다.
 */

import { barsOfLine } from "./abcReflow";
import { abcOrders } from "./abcOrder";
import type { Bar } from "./bars";
import type { LyricLine } from "./types";

/** 가사를 받는 음표 하나 — 마디 머리부터 4분음표 몇 개째에서, 몇 박 동안 */
interface Slot {
  at: number;
  len: number;
}

interface ScoreBar {
  slots: Slot[];
  /** 마디 길이(4분음표 수) */
  total: number;
  /** 가사를 받는 음표 수 */
  notes: number;
  /** 절마다 음표 하나에 한 음절(없으면 "") */
  verses: string[][];
}

/** 음표 길이 글(「2」「/2」「3/2」「//」)을 L 단위 배수로 */
function lengthOf(s: string): number {
  const m = /^(\d*)(\/*)(\d*)$/.exec(s);
  if (!m) return 1;
  const num = m[1] ? +m[1] : 1;
  if (!m[2]) return num;
  const den = m[3] ? +m[3] : 2 ** m[2].length;
  return num / den;
}

/** 셋잇단 (p — p개를 몇 개 자리에 넣나 */
const TUPLET_IN: Record<number, number> = { 2: 3, 3: 2, 4: 3, 5: 2, 6: 2, 7: 2, 8: 3, 9: 2 };

/** 마디 글에서 가사를 받는 음표마다 자리와 길이. unit = L 한 칸의 4분음표 수 */
function slotsOfBar(text: string, unit: number): { slots: Slot[]; total: number } {
  const slots: Slot[] = [];
  let t = 0;
  let tuplet = 0;
  let tupletScale = 1;
  let broken: number | null = null; // 앞 음표의 >·<가 이 음표에 남긴 배율
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    const rest = text.slice(i);
    // 코드 이름·장식기호·꾸밈음·줄 안 지시·괄호 번호는 시간을 먹지 않는다
    if (c === '"' || c === "!") {
      const e = text.indexOf(c, i + 1);
      i = e < 0 ? text.length : e + 1;
      continue;
    }
    if (c === "{") {
      const e = text.indexOf("}", i);
      i = e < 0 ? text.length : e + 1;
      continue;
    }
    if (c === "[" && /^\[[A-Za-z]:/.test(rest)) {
      const e = text.indexOf("]", i);
      i = e < 0 ? text.length : e + 1;
      continue;
    }
    const volta = /^\[\d[\d,.-]*/.exec(rest);
    if (volta) {
      i += volta[0].length;
      continue;
    }
    const tu = /^\((\d)(?::\d*){0,2}/.exec(rest);
    if (tu) {
      const p = +tu[1];
      tuplet = p;
      tupletScale = (TUPLET_IN[p] ?? 2) / p;
      i += tu[0].length;
      continue;
    }
    let len = 0;
    let sung = false;
    let used = 0;
    const chord = c === "[" ? /^\[([^\]]*)\]([\d/]*)/.exec(rest) : null;
    const note = /^[_^=]*([A-Ga-gzx])[,']*([\d/]*)/.exec(rest);
    if (chord) {
      const inner = /[A-Ga-g][,']*([\d/]*)/.exec(chord[1]);
      len = lengthOf(inner?.[1] ?? "") * lengthOf(chord[2]);
      sung = true;
      used = chord[0].length;
    } else if (note) {
      len = lengthOf(note[2]);
      sung = !/[zx]/.test(note[1]);
      used = note[0].length;
    } else {
      i += 1;
      continue;
    }
    if (broken !== null) {
      len *= broken;
      broken = null;
    }
    const br = /^(>+|<+)/.exec(text.slice(i + used));
    if (br) {
      const cut = 2 ** -br[1].length;
      len *= br[1][0] === ">" ? 2 - cut : cut;
      broken = br[1][0] === ">" ? cut : 2 - cut;
      used += br[1].length;
    }
    if (tuplet > 0) {
      len *= tupletScale;
      tuplet -= 1;
    }
    if (sung) slots.push({ at: t * unit, len: len * unit });
    t += len;
    i += used;
  }
  return { slots, total: t * unit };
}

/** `w:` 줄을 음표 하나에 한 음절씩. 「사-랑」은 두 음절, 「*」「_」는 빈 자리 */
function syllablesOf(line: string): string[] {
  const out: string[] = [];
  for (const tok of line.replace(/^w:\s*/, "").split(/\s+/)) {
    if (!tok || tok === "|") continue;
    const parts = tok.split("-");
    // 끝의 「-」는 다음 음절로 이어진다는 표시일 뿐 — 빈 조각을 버린다
    if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    for (const p of parts) {
      const s = p.replace(/[_*]/g, "").replace(/~/g, " ").replace(/\\/g, "");
      out.push(s);
    }
  }
  return out;
}

/** 머리글의 L:(음표 한 칸). 없으면 ABC 약속대로 1/8 */
function unitOf(abc: string): number {
  const m = /^L:\s*(\d+)\s*\/\s*(\d+)/m.exec(abc);
  return m ? (4 * +m[1]) / +m[2] : 0.5;
}

/** 악보의 마디마다 음표 자리와 절별 가사 */
function scoreBars(abc: string): ScoreBar[] | null {
  const lines = abc.split("\n");
  const k = lines.findIndex((l) => /^K:/.test(l));
  if (k < 0) return null;
  const unit = unitOf(abc);
  const out: ScoreBar[] = [];
  let group: ScoreBar[] = [];
  let verse = 0;
  for (const line of lines.slice(k + 1)) {
    if (!line.trim()) continue;
    if (/^w:/.test(line)) {
      const syls = syllablesOf(line);
      let at = 0;
      for (const b of group) {
        b.verses[verse] = syls.slice(at, at + b.notes);
        at += b.notes;
      }
      verse += 1;
      continue;
    }
    if (/^(%|[A-Za-z]:)/.test(line)) continue;
    group = barsOfLine(line).map((seg) => {
      const { slots, total } = slotsOfBar(seg.text, unit);
      return { slots, total, notes: seg.notes, verses: [] };
    });
    out.push(...group);
    verse = 0;
  }
  return out;
}

const has = (v: string[] | undefined) => !!v?.some((s) => s.trim());

/** 마디 안의 자리(0~1)를 음원 시각으로. 박 시각을 따라가 늘어난 마디도 맞춘다 */
function timeIn(bar: Bar, f: number): number {
  const pts = [...bar.beatTimes, bar.end];
  const n = pts.length - 1;
  if (n <= 0) return bar.start;
  const x = Math.min(Math.max(f, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  return pts[i] + (pts[i + 1] - pts[i]) * (x - i);
}

/** 받아 적은 가사의 띄어쓰기를 악보 글자에 옮긴다(글자끼리 짝짓기) */
function spacingFrom(chars: string[], source: string): boolean[] | null {
  const src: string[] = [];
  const gapBefore: boolean[] = [];
  let pendingGap = false;
  for (const ch of source) {
    if (/\s/.test(ch)) {
      pendingGap = true;
      continue;
    }
    src.push(ch);
    gapBefore.push(pendingGap);
    pendingGap = false;
  }
  const n = chars.length;
  const m = src.length;
  if (!n || !m) return null;
  // 편집 거리 정렬. 뒤따라가기 표: 0 짝, 1 악보 글자만, 2 받아 적은 글자만
  const back = new Uint8Array((n + 1) * (m + 1));
  let prev = new Uint32Array(m + 1);
  let cur = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) {
    prev[j] = j;
    back[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    back[i * (m + 1)] = 1;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + (chars[i - 1] === src[j - 1] ? 0 : 1);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      let best = diag;
      let dir = 0;
      if (up < best) {
        best = up;
        dir = 1;
      }
      if (left < best) {
        best = left;
        dir = 2;
      }
      cur[j] = best;
      back[i * (m + 1) + j] = dir;
    }
    [prev, cur] = [cur, prev];
  }
  const out: boolean[] = new Array(n).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j >= 0) {
    const dir = back[i * (m + 1) + j];
    if (dir === 0 && j > 0) {
      out[i - 1] = gapBefore[j - 1];
      i--;
      j--;
    } else if (dir === 1 || j === 0) i--;
    else j--;
  }
  return out;
}

interface Syl {
  text: string;
  t: number;
  end: number;
  /** 곡 머리부터 4분음표 몇 개째 */
  pos: number;
}

/** 숨 쉬는 자리 — 앞 음절에서 이만큼(4분음표) 넘게 비면 줄을 끊는다 */
const BREATH = 2.5;
/** 짧은 소절은 이어 붙인다 — 한 줄에 이만큼(음절)까지 */
const LINE_MAX = 16;
/** 이만큼 넘게 비면(간주) 붙이지 않는다 */
const JOIN_GAP = 6;

/**
 * 악보 가사로 지은 가사 줄. 악보에 가사가 없거나 마디를 셀 수 없으면 null.
 *
 * bars는 음원의 마디 격자, barOffset은 악보 첫 마디가 음원 몇째 마디인가.
 * spacing은 띄어쓰기를 빌려 올 가사(보통 지금 가사 — 받아 적은 것이거나,
 * 이미 악보에서 지은 것이면 제 띄어쓰기를 그대로 돌려받는다).
 */
export function scoreLyricLines(
  abc: string,
  bars: Bar[],
  barOffset: number,
  spacing?: LyricLine[] | null,
): LyricLine[] | null {
  const sb = scoreBars(abc);
  if (!sb || !sb.some((b) => b.verses.some((v) => has(v)))) return null;
  const orders = abcOrders(abc);
  if (!orders || orders.measures.length !== sb.length) return null;
  const ms = orders.measures;

  // 도돌이 구간 — 회차마다 다음 절을 부른다. 1·2번 괄호까지 한 구간이다
  const region = ms.map(() => -1);
  let open: number | null = null;
  for (let k = 0; k < ms.length; k++) {
    if (ms[k].startRepeat) open = k;
    if (!ms[k].endRepeat) continue;
    const s = open ?? 0;
    let e = k;
    while (e + 1 < ms.length && ms[e + 1].volta !== null && !ms[e + 1].startRepeat) e++;
    for (let j = s; j <= e; j++) region[j] = s;
    open = null;
  }
  const regionVerses = new Map<number, number>();
  region.forEach((s, j) => {
    if (s < 0) return;
    let n = 0;
    sb[j].verses.forEach((v, i) => {
      if (has(v)) n = Math.max(n, i + 1);
    });
    regionVerses.set(s, Math.max(regionVerses.get(s) ?? 0, n));
  });

  const syls: Syl[] = [];
  const visits = new Map<number, number>();
  let pos = 0;
  orders.withJump.forEach((d, k) => {
    visits.set(d, (visits.get(d) ?? 0) + 1);
    const b = sb[d];
    const bar = bars[k + barOffset];
    const start = pos;
    pos += b.total;
    if (!bar) return;
    const reg = region[d];
    const pass = (visits.get(reg >= 0 ? reg : d) ?? 1) - 1;
    let v: number;
    if (reg >= 0) {
      v = Math.min(pass, Math.max((regionVerses.get(reg) ?? 1) - 1, 0));
    } else {
      // 되돌이로 다시 온 마디: 그 회차의 절이 없으면 적힌 절을 쓴다(후렴)
      v = pass;
      if (!has(b.verses[v])) {
        let w = Math.min(v, b.verses.length - 1);
        while (w > 0 && !has(b.verses[w])) w--;
        if (!has(b.verses[w])) w = b.verses.findIndex((x) => has(x));
        v = Math.max(w, 0);
      }
    }
    const words = b.verses[v] ?? [];
    const even = b.slots.length !== b.notes || !(b.total > 0);
    for (let i = 0; i < b.notes; i++) {
      const s = words[i]?.trim();
      if (!s) continue;
      const slot = even
        ? { at: (i / b.notes) * (b.total || 4), len: (b.total || 4) / b.notes }
        : b.slots[i];
      const total = b.total || 4;
      syls.push({
        text: s,
        t: timeIn(bar, slot.at / total),
        end: timeIn(bar, (slot.at + slot.len) / total),
        pos: start + slot.at,
      });
    }
  });
  if (!syls.length) return null;

  // 띄어쓰기 — 받아 적은 가사에서 빌린다. 없으면 숨 쉬는 자리에서만
  const chars: string[] = [];
  const firstChar: number[] = [];
  for (const s of syls) {
    firstChar.push(chars.length);
    for (const ch of s.text.replace(/\s+/g, "")) chars.push(ch);
  }
  const source = (spacing ?? []).map((l) => l.text).join(" ");
  const gaps = spacingFrom(chars, source);
  const wordStart = syls.map((s, i) =>
    i === 0 ? true : gaps ? gaps[firstChar[i]] : s.pos - syls[i - 1].pos >= 1.5,
  );
  const index = new Map(syls.map((s, i) => [s, i]));
  const count = (p: Syl[]) => p.reduce((n, s) => n + s.text.length, 0);

  // 숨 쉬는 자리로 소절을 나눈다
  const phrases: Syl[][] = [];
  for (const s of syls) {
    const last = phrases[phrases.length - 1];
    if (last && s.pos - last[last.length - 1].pos < BREATH) last.push(s);
    else phrases.push([s]);
  }
  /* 쉬지 않고 이어 부르는 긴 소절(「부드러운 미풍을 … 눈부신 햇살 아래」가
     한 줄이었다)은 낱말 사이에서 가장 길게 끄는 자리로 한 번 더 나눈다.
     양쪽이 비슷한 길이가 되는 쪽을 조금 더 친다 */
  const split = (p: Syl[]): Syl[][] => {
    if (count(p) <= LINE_MAX) return [p];
    let best = -1;
    let score = -Infinity;
    for (let j = 1; j < p.length; j++) {
      if (!wordStart[index.get(p[j]) ?? 0]) continue;
      const left = count(p.slice(0, j));
      const right = count(p) - left;
      if (left < 4 || right < 4) continue;
      const sc = (p[j].pos - p[j - 1].pos) * 4 - Math.abs(left - right) * 0.5;
      if (sc > score) {
        score = sc;
        best = j;
      }
    }
    if (best < 0) return [p];
    return [...split(p.slice(0, best)), ...split(p.slice(best))];
  };
  // 짧은 소절끼리는 한 줄로 잇는다
  const lines: Syl[][] = [];
  for (const p of phrases.flatMap(split)) {
    const last = lines[lines.length - 1];
    if (
      last &&
      count(last) + count(p) <= LINE_MAX &&
      p[0].pos - last[last.length - 1].pos < JOIN_GAP
    )
      last.push(...p);
    else lines.push([...p]);
  }

  return lines.map((line) => {
    let text = "";
    line.forEach((s, j) => {
      const gap = wordStart[index.get(s) ?? 0];
      text += (j > 0 && gap ? " " : "") + s.text;
    });
    return {
      t: +line[0].t.toFixed(2),
      end: +line[line.length - 1].end.toFixed(2),
      text,
    };
  });
}
