/**
 * 코드 표기 변환.
 *
 * 백엔드는 근음을 샾(#)으로만 돌려준다. 그런데 Ab장조를 G#으로 읽는 기타리스트는 없다.
 * 조표가 플랫 계열이면 플랫으로 바꿔 적는다.
 */

// 임시표는 라틴 글자가 아니라 악보 기호로 적는다: ♭(U+266D), ♯(U+266F).
// 화면에서는 ChordLabel이 이 기호들을 위첨자로 올려 그린다.
// 내부 데이터(근음 키)는 여전히 "C#" 형태를 쓰고, 표시 직전에만 바꾼다.
const SHARP_TO_FLAT: Record<string, string> = {
  "C#": "D♭",
  "D#": "E♭",
  "F#": "G♭",
  "G#": "A♭",
  "A#": "B♭",
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

/** 표시용 표기. 플랫 조표면 "A#m" → "B♭m", 아니면 "A♯m"처럼 기호로 바꾼다. */
export function spell(label: string, flats: boolean): string {
  const base = flats
    ? label.replace(/[A-G]#/g, (m) => SHARP_TO_FLAT[m] ?? m)
    : label;
  return base.replace(/#/g, "♯");
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

/**
 * 「기본」 표기로 낮출 때 쓰는 대응표.
 *
 * 초보자는 Cmaj7·Csus4를 다 잡지 못해도 C만 잡으면 곡이 굴러간다.
 * 3화음(장/단)과 세븐스만 남기고 확장·변화음은 뿌리 화음으로 되돌린다.
 * 감·반감 계열은 단3도를 품으므로 단화음 쪽으로 보낸다.
 */
const BASIC_QUALITY: Record<string, string> = {
  maj7: "maj", 6: "maj", add9: "maj", sus2: "maj", sus4: "maj", aug: "maj",
  min7: "min", min6: "min", minmaj7: "min", dim: "min", dim7: "min", min7b5: "min",
};

/** 코드 어휘를 「기본」으로 낮춘다. all이면 그대로 둔다. */
export function simplifyQuality(quality: string, vocab: "basic" | "all"): string {
  if (vocab === "all") return quality;
  return BASIC_QUALITY[quality] ?? quality;
}

/** 근음 + 종류로 표시용 라벨을 만든다. 이조해도 7th 표기가 유지된다. */
export function labelFor(root: string | null, quality: string, flats: boolean): string {
  if (!root || quality === "N") return "N.C.";
  const suffix = QUALITY_SUFFIX[quality] ?? quality;
  return `${spell(root, flats)}${suffix}`;
}

/** 「Eb」「D♭」처럼 적힌 근음을 반음 수로. 모르면 null */
function pitchOf(root: string): number | null {
  const m = root.replace(/♯/g, "#").replace(/♭/g, "b").match(/^([A-G])([#b]?)$/);
  if (!m) return null;
  const base = PITCH_CLASS[m[1]];
  if (base === undefined) return null;
  const alter = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return (((base + alter) % 12) + 12) % 12;
}

/**
 * 「E7/G#」처럼 통째로 적힌 코드 이름을 반음 단위로 옮긴다.
 *
 * 타브 화면은 악보 파일에 적힌 코드 이름을 그대로 받는다. 그런데 다른
 * 화면들은 카포만큼 옮겨 적으므로, 옮기지 않으면 같은 자리를 두고
 * 멜로디는 Gm, 타브는 Em이라 부르게 된다 — 같은 곡에서 이름이 둘이면
 * 서로 짚어 말할 수가 없다.
 */
export function shiftChordLabel(
  label: string,
  semitones: number,
  flats: boolean,
): string {
  if (!label) return label;
  /* 옮길 것이 없으면 **적힌 그대로** 둔다. 다시 적으면 ♭·♯이 뒤집혀,
     악보가 B7/E♭이라 적은 자리를 화면만 B7/D♯으로 적는다 — 같은
     코드인데 글자가 달라 보인다. 기호만 예쁘게 고친다 */
  if (!semitones) return prettyAccidentals(label);
  const [head, bass] = label.split("/");
  const m = head.match(/^([A-G][#b♯♭]?)(.*)$/);
  if (!m) return label;
  const pc = pitchOf(m[1]);
  if (pc === null) return label;
  const root = SHARP_NAMES[(((pc + semitones) % 12) + 12) % 12];
  let out = spell(root, flats) + m[2];
  if (bass) {
    const bp = pitchOf(bass);
    out +=
      "/" +
      (bp === null
        ? bass
        : spell(SHARP_NAMES[(((bp + semitones) % 12) + 12) % 12], flats));
  }
  return out;
}


/** b·#을 ♭·♯으로. 음 이름 뒤에 붙은 것만 고친다(sus4b9의 b는 놔둔다) */
export function prettyAccidentals(label: string): string {
  return label.replace(/([A-G])b/g, "$1♭").replace(/([A-G])#/g, "$1♯");
}

/**
 * 화면에 적을 코드 이름. **베이스음(슬래시)까지** 담는다.
 *
 * 그리드와 파형은 뿌리와 성질만 적어 왔다. 그래서 악보가 B7/E♭이라
 * 적은 자리를 B7로만 적어, 화면마다 코드가 다르게 보였다.
 *
 * exact면 악보에 적힌 이름을 그대로 쓴다 — 다시 적으면 ♭·♯이 뒤집힌다.
 * 음높이를 옮겼거나 어휘를 낮춘 곡은 적힌 이름이 더는 맞지 않으므로
 * 뿌리와 성질에서 새로 짓는다.
 */
export function chordText(
  chord: {
    root: string | null;
    quality: string;
    bass?: string | null;
    /** 악보에 적힌 그대로의 이름 */
    score?: string;
  },
  shift: number,
  flats: boolean,
  exact = false,
): string {
  if (exact && chord.score) return prettyAccidentals(chord.score);
  const head = labelFor(transposeRoot(chord.root, shift), chord.quality, flats);
  if (!chord.bass) return head;
  const bass = transposeRoot(chord.bass, shift);
  return `${head}/${bass ? spell(bass, flats) : prettyAccidentals(chord.bass)}`;
}
