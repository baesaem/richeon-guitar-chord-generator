"use client";

/**
 * 강상기타반 공유 폴더 파일명 규칙.
 *
 * 관리자가 재생목록에서 내보내는 파일은 두 가지다:
 *   코드: "리천 노래명(출처).rml"
 *   음원: "리천 노래명(출처).{결과id}.mp3"  (id = YouTube 11자 또는 업로드 해시 16자 hex)
 *
 * 음원 파일명에 결과 id가 들어 있어, 수강생이 곡(.rml)을 받을 때
 * 그 안의 결과 id로 짝이 되는 음원을 찾아 함께 받을 수 있다.
 */

const AUDIO_RE = /\.([A-Za-z0-9_-]{11}|[0-9a-f]{16})\.(mp3|m4a|webm|wav|ogg|aac|flac)$/i;

/** 공유 음원 파일명에서 결과 id를 뽑는다. 음원이 아니면 null. */
export function audioIdFromName(name: string): string | null {
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
