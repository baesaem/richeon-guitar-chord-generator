"use client";

/**
 * 강상기타반 공유 폴더 파일명 규칙.
 *
 * 관리자가 음원목록에서 내보내는 파일은 세 가지다:
 *   코드: "리천 노래명(출처).rml"
 *   음원: "리천 노래명(출처).{결과id}.mp3"  (id = YouTube 11자 또는 업로드 해시 16자 hex)
 *   반주: "리천 노래명(반주).{결과id}.inst.mp3"  (보컬을 걷어낸 트랙)
 *
 * 음원 파일명에 결과 id가 들어 있어, 수강생이 곡(.rml)을 받을 때
 * 그 안의 결과 id로 짝이 되는 음원을 찾아 함께 받을 수 있다.
 */

const AUDIO_RE = /\.([A-Za-z0-9_-]{11}|[0-9a-f]{16})\.(mp3|m4a|webm|wav|ogg|aac|flac)$/i;
// 반주는 id 뒤에 .inst가 붙는다. 위 규칙과 겹치지 않아 원곡으로 오인되지 않는다.
const INST_RE = /\.([A-Za-z0-9_-]{11}|[0-9a-f]{16})\.inst\.(mp3|m4a|wav|ogg)$/i;

/** 반주 파일명에서 결과 id를 뽑는다. 반주가 아니면 null. */
export function instIdFromName(name: string): string | null {
  const m = name.match(INST_RE);
  return m ? m[1] : null;
}

/** 어떤 트랙을 들을지. off = 전체(원곡 그대로) */
export type StemChoice = "off" | "inst" | "vocals";

/** 기기 저장소에서 분리 트랙을 담는 열쇠. 원곡(id)과 구분한다 */
export const stemKey = (id: string, kind: "inst" | "vocals") => `${id}:${kind}`;
export const instKey = (id: string) => stemKey(id, "inst");

/** 공유 음원 파일명에서 결과 id를 뽑는다. 음원이 아니면 null. */
export function audioIdFromName(name: string): string | null {
  if (INST_RE.test(name)) return null; // 반주는 원곡이 아니다
  const m = name.match(AUDIO_RE);
  return m ? m[1] : null;
}

/** 음원 파일명에서 곡 이름 부분("리천 노래명(출처)")만 남긴다. 음원이 아니면 null. */
export function audioBaseOf(name: string): string | null {
  const m = name.match(AUDIO_RE);
  return m ? name.slice(0, m.index) : null;
}

/** 코드 목록 파일인가. 옛 .json 내보내기도 받아 준다. */
export function isRmlName(name: string): boolean {
  return /\.(rml|json)$/i.test(name);
}

/** 곡 파일명에서 확장자와 "리천 " 접두어를 떼 화면에 보일 제목을 만든다. */
export function songTitleOf(name: string): string {
  return name.replace(/\.(rml|json)$/i, "").replace(/^리천\s*/, "");
}

/** 곡(.rml) 파일명의 이름 부분. 음원 파일과 짝을 맞출 때 쓴다. */
export function rmlBaseOf(name: string): string {
  return name.replace(/\.(rml|json)$/i, "");
}
