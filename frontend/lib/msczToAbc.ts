"use client";

/**
 * MuseScore(.mscz) 파일 → ABC notation.
 *
 * .mscz는 zip이고 안에 .mscx(XML)가 들어 있다. 압축을 풀어 XML을 읽고
 * 마디·음표·코드·가사·도돌이표를 ABC로 옮긴다. 악보생성 앱에서 검증한
 * 변환기를 그대로 옮겨 왔다 — 혜화동 2단 악보(58마디, 볼타 2개, 전조)가
 * 원본 PDF와 일치함을 확인했다.
 *
 * MuseScore 2.x 형식 기준. 멜로디 스태프(첫 번째)만 옮긴다 — 연주기의
 * 멜로디 화면이 쓰는 것이라 반주 스태프는 필요 없다.
 */

import { unzipSync } from "fflate";

// ---- 음이름 변환 ----

const DUR: Record<string, number> = {
  "64th": 0.25,
  "32nd": 0.5,
  "16th": 1,
  eighth: 2,
  quarter: 4,
  half: 8,
  whole: 16,
};
const TPC_LETTER: Record<number, string> = {
  13: "F", 14: "C", 15: "G", 16: "D", 17: "A", 18: "E", 19: "B",
};
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
const SIG_KEY: Record<number, string> = {
  [-4]: "Ab", [-3]: "Eb", [-2]: "Bb", [-1]: "F",
  0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B",
};

function tpcInfo(tpc: number): { letter: string; alter: number } {
  let alter = 0;
  let t = tpc;
  while (t > 19) { t -= 7; alter++; }
  while (t < 13) { t += 7; alter--; }
  return { letter: TPC_LETTER[t] ?? "C", alter };
}

function keyDefaults(sig: number): Record<string, number> {
  const d: Record<string, number> = {};
  for (const l of "ABCDEFG") d[l] = 0;
  if (sig > 0) for (let i = 0; i < sig; i++) d[SHARP_ORDER[i]] = 1;
  if (sig < 0) for (let i = 0; i < -sig; i++) d[FLAT_ORDER[i]] = -1;
  return d;
}

function abcPitch(
  letter: string,
  alter: number,
  midi: number,
  accState: Record<string, number>,
  keyDef: Record<string, number>,
): string {
  const octave = Math.floor((midi - alter - PC[letter]) / 12) - 1;
  const stateKey = letter + octave;
  const cur = stateKey in accState ? accState[stateKey] : keyDef[letter];
  let acc = "";
  if (alter !== cur) {
    acc =
      alter === 1 ? "^" : alter === -1 ? "_" :
      alter === 2 ? "^^" : alter === -2 ? "__" : "=";
    accState[stateKey] = alter;
  }
  let n = letter;
  if (octave >= 5) {
    n = n.toLowerCase();
    for (let i = 6; i <= octave; i++) n += "'";
  } else {
    for (let i = octave; i < 4; i++) n += ",";
  }
  return acc + n;
}

function lenStr(units: number): string {
  if (units === 1) return "";
  if (Number.isInteger(units)) return String(units);
  return units * 2 + "/2";
}

function chordName(h: { root?: string; name?: string; base?: string }): string {
  if (!h.root) return "";
  const root = tpcInfo(+h.root);
  let name =
    root.letter + (root.alter === 1 ? "#" : root.alter === -1 ? "b" : "");
  if (h.name) name += h.name;
  if (h.base) {
    const b = tpcInfo(+h.base);
    name += "/" + b.letter + (b.alter === 1 ? "#" : b.alter === -1 ? "b" : "");
  }
  return name;
}

// ---- 마디 파싱 ----

interface NoteEv {
  type: "note" | "rest";
  units: number;
  notes: { midi: number; tpc: number; tie: boolean }[];
  lyric: string | null;
  lyric2: string | null;
  harmony: { root?: string; name?: string; base?: string } | null;
}

interface Measure {
  events: NoteEv[];
  keysig: number | null;
  startRepeat: boolean;
  endRepeat: boolean;
  volta: string | null;
  /** 세뇨·코다·다카포 따위. ABC 기호로 옮겨 둔 것 */
  marks: string;
}

/**
 * 뮤즈스코어의 되돌이 지시를 ABC 기호로.
 *
 * 이것을 옮기지 않으면 「D.S. al Coda」가 통째로 사라져, 41마디 악보가
 * 48마디로만 펴진다(실제로 부르는 것은 64마디다). 그러면 음원과 마디
 * 수가 어긋난 줄도 모르고 진행 바가 느리게 간다 — 「광화문 연가」가
 * 그랬다.
 *
 * 뮤즈스코어의 이름은 우리와 다르다. To Coda 자리가 label="coda"이고,
 * 코다 본문이 label="codab"이다. ABC에서는 둘 다 !coda!로 적는다 —
 * 코다 표가 둘이면 앞의 것이 빠져나가는 자리, 뒤의 것이 코다 본문이다.
 */
