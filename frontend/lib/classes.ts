"use client";

/**
 * 강상주민센터 기타반 — 반별 공유 폴더.
 *
 * 초급과 중급은 나가는 곡이 다르다. 한 폴더에 섞어 두면 수강생이 자기
 * 반 곡을 골라내야 하고, 강사님도 어느 곡이 어느 반 것인지 헷갈린다.
 * 반마다 폴더를 따로 두고 화면에서도 따로 연다.
 *
 * 폴더 id는 화면에 실려도 된다 — "링크가 있는 모든 사용자 · 뷰어"로
 * 공개된 폴더라 id를 아는 것과 링크를 아는 것이 같다.
 */

export interface GuitarClass {
  id: string;
  name: string;
  /** 곡(음원·코드) 공유 폴더 */
  folderId: string;
  /** 강의실 자료 공유 폴더. 곡과 섞이지 않게 따로 둔다 */
  lessonFolderId: string;
}

export const CLASSES: GuitarClass[] = [
  {
    id: "beginner",
    name: "강상주민센터 기타반(초급)",
    folderId: "1hEKM-s_pNLuw7W2e2YsPNveE6qoQq-Nd",
    lessonFolderId: "1EWHUax-B5WGnAr7y3gYEFpaE9v5Q7Ouj",
  },
  {
    id: "intermediate",
    name: "강상주민센터 기타반(중급)",
    folderId: "14DkfLqbYBapOD3rlrTxpqpLNEmX90CzL",
    lessonFolderId: "1xjOfkBsy7_XOiuZ90w_jikBwtIgbZjUJ",
  },
];

/**
 * 노래방 공유 폴더(강사님) — 악보 없이 유튜브 음원을 분석한 곡을 모은다.
 *
 * 반이 아니라 강의실은 없다. 음원목록의 「노래방」 폴더와 짝이다 — 올리면
 * 이 드라이브 폴더로 가고, 받으면 음원목록의 「노래방」 폴더에 담긴다.
 * 반 폴더처럼 「링크가 있는 모든 사용자 · 뷰어」로 공개했다.
 */
export const KARAOKE_SHARE: GuitarClass = {
  id: "karaoke",
  name: "노래방",
  folderId: "1Pem8c5zjTL-N9F6apmMNWKC26ZBLonQZ",
  lessonFolderId: "",
};

/** 곡을 올리고 받는 드라이브 폴더 전부 — 반 폴더와 노래방 */
export const SONG_SHARES: GuitarClass[] = [...CLASSES, KARAOKE_SHARE];

export const folderUrl = (folderId: string) =>
  `https://drive.google.com/drive/folders/${folderId}`;

/** 알고 있는 반의 폴더인가. 서버에 넘길 값을 걸러 내는 데 쓴다. */
export const knownFolder = (folderId: string) =>
  folderId === KARAOKE_SHARE.folderId ||
  CLASSES.some((c) => c.folderId === folderId || c.lessonFolderId === folderId);
