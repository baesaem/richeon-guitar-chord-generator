/**
 * 타브 숫자는 몇 조로 적혀 있나 — 멜로디와의 반음 차이로 음높이를 정한다.
 *
 * 타브 숫자는 적힌 그대로 박혀 있다. 「G key Version」처럼 치기 쉬운 조로
 * 옮겨 적은 타브를 C로 울리는 음원과 함께 치려면 카포 5를 끼워야 하고,
 * 화면의 멜로디·코드도 G로 보여야 타브와 이름이 맞는다. 멜로디 악보와
 * 음원의 조만 견주면 이런 곡을 놓친다(「나는 반딧불」) — 타브의 조를 잰다.
 *
 * 재는 법: 마디마다 타브의 코드와 같은 마디 멜로디 코드의 근음을 견준다.
 *   - 그림 타브의 훑는 마디 — 누르는 모양에서 코드를 읽는다(가장 믿을 만하다)
 *   - 타브 보표 — 칸에 적힌 코드 이름
 *   - 뜯는 마디만 있는 그림 타브 — 뜯는 음이 멜로디 코드의 음에 드는 비율
 * 타브 마디 번호와 멜로디 마디가 몇 마디 어긋날 수 있어 어긋남도 함께
 * 찾는다. 딴 조 차이와 뚜렷이 벌어지지 않으면 모른다(null)고 한다 —
 * 틀린 음높이를 권하느니 권하지 않는다.
 */

import type { PickedTab } from "./types";

/** 1~6번줄 개방현 음(MIDI) */
const OPEN = [64, 59, 55, 50, 45, 40];
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod = (n: number, m = 12) => ((n % m) + m) % m;

