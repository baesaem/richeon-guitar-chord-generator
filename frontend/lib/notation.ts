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

/** "G# major" 같은 조 이름을 보고 플랫 표기를 쓸지 결정한다. */
export function useFlats(key: string): boolean {
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
  return spell(key, useFlats(key));
}
