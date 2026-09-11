/**
 * 타브 숫자를 반음 단위로 옮긴다 — 같은 음을 기타에서 다시 짚는다.
 *
 * 강사님 원칙: 타브는 무조건 악보(멜로디)를 따르고, 음높이를 옮기면
 * 멜로디·타브·그리드가 함께 옮겨진다. 타브 숫자는 적힌 조로 박혀 있으니,
 * 그릴 때 음을 옮기고 **짚을 자리를 새로 고른다.** 프렛에 반음 수를 그대로
 * 더하면 개방현 모양이 5프렛 위로 올라가 손이 닿기 어렵다.
 *
 *   - 한 칸(동시에 뜯는 음들)은 서로 다른 줄에, 되도록 원래 줄 가까이
 *   - 낮은 프렛(개방현 쪽)을 먼저, 다섯 프렛을 넘으면 크게 벌점
 *   - 칸마다 한 옥타브 위/아래를 고를 수 있되, 앞 칸과 같은 쪽을 우선한다
 *     — 아르페지오의 흐름이 옥타브를 오르내리며 끊기지 않게
 */

/** 1~6번줄 개방현 음(MIDI). 배열 자리 0 = 1번줄 */
const OPEN = [64, 59, 55, 50, 45, 40];
const MAX_FRET = 12;

export interface FretNote {
  /** 0 = 1번줄(가장 가는 줄) */
  string: number;
  fret: number;
}

/** 한 칸의 음들을 semis 옮겨 다시 짚는다. 짚을 수 없으면 null */
function placeCol(notes: FretNote[], semis: number): { notes: FretNote[]; cost: number } | null {
  const want = notes
    .map((n) => ({ from: n.string, pitch: OPEN[n.string] + n.fret + semis }))
    .sort((a, b) => a.pitch - b.pitch);
  const cands = want.map((w, i) => {
    // 베이스(칸의 가장 낮은 음)가 낮은 줄(4~6번)에 있었으면 낮은 줄에 남긴다
    const bass = i === 0 && w.from >= 3;
    const list: { string: number; fret: number; cost: number }[] = [];
    for (let s = 0; s < 6; s++) {
      const f = w.pitch - OPEN[s];
      if (f < 0 || f > MAX_FRET) continue;
      list.push({
        string: s,
        fret: f,
        cost: f + Math.max(0, f - 5) * 3 + Math.abs(s - w.from) * 1.5 + (bass && s < 3 ? 5 : 0),
      });
    }
    return list;
  });
  let best: { notes: FretNote[]; cost: number } | null = null;
  const pick: { string: number; fret: number; cost: number }[] = [];
  const walk = (i: number) => {
    if (i === want.length) {
      const fretted = pick.filter((p) => p.fret > 0).map((p) => p.fret);
      const spread = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (spread > 4) return;
      // 낮은 음이 낮은 줄에 — 줄 순서가 음 순서와 뒤집히면 벌점
      let order = 0;
      for (let k = 1; k < pick.length; k++) if (pick[k].string > pick[k - 1].string) order += 3;
      const cost = pick.reduce((a, p) => a + p.cost, 0) + spread + order;
      if (!best || cost < best.cost)
        best = { notes: pick.map((p) => ({ string: p.string, fret: p.fret })), cost };
      return;
    }
    for (const c of cands[i]) {
      if (pick.some((p) => p.string === c.string)) continue;
      pick.push(c);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}

/**
 * 한 마디의 칸들을 semis 옮긴다. 칸마다 옥타브(semis, ±12)를 고르되
 * 옥타브를 바꾸면 벌점을 매겨, 마디 전체가 가장 덜 힘든 길을 찾는다.
 */
export function shiftBarCols<T extends { frets: FretNote[] }>(cols: T[], semis: number): T[] {
  semis = Math.round(semis);
  if (!semis || !cols.some((c) => c.frets.length)) return cols;
  const octs = [semis, semis - 12, semis + 12];
  // 칸마다 세 옥타브의 자리와 값
  const opts = cols.map((c) =>
    c.frets.length ? octs.map((s) => placeCol(c.frets, s)) : null,
  );
  // 앞에서부터 옥타브별 최소 비용(동적 계획)
  type Step = { cost: number; prev: number };
  const table: (Step[] | null)[] = [];
  let lastIdx = -1;
  for (let i = 0; i < cols.length; i++) {
    const o = opts[i];
    if (!o) {
      table.push(null);
      continue;
    }
    const row: Step[] = o.map((p, k) => {
      if (!p) return { cost: Infinity, prev: -1 };
      const base = p.cost + Math.abs(octs[k] - semis) * 0.3;
      if (lastIdx < 0) return { cost: base, prev: -1 };
      const prevRow = table[lastIdx]!;
      let bestPrev = -1;
      let bestCost = Infinity;
      prevRow.forEach((st, j) => {
        const c = st.cost + (j === k ? 0 : 6);
        if (c < bestCost) {
          bestCost = c;
          bestPrev = j;
        }
      });
      return { cost: base + bestCost, prev: bestPrev };
    });
    table.push(row);
    lastIdx = i;
  }
  if (lastIdx < 0) return cols;
  // 뒤에서부터 고른 옥타브를 따라간다
  const chosen = new Array<number>(cols.length).fill(-1);
  let k = table[lastIdx]!.reduce((b, st, j, all) => (st.cost < all[b].cost ? j : b), 0);
  if (!Number.isFinite(table[lastIdx]![k].cost)) return cols;
  for (let i = lastIdx; i >= 0; i--) {
    if (!table[i]) continue;
    chosen[i] = k;
    k = table[i]![k].prev;
    if (k < 0) {
      // 앞 칸들은 이어진 길이 없다 — 가장 싼 쪽을 따로 고른다
      for (let j = i - 1; j >= 0; j--)
        if (table[j]) chosen[j] = table[j]!.reduce((b, st, q, all) => (st.cost < all[b].cost ? q : b), 0);
      break;
    }
  }
  return cols.map((c, i) => {
    const o = opts[i];
    if (!o || chosen[i] < 0 || !o[chosen[i]]) return c;
    return { ...c, frets: o[chosen[i]]!.notes };
  });
}

/** 그림 타브 한 칸(줄 번호 1~6 → 프렛)을 FretNote로 */
export function fromPickedCol(col: Record<string, number>): FretNote[] {
  return Object.entries(col)
    .map(([s, f]) => ({ string: Number(s) - 1, fret: f }))
    .filter((n) => n.string >= 0 && n.string < 6 && n.fret >= 0);
}