function pcOf(name: string | undefined): number | null {
  const m = (name ?? "").match(/^([A-G])([#b♯♭]?)/);
  if (!m) return null;
  return mod(PC[m[1]] + (/[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0));
}

/** 코드 이름 → 울리는 음(근음·3음·5음, 7이 있으면 7음) */
function chordTones(name: string): number[] {
  const r = pcOf(name);
  if (r === null) return [];
  const rest = name.replace(/^[A-G][#b♯♭]?/, "").split("/")[0];
  const dim = /dim|m7b5|°/.test(rest);
  const minor = dim || /^m(?!aj)|^min/.test(rest);
  const tones = [r, mod(r + (minor ? 3 : 4)), mod(r + (dim ? 6 : /aug|\+/.test(rest) ? 8 : 7))];
  if (/maj7|M7/.test(rest)) tones.push(mod(r + 11));
  else if (/7/.test(rest)) tones.push(mod(r + 10));
  return tones;
}

/** 누르는 모양(줄→프렛) → 근음. 가장 낮은 음부터 3화음이 서는 근음을 찾는다 */
function shapeRoot(chord: Record<string, number>): number | null {
  const notes = Object.entries(chord)
    .filter(([, f]) => f >= 0)
    .map(([s, f]) => OPEN[Number(s) - 1] + f)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!notes.length) return null;
  const pcs = new Set(notes.map((n) => mod(n)));
  for (const r of [mod(notes[0]), ...pcs])
    if (pcs.has(mod(r + 7)) && (pcs.has(mod(r + 4)) || pcs.has(mod(r + 3)))) return r;
  return null;
}

/** ABC 마디마다의 코드 기호(0부터). 코드가 안 적힌 마디는 앞 코드가 이어진다 */
export function abcBarChordNames(abc: string): string[][] {
  const body = abc
    .split("\n")
    .filter((l) => !/^[A-Za-z]:/.test(l) && !/^\s*%/.test(l))
    .join("\n");
  const out: string[][] = [];
  let last: string[] = [];
  for (const piece of body.split("|")) {
    const plain = piece.replace(/"[^"]*"/g, "").replace(/![^!]*!/g, "");
    if (!/[A-Ga-gzxZ]/.test(plain)) continue;
    const names = [...piece.matchAll(/"([A-G][#b]?[^"]*)"/g)].map((m) => m[1]);
    if (names.length) last = names;
    out.push(last);
  }
  return out;
}

export interface TabBarsLike {
  cols: { frets: { string: number; fret: number }[]; chord?: string }[];
}

export interface TabGap {
  /** 타브 조 − 멜로디 조(반음, −5~+6) */
  gap: number;
  /** 견준 마디 수와 맞은 수 */
  total: number;
  matched: number;
}

/**
 * 타브가 멜로디보다 몇 반음 높게 적혔나. 모르면 null.
 *
 * picked는 그림 타브, tabBars는 타브 보표(악보 마디 순서 그대로)다.
 */
export function tabKeyGap(
  melodyAbc: string | null | undefined,
  picked?: PickedTab | null,
  tabBars?: TabBarsLike[] | null,
): TabGap | null {
  if (!melodyAbc?.trim()) return null;
  const bars = abcBarChordNames(melodyAbc);
  if (bars.length < 4) return null;

  /** 마디 i에서 견줄 것: 근음 하나(코드) 또는 음들(뜯는 마디) */
  type Probe = { at: number; root?: number; notes?: number[] };
  const probes: Probe[] = [];
  const off = picked?.bar_offset ?? 0;
  for (const m of picked?.measures ?? []) {
    const at = m.no - 1 + off;
    if (m.kind === "strum") {
      const r = shapeRoot(m.chord);
      if (r !== null) probes.push({ at, root: r });
    } else {
      const notes = m.cols.flatMap((c) =>
        Object.entries(c)
          .map(([s, f]) => OPEN[Number(s) - 1] + f)
          .filter((n) => Number.isFinite(n))
          .map((n) => mod(n)),
      );
      if (notes.length) probes.push({ at, notes });
    }
  }
  (tabBars ?? []).forEach((bar, i) => {
    const named = bar.cols.map((c) => pcOf(c.chord)).find((x) => x !== null);
    if (named != null) probes.push({ at: i, root: named });
  });
  const roots = probes.filter((p) => p.root !== undefined).length;
  const picks = probes.length - roots;
  if (roots < 6 && picks < 8) return null;

  // 어긋남 a와 조 차이 g를 모두 넣어 보고, 조 차이마다 가장 잘 맞는 어긋남을 쓴다
  const bestByGap = new Array<{ score: number; hit: number; total: number }>(12)
    .fill({ score: -1, hit: 0, total: 0 });
  for (let a = -8; a <= 8; a++)
    for (let g = 0; g < 12; g++) {
      let score = 0;
      let hit = 0;
      let total = 0;
      for (const p of probes) {
        const mel = bars[p.at + a];
        if (!mel?.length) continue;
        if (p.root !== undefined) {
          total++;
          if (mel.some((c) => pcOf(c) !== null && mod((pcOf(c) as number) + g) === p.root)) {
            hit++;
            score += 1;
          }
        } else if (roots < 6) {
          const tones = new Set(mel.flatMap(chordTones).map((x) => mod(x + g)));
          const f = p.notes!.filter((x) => tones.has(x)).length / p.notes!.length;
          total++;
          score += f;
          if (f >= 0.6) hit++;
        }
      }
      if (score > bestByGap[g].score) bestByGap[g] = { score, hit, total };
    }
  const order = [...bestByGap.keys()].sort((x, y) => bestByGap[y].score - bestByGap[x].score);
  const best = bestByGap[order[0]];
  const second = bestByGap[order[1]];
  if (best.total < 6) return null;
  // 코드끼리 견준 곡은 열에 일곱, 뜯는 음으로 견준 곡은 음의 여섯 할이 맞아야 하고,
  // 둘째로 잘 맞는 조 차이와 뚜렷이 벌어져야 믿는다
  const need = roots >= 6 ? 0.7 : 0.6;
  if (best.score / best.total < need) return null;
  if (best.score - second.score < Math.max(2, best.total * 0.2)) return null;
  const g = order[0];
  return { gap: g > 6 ? g - 12 : g, total: best.total, matched: best.hit };
}

/**
 * 타브에 맞춘 음높이(저장값). 화면 조 = 멜로디 조 − 음높이이므로 타브 조로
 * 보이려면 −gap이다. 모르거나 같은 조면 0.
 */
export function tabAutoTranspose(
  melodyAbc: string | null | undefined,
  picked?: PickedTab | null,
  tabBars?: TabBarsLike[] | null,
): number {
  const g = tabKeyGap(melodyAbc, picked, tabBars);
  return g && g.gap ? -g.gap : 0;
}
