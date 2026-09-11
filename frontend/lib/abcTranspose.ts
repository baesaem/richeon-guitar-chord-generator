/**
 * ABC 악보를 반음 단위로 옮긴다 — 조표·음표·코드 이름을 함께.
 *
 * 화면에서만 옮겨 보이면(음높이) 악보에 적힌 조와 화면의 조가 달라,
 * 「원키 C (악보 G)」처럼 무엇이 G인지 헷갈리는 표시가 붙는다. 악보
 * 파일로 붙인 멜로디는 글 자체를 음원의 조로 옮겨 두면 그런 표시가
 * 필요 없다.
 *
 * 음표는 **음이름째로** 옮긴다(G→C면 모든 음이 네 글자 위로). 반음만
 * 세어 옮기면 F♯이 G♭으로 적히는 식으로 조표와 어긋난다. 임시표는 새
 * 조표와 그 마디에서 앞서 붙은 임시표를 보고 필요한 곳에만 다시 붙인다.
 * 가사(w:)·제목 같은 머리 줄은 건드리지 않는다.
 */

const LETTERS = "CDEFGAB";
const NAT = [0, 2, 4, 5, 7, 9, 11];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** 새 조의 으뜸음 이름 — 조표가 적은 쪽으로 */
const MAJOR_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
/** 코드 이름 — 샵 조·플랫 조·조표 없는 조(C·Am)에서 흔히 쓰는 쪽 */
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const PLAIN = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const mod = (n: number, m: number) => ((n % m) + m) % m;
const alterOf = (a: string) => (a === "#" || a === "♯" ? 1 : a === "b" || a === "♭" ? -1 : 0);

interface Key {
  letter: number;
  pc: number;
  minor: boolean;
}

