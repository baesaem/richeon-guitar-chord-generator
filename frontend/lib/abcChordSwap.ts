/**
 * ABC 악보의 **코드 글자만** 갈아 끼운다.
 *
 * 종이 악보대로 편곡할 때, 짚는 자리는 그림에서 가져오면서 코드 이름만
 * 악보 파일의 것이 남으면 둘이 어긋난다. 그렇다고 악보를 통째로 그림에서
 * 만든 것으로 바꾸면 음표와 가사를 잃는다 — 음표·가사·되돌이는 그대로 두고
 * 따옴표 안의 코드 이름만 바꾼다.
 */

/** 한 마디를 이루는 글자 조각과, 그 안에서 음표가 시작하는 자리들 */
interface Piece {
  text: string;
  /** 이 마디에 적힌 코드 글자의 자리(text 안의 [시작, 끝)) */
  chords: [number, number][];
  /** 음표가 시작하는 자리들. 코드를 새로 끼울 때 여기 앞에 넣는다 */
  notes: number[];
}

/**
 * 마디 하나를 훑어 코드 글자와 음표 자리를 찾는다.
 *
 * 따옴표("Em")·장식기호(!segno!)·줄 안 지시([K:G])는 통째로 건너뛴다.
 * 음표는 임시표와 옥타브표를 앞에 달 수 있고, 화음은 [ ]로 묶인다.
 */
