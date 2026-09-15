/**
 * ABC 악보의 가사를 **마디마다** 나눠 준다.
 *
 * 타브 악보에도 가사가 있어야 한다. 뮤즈스코어 파일에서 타브를 뜬 곡은
 * 노래 보표에서 가사를 함께 떠 왔지만, 그림 악보에서 읽은 타브는 숫자와
 * 코드뿐이라 가사 칸이 비어 있었다. 가사는 멜로디가 가지고 있으니
 * 거기서 가져온다 — 마디도 코드도 멜로디를 따르는 것과 같다.
 *
 * ABC는 `w:` 줄에 가사를 적고, 그 **바로 위 음악 줄**의 음표와 하나씩
 * 짝을 짓는다. 쉼표는 세지 않고, 음표에 붙일 말이 없으면 `*`로 자리를
 * 비운다. 그러니 음악 줄에서 마디마다 음표를 세어 두면 `w:` 줄을 그
 * 수만큼 끊어 나눠 주면 된다. 「광화문 연가」 첫 줄은 4·7·8·3개였고
 * 가사도 그대로 4·7·8·3음절이었다.
 *
 * `w:` 줄이 둘이면 1절과 2절이다 — 도돌이를 돌 때 부르는 말이라
 * 같은 마디에 둘이 붙는다.
 */

import { barsOfLine } from "./abcReflow";

/** 한 마디에 붙는 가사 */
export interface BarLyric {
  lyric: string;
  lyric2: string;
}

/**
 * 음악 줄 하나를 마디로 끊고, 마디마다 음표를 센다.
 *
 * 1·2번 괄호 「[1」「[2」와 겹세로줄 뒤 도돌이 「||:」를 알아보는 쪽(악보
 * 줄 다시 나누기와 같은 것)을 쓴다. 예전 셈은 「[1」을 화음으로 읽어 그 줄의
 * 나머지를 통째로 삼켰다 — 「광화문 연가」 타브는 1번 괄호(11마디)부터
 * 가사가 「히」「힌」「깊이 그리워지」로 한두 마디씩 밀렸다.
 */
function notesPerBar(line: string): number[] {
  return barsOfLine(line).map((b) => b.notes);
}

/** 예전 셈. 괄호가 없는 줄에서 새 셈과 같은지 견줄 때만 쓴다 */
export function notesPerBarLegacy(line: string): number[] {
  const out: number[] = [];
  let notes = 0;
  let seen = false; // 이 칸에 음표든 쉼표든 있었나 — 마디로 셀지 가른다
  const flush = () => {
    if (seen) out.push(notes);
    notes = 0;
    seen = false;
  };
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    // 따옴표 글자·장식기호·줄 안 지시는 통째로 건너뛴다
    if (c === '"' || c === "!") {
      const end = line.indexOf(c, i + 1);
      i = end < 0 ? line.length : end + 1;
      continue;
    }
    if (c === "[" && /^\[[A-Za-z]:/.test(line.slice(i))) {
      const end = line.indexOf("]", i);
      i = end < 0 ? line.length : end + 1;
      continue;
    }
    if (c === "|") {
      const m = /^[|\]:]+/.exec(line.slice(i)) as RegExpExecArray;
      flush();
      i += m[0].length;
      continue;
    }
    // 화음 [CEG]는 한 음표로 센다
    if (c === "[") {
      const end = line.indexOf("]", i);
      notes += 1;
      seen = true;
      i = end < 0 ? line.length : end + 1;
      continue;
    }
    const m = /^[_^=]*([A-Ga-gzZx])/.exec(line.slice(i));
    if (m) {
      seen = true;
      // 쉼표에는 가사가 붙지 않는다
      if (!/[zZx]/.test(m[1])) notes += 1;
      i += m[0].length;
      continue;
    }
    i += 1;
  }
  flush();
  return out;
}

/** `w:` 줄을 음절로 끊는다. `*`는 말 없는 자리, `-`와 `_`는 앞말에 이어진다 */
function syllables(line: string): string[] {
  return line
    .replace(/^w:\s*/, "")
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

/**
 * 마디마다의 가사. 열쇠는 **적힌 마디 번호**(0부터)다.
 *
 * abcOrder의 abcMeasures와 같은 자로 마디를 센다 — 음표든 쉼표든 든
 * 칸만 마디로 본다. 그래야 화면이 세는 마디와 어긋나지 않는다.
 */
export function abcBarLyrics(abc: string): BarLyric[] {
  const lines = abc.split("\n");
  let head = 0;
  for (; head < lines.length; head++) if (/^K:/.test(lines[head])) break;
  if (head >= lines.length) return [];

  const out: BarLyric[] = [];
  let at = 0; // 지금까지 센 마디 수
  let bar0 = 0; // 이번 음악 줄이 시작하는 마디
  let counts: number[] = [];
  let verse = 0; // 이 음악 줄에 붙은 w: 줄이 몇 번째인가

  const put = (line: string) => {
    const syls = syllables(line);
    let k = 0;
    counts.forEach((n, j) => {
      const take = syls.slice(k, k + n).filter((s) => s !== "*");
      k += n;
      const text = take.join(" ").replace(/[-_]+$/, "");
      if (!text) return;
      const bar = (out[bar0 + j] ??= { lyric: "", lyric2: "" });
      if (verse === 0) bar.lyric = text;
      else if (verse === 1) bar.lyric2 = text;
    });
    verse += 1;
  };

  for (let i = head + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^[wW]:/.test(line)) {
      if (counts.length) put(line);
      continue;
    }
    if (/^(%|[A-Za-z]:)/.test(line)) continue;
    bar0 = at;
    counts = notesPerBar(line);
    at += counts.length;
    verse = 0;
  }

  for (let j = 0; j < at; j++) out[j] ??= { lyric: "", lyric2: "" };
  return out;
}

