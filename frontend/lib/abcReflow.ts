/**
 * ABC 악보를 **한 줄 N마디**로 다시 나눈다 — 「마디(확대)」.
 *
 * abcjs의 자동 줄바꿈(wrap)은 음표 간격을 따져 넣을 수 있는 만큼만 넣는다.
 * 16분음표가 빽빽한 곡은 「2마디」로 골라도 1마디씩, 「3마디」가 3·3·2·2로
 * 그려져 고른 수와 화면이 달랐다. 줄을 여기서 직접 끊으면 악보에 적힌
 * 대로(4마디) 그릴 때와 같은 촘촘함으로 정확히 N마디씩 그린다.
 *
 * 가사(w:)는 바로 위 음악 줄의 음표와 하나씩 짝을 짓는다. 그래서 마디마다
 * 가사를 받는 음표 수를 세어 w: 줄도 같은 자리에서 끊어 옮긴다.
 *
 * 줄 구조가 특이한 악보(중간 머리글·주석·성부 표시 [V:], 마디 맞춤 가사
 * 「|」)는 null을 돌려준다 — 부른 쪽이 abcjs 줄바꿈으로 대신한다.
 */

export interface AbcBarText {
  /** 마디 글(끝의 세로줄 포함) */
  text: string;
  /** 가사를 받는 음표 수. 쉼표는 세지 않고, 화음 [CEG]는 하나다 */
  notes: number;
}

const BARLINE = /^(:\|:|::|\|\|:|\[\|:|\|:|:\||\|\]|\|\||\|)/;

/** 음악 줄 하나를 마디로 쪼갠다 */
export function barsOfLine(line: string): AbcBarText[] {
  const out: AbcBarText[] = [];
  let buf = "";
  let notes = 0;
  let seen = false; // 이 조각에 음표든 쉼표든 있었나
  const copyUntil = (i: number, close: string): number => {
    const end = line.indexOf(close, i + 1);
    const to = end < 0 ? line.length : end + 1;
    buf += line.slice(i, to);
    return to;
  };
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    const rest = line.slice(i);
    // 따옴표 글자(코드 이름)·장식기호는 통째로
    if (c === '"' || c === "!") {
      i = copyUntil(i, c);
      continue;
    }
    // 꾸밈음은 가사를 받지 않는다
    if (c === "{") {
      i = copyUntil(i, "}");
      continue;
    }
    const bar = BARLINE.exec(rest);
    if (bar) {
      buf += bar[1];
      i += bar[1].length;
      if (seen) {
        out.push({ text: buf, notes });
        buf = "";
        notes = 0;
        seen = false;
      }
      continue;
    }
    if (c === "[") {
      // [K:A] 같은 줄 안 지시
      if (/^\[[A-Za-z]:/.test(rest)) {
        i = copyUntil(i, "]");
        continue;
      }
      // 1·2번 괄호 [1 [2 [1,3 — 화음이 아니다
      const volta = /^\[\d[\d,.-]*/.exec(rest);
      if (volta) {
        buf += volta[0];
        i += volta[0].length;
        continue;
      }
      // 화음 [CEG]는 음표 하나
      i = copyUntil(i, "]");
      notes += 1;
      seen = true;
      continue;
    }
    const note = /^[_^=]*([A-Ga-gzZx])/.exec(rest);
    if (note) {
      seen = true;
      if (!/[zZx]/.test(note[1])) notes += 1;
      buf += note[0];
      i += note[0].length;
      continue;
    }
    buf += c;
    i += 1;
  }
  // 줄 끝의 음표 없는 조각(겹세로줄 따위)은 앞 마디에 붙인다
  if (seen) out.push({ text: buf, notes });
  else if (buf.trim() && out.length) out[out.length - 1].text += buf;
  return out;
}

export function reflowAbc(abc: string, perLine: number): string | null {
  if (!(perLine >= 1)) return null;
  const lines = abc.split("\n");
  const k = lines.findIndex((l) => /^K:/.test(l));
  if (k < 0) return null;

  type Bar = AbcBarText & { words: string[][] };
  const bars: Bar[] = [];
  let music: string | null = null;
  let ws: string[] = [];
  let verses = 0;

  const flush = () => {
    if (music === null) return;
    const segs = barsOfLine(music);
    const toks = ws.map((w) =>
      w.replace(/^w:\s*/, "").split(/\s+/).filter((s) => s.length > 0),
    );
    verses = Math.max(verses, toks.length);
    const at = toks.map(() => 0);
    for (const seg of segs) {
      bars.push({
        ...seg,
        words: toks.map((t, v) => {
          const take = t.slice(at[v], at[v] + seg.notes);
          at[v] += seg.notes;
          return take;
        }),
      });
    }
    music = null;
    ws = [];
  };

  for (const line of lines.slice(k + 1)) {
    if (!line.trim()) continue;
    if (/^w:/.test(line)) {
      // 마디 맞춤 가사(|)는 옮길 수 없다
      if (music === null || line.includes("|")) return null;
      ws.push(line);
      continue;
    }
    // 중간 머리글·주석·성부 표시·줄 잇기(\) — 손대지 않는다
    if (/^(%|[A-Za-z]:|\[V:)/.test(line) || /\\\s*$/.test(line)) return null;
    flush();
    music = line;
  }
  flush();
  if (!bars.length) return null;

  const out = lines.slice(0, k + 1);
  for (let i = 0; i < bars.length; i += perLine) {
    const group = bars.slice(i, i + perLine);
    out.push(group.map((b) => b.text.trim()).join(" "));
    for (let v = 0; v < verses; v++) {
      const toks = group.flatMap((b) => {
        const w = b.words[v] ?? [];
        return w.length >= b.notes
          ? w.slice(0, b.notes)
          : [...w, ...Array(b.notes - w.length).fill("*")];
      });
      if (toks.some((t) => t !== "*")) out.push("w: " + toks.join(" "));
    }
  }
  return out.join("\n") + "\n";
}
