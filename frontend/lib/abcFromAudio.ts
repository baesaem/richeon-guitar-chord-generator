/**
 * 음원의 가사·코드를 멜로디 악보(ABC)에 적어 넣는다(강사님: 「Lost Stars — 악보에도
 * 가사를 넣어 줘, 코드도 붙여」).
 *
 * 보컬에서 뽑은 악보에는 가사도 코드도 없다. 곡에는 이미 두 가지가 시각과 함께 있다 —
 * 가사 줄(받아쓴 낱말 시각에 맞춘 음절, 노래방이 쓰는 것)과 분석한 코드(시작 시각).
 * 음원의 마디 격자로 악보 음표마다 부르는 시각을 셈해,
 *
 * - 음절은 그 시각에 가장 가까운 **부르는 음표**(붙임줄로 이어진 음은 빼고) 밑에,
 * - 코드는 바뀌는 시각에 가장 가까운 **음표·쉼표** 앞에
 *
 * 적는다. 영어는 낱말 하나(Lost·Stars), 한글은 글자 하나가 음표 하나다. 있던 가사 줄과
 * 코드 이름은 걷어 낸다. 되돌이가 있는 악보는 처음 부르는 바퀴의 시각으로 놓는다.
 */

import { barsOfLine } from "./abcReflow";
import { abcOrders } from "./abcOrder";
import type { Bar } from "./bars";
import type { KaraokeSyl } from "./karaokeSyllables";
import { barTokens, timeIn, unitOf, type BarToken } from "./scoreLyrics";

export interface AudioChord {
  start: number;
  label: string;
}

const isNoChord = (label: string) => /^\s*n\.?\s*c\.?\s*$/i.test(label);

/** ABC 가사 글자로 — 붙임표·밑줄·별표·물결은 가사 줄에서 뜻이 있다 */
const lyricToken = (s: string) =>
  s.trim().replace(/\\/g, "").replace(/([-_*~|])/g, "\\$1").replace(/\s+/g, "~") || "*";