function scan(text: string): Piece {
  const chords: [number, number][] = [];
  const notes: number[] = [];
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      const stop = end < 0 ? text.length : end + 1;
      // ^ _ < > @ 로 시작하는 것은 코드가 아니라 덧말이다
      if (!/^"[\^_<>@]/.test(text.slice(i, stop))) chords.push([i, stop]);
      i = stop;
      continue;
    }
    if (c === "!") {
      const end = text.indexOf("!", i + 1);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (c === "[" && /^\[[A-Za-z]:/.test(text.slice(i))) {
      const end = text.indexOf("]", i);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    // 화음 [CEG] 또는 홑음. 임시표·옥타브표가 앞에 붙는다
    const m = /^(?:\[)?[_^=]*[A-Ga-gz]/.exec(text.slice(i));
    if (m) {
      notes.push(i);
      // 화음이면 닫는 ]까지 건너뛴다
      if (text[i] === "[") {
        const end = text.indexOf("]", i);
        i = end < 0 ? text.length : end + 1;
      } else {
        i += m[0].length;
      }
      continue;
    }
    i += 1;
  }
  return { text, chords, notes };
}

/** 마디를 나눈다. 세로줄(|)이 기준이고, 줄바꿈과 가사줄은 그대로 둔다 */
function splitBars(body: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c === '"' || c === "!") {
      const end = body.indexOf(c, i + 1);
      const stop = end < 0 ? body.length : end + 1;
      buf += body.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "|") {
      // :|  ||  |:  |] 처럼 붙어 다니는 것을 한 덩이로 본다
      const m = /^[|\]:]+/.exec(body.slice(i)) as RegExpExecArray;
      buf += m[0];
      out.push(buf);
      buf = "";
      i += m[0].length;
      continue;
    }
    buf += c;
    i += 1;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * 마디마다의 코드 이름을 악보에 적어 넣는다.
 *
 * byBar의 열쇠는 **적힌 마디 번호**(0부터)다. 값이 없는 마디는 손대지
 * 않는다 — 그림이 못 읽은 마디까지 지워 버리면 있던 코드마저 잃는다.
 */
export function applyBarChords(
  abc: string,
  byBar: Record<number, string[]>,
): string {
  const lines = abc.split("\n");
  let head = 0;
  for (; head < lines.length; head++) if (/^K:/.test(lines[head])) break;
  if (head >= lines.length) return abc;

  let bar = -1;
  for (let li = head + 1; li < lines.length; li++) {
    const line = lines[li];
    // 가사줄·지시줄은 마디를 세지 않는다
    if (!line.trim() || /^(w:|W:|%|[A-Za-z]:)/.test(line)) continue;

    const pieces = splitBars(line);
    const done = pieces.map((piece) => {
      // 음표가 없는 조각(줄 첫머리의 도돌이표 따위)은 마디로 세지 않는다
      if (!/[A-Ga-gz]/.test(piece.replace(/"[^"]*"/g, ""))) return piece;
      bar += 1;
      const names = byBar[bar];
      if (!names?.length) return piece;

      const { chords, notes } = scan(piece);
      if (!notes.length) return piece;
      /* 있던 코드를 걷고, 마디를 코드 수만큼 나눠 음표 앞에 새로 적는다.
         뒤에서부터 손대야 앞의 자리가 밀리지 않는다 */
      const put = names.map((name, i) => ({
        at: notes[Math.min(Math.round((i * notes.length) / names.length), notes.length - 1)],
        name,
      }));
      const cuts: { at: number; to: number; text: string }[] = chords.map(
        ([a, b]) => ({ at: a, to: b, text: "" }),
      );
      for (const p of put) cuts.push({ at: p.at, to: p.at, text: `"${p.name}"` });
      cuts.sort((a, b) => b.at - a.at || b.to - a.to);
      let out = piece;
      for (const cut of cuts)
        out = out.slice(0, cut.at) + cut.text + out.slice(cut.to);
      return out;
    });
    lines[li] = done.join("");
  }
  return lines.join("\n");
}

/**
 * 마디 위 메모 덧말의 머리표. 그린 뒤 이것으로 메모를 알아본다.
 * 보이지 않는 글자(폭 없는 빈칸)다 — 강사님: 「📝 표시 삭제」.
 */
export const MEMO_MARK = "​";

/**
 * 마디 위 메모를 덧말("^…")로 끼운다 — **그릴 때만** 쓴다(저장하지 않는다).
 *
 * 그린 뒤 쪽지를 얹으면 윗줄 가사·제목과 겹쳤다. 덧말로 넣으면 abcjs가
 * 줄 사이에 그만큼 자리를 비워 둔다. 마디를 세는 법은 applyBarChords와
 * 같다 — 코드를 고치는 마디 번호와 메모의 마디 번호가 같아야 한다.
 */
export function addBarMemos(
  abc: string,
  byBar: Record<string, string> | undefined,
): string {
  if (!byBar || !Object.keys(byBar).length) return abc;
  const lines = abc.split("\n");
  let head = 0;
  for (; head < lines.length; head++) if (/^K:/.test(lines[head])) break;
  if (head >= lines.length) return abc;

  let bar = -1;
  for (let li = head + 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim() || /^(w:|W:|%|[A-Za-z]:)/.test(line)) continue;
    lines[li] = splitBars(line)
      .map((piece) => {
        if (!/[A-Ga-gz]/.test(piece.replace(/"[^"]*"/g, ""))) return piece;
        bar += 1;
        const raw = byBar[String(bar)] ?? "";
        if (!raw.trim()) return piece;
        const { chords, notes } = scan(piece);
        if (!notes.length) return piece;
        /* 앞쪽 빈칸은 글자로 친다(강사님: 빈칸으로 메모를 오른쪽으로 민다).
           그냥 빈칸은 abcjs·SVG가 걷어 내므로 줄바꿈 없는 빈칸으로 바꾼다 —
           머리표(폭 없는 글자)가 맨 앞에 있어 걷히지 않는다 */
        const lead = Math.min(raw.length - raw.trimStart().length, 40);
        const memo = raw.trim().replace(/["\s]+/g, " ");
        // 긴 메모는 줄여 적는다 — 덧말이 길면 마디가 벌어진다. 다 읽으려면 마디를 연다
        const shown = " ".repeat(lead) + (memo.length > 16 ? `${memo.slice(0, 15)}…` : memo);
        /* 코드 이름 **앞**에 둔다 — abcjs가 먼저 적힌 덧말을 오선 가까이
           놓는다. 강사님: 「메모는 악보 위에 바로 붙임」(↓ 같은 표시가 음표를
           가리키게). 그 마디 코드는 메모 위로 한 칸 올라간다 */
        const at = Math.min(notes[0], chords[0]?.[0] ?? Infinity);
        return `${piece.slice(0, at)}"^${MEMO_MARK}${shown}"${piece.slice(at)}`;
      })
      .join("");
  }
  return lines.join("\n");
}
