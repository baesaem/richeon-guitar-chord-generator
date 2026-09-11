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
  notes: { midi: number; tpc: number; tie: boolean; fret: number | null; string: number | null }[];
  lyric: string | null;
  lyric2: string | null;
  /**
   * 셋잇단 따위의 길이 비율(2/3 같은 것). 없으면 1.
   *
   * units는 그대로 둔다 — ABC로 옮길 때 쓰는 값이라, 여기서 줄이면
   * 「1.333/2」 같은 적을 수 없는 길이가 나온다. 타브를 박 길이대로
   * 놓을 때만 이 비율을 곱한다.
   */
  tuplet?: number;
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
 *
 * 되돌이(D.S.)에 「이어 칠 자리」(continueAt)가 비어 있어도 코다 표가 둘
 * 이상이면 al Coda로 읽는다. 「우리 사랑 기억 하겠네」 악보는 D.S.를
 * playUntil=end로만 적어 두고 코다 표 둘을 찍어 두었다 — 끝까지 치면
 * 85마디, 코다로 건너뛰면 69마디이고 음원은 72마디(전주가 한 마디 김)다.
 */
function marksToAbc(content: string, codaJump = false): string {
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
    out += cont || codaJump ? `!${ds}alcoda!` : `!${ds}alfine!`;
  }
  return out;
}