function marksToAbc(content: string): string {
  let out = "";
  for (const m of content.matchAll(/<Marker>([\s\S]*?)<\/Marker>/g)) {
    const label = (m[1].match(/<label>([^<]*)/) ?? [])[1]?.trim();
    if (label === "segno") out += "!segno!";
    else if (label === "coda" || label === "codab") out += "!coda!";
    else if (label === "fine") out += "!fine!";
  }
  for (const j of content.matchAll(/<Jump>([\s\S]*?)<\/Jump>/g)) {
    const to = (j[1].match(/<jumpTo>([^<]*)/) ?? [])[1]?.trim() ?? "";
    const cont = (j[1].match(/<continueAt>([^<]*)/) ?? [])[1]?.trim() ?? "";
    const ds = to === "segno" ? "D.S." : "D.C.";
    out += cont ? `!${ds}alcoda!` : `!${ds}alfine!`;
  }
  return out;
}

function parseStaff(body: string): Measure[] {
  const measures: Measure[] = [];
  for (const mm of body.matchAll(/<Measure([^>]*)>([\s\S]*?)<\/Measure>/g)) {
    const content = mm[2];
    const events: NoteEv[] = [];
    let pendingHarmony: NoteEv["harmony"] = null;
    let keysig: number | null = null;
    const elRe = /<(KeySig|Harmony|Chord|Rest)>([\s\S]*?)<\/\1>/g;
    let e: RegExpExecArray | null;
    while ((e = elRe.exec(content))) {
      const tag = e[1];
      const inner = e[2];
      if (tag === "KeySig") {
        keysig = +(inner.match(/<accidental>(-?\d+)/) ?? [0, 0])[1];
      } else if (tag === "Harmony") {
        pendingHarmony = {
          root: (inner.match(/<root>(-?\d+)/) ?? [])[1],
          name: (inner.match(/<name>([^<]*)/) ?? [])[1] ?? "",
          base: (inner.match(/<base>(-?\d+)/) ?? [])[1],
        };
      } else {
        const dt = (inner.match(/<durationType>([^<]+)/) ?? [])[1];
        const dots = +((inner.match(/<dots>(\d+)/) ?? [])[1] ?? 0);
        let units: number;
        if (dt === "measure") {
          const frac = inner.match(/<duration>(\d+)\/(\d+)/) ?? [];
          units = frac[1] ? (16 * +frac[1]) / +frac[2] : 16;
        } else {
          units = DUR[dt ?? ""] ?? 4;
          if (dots === 1) units *= 1.5;
          if (dots === 2) units *= 1.75;
        }
        if (tag === "Rest") {
          events.push({
            type: "rest", units, notes: [],
            lyric: null, lyric2: null, harmony: pendingHarmony,
          });
        } else {
          const notes = [...inner.matchAll(/<Note>([\s\S]*?)<\/Note>/g)].map(
            (nm) => {
              const ni = nm[1];
              return {
                midi: +(ni.match(/<pitch>(\d+)/) ?? [0, 0])[1],
                tpc: +(ni.match(/<tpc>(-?\d+)/) ?? [0, 14])[1],
                tie: /<Tie[\s>]/.test(ni),
              };
            },
          );
          const lyrics: Record<number, string> = {};
          for (const lm of inner.matchAll(/<Lyrics>([\s\S]*?)<\/Lyrics>/g)) {
            const verse = +((lm[1].match(/<no>(\d+)/) ?? [])[1] ?? 0);
            let text = (lm[1].match(/<text>([^<]*)/) ?? [])[1] ?? "";
            const syl = (lm[1].match(/<syllabic>([^<]*)/) ?? [])[1];
            if (syl === "begin" || syl === "middle") text += "-";
            if (verse <= 1) lyrics[verse] = text;
          }
          events.push({
            type: "note", units, notes,
            lyric: lyrics[0] ?? null, lyric2: lyrics[1] ?? null,
            harmony: pendingHarmony,
          });
        }
        pendingHarmony = null;
      }
    }
    measures.push({
      events, keysig,
      startRepeat: /<startRepeat/.test(content),
      endRepeat: /<endRepeat/.test(content),
      volta: (content.match(/<Volta[\s\S]*?<endings>(\d+)/) ?? [])[1] ?? null,
      marks: marksToAbc(content),
    });
  }
  return measures;
}