/** 가사 글을 음절로 — 한글은 한 글자가 한 음절, 그 밖은 띄어 쓴 낱말 하나 */
function splitSyllables(text: string): string[] {
  const out: string[] = [];
  for (const w of text.trim().split(/\s+/)) {
    if (!w) continue;
    if (/[가-힣]/.test(w)) {
      for (const ch of w) if (/[가-힣]/.test(ch)) out.push(ch);
    } else {
      out.push(w.replace(/[*_\-|~]/g, ""));
    }
  }
  return out.filter(Boolean);
}

/** 마디 글에서 가사를 받는 음표마다 「붙임줄로 이어진 음인가」. 화음 [CEG]는 한 음 */
function tieFlags(text: string, tiedIn: boolean): { cont: boolean[]; tiedOut: boolean } {
  const cont: boolean[] = [];
  let prevTie = tiedIn;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    const rest = text.slice(i);
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
    const m =
      /^(\[[^\]]*\]|[_^=]*[A-Ga-g][,']*)([\d/]*)(-?)/.exec(rest) ??
      /^([zxZ])([\d/]*)/.exec(rest);
    if (m) {
      if (/^[zxZ]$/.test(m[1])) {
        prevTie = false; // 쉼표는 붙임줄을 끊는다
      } else {
        cont.push(prevTie);
        prevTie = m[3] === "-";
      }
      i += m[0].length;
      continue;
    }
    i += 1;
  }
  return { cont, tiedOut: prevTie };
}

/**
 * 마디마다의 가사를 ABC에 가사 줄(w:)로 적어 넣는다. 이미 있던 가사 줄은 버린다.
 *
 * 글자가 없는 그림 PDF는 가사를 AI가 마디마다 읽는다(「백일몽」) — 어느 음표
 * 아래인지까지는 모르므로, 붙임줄로 이어진 음·쉼표를 뺀 음표에 차례로 붙인다.
 * 음절이 음표보다 적으면 앞에서부터 채우되, 앞 마디에 가사가 없던 마디(전주 뒤
 * 못갖춘마디 「이」)는 뒤에서부터 채운다. 음절이 더 많으면 가까운 음표에 묶는다 —
 * 음표는 틀려도 가사 글자는 잃지 않는다.
 *
 * byBar의 열쇠는 **적힌 마디 번호**(0부터), 값은 [1절, 2절].
 */
export function addBarLyrics(abc: string, byBar: Record<number, string[]>): string {
  const lines = abc.split("\n");
  const k = lines.findIndex((l) => /^K:/.test(l));
  if (k < 0) return abc;
  const verses = Math.max(1, ...Object.values(byBar).map((v) => (v[1]?.trim() ? 2 : 1)));
  const out = lines.slice(0, k + 1);
  let bar = 0;
  let tiedIn = false;
  let prevHad = false;
  for (const line of lines.slice(k + 1)) {
    if (/^w:/.test(line)) continue; // 옛 가사 줄은 버린다
    out.push(line);
    if (!line.trim() || /^(%|[A-Za-z]:)/.test(line)) continue;
    const segs = barsOfLine(line);
    const rows: string[][] = Array.from({ length: verses }, () => []);
    for (const seg of segs) {
      const { cont, tiedOut } = tieFlags(seg.text, tiedIn);
      tiedIn = tiedOut;
      const n = seg.notes;
      const cand = cont.slice(0, n).map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
      const words = byBar[bar] ?? [];
      let had = false;
      for (let v = 0; v < verses; v++) {
        const toks: string[] = Array(n).fill("*");
        const syls = splitSyllables(words[v] ?? "");
        if (syls.length && cand.length) {
          had = true;
          if (syls.length <= cand.length) {
            const use = !prevHad && syls.length < cand.length ? cand.slice(-syls.length) : cand.slice(0, syls.length);
            use.forEach((q, s) => (toks[q] = syls[s]));
          } else {
            // 음표가 모자라면 음절을 고르게 나눠 묶는다
            cand.forEach((q, s) => {
              const a = Math.floor((s * syls.length) / cand.length);
              const b = Math.floor(((s + 1) * syls.length) / cand.length);
              toks[q] = syls.slice(a, b).join("");
            });
          }
        }
        rows[v].push(...toks);
      }
      prevHad = had;
      bar++;
    }
    rows.forEach((toks, v) => {
      if (toks.some((t) => t !== "*") || v === 0) out.push("w: " + toks.join(" "));
    });
  }
  return out.join("\n");
}
