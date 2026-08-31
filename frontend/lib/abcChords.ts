"use client";

/**
 * 악보·파형·타브의 코드를 **한 벌로 모은다.**
 *
 * 악보에 인쇄된 코드와 음원에서 딴 코드가 어긋나는 일이 있다 — 악보는
 * 편곡자가 단순하게 적거나 옛 판을 옮긴 것이고, 파형·타브 화면은 실제
 * 녹음에서 들리는 것을 보여 준다. 두 화면이 서로 다른 코드를 말하면
 * 수업에서 어느 쪽을 잡으라 할 수 없다.
 *
 * 그래서 **다른 자리만** 원곡 쪽으로 맞춘다. 같은 자리는 악보에 적힌
 * 이름을 그대로 둔다 — Cm6·Fsus4처럼 자세히 적힌 이름을 뭉뚱그린
 * 이름으로 덮어쓰면 도리어 잃는 것이 많다.
 *
 * 조를 먼저 맞춘다. 카포 2로 적힌 악보는 E로 쓰고 F♯으로 울린다 —
 * 조를 맞추지 않으면 모든 마디가 「다르다」고 나온다.
 */

import { abcOrders } from "./abcOrder";
import { chordIndexAt, type Bar } from "./bars";
import { parseLabel } from "./editChords";
import type { Chord } from "./types";

const PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
/** 내림표를 쓰는 조. 여기 없으면 올림표로 적는다 */
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]);