function measureToAbc(
  meas: Measure,
  state: { sig: number; keyChange: string | null },
): { music: string; syls: string[]; syls2: string[] } {
  if (meas.keysig !== null && meas.keysig !== state.sig) {
    state.sig = meas.keysig;
    state.keyChange = SIG_KEY[state.sig] ?? "C";
  }
  const keyDef = keyDefaults(state.sig);
  const accState: Record<string, number> = {};
  const toks: string[] = [];
  const syls: string[] = [];
  const syls2: string[] = [];
  for (const ev of meas.events) {
    let t = "";
    if (ev.harmony?.root) t += `"${chordName(ev.harmony)}" `;
    if (ev.type === "rest") {
      t += "z" + lenStr(ev.units);
    } else {
      const ns = ev.notes.map((n) => {
        const { letter, alter } = tpcInfo(n.tpc);
        return abcPitch(letter, alter, n.midi, accState, keyDef);
      });
      const bodyTok = ns.length > 1 ? "[" + ns.join("") + "]" : ns[0];
      t += bodyTok + lenStr(ev.units) + (ev.notes.some((n) => n.tie) ? "-" : "");
      syls.push(ev.lyric ? ev.lyric : "*");
      syls2.push(ev.lyric2 ? ev.lyric2 : "*");
    }
    toks.push(t);
  }
  return { music: toks.join(" "), syls, syls2 };
}

/** .mscz(또는 .mscx) 바이트 → 악보 XML 글 */
function loadMscx(data: Uint8Array, fileName: string): string {
  if (fileName.toLowerCase().endsWith(".mscx")) return new TextDecoder().decode(data);
  const files = unzipSync(data);
  const mscxName = Object.keys(files).find((n) => n.endsWith(".mscx"));
  if (!mscxName) throw new Error("mscz 안에서 악보(.mscx)를 찾지 못했습니다");
  return new TextDecoder().decode(files[mscxName]);
}

/**
 * 마디를 품은 보표들.
 *
 * Part 정의부에도 <Staff id="n">이 있다(악기 설정만 든 껍데기). 앞에서부터
 * 훑으면 그 껍데기가 첫 보표의 마디까지 삼켜 번호가 엇갈린다 — 광화문
 * 연가에서 id가 3·2·3으로 나와, 플루트 보표에 「어쿠스틱 기타 2 (타브)」
 * 라는 이름이 붙었다. Part 정의부가 끝난 뒤부터 뒤진다.
 */
