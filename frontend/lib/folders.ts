"use client";

/**
 * 음원목록 폴더 분류.
 *
 * 폴더 목록과 곡→폴더 배정만 기억하면 되므로 localStorage로 충분하다
 * (결과 본문은 IndexedDB, 분류는 여기 — 서로 독립이라 한쪽이 깨져도 다른 쪽은 산다).
 */

const KEY = "chordgen.folders";

/**
 * 노래방 폴더 — 늘 있다(강사님: 「음원목록에 노래방 폴더 자동생성」).
 * 드라이브의 노래방 공유 폴더와 짝이라, 지워도 다시 생긴다.
 */
export const KARAOKE_FOLDER = "노래방";

/**
 * 늘 두는 폴더 — 반(초급·중급)과 노래방(강사님: 「초급/중급 폴더 자동 생성」).
 * 비슷한 이름이 이미 있으면(「초급반」·「초급」) 그것을 쓰고 새로 만들지 않는다.
 * 드라이브의 같은 이름 공유 폴더(반 id)와 짝이다.
 */
const BUILT_IN: { share: string; name: string; like: RegExp }[] = [
  { share: "beginner", name: "초급반", like: /초급/ },
  { share: "intermediate", name: "중급반", like: /중급/ },
  { share: "karaoke", name: KARAOKE_FOLDER, like: /^노래방$/ },
];

interface FolderData {
  folders: string[];
  /** songId → 폴더 이름 */
  assignment: Record<string, string>;
}

function read(): FolderData {
  let data: FolderData = { folders: [], assignment: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const got = JSON.parse(raw) as FolderData;
      if (Array.isArray(got.folders) && got.assignment) data = got;
    }
  } catch {
    // 깨진 저장값은 초기화로 간다
  }
  for (const b of BUILT_IN)
    if (!data.folders.some((f) => b.like.test(f))) data.folders.push(b.name);
  return data;
}

/**
 * 드라이브 공유 폴더(반 id·"karaoke")에 짝인 음원목록 폴더 이름. 받은 곡을
 * 여기에 담는다. 모르는 폴더면 null.
 */
export function shareFolder(shareId: string): string | null {
  const b = BUILT_IN.find((x) => x.share === shareId);
  return b ? (read().folders.find((f) => b.like.test(f)) ?? null) : null;
}

function write(data: FolderData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 저장이 막혀도 이번 세션 동작에는 지장 없다
  }
}

export function listFolders(): string[] {
  return read().folders;
}

export function createFolder(name: string): string[] {
  const trimmed = name.trim();
  const data = read();
  if (trimmed && !data.folders.includes(trimmed)) {
    data.folders.push(trimmed);
    write(data);
  }
  return data.folders;
}

/** 폴더 이름을 바꾼다. 안에 있던 곡의 배정도 따라간다. */
export function renameFolder(oldName: string, newName: string): string[] {
  const trimmed = newName.trim();
  const data = read();
  if (!trimmed || trimmed === oldName || data.folders.includes(trimmed)) {
    return data.folders;
  }
  data.folders = data.folders.map((f) => (f === oldName ? trimmed : f));
  for (const id of Object.keys(data.assignment)) {
    if (data.assignment[id] === oldName) data.assignment[id] = trimmed;
  }
  write(data);
  return data.folders;
}

/** 폴더를 지운다. 안에 있던 곡은 미분류로 돌아간다(곡 자체는 지워지지 않는다). */
export function deleteFolder(name: string): string[] {
  const data = read();
  data.folders = data.folders.filter((f) => f !== name);
  for (const id of Object.keys(data.assignment)) {
    if (data.assignment[id] === name) delete data.assignment[id];
  }
  write(data);
  return data.folders;
}

export function assignFolder(songId: string, folder: string | null): void {
  const data = read();
  if (folder && data.folders.includes(folder)) data.assignment[songId] = folder;
  else delete data.assignment[songId];
  write(data);
}

export function folderAssignments(): Record<string, string> {
  return read().assignment;
}