export function abcFromAudio(
  abc: string,
  bars: Bar[],
  barOffset: number,
  opts: { syllables?: KaraokeSyl[] | null; chords?: AudioChord[] | null },
): { abc: string; words: number; chords: number; gaps: number[] } | null {
  const lines = abc.split("\n");
  const k = lines.findIndex((l) => /^K:/.test(l));
  if (k < 0 || !bars.length) return null;
  const unit = unitOf(abc);

  // 적힌 마디 → 처음 부르는 차례(되돌이가 없으면 같다)
  let firstPlay: number[] = [];
  try {
    const o = abcOrders(abc);
    if (o) {
      const seen = new Map<number, number>();
      o.withJump.forEach((d, i) => {
        if (!seen.has(d)) seen.set(d, i);
      });
      firstPlay = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    }
  } catch {
    firstPlay = [];
  }

  interface Seg {
    text: string;
    tokens: BarToken[];
    /** 이 마디가 음원에서 흐르는 자리 */
    bar: Bar | undefined;
    total: number;
  }
  interface Row {
    li: number;
    segs: Seg[];
  }
  const rows: Row[] = [];
  let written = 0;
  for (let li = k + 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim() || /^(w:|W:|%|[A-Za-z]:)/.test(line)) continue;
    const segs = barsOfLine(line).map((seg) => {
      // 있던 코드 이름은 걷는다(덧말 「^…」「_…」 같은 메모는 남긴다)
      const text = opts.chords ? seg.text.replace(/"(?![\^_<>@])[^"]*"/g, "") : seg.text;
      const { tokens, total } = barTokens(text, unit);
      const play = firstPlay[written] ?? written;
      written += 1;
      return { text, tokens, bar: bars[play + barOffset], total: total || 4 };
    });
    rows.push({ li, segs });
  }

  // ---- 가사: 음절 → 가장 가까운 부르는 음표 ----
  interface NoteRef {
    row: number;
    idx: number; // 이 줄 가사 칸 차례(부르는 음표마다 하나, 붙임줄 뒤 음도 칸을 차지한다)
    t: number;
    free: boolean; // 붙임줄로 이어져 온 음이 아니다 — 새 음절을 받을 수 있다
  }
  const notes: NoteRef[] = [];
  let tiedIn = false;
  rows.forEach((r, ri) => {
    let idx = 0;
    for (const s of r.segs) {
      for (const tk of s.tokens) {
        if (!tk.sung) {
          tiedIn = false;
          continue;
        }
        const t = s.bar ? timeIn(s.bar, tk.at / s.total) : NaN;
        notes.push({ row: ri, idx, t, free: !tiedIn });
        idx += 1;
        tiedIn = tk.tieOut;
      }
    }
  });
  const cells: string[][] = rows.map(() => []);
  notes.forEach((n) => (cells[n.row][n.idx] = "*"));
  let words = 0;
  /** 음절마다 놓인 음표와의 시각 차(초) — 앞 음표에 붙인 것은 그 음표와의 차 */
  const gaps: number[] = [];
  const syls = (opts.syllables ?? []).filter((s) => s.text.trim());
  if (syls.length) {
    const free = notes.filter((n) => n.free && Number.isFinite(n.t));
    let p = 0;
    let last: NoteRef | null = null;
    for (let i = 0; i < syls.length; i++) {
      const s = syls[i];
      const next = syls[i + 1]?.t ?? Infinity;
      // 이 음절 시각 앞뒤에서 가장 가까운 빈 음표 — 다음 음절 자리를 넘지 않게
      let best = -1;
      let gap = Infinity;
      for (let j = p; j < free.length && free[j].t < Math.min(s.t + 0.6, next); j++) {
        const d = Math.abs(free[j].t - s.t);
        if (d < gap) {
          gap = d;
          best = j;
        }
      }
      if (best >= 0 && gap < 1.2) {
        const n = free[best];
        cells[n.row][n.idx] = lyricToken(s.text);
        p = best + 1;
        last = n;
        words += 1;
        gaps.push(gap);
      } else if (last) {
        // 맞는 음표가 없다(악보에 그 음이 빠졌다) — 앞 음표에 붙여 글자는 잃지 않는다
        cells[last.row][last.idx] += "~" + lyricToken(s.text);
        words += 1;
        gaps.push(Math.abs(s.t - last.t));
      }
    }
  }

  // ---- 코드: 바뀌는 시각 → 가장 가까운 음표·쉼표 앞 ----
  let chordCount = 0;
  const changes: AudioChord[] = [];
  for (const c of [...(opts.chords ?? [])].sort((a, b) => a.start - b.start)) {
    const label = c.label.trim();
    if (!label || isNoChord(label)) {
      if (changes.length && !isNoChord(changes[changes.length - 1].label))
        changes.push({ start: c.start, label: "N.C." });
      continue;
    }
    if (changes.length && changes[changes.length - 1].label === label) continue;
    changes.push({ start: c.start, label });
  }
  const insertAt: Map<Seg, { char: number; name: string }[]> = new Map();
  if (changes.length) {
    const spots: { seg: Seg; char: number; t: number }[] = [];
    for (const r of rows)
      for (const s of r.segs)
        for (const tk of s.tokens)
          if (s.bar) spots.push({ seg: s, char: tk.char, t: timeIn(s.bar, tk.at / s.total) });
    let q = 0;
    let prevLabel = "";
    for (const c of changes) {
      if (isNoChord(c.label)) {
        prevLabel = "";
        continue;
      }
      while (q + 1 < spots.length && spots[q + 1].t <= c.start + 0.12) q++;
      // 바로 뒤 자리가 더 가까우면 그쪽
      let at = q;
      if (q + 1 < spots.length && Math.abs(spots[q + 1].t - c.start) < Math.abs(spots[q].t - c.start))
        at = q + 1;
      const spot = spots[at];
      if (!spot || Math.abs(spot.t - c.start) > 2.5 || c.label === prevLabel) continue;
      const list = insertAt.get(spot.seg) ?? [];
      // 한 자리에 둘이 오면 뒤의 것이 이긴다
      const same = list.findIndex((x) => x.char === spot.char);
      if (same >= 0) list[same].name = c.label;
      else {
        list.push({ char: spot.char, name: c.label });
        chordCount += 1;
      }
      insertAt.set(spot.seg, list);
      prevLabel = c.label;
    }
  }

  // ---- 다시 적기 ----
  const out: string[] = [];
  let ri = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (li > k && /^w:/.test(line) && syls.length) continue; // 옛 가사 줄은 버린다
    const r = rows[ri];
    if (!r || r.li !== li) {
      out.push(line);
      continue;
    }
    const text = r.segs
      .map((s) => {
        const list = insertAt.get(s) ?? [];
        let t = s.text;
        for (const x of [...list].sort((a, b) => b.char - a.char))
          t = t.slice(0, x.char) + `"${x.name.replace(/"/g, "")}"` + t.slice(x.char);
        return t;
      })
      .join("");
    out.push(text);
    if (syls.length && cells[ri].length) out.push("w: " + cells[ri].join(" "));
    ri += 1;
  }
  return { abc: out.join("\n"), words, chords: chordCount, gaps };
}