function staffBlocksOf(xml: string): RegExpMatchArray[] {
  const from = xml.lastIndexOf("</Part>");
  const body = from >= 0 ? xml.slice(from) : xml;
  return [
    ...body.matchAll(/<Staff id="(\d+)">([\s\S]*?)<\/Staff>\s*(?=<Staff id="|<\/Score>)/g),
  ].filter((m) => m[2].includes("<Measure"));
}

export interface MsczPart {
  /** 보표 차례(0부터). msczToAbc·서버에 넘기는 값 */
  index: number;
  /** 사람이 읽는 이름 — 「노래」「기타」「Guitar (Tab)」 같은 것 */
  name: string;
}

/**
 * 혼성 악보의 보표 목록.
 *
 * 노래·기타·타브가 한 파일에 든 악보는 어느 보표가 멜로디인지 파일만
 * 봐서는 모른다. 이름을 뽑아 사람이 고르게 한다. 보표가 하나면 빈 목록.
 */
export function msczParts(data: Uint8Array, fileName: string): MsczPart[] {
  const xml = loadMscx(data, fileName);
  const blocks = staffBlocksOf(xml);
  if (blocks.length < 2) return [];
  // Part 정의부: <Part><Staff id="n"/>…<trackName>이름</trackName>
  // 이름과 타브 여부는 Part 정의부에 있다. 보표마다 StaffType이 붙어 있고,
  // 타브는 group="tablature"다 — 기타 한 대가 오선과 타브 두 보표를 갖는다.
  const names = new Map<string, string>();
  for (const part of xml.matchAll(/<Part[ >][\s\S]*?<\/Part>/g)) {
    const staffs = [...part[0].matchAll(/<Staff id="(\d+)">([\s\S]*?)<\/Staff>/g)];
    const name =
      (part[0].match(/<trackName>([^<]*)/) ?? [])[1]?.trim() ||
      (part[0].match(/<longName>([^<]*)/) ?? [])[1]?.trim() ||
      (part[0].match(/<instrumentId>([^<]*)/) ?? [])[1]?.trim() ||
      "";
    staffs.forEach((st, k) => {
      const tab = /<StaffType[^>]*group="tablature"/.test(st[2]) ? " (타브)" : "";
      names.set(st[1], (staffs.length > 1 ? `${name} ${k + 1}` : name) + tab);
    });
  }
  return blocks.map((b, i) => ({ index: i, name: names.get(b[1]) || `${i + 1}번 보표` }));
}

/** .mscz(또는 .mscx) 바이트 → ABC. 실패하면 이유를 담아 던진다. staff는 혼성 악보에서 쓸 보표(0부터) */
export function msczToAbc(data: Uint8Array, fileName: string, staff = 0): string {
  const xml = loadMscx(data, fileName);
  const staffBlocks = staffBlocksOf(xml);
  if (!staffBlocks.length) throw new Error("악보에서 마디를 찾지 못했습니다");
  if (!staffBlocks[staff]) throw new Error(`보표가 ${staffBlocks.length}개뿐입니다`);

  const title = (xml.match(/<metaTag name="workTitle">([^<]*)/) ?? [])[1] ?? "";
  const tempoM = xml.match(/<tempo>([\d.]+)/);
  const bpm = tempoM ? Math.round(+tempoM[1] * 60) : 0;
  const sigN = (xml.match(/<sigN>(\d+)/) ?? [0, 4])[1];
  const sigD = (xml.match(/<sigD>(\d+)/) ?? [0, 4])[1];
  const firstKey = +((xml.match(/<KeySig>[\s\S]*?<accidental>(-?\d+)/) ?? [0, 0])[1]);

  const staff1 = parseStaff(staffBlocks[staff][2]);
  /*
   * 되돌이·1·2번 괄호·세뇨·코다는 악보 전체의 일이라, 뮤즈스코어는
   * **첫 보표에만** 적어 둔다. 기타 보표를 골랐다고 그것을 잃으면 41마디
   * 악보가 41마디로만 펴진다 — 도돌이가 통째로 날아간다.
   */
  if (staff > 0) {
    const first = parseStaff(staffBlocks[0][2]);
    staff1.forEach((m, j) => {
      const f = first[j];
      if (!f) return;
      if (!m.startRepeat) m.startRepeat = f.startRepeat;
      if (!m.endRepeat) m.endRepeat = f.endRepeat;
      if (m.volta === null) m.volta = f.volta;
      if (!m.marks) m.marks = f.marks;
    });
  }
  const st = { sig: firstKey, keyChange: null as string | null };
  const PER_LINE = 4;
  const lines: string[] = [];
  for (let i = 0; i < staff1.length; i += PER_LINE) {
    const chunk: string[] = [];
    const sylsAll: string[] = [];
    const syls2All: string[] = [];
    for (let j = i; j < Math.min(i + PER_LINE, staff1.length); j++) {
      const meas = staff1[j];
      const pre =
        (meas.startRepeat ? "|: " : "") +
        (meas.volta ? `[${meas.volta} ` : "") +
        meas.marks;
      /*
       * 1·2번 괄호는 **닫아 주어야** 한다.
       *
       * ABC에서 괄호는 되돌이 끝(:|)이나 겹세로줄(||)을 만나야 닫힌다.
       * 1번 괄호는 뒤에 :| 가 있어 저절로 닫히지만 마지막 괄호(2번)는
       * 닫는 것이 없어, 악보 끝까지 긴 선이 그어졌다 — 줄마다 오선 위로
       * 지나가던 그 선이다. 괄호가 끝나는 자리에 겹세로줄을 세운다.
       */
      const next = staff1[j + 1];
      const closesVolta =
        !!meas.volta && !meas.endRepeat && !next?.endRepeat && !next?.volta;
      const bar = meas.endRepeat ? " :|" : closesVolta ? " ||" : " |";
      st.keyChange = null;
      const r = measureToAbc(meas, st);
      chunk.push(
        pre + (st.keyChange ? `[K:${st.keyChange}] ` : "") + r.music + bar,
      );
      sylsAll.push(...r.syls);
      syls2All.push(...r.syls2);
    }
    let block = chunk.join("");
    if (sylsAll.some((s) => s !== "*")) block += "\nw: " + sylsAll.join(" ");
    if (syls2All.some((s) => s !== "*")) block += "\nw: " + syls2All.join(" ");
    lines.push(block);
  }

  return (
    `X:1
T:${title || "제목 없음"}
M:${sigN}/${sigD}
L:1/16
${bpm ? `Q:1/4=${bpm}\n` : ""}K:${SIG_KEY[firstKey] ?? "C"}
` + lines.join("\n") + "\n"
  );
}
