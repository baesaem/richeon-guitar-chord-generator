"use client";

/**
 * 강상주민센터 기타반 — 반별 공유 폴더.
 *
 * 초급과 중급은 나가는 곡이 다르다. 한 폴더에 섞어 두면 수강생이 자기
 * 반 곡을 골라내야 하고, 선생님도 어느 곡이 어느 반 것인지 헷갈린다.
 * 반마다 폴더를 따로 두고 화면에서도 따로 연다.
 *
 * 폴더 id는 화면에 실려도 된다 — "링크가 있는 모든 사용자 · 뷰어"로
 * 공개된 폴더라 id를 아는 것과 링크를 아는 것이 같다.
 */

export interface GuitarClass {
  id: string;
  name: string;
  folderId: string;
}

export const CLASSES: GuitarClass[] = [
  {
    id: "beginner",
    name: "강상주민센터 기타반(초급)",
    folderId: "1hEKM-s_pNLuw7W2e2YsPNveE6qoQq-Nd",
  },
  {
    id: "intermediate",
    name: "강상주민센터 기타반(중급)",
    folderId: "14DkfLqbYBapOD3rlrTxpqpLNEmX90CzL",
  },
];

export const folderUrl = (folderId: string) =>
  `https://drive.google.com/drive/folders/${folderId}`;

/** 알고 있는 반의 폴더인가. 서버에 넘길 값을 걸러 내는 데 쓴다. */
export const knownFolder = (folderId: string) =>
  CLASSES.some((c) => c.folderId === folderId);
