/**
 * 곡에 붙인 「함께 볼 영상」 링크 — 유튜브 주소에서 영상 번호를 뽑는다.
 *
 * 동영상 파일로 등록한 곡은 영상을 드라이브에 올릴 수 없어(수십 MB) 수강생은
 * 소리만 받는다. 강사님이 그 곡의 유튜브 링크를 붙여 두면 재생 화면이 그
 * 영상을 **음소거로** 띄우고 음원 시각에 맞춰 돌린다 — 소리는 등록한 음원,
 * 그림은 유튜브.
 */

/** 유튜브 주소(watch·youtu.be·shorts·embed)에서 11자 영상 번호. 아니면 null */
export function youtubeIdOf(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})(?![\w-])/);
  if (m) return m[1];
  // 번호만 적어 둔 경우
  return /^[\w-]{11}$/.test(s) ? s : null;
}