function parseStaff(body: string): Measure[] {
  // 코다 표가 둘 이상이면 되돌이는 코다로 건너뛰는 것이다(marksToAbc 참고)
  const codaJump = (body.match(/<label>codab?<\/label>/g) ?? []).length >= 2;
  // 앞의 코다 표가 마디 머리(codab)에 찍혔는가 — 아래에서 쓴다
  const firstCodaAtStart =
    codaJump && (body.match(/<label>(codab?)<\/label>/) ?? [])[1] === "codab";
  const measures: Measure[] = [];
  for (const mm of body.matchAll(/<Measure([^>]*)>([\s\S]*?)<\/Measure>/g)) {
    const content = mm[2];
    /* 셋잇단은 마디 앞에 <Tuplet id="185">로 한 번 적어 두고, 그 안의
       음마다 <Tuplet>185</Tuplet>로 가리킨다. 끝을 알리는 표는 없다 */
    const ratios = new Map<string, number>();
    for (const t of content.matchAll(/<Tuplet id="(\d+)">([\s\S]*?)<\/Tuplet>/g)) {
      const normal = +((t[2].match(/<normalNotes>(\d+)/) ?? [])[1] ?? 0);
      const actual = +((t[2].match(/<actualNotes>(\d+)/) ?? [])[1] ?? 0);
      if (normal > 0 && actual > 0) ratios.set(t[1], normal / actual);
    }
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
        const inTuplet = inner.match(/<Tuplet>(\d+)<\/Tuplet>/);
        const tuplet = inTuplet ? ratios.get(inTuplet[1]) : undefined;
        if (tag === "Rest") {
          events.push({
            type: "rest", units, notes: [], tuplet,
            lyric: null, lyric2: null, harmony: pendingHarmony,
          });
        } else {
          const notes = [...inner.matchAll(/<Note>([\s\S]*?)<\/Note>/g)].map(
            (nm) => {
              const ni = nm[1];
              const fret = ni.match(/<fret>(\d+)/);
              const string = ni.match(/<string>(\d+)/);
              return {
                midi: +(ni.match(/<pitch>(\d+)/) ?? [0, 0])[1],
                tpc: +(ni.match(/<tpc>(-?\d+)/) ?? [0, 14])[1],
                tie: /<Tie[\s>]/.test(ni),
                // 타브 보표에만 있다. 0번 줄이 맨 윗줄(가는 1번 줄)이다
                fret: fret ? +fret[1] : null,
                string: string ? +string[1] : null,
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
            type: "note", units, notes, tuplet,
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
      marks: marksToAbc(content, codaJump),
    });
  }
  /*
   * 코다 표가 둘 다 마디 머리(codab)에 찍힌 악보는, 앞의 것이 「그 마디에
   * 들어가기 전에」 코다로 건너뛰는 자리다. ABC의 !coda!는 「이 마디를
   * 치고 건너뛴다」로 읽히므로 바로 앞 마디로 옮겨 적는다. 「우리 사랑
   * 기억 하겠네」는 29마디 머리의 ⊕에서 뛰어야 음원(가사 자리)과 맞았다.
   */
  if (firstCodaAtStart) {
    const at = measures.findIndex((m) => m.marks.includes("!coda!"));
    if (at > 0) {
      measures[at].marks = measures[at].marks.replace("!coda!", "");
      measures[at - 1].marks += "!coda!";
    }
  }
  return measures;
}

/**
 * 마디 하나를 ABC로. up은 적는 음높이를 올릴 반음 수다.
 *
 * 기타 악보는 **소리보다 한 옥타브 높여** 적는다(높은음자리표 아래
 * 8). 뮤즈스코어는 소리 나는 음높이를 저장하므로, 그대로 옮기면 6번
 * 줄 개방현(E2)이 기타로 짚을 수 없는 음이 되어 abcjs가 프렛 자리에
 * 물음표를 찍는다 — 495자리 가운데 92자리가 그랬다. 타브 보표를 옮길
 * 때만 12를 준다.
 */
function measureToAbc(
  meas: Measure,
  state: { sig: number; keyChange: string | null },
  up = 0,
  keepKey = false,
): { music: string; syls: string[]; syls2: string[] } {
  /*
   * keepKey면 곡 가운데서 조표가 바뀌어도 처음 조표를 그대로 쓴다.
   *
   * abcjs의 타브는 **줄머리에 선 조표만** 본다 — 줄 가운데의 [K:G]는
   * 못 보고 옛 조로 계속 읽는다. 그래서 코다에서 조가 바뀌는 「광화문
   * 연가」는 36마디부터 프렛이 통째로 어긋났다. 조표를 하나로 두면
   * 바뀐 조의 음들은 임시표로 적히고, 그것은 abcjs도 제대로 읽는다.
   */
  if (!keepKey && meas.keysig !== null && meas.keysig !== state.sig) {
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
        return abcPitch(letter, alter, n.midi + up, accState, keyDef);
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

/** 이 보표가 타브인가. Part 정의부의 StaffType group="tablature"가 말해 준다 */
function isTabStaff(xml: string, staffId: string): boolean {
  for (const st of xml.matchAll(/<Staff id="(\d+)">([\s\S]*?)<\/Staff>/g)) {
    if (st[1] !== staffId) continue;
    if (/<StaffType[^>]*group="tablature"/.test(st[2])) return true;
  }
  return false;
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
  // 타브 보표면 적는 음높이를 한 옥타브 올린다(윗글 참고)
  const up = isTabStaff(xml, staffBlocks[staff][1]) ? 12 : 0;
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
      /*
       * 코드 이름도 첫 보표에서 가져온다.
       *
       * 코드는 노래 보표 위에만 적혀 있다. 기타 보표를 골랐다고 코드가
       * 사라지면, 짚을 자리는 보이는데 무슨 코드인지 알 수 없는 타브가
       * 된다. 이 마디에 적힌 코드가 없을 때만 옮겨 온다.
       */
      if (!m.events.some((e) => e.harmony?.root)) {
        const chords = f.events.filter((e) => e.harmony?.root);
        chords.forEach((c, k) => {
          // 마디를 코드 수만큼 나눠 그 자리에 얹는다
          const at = Math.floor((m.events.length * k) / Math.max(chords.length, 1));
          const ev = m.events[at];
          if (ev && !ev.harmony) ev.harmony = c.harmony;
        });
      }
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
      const r = measureToAbc(meas, st, up, up !== 0);
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

// ---- 타브 악보를 우리가 그리기 위한 꼴 ----

/** 한 자리에서 함께 짚는 손가락들. string 0이 가장 가는 1번 줄이다 */
export interface TabCol {
  /** 16분음표 몇 개 길이인가. 마디 안에서 자리를 나누는 데 쓴다 */
  units: number;
  frets: { string: number; fret: number }[];
  /** 이 자리에 붙은 코드 이름. 없으면 빈 값 */
  chord?: string;
}

export interface TabBar {
  cols: TabCol[];
  startRepeat: boolean;
  endRepeat: boolean;
  /** 1·2번 괄호. 없으면 null */
  volta: string | null;
  /** 세뇨·코다·달세뇨를 사람이 읽는 글자로 */
  marks: string[];
  /** 마디 하나가 몇 16분음표인가. 4/4면 16 */
  units: number;
  /** 이 마디에 붙은 가사. 노래 보표에서 가져와 이어 붙인 것 */
  lyric: string;
  /** 2절 가사. 도돌이를 돌 때 부르는 말이다 */
  lyric2: string;
}

export interface TabScore {
  title: string;
  bpm: number;
  meter: string;
  bars: TabBar[];
  /**
   * 숫자도 이 악보의 것을 쓴다. 보통 숫자는 그림 악보에서만 오고 이
   * 틀은 마디·가사·되돌이만 준다 — 악보 파일의 타브는 옮겨 적은 사람이
   * 달라 종이와 어긋난다. 사람이 「이 곡은 기타 파트를 타브로」라고 고른
   * 곡만 켠다. 「나는 반딧불」은 종이 타브가 없고 기타 파트를 떠 달라 했다
   */
  ownFrets?: boolean;
}

/** ABC 기호로 적어 둔 되돌이 지시를 악보에 적는 글자로 */
function markLabels(abcMarks: string): string[] {
  const out: string[] = [];
  if (abcMarks.includes("!segno!")) out.push(String.fromCodePoint(0x1d10b));
  if (abcMarks.includes("!coda!")) out.push(String.fromCodePoint(0x1d10c));
  if (abcMarks.includes("!fine!")) out.push("Fine");
  const jump = abcMarks.match(/!D\.([SC])\.al(coda|fine)!/i);
  if (jump)
    out.push(
      `D.${jump[1].toUpperCase()}. al ${
        jump[2].toLowerCase() === "coda" ? "Coda" : "Fine"
      }`,
    );
  return out;
}

/** 이 보표 악기의 줄 음높이(굵은 줄부터). 적힌 것이 없으면 표준 조율 */
function tuningOf(xml: string, staffId: string): number[] {
  for (const part of xml.matchAll(/<Part[ >][\s\S]*?<\/Part>/g)) {
    if (!new RegExp(`<Staff id="${staffId}"[ >]`).test(part[0])) continue;
    const sd = part[0].match(/<StringData>([\s\S]*?)<\/StringData>/);
    if (sd) {
      const s = [...sd[1].matchAll(/<string[^>]*>(\d+)<\/string>/g)].map((m) => +m[1]);
      if (s.length >= 4) return s;
    }
  }
  return [40, 45, 50, 55, 59, 64];
}

/**
 * 오선으로만 적힌 기타 파트에 줄·프렛을 매긴다.
 *
 * 함께 울리는 음은 서로 다른 줄에, 높은 음일수록 가는 줄에 둔다. 손이
 * 벌어지지 않게(개방현을 빼고 4프렛 안) 고르고, 그중에서 앞 자리에서 손이
 * 있던 곳과 가깝고 낮은 자리를 고른다. 안 되면 폭을 넓혀 다시 찾는다.
 * string 0이 가장 가는 1번 줄이다.
 */
function assignFrets(
  pitches: number[],
  tuning: number[],
  hand: number,
): { string: number; fret: number }[] | null {
  const n = tuning.length;
  const notes = [...new Set(pitches)].sort((a, b) => b - a).slice(0, n);
  // 19프렛까지 — C5·D5·E5 같은 높은 음 뭉치는 3번 줄 17프렛이라야 짚인다
  const MAX_FRET = 19;
  for (const span of [4, 5, 7, 19]) {
    let best: { cost: number; pick: { string: number; fret: number }[] } | null = null;
    const pick: { string: number; fret: number }[] = [];
    const go = (k: number) => {
      if (k === notes.length) {
        const fretted = pick.filter((p) => p.fret > 0).map((p) => p.fret);
        const lo = fretted.length ? Math.min(...fretted) : hand;
        const hi = fretted.length ? Math.max(...fretted) : hand;
        if (hi - lo > span) return;
        const center = (lo + hi) / 2;
        const cost = (hi - lo) + Math.abs(center - hand) * 0.6 + center * 0.15;
        if (!best || cost < best.cost) best = { cost, pick: pick.map((p) => ({ ...p })) };
        return;
      }
      // 앞서 고른 음(더 높다)보다 굵은 줄에서만 찾는다
      const from = pick.length ? pick[pick.length - 1].string + 1 : 0;
      for (let s = from; s < n; s++) {
        const fret = notes[k] - tuning[n - 1 - s];
        if (fret < 0 || fret > MAX_FRET) continue;
        pick.push({ string: s, fret });
        go(k + 1);
        pick.pop();
      }
    };
    go(0);
    if (best) return (best as { pick: { string: number; fret: number }[] }).pick;
  }
  return null;
}

/**
 * .mscz의 **기타 타브 보표**를 그대로 읽어 온다.
 *
 * 타브 보표가 없고 기타 파트가 오선으로만 적힌 악보(「나는 반딧불」)는
 * 음높이에서 줄·프렛을 매긴다 — 조율은 그 악기에 적힌 것을 쓴다.
 *
 * ABC로 옮겨 abcjs에게 프렛을 다시 세게 하면, 편곡자가 어느 줄에서
 * 짚으라고 적었는지가 지워진다 — abcjs는 음높이만 보고 제 나름대로
 * 줄을 고른다. 뮤즈스코어 파일에는 음마다 fret과 string이 적혀 있으니
 * 그것을 그냥 쓴다. 코드·되돌이·세뇨는 첫 보표에만 있으므로 옮겨 온다.
 */
export function msczToTab(
  data: Uint8Array,
  fileName: string,
  staff: number,
  /**
   * 음높이로 줄·프렛을 매길 때만 옮기는 반음 수. -12면 한 옥타브 낮춘다.
   * 「나는 반딧불」 기타 파트는 피아노처럼 높게 적혀(C5·D5·E5 뭉치)
   * 12~17프렛 숫자뿐이었다 — 한 옥타브 내리면 개방 코드 자리로 온다
   */
  shift = 0,
): TabScore {
  const xml = loadMscx(data, fileName);
  const blocks = staffBlocksOf(xml);
  if (!blocks[staff]) throw new Error(`보표가 ${blocks.length}개뿐입니다`);

  const title = (xml.match(/<metaTag name="workTitle">([^<]*)/) ?? [])[1] ?? "";
  const tempoM = xml.match(/<tempo>([\d.]+)/);
  const bpm = tempoM ? Math.round(+tempoM[1] * 60) : 0;
  const sigN = +((xml.match(/<sigN>(\d+)/) ?? [0, 4])[1]);
  const sigD = +((xml.match(/<sigD>(\d+)/) ?? [0, 4])[1]);
  const perBar = (16 * sigN) / sigD;

  const mine = parseStaff(blocks[staff][2]);
  const first = staff > 0 ? parseStaff(blocks[0][2]) : mine;
  const tuning = tuningOf(xml, blocks[staff][1]);
  let hand = 3;
  /* 타브 보표면 적힌 줄·프렛을 그대로, 오선만 있는 기타 파트면 음높이로 매긴다 */
  const fretsOf = (
    notes: { midi: number; fret: number | null; string: number | null }[],
  ): { string: number; fret: number }[] => {
    const written = notes.filter((n) => n.fret !== null && n.string !== null);
    if (written.length)
      return written.map((n) => ({ string: n.string as number, fret: n.fret as number }));
    if (!notes.length) return [];
    // 옮기다 가장 굵은 줄보다 낮아진 음은 한 옥타브씩 올려 짚을 수 있게 한다
    const lowest = Math.min(...tuning);
    const pitches = notes.map((n) => {
      let p = n.midi + shift;
      while (p < lowest) p += 12;
      return p;
    });
    let got = assignFrets(pitches, tuning, hand);
    /* 낮춘 화음의 아랫음이 둘 다 6번 줄에서만 나면 짚을 수가 없다 —
       가장 낮은 음부터 덜어 낸다. 베이스는 베이스 파트가 친다 */
    const rest = [...new Set(pitches)].sort((a, b) => a - b);
    while (!got && rest.length > 1) {
      rest.shift();
      got = assignFrets(rest, tuning, hand);
    }
    if (!got) return [];
    const fretted = got.filter((p) => p.fret > 0).map((p) => p.fret);
    if (fretted.length) hand = (Math.min(...fretted) + Math.max(...fretted)) / 2;
    return got;
  };

  const bars: TabBar[] = mine.map((m, j) => {
    const f = first[j];
    /* 코드는 노래 보표 위에만 적혀 있다. 기타 보표를 골랐다고 코드가
       사라지면, 짚을 자리는 보이는데 무슨 코드인지 알 수 없는 타브가
       된다. 이 마디에 적힌 코드가 없을 때만 옮겨 온다. */
    const own = m.events.filter((e) => e.harmony?.root);
    const lend = own.length ? [] : (f?.events ?? []).filter((e) => e.harmony?.root);

    const cols: TabCol[] = m.events.map((ev) => ({
      // 셋잇단은 여기서 줄인다 — 마디 길이 합이 맞아야 박대로 놓을 수 있다
      units: ev.units * (ev.tuplet ?? 1),
      frets: fretsOf(ev.notes),
      chord: chordName(ev.harmony ?? {}),
    }));
    // 빌려 온 코드는 마디를 코드 수만큼 나눠 그 자리에 얹는다
    lend.forEach((c, k) => {
      const at = Math.floor((cols.length * k) / Math.max(lend.length, 1));
      const col = cols[at];
      if (col && !col.chord) col.chord = chordName(c.harmony ?? {});
    });

    /* 가사도 노래 보표에만 있다. 타브 보표의 자리와 노래 보표의 자리는
       수가 달라 한 자리씩 맞출 수 없으니, 마디에 붙은 것을 이어 마디
       아래에 적는다 — 어느 마디에서 무엇을 부르는지는 그것으로 안다 */
    /* 한 낱말이 이어지는 음절에는 뒤에 -가 붙어 있다(뮤즈스코어의
       syllabic). 이어지는 것은 붙이고, 끝난 것 뒤에는 한 칸 띄운다 —
       안 그러면 「이제모두세월따라」처럼 붙어 읽기 어렵다 */
    const joined = (pick: (e: (typeof m.events)[number]) => string | null) => {
      let out = "";
      for (const e of f?.events ?? []) {
        const w = pick(e);
        if (!w) continue;
        const goes = w.endsWith("-");
        out += (goes ? w.slice(0, -1) : w) + (goes ? "" : " ");
      }
      return out.trim();
    };
    const lyric = joined((e) => e.lyric);
    const lyric2 = joined((e) => e.lyric2);

    return {
      cols,
      lyric,
      lyric2,
      startRepeat: m.startRepeat || !!f?.startRepeat,
      endRepeat: m.endRepeat || !!f?.endRepeat,
      volta: m.volta ?? f?.volta ?? null,
      marks: markLabels(m.marks || f?.marks || ""),
      units: perBar,
    };
  });

  return { title, bpm, meter: `${sigN}/${sigD}`, bars };
}
