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

const EXTRA_KEY = "chordgen.karaokeExtra";

/**
 * 제 폴더(초급반·중급반…)에 둔 채 노래방 목록에도 보이는 곡(강사님: 「노래방에는
 * 없는 음원에 노래방 목록에도 표시 가능을 추가」). 곡은 폴더 하나에만 들어가서,
 * 반 곡을 노래방에도 두려면 따로 적어 둔다.
 */
export function karaokeExtras(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(EXTRA_KEY) || "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 노래방 목록에도 보이게(on) · 빼기 */
export function setKaraokeExtra(id: string, on: boolean): string[] {
  const set = new Set(karaokeExtras());
  if (on) set.add(id);
  else set.delete(id);
  const list = [...set];
  try {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(list));
  } catch {
    // 저장이 막혀도 이번 세션 동작에는 지장 없다
  }
  return list;
}

/**
 * 드라이브 공유 폴더(반·노래방)에서 받은 곡을 그 짝 폴더에 담는다.
 *
 * sync(수강생 기기)면 늘 강사님이 올린 폴더를 따른다 — 강사님 음원등록과
 * 같아진다(강사님: 「수강생에도 초급/중급/노래방 폴더는 관리자 음원등록에
 * 동기화」). 강사님 기기는 아직 폴더가 없는 곡만 담는다 — 손으로 나눠 둔 것은
 * 그대로. 노래방 폴더에서 받은 곡은, 이미 제 폴더(반)가 있으면 옮기지 않고
 * 「노래방에도」로 적는다 — 반 곡을 노래방에도 올린 것이다. 바꾼 것이 있으면 true.
 */
export function fileToShareFolder(
  shareId: string,
  resultIds: string[],
  sync: boolean,
): boolean {
  const target = shareFolder(shareId);
  if (!target || !resultIds.length) return false;
  const data = read();
  let changed = false;
  for (const id of resultIds) {
    const cur = data.assignment[id];
    if (cur === target) continue;
    if (shareId === "karaoke") {
      if (cur) {
        if (!karaokeExtras().includes(id)) setKaraokeExtra(id, true);
        continue;
      }
      data.assignment[id] = target;
      changed = true;
      continue;
    }
    if (sync || !cur) {
      data.assignment[id] = target;
      changed = true;
    }
  }
  if (changed) write(data);
  return changed;
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