/** K: 뒤의 글 → 조와 나머지. 교회 선법·K:none처럼 모르는 것은 null */
function parseKey(text: string): { key: Key; rest: string } | null {
  const m = text.match(
    /^\s*([A-G])([#b♯♭]?)\s*(minor|Minor|min|Min|major|Major|maj|Maj|aeo|ion|m)?([\s\S]*)$/,
  );
  if (!m) return null;
  const rest = m[4];
  // 「G mix」「D dor」 — 선법은 조표 셈이 달라 건드리지 않는다
  if (!m[3] && /^\s*(mix|dor|phr|lyd|loc)/i.test(rest)) return null;
  if (m[3] === "m" && /^[a-z]/i.test(rest)) return null;
  const letter = LETTERS.indexOf(m[1]);
  const minor = !!m[3] && /^(m|min|minor|aeo)$/i.test(m[3]);
  return { key: { letter, pc: mod(NAT[letter] + alterOf(m[2]), 12), minor }, rest };
}

/** 조표: 음이름(0=C…6=B)마다 붙는 반음 */
function signature(k: Key): number[] {
  const pat = k.minor ? MINOR : MAJOR;
  const sig = new Array<number>(7).fill(0);
  for (let i = 0; i < 7; i++) {
    const l = (k.letter + i) % 7;
    sig[l] = mod(mod(k.pc + pat[i], 12) - NAT[l] + 6, 12) - 6;
  }
  return sig;
}

/** 악보의 조 이름(「G」「Em」). 못 읽으면 null */
export function abcKeyName(abc: string): string | null {
  const k = abc.match(/^K:(.*)$/m);
  const p = k ? parseKey(k[1]) : null;
  if (!p) return null;
  const names = p.key.minor ? MINOR_NAMES : MAJOR_NAMES;
  return names[p.key.pc] + (p.key.minor ? "m" : "");
}

/**
 * 악보가 음원보다 몇 반음 높게 적혔는가(−5~+6). 모르면 0.
 *
 * 장·단을 나란한 장조로 맞춰 견준다 — 조표만 적힌 악보(K:G)가 마단조
 * 곡이어도, K:Em 악보가 사장조 곡이어도 같은 조표면 0이다.
 */
export function abcKeyGap(abc: string, audioKey: string): number {
  const k = abc.match(/^K:(.*)$/m);
  const p = k ? parseKey(k[1]) : null;
  if (!p) return 0;
  const [tonic = "", mode = ""] = audioKey.trim().split(/\s+/);
  const t = tonic.match(/^([A-G])([#b♯♭]?)$/);
  if (!t) return 0;
  const apc = mod(NAT[LETTERS.indexOf(t[1])] + alterOf(t[2]), 12);
  const audioMajor = /min/i.test(mode) ? mod(apc + 3, 12) : apc;
  const scoreMajor = p.key.minor ? mod(p.key.pc + 3, 12) : p.key.pc;
  const g = mod(scoreMajor - audioMajor, 12);
  return g > 6 ? g - 12 : g;
}

/**
 * ABC 글을 semis 반음 옮긴다. 조표(K:)를 못 읽으면 null — 반쯤 옮긴
 * 악보를 내놓느니 손대지 않는다.
 */
export function transposeAbc(abc: string, semis: number): string | null {
  semis = Math.round(semis);
  if (!semis) return abc;

  let steps = 0;
  let inSig: number[] | null = null;
  let outSig: number[] = [];
  let names = PLAIN;
  let inBar = new Map<string, number>();
  let outBar = new Map<string, number>();

  /** K: 뒤의 글을 새 조로. 음표를 옮길 셈(steps·조표)도 여기서 정한다 */
  const retune = (text: string): string | null => {
    const p = parseKey(text);
    if (!p) return null;
    const pc = mod(p.key.pc + semis, 12);
    const name = (p.key.minor ? MINOR_NAMES : MAJOR_NAMES)[pc];
    const letter = LETTERS.indexOf(name[0]);
    // 음이름 몇 칸을 옮기나 — 반음 수에 가장 가까운 쪽(위로/아래로)
    const d = letter - p.key.letter;
    steps = [d - 7, d, d + 7].reduce((a, b) =>
      Math.abs(b - (semis * 7) / 12) < Math.abs(a - (semis * 7) / 12) ? b : a,
    );
    inSig = signature(p.key);
    const next: Key = { letter, pc, minor: p.key.minor };
    outSig = signature(next);
    names = outSig.some((a) => a < 0) ? FLAT : outSig.some((a) => a > 0) ? SHARP : PLAIN;
    return name + (p.key.minor ? "m" : "") + p.rest;
  };

  const chordName = (s: string): string => {
    // 「^위에 적는 글」 같은 주석은 코드가 아니다
    if (/^[\^_<>@]/.test(s)) return s;
    const m = s.match(/^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/);
    if (!m) return s;
    const one = (r: string, a: string) =>
      names[mod(NAT[LETTERS.indexOf(r)] + alterOf(a) + semis, 12)];
    return one(m[1], m[2]) + m[3] + (m[4] ? "/" + one(m[4], m[5] ?? "") : "");
  };

  const note = (acc: string, ch: string, marks: string): string => {
    const letter = LETTERS.indexOf(ch.toUpperCase());
    const octave =
      (ch === ch.toUpperCase() ? 4 : 5) +
      (marks.match(/'/g)?.length ?? 0) -
      (marks.match(/,/g)?.length ?? 0);
    const kin = `${letter}:${octave}`;
    let alter: number;
    if (acc) {
      alter = { "^^": 2, "^": 1, "=": 0, _: -1, __: -2 }[acc] ?? 0;
      inBar.set(kin, alter);
    } else alter = inBar.get(kin) ?? inSig![letter];
    const want = 12 * (octave + 1) + NAT[letter] + alter + semis;
    // 새 음이름. 겹임시표를 넘으면 이웃 음이름으로 적는다
    let D = octave * 7 + letter + steps;
    let l2 = 0;
    let o2 = 0;
    let a2 = 0;
    for (const nudge of [0, -1, 1]) {
      const dd = D + nudge;
      l2 = mod(dd, 7);
      o2 = Math.floor(dd / 7);
      a2 = want - (12 * (o2 + 1) + NAT[l2]);
      if (Math.abs(a2) <= 2) {
        D = dd;
        break;
      }
    }
    const kout = `${l2}:${o2}`;
    const expect = outBar.get(kout) ?? outSig[l2];
    let out = "";
    if (a2 !== expect) {
      out = a2 === 2 ? "^^" : a2 === 1 ? "^" : a2 === 0 ? "=" : a2 === -1 ? "_" : "__";
      outBar.set(kout, a2);
    }
    out +=
      o2 >= 5
        ? LETTERS[l2].toLowerCase() + "'".repeat(o2 - 5)
        : LETTERS[l2] + ",".repeat(4 - o2);
    return out;
  };

  const music = (line: string): string => {
    let out = "";
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      const rest = line.slice(i);
      if (c === "%") {
        out += rest;
        break;
      }
      if (c === '"') {
        const j = line.indexOf('"', i + 1);
        if (j < 0) {
          out += rest;
          break;
        }
        out += '"' + chordName(line.slice(i + 1, j)) + '"';
        i = j + 1;
        continue;
      }
      if (c === "!") {
        const j = line.indexOf("!", i + 1);
        if (j > i) {
          out += line.slice(i, j + 1);
          i = j + 1;
          continue;
        }
      }
      const deco = rest.match(/^\+[A-Za-z0-9.]+\+/);
      if (deco) {
        out += deco[0];
        i += deco[0].length;
        continue;
      }
      const field = rest.match(/^\[([A-Za-z]):([^\]]*)\]/);
      if (field) {
        if (field[1] === "K") {
          const t = retune(field[2]);
          out += t === null ? field[0] : `[K:${t}]`;
        } else out += field[0];
        i += field[0].length;
        continue;
      }
      if (c === "|" || c === ":") {
        // 마디가 바뀌면 임시표는 풀린다
        inBar = new Map();
        outBar = new Map();
        out += c;
        i++;
        continue;
      }
      const n = rest.match(/^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)/);
      if (n) {
        out += note(n[1] ?? "", n[2], n[3]);
        i += n[0].length;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  };

  const lines = abc.split("\n");
  const done: string[] = [];
  for (const line of lines) {
    // 줄 끝의 \r(윈도 줄바꿈)까지 머리 줄로 받는다
    const head = line.match(/^([A-Za-z]):([\s\S]*)$/);
    if (head) {
      if (head[1] === "K") {
        const t = retune(head[2]);
        if (t === null) return null;
        inBar = new Map();
        outBar = new Map();
        done.push("K:" + t);
      } else done.push(line);
      continue;
    }
    if (/^\s*%/.test(line) || !inSig) {
      done.push(line);
      continue;
    }
    done.push(music(line));
  }
  return inSig ? done.join("\n") : null;
}