/** 음이름 → 반음 번호. 알아보지 못하면 null */
function pcOf(name: string): number | null {
  const m = /^([A-G])([#b♯♭]*)/.exec(name.trim());
  if (!m) return null;
  let pc = PC[m[1]];
  for (const ch of m[2]) pc += ch === "#" || ch === "♯" ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

/** 코드 이름을 옮긴다. 뿌리와 베이스만 건드리고 성질은 그대로 둔다 */
export function moveChord(
  label: string,
  semitones: number,
  flats: boolean,
): string {
  if (!label || label === "N.C.") return label;
  const table = flats ? FLAT : SHARP;
  return label
    .split("/")
    .map((part) => {
      const m = /^([A-G][#b♯♭]*)(.*)$/.exec(part.trim());
      if (!m) return part;
      const pc = pcOf(m[1]);
      if (pc === null) return part;
      return table[(((pc + semitones) % 12) + 12) % 12] + m[2];
    })
    .join("/");
}

/**
 * 코드 성질의 뼈대. 장조 쪽인가 단조 쪽인가, 둘뿐이다.
 *
 * D7과 D, Cm6과 Cm은 「같은 코드를 자세히 적은 것」이다. Dadd4와 Dsus4도
 * 기타에서는 거의 같이 짚는다. 음원에서 딴 이름은 이런 잔가지를 미덥지
 * 않게 짚으므로, 잔가지로 악보를 고치면 얻는 것 없이 잃기만 한다.
 *
 * 수강생이 잘못 짚게 되는 어긋남은 둘뿐이다 — **뿌리음이 다르거나,
 * 장조를 단조로(또는 그 반대로) 짚거나**. 그것만 고쳐 적는다.
 */
function family(rest: string): string {
  const r = rest.replace(/\s+/g, "").toLowerCase();
  // 감화음은 단조 쪽, 증화음·서스펜디드는 장조 쪽으로 친다
  if (/^(dim|°|ø)/.test(r)) return "min";
  if (/^m(?!aj)/.test(r)) return "min";
  return "maj";
}

/** ABC에 적을 수 있는 이름으로. ♯♭는 #b로 적는다 */
function plain(label: string): string {
  return label.replace(/♯/g, "#").replace(/♭/g, "b").trim();
}

/** 같은 코드로 볼 것인가. 뿌리와 뼈대가 같으면 악보 쪽 이름을 살린다 */
function same(a: string, b: string): boolean {
  const split = (s: string) => {
    const head = s.split("/")[0].trim();
    const m = /^([A-G][#b♯♭]*)(.*)$/.exec(head);
    return m ? { pc: pcOf(m[1]), fam: family(m[2]) } : null;
  };
  const x = split(a);
  const y = split(b);
  if (!x || !y || x.pc === null || y.pc === null) return a.trim() === b.trim();
  return x.pc === y.pc && x.fam === y.fam;
}

interface Slot {
  /** 원문에서 코드 이름이 놓인 자리(따옴표 안) */
  from: number;
  to: number;
  label: string;
}

interface Meas {
  slots: Slot[];
  /** 마디 안 음표들이 시작하는 자리. 코드를 새로 끼워 넣을 때 쓴다 */
  notes: number[];
}

/**
 * 본문을 마디로 쪼개면서 코드 이름의 자리를 적어 둔다.
 *
 * abcOrder의 abcMeasures와 같은 규칙으로 쪼갠다 — 마디 수가 어긋나면
 * 아무것도 손대지 않는다(아래 songChords가 확인한다).
 */
function scan(abc: string): Meas[] {
  const out: Meas[] = [];
  let cur: Slot[] = [];
  let notes: number[] = [];
  let hasNote = false;
  const close = () => {
    if (hasNote) out.push({ slots: cur, notes });
    cur = [];
    notes = [];
    hasNote = false;
  };

  const lines = abc.split("\n");
  let pos = 0;
  let started = false;
  for (const line of lines) {
    const head = pos;
    pos += line.length + 1;
    if (!started) {
      if (/^K:/.test(line)) started = true;
      continue;
    }
    if (!line.trim() || /^(w:|W:|%)/.test(line)) continue;

    for (let k = 0; k < line.length;) {
      const c = line[k];
      if (c === '"') {
        const e = line.indexOf('"', k + 1);
        const end = e < 0 ? line.length : e;
        const text = line.slice(k + 1, end);
        // ^ _ < > @ 로 시작하는 것은 코드가 아니라 덧붙인 글자다
        if (text && !"^_<>@".includes(text[0]))
          cur.push({ from: head + k + 1, to: head + end, label: text });
        k = end + 1;
        continue;
      }
      if (c === "!") {
        const e = line.indexOf("!", k + 1);
        k = (e < 0 ? line.length : e) + 1;
        continue;
      }
      if (c === "[" && /^\[[A-Za-z]:/.test(line.slice(k, k + 3))) {
        const e = line.indexOf("]", k);
        k = (e < 0 ? line.length : e) + 1;
        continue;
      }
      const bar = /^(:\|:|::|\|:|:\||\|\]|\|\||\|)/.exec(line.slice(k));
      if (bar) {
        close();
        k += bar[1].length;
        continue;
      }
      if (/[A-Ga-gz]/.test(c)) {
        hasNote = true;
        // 임시표(^ _ =)는 음표의 일부다 — 코드는 그 앞에 놓아야 한다
        let at = k;
        while (at > 0 && "^_=".includes(line[at - 1])) at--;
        notes.push(head + at);
      }
      k++;
    }
  }
  close();
  return out;
}

/**
 * 이 마디에서 파형·타브가 적는 코드. 많아야 둘이다.
 *
 * 코드악보(ChordScore)가 쓰는 법을 그대로 따른다 — 박마다 코드가
 * 바뀌었는지 보고, 바뀐 것만 적되 셋째부터는 적지 않는다. 셈법이
 * 조금이라도 다르면 화면끼리 또 어긋난다.
 */
function heardIn(bar: Bar, chords: Chord[]): string[] {
  const beats = bar.beatTimes.length ? bar.beatTimes : [bar.start];
  const name = (i: number) => {
    const label = i >= 0 ? chords[i]?.label : "";
    return label && label !== "N.C." ? plain(label) : "";
  };
  const head = chordIndexAt(chords, beats[0]);
  const out: string[] = [];
  // 마디 첫머리에 울리는 코드. 앞 마디에서 이어져 온 것이라도 이것이다
  if (name(head)) out.push(name(head));
  // 마디 안에서 한 번 바뀌면 그것까지. 셋째부터는 코드악보도 적지 않는다
  for (let b = 1; b < beats.length; b++) {
    const idx = chordIndexAt(chords, beats[b]);
    if (idx !== head) {
      if (name(idx)) out.push(name(idx));
      break;
    }
  }
  return out;
}

/** 마디에 걸린 코드 가운데 가장 오래 울린 것 */
function mainChord(bar: Bar, from: number, to: number): string | null {
  let best: string | null = null;
  let span = 0;
  for (const c of bar.chords) {
    if (c.label === "N.C." || !c.root) continue;
    const overlap = Math.min(c.end, to) - Math.max(c.start, from);
    if (overlap > span) {
      span = overlap;
      best = c.label;
    }
  }
  // 마디의 4분의 1도 못 채우는 것은 스쳐 간 것이다
  return span > (to - from) * 0.25 ? best : null;
}

/** 어느 쪽 코드를 원본으로 삼았나 */
export type ChordSource = "score" | "audio" | "none";

export interface SongChordResult {
  /** 악보에 그릴 ABC. 카포 악보일 때만 코드가 바뀐다 */
  abc: string;
  /** 파형·타브에 쓸 코드. 오리지날 악보일 때만 채워진다 */
  chords: Chord[] | null;
  /** score = 악보 코드로 모음 · audio = 음원 코드로 모음 · none = 손대지 않음 */
  source: ChordSource;
  /** 원본과 달라 갈아 끼운 자리 수 */
  changed: number;
  /** 견주어 본 코드 자리 수 */
  total: number;
  /** 이미 같았던 자리 수. 너무 적으면 손대지 않는다 */
  matched: number;
  /** 악보와 음원의 조 차이(반음). 0이 아니면 카포로 옮겨 적은 악보다 */
  shift: number;
}

/** 코드 이름 → Chord 한 칸. 분수코드는 베이스를 떼어 낸다 */
function toChord(label: string, start: number, end: number): Chord {
  const [head, bass] = plain(label).split("/");
  const { root, quality } = parseLabel(head);
  return {
    start: +start.toFixed(3),
    end: +end.toFixed(3),
    label: plain(label),
    root,
    quality,
    bass: bass ?? null,
    // 악보에 적힌 것이라 확신도는 최대다
    confidence: 1,
    edited: false,
  };
}

/**
 * 악보의 코드를 원곡 코드와 견주어, 다른 자리만 고쳐 적는다.
 *
 * @param abc       악보 원문
 * @param bars      음원에서 딴 마디 격자
 * @param barOffset 악보 첫 마디가 음원의 몇 번째 마디인가
 */
export function unifyChords(
  abc: string,
  bars: Bar[],
  barOffset: number,
  /** 파형·타브가 실제로 적는 코드 목록(어휘 낮추기·다듬기를 거친 것).
   *  주지 않으면 마디에 걸린 코드를 그대로 쓴다 */
  heard?: Chord[],
): SongChordResult {
  const none: SongChordResult = {
    abc,
    chords: null,
    source: "none",
    changed: 0,
    total: 0,
    matched: 0,
    shift: 0,
  };
  if (!abc.trim() || !bars.length) return none;

  const meas = scan(abc);
  let orders = null;
  try {
    orders = abcOrders(abc);
  } catch {
    orders = null;
  }
  // 두 셈이 어긋나면 어느 마디가 어느 마디인지 믿을 수 없다 — 손대지 않는다
  if (!orders || orders.measures.length !== meas.length) return none;

  const scoreKeyName = (abc.match(/^K:\s*([A-G][#b♯♭]?m?)/m) ?? [])[1] ?? "";
  const flats = FLAT_KEYS.has(scoreKeyName.replace(/m$/, ""));

  // 악보의 몇째 마디를 처음 부르는 것이 음원의 몇째 마디인가
  const firstAt = new Map<number, number>();
  orders.withJump.forEach((d, k) => {
    if (!firstAt.has(d)) firstAt.set(d, k);
  });

  // 마디마다 「악보가 적은 것」과 「파형·타브가 적는 것」을 나란히 놓는다
  const heardList = heard ?? bars.flatMap((bar) => bar.chords);
  const want = new Map<number, string[]>();
  const pairs: { slot: Slot; heard: string }[] = [];
  meas.forEach((m, d) => {
    const k = firstAt.get(d);
    if (k === undefined) return;
    const bar = bars[k + barOffset];
    if (!bar) return;
    const list = heardIn(bar, heardList);
    want.set(d, list);
    m.slots.forEach((slot, i) => {
      if (list[i]) pairs.push({ slot, heard: list[i] });
    });
  });
  if (!pairs.length) return none;

  /* 조를 얼마나 옮겨 견줄 것인가 — 조 이름을 믿지 않고 세어 본다.
   *
   * 카포 2로 적힌 악보는 E로 쓰고 F♯으로 울린다. 조 이름으로 셈하면
   * 될 것 같지만, 음원에서 딴 조가 틀리는 일이 있어(단조·나란한조를
   * 잘못 짚는다) 그러면 모든 마디가 「다르다」고 나온다. 열두 가지를
   * 다 넣어 보고 **가장 많이 들어맞는 것**을 고르면 스스로 바로잡는다.
   */
  let shift = 0;
  let hits = -1;
  for (const s of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    const n = pairs.filter((p) =>
      same(moveChord(p.heard, s, flats), p.slot.label),
    ).length;
    if (n > hits) {
      hits = n;
      shift = s;
    }
  }

  /* 열에 여덟은 맞아야 나머지를 짚는다.
   *
   * 마디가 어긋났거나(전주 길이가 다르다) 아주 다른 편곡이면 여기저기가
   * 다르게 나오는데, 그것은 「악보가 틀렸다」가 아니라 「견줄 수 없다」는
   * 뜻이다. 그럴 때 고쳐 적으면 도움이 아니라 훼방이다 — 실제로 도돌이가
   * 어긋난 곡에서 멀쩡한 코드 열다섯 자리가 엉뚱하게 바뀌었다.
   */
  const total = pairs.length;
  if (hits < total * 0.8) return { ...none, total, matched: hits, shift };

  /* 어느 쪽이 「오리지날」인가로 갈린다.
   *
   * 조가 어긋나 있으면 카포용으로 옮겨 적은 악보다 — E로 쓰고 F♯으로
   * 울린다. 그 악보의 코드 글자는 원곡의 코드가 아니므로, **악보 쪽을**
   * 음원 코드로 바꿔 적는다.
   *
   * 조가 같으면 악보가 원곡 그대로다. 이때는 악보를 건드리지 않고
   * **파형·타브 쪽을** 악보 코드로 갈아 끼운다 — 음원 분석은 나란한
   * 단조를 헷갈리는 등 잘못 듣는 자리가 있고, 사람이 적어 둔 악보가
   * 언제나 낫다.
   *
   * 어느 쪽이든 세 화면이 같은 코드를 말하게 된다.
   */
  if (shift !== 0) {
    /* 마디마다 코드 자리 수까지 맞춘다.
     *
     * 이름만 바꿔서는 모자랐다 — 악보에 한 개만 적힌 마디에서 음원은
     * 가운데서 한 번 더 바뀌기도 하고, 그 반대이기도 하다. 그러면 두
     * 화면이 여전히 다른 말을 한다. 모자라면 끼워 넣고 남으면 지운다.
     */
    const edits: { from: number; to: number; label: string }[] = [];
    meas.forEach((m, d) => {
      const list = want.get(d);
      if (!list) return;
      const n = Math.min(m.slots.length, list.length);
      for (let i = 0; i < n; i++) {
        if (!same(list[i], m.slots[i].label))
          edits.push({
            from: m.slots[i].from,
            to: m.slots[i].to,
            label: list[i],
          });
      }
      // 악보에만 있는 코드 자리는 따옴표째 지운다
      for (let i = n; i < m.slots.length; i++)
        edits.push({
          from: m.slots[i].from - 1,
          to: m.slots[i].to + 1,
          label: "",
        });
      // 악보에 코드가 안 적힌 마디면 첫 음표 앞에 세운다
      if (!m.slots.length && list.length && m.notes.length) {
        const at = m.notes[0];
        edits.push({ from: at, to: at, label: `"${list[0]}"` });
      }
      // 음원에만 있는 둘째 코드는 마디 한가운데 음표 앞에 끼워 넣는다.
      // 음표가 하나뿐인 마디에는 둘을 나란히 세울 자리가 없어 건너뛴다.
      const put2 = m.slots.length ? m.slots.length : 1;
      if (list.length > put2 && m.notes.length > 1) {
        const at = m.notes[Math.floor(m.notes.length / 2)];
        edits.push({ from: at, to: at, label: `"${list[put2]}"` });
      }
    });
    edits.sort((x, y) => x.from - y.from);
    if (!edits.length)
      return { ...none, source: "audio", total, matched: hits, shift };
    let out = "";
    let at = 0;
    for (const e of edits) {
      if (e.from < at) continue; // 자리가 겹치면 앞의 것만 쓴다
      out += abc.slice(at, e.from) + e.label;
      at = e.to;
    }
    out += abc.slice(at);
    return {
      abc: out,
      chords: null,
      source: "audio",
      changed: edits.length,
      total,
      matched: hits,
      shift,
    };
  }

  /* 악보 코드를 음원의 시간 위에 편다.
   *
   * 코드가 적히지 않은 마디는 앞 코드가 그대로 이어진다 — 악보를 읽는
   * 법이 그렇다. 한 마디에 둘이면 앞뒤 절반씩 나눈다.
   */
  const laid: Chord[] = [];
  let first = Infinity;
  let last = -Infinity;
  /* 강사님이 손수 고친 코드는 그대로 둔다.
   *
   * 고쳐 놓은 자리를 악보로 덮으면 아무리 고쳐도 되돌아오는 꼴이 된다.
   * 사람이 정한 것이 악보보다도 위다.
   */
  const byHand = bars
    .flatMap((b) => b.chords)
    .filter((c, i, all) => c.edited && all.indexOf(c) === i);
  const touched = (from: number, to: number) =>
    byHand.some((c) => c.start < to && c.end > from);

  orders.withJump.forEach((d, k) => {
    const bar = bars[k + barOffset];
    if (!bar || touched(bar.start, bar.end)) return;
    first = Math.min(first, bar.start);
    last = Math.max(last, bar.end);
    const slots = meas[d]?.slots ?? [];
    const put = (label: string, from: number, to: number) => {
      const prev = laid[laid.length - 1];
      if (
        prev &&
        prev.label === plain(label) &&
        Math.abs(prev.end - from) < 0.05
      )
        prev.end = +to.toFixed(3);
      else laid.push(toChord(label, from, to));
    };
    if (!slots.length) {
      // 적힌 코드가 없으면 앞 코드를 이 마디 끝까지 늘인다
      const prev = laid[laid.length - 1];
      if (prev) prev.end = +bar.end.toFixed(3);
      return;
    }
    const span = bar.end - bar.start;
    slots.forEach((slot, i) => {
      put(
        slot.label,
        bar.start + (span * i) / slots.length,
        bar.start + (span * (i + 1)) / slots.length,
      );
    });
  });
  if (!laid.length) return { ...none, total, matched: hits, shift };

  // 악보가 닿지 않는 앞뒤(전주·후주)는 음원에서 딴 코드를 그대로 둔다
  const outside = bars
    .flatMap((b) => b.chords)
    .filter((c, i, all) => all.indexOf(c) === i)
    .filter((c) => c.edited || c.end <= first || c.start >= last);
  const chords = [...outside, ...laid].sort((x, y) => x.start - y.start);

  // 몇 자리나 달랐나 — 음원이 잘못 들었던 자리 수다
  const changed = pairs.filter(
    (p) => !same(plain(p.heard), p.slot.label),
  ).length;
  return { abc, chords, source: "score", changed, total, matched: hits, shift };
}
