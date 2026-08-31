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

/** .mscz(또는 .mscx) 바이트 → ABC. 실패하면 이유를 담아 던진다 */
export function msczToAbc(data: Uint8Array, fileName: string): string {
  let xml: string;
  if (fileName.toLowerCase().endsWith(".mscx")) {
    xml = new TextDecoder().decode(data);
  } else {
    const files = unzipSync(data);
    const mscxName = Object.keys(files).find((n) => n.endsWith(".mscx"));
    if (!mscxName) throw new Error("mscz 안에서 악보(.mscx)를 찾지 못했습니다");
    xml = new TextDecoder().decode(files[mscxName]);
  }

  // 마디를 품은 스태프만 (Part 정의부의 껍데기 Staff는 거른다)
  const staffBlocks = [
    ...xml.matchAll(/<Staff id="(\d)">([\s\S]*?)<\/Staff>\s*(?=<Staff id="|<\/Score>)/g),
  ].filter((m) => m[2].includes("<Measure"));
  if (!staffBlocks.length) throw new Error("악보에서 마디를 찾지 못했습니다");

  const title = (xml.match(/<metaTag name="workTitle">([^<]*)/) ?? [])[1] ?? "";
  const tempoM = xml.match(/<tempo>([\d.]+)/);
  const bpm = tempoM ? Math.round(+tempoM[1] * 60) : 0;
  const sigN = (xml.match(/<sigN>(\d+)/) ?? [0, 4])[1];
  const sigD = (xml.match(/<sigD>(\d+)/) ?? [0, 4])[1];
  const firstKey = +((xml.match(/<KeySig>[\s\S]*?<accidental>(-?\d+)/) ?? [0, 0])[1]);

  const staff1 = parseStaff(staffBlocks[0][2]);
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
        (meas.startRepeat ? "|: " : "") + (meas.volta ? `[${meas.volta} ` : "");
      const bar = meas.endRepeat ? " :|" : " |";
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
