/**
 * 코드 표기 변환.
 *
 * 백엔드는 근음을 샾(#)으로만 돌려준다. 그런데 Ab장조를 G#으로 읽는 기타리스트는 없다.
 * 조표가 플랫 계열이면 플랫으로 바꿔 적는다.
 */

const SHARP_TO_FLAT: Record<string, string> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
};

const PITCH_CLASS: Record<string, number> = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5,
  "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};

// 플랫 조표를 쓰는 조 (으뜸음의 피치 클래스)
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);   // F  Bb Eb Ab Db
const FLAT_MINOR = new Set([2, 7, 0, 5, 10]);   // Dm Gm Cm Fm Bbm

/** "G# major" 같은 조 이름을 보고 플랫 표기를 쓸지 결정한다. (리액트 훅 아님) */
export function prefersFlats(key: string): boolean {
  const [tonic, mode] = key.split(" ");
  const pc = PITCH_CLASS[tonic];
  if (pc === undefined) return false;
  return mode === "minor" ? FLAT_MINOR.has(pc) : FLAT_MAJOR.has(pc);
}

/** 코드 라벨의 근음(과 슬래시 베이스)만 플랫으로 바꾼다. "A#m" → "Bbm" */
export function spell(label: string, flats: boolean): string {
  if (!flats) return label;
  return label.replace(/[A-G]#/g, (m) => SHARP_TO_FLAT[m] ?? m);
}

/** "G# major" → "Ab major" */
export function spellKey(key: string): string {
  return spell(key, prefersFlats(key));
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** 근음을 반음 단위로 옮긴다. 카포/이조 표시용. */
export function transposeRoot(root: string | null, semitones: number): string | null {
  if (!root) return null;
  const pc = PITCH_CLASS[root];
  if (pc === undefined) return null;
  return SHARP_NAMES[(((pc + semitones) % 12) + 12) % 12];
}

/** 설정(자동/♯ 고정/♭ 고정)까지 반영해 플랫 표기 여부를 정한다. */
export function resolveFlats(key: string, notation: "auto" | "sharp" | "flat"): boolean {
  if (notation === "sharp") return false;
  if (notation === "flat") return true;
  return prefersFlats(key);
}

// quality → 근음 뒤 접미사. 백엔드 chords_btc._LABEL_SUFFIX와 짝을 맞춘다.
const QUALITY_SUFFIX: Record<string, string> = {
  maj: "", min: "m", dim: "dim", aug: "aug",
  "6": "6", min6: "m6", min7: "m7", minmaj7: "mM7",
  maj7: "maj7", "7": "7", dim7: "dim7", min7b5: "m7b5",
  sus2: "sus2", sus4: "sus4", add9: "add9",
};

/** 근음 + 종류로 표시용 라벨을 만든다. 이조해도 7th 표기가 유지된다. */
export function labelFor(root: string | null, quality: string, flats: boolean): string {
  if (!root || quality === "N") return "N.C.";
  const suffix = QUALITY_SUFFIX[quality] ?? quality;
  return `${spell(root, flats)}${suffix}`;
}
