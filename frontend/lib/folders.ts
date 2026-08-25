"use client";

/**
 * 재생목록 폴더 분류.
 *
 * 폴더 목록과 곡→폴더 배정만 기억하면 되므로 localStorage로 충분하다
 * (결과 본문은 IndexedDB, 분류는 여기 — 서로 독립이라 한쪽이 깨져도 다른 쪽은 산다).
 */

const KEY = "chordgen.folders";

interface FolderData {
  folders: string[];
  /** songId → 폴더 이름 */
  assignment: Record<string, string>;
}

function read(): FolderData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as FolderData;
      if (Array.isArray(data.folders) && data.assignment) return data;
    }
  } catch {
    // 깨진 저장값은 초기화로 간다
  }
  return { folders: [], assignment: {} };
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
