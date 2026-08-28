"use client";

/**
 * 강의실 나눠 주기.
 *
 * 곡과 같은 길을 쓴다. 선생님이 강의실에 링크를 모아 파일 하나로
 * 내보내고, 그 파일을 반 공유 폴더(구글 드라이브)에 올린다. 수강생은
 * 「새 강좌 가져오기」로 그 파일을 받아 자기 강의실에 붙인다.
 *
 * 링크는 몇 줄뿐이라 파일이 아주 작다 — 곡 꾸러미와 달리 음원이 없다.
 */

import { downloadShared, listShared } from "./api";
import { CLASSES, type GuitarClass } from "./classes";
import { downloadDirectText, hasDriveKey, listSharedDirect } from "./driveDirect";
import {
  classroomShelf,
  listLectures,
  replaceLectures,
  siteOf,
  videoIdOf,
  type Lecture,
} from "./lectures";

const KIND = "richeon-lesson-links";

export interface LessonFile {
  kind: typeof KIND;
  version: 1;
  /** 어느 반 것인지 사람이 읽는 이름. 파일을 열어 보지 않아도 알게 */
  className?: string;
  exported: string;
  items: Lecture[];
}

export function isLessonFile(data: unknown): data is LessonFile {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { kind?: string }).kind === KIND &&
    Array.isArray((data as { items?: unknown }).items)
  );
}

/** 공유 폴더에서 강의실 파일을 알아보는 이름 규약 */
export const LESSON_FILE_RE = /강의실.*\.rml$/i;

export function lessonFileName(className?: string): string {
  const tail = className ? ` ${className}` : "";
  return `리천 강의실${tail}.rml`;
}

/** 이 반의 강의실을 파일 한 덩어리로 만든다. 내려받기·올리기가 같이 쓴다. */
export function lessonBlob(
  klass: GuitarClass,
  /** 고른 것만 담는다. 비어 있으면 그 반 강의실 전부 */
  onlyIds?: string[],
): { blob: Blob; count: number } {
  const all = listLectures(classroomShelf(klass.id));
  const items =
    onlyIds && onlyIds.length > 0 ? all.filter((l) => onlyIds.includes(l.id)) : all;
  const file: LessonFile = {
    kind: KIND,
    version: 1,
    className: klass.name,
    exported: new Date().toISOString().slice(0, 10),
    items,
  };
  // application/json으로 주면 Chrome이 .rml 뒤에 .json을 덧붙인다
  return {
    blob: new Blob([JSON.stringify(file)], { type: "application/octet-stream" }),
    count: items.length,
  };
}

/** 이 반의 강의실을 파일로 내려받는다. 이 파일을 그 반 강의실 폴더에 올리면 끝이다. */
export function downloadLessonFile(
  klass: GuitarClass,
  onlyIds?: string[],
  /** 파일 이름에 적을 반. 다른 반에 올릴 때 쓴다 */
  asName?: string,
): number {
  const { blob, count } = lessonBlob(klass, onlyIds);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lessonFileName(asName ?? klass.name);
  a.click();
  URL.revokeObjectURL(url);
  return count;
}

/**
 * 받은 자료로 그 반 강의실을 맞춘다.
 *
 * 새것만 더하면 선생님이 고친 제목·설명이 영영 전해지지 않고, 뺀
 * 자료도 수강생 화면에 남는다. 선생님이 올린 파일이 정답이므로 그대로
 * 맞춘다. 무엇이 달라졌는지 세어 돌려준다.
 */
export function applyLessonFiles(
  klass: GuitarClass,
  files: LessonFile[],
): { added: number; changed: number; removed: number } {
  const shelf = classroomShelf(klass.id);
  const before = listLectures(shelf);
  const beforeById = new Map(before.map((l) => [l.id, l]));

  const next: Lecture[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const item of file.items) {
      if (!item?.url || seen.has(item.id)) continue;
      seen.add(item.id);
      next.push({
        ...item,
        videoId: item.videoId ?? videoIdOf(item.url) ?? undefined,
        site: item.site ?? siteOf(item.url),
      });
    }
  }

  replaceLectures(shelf, next);

  let added = 0;
  let changed = 0;
  for (const item of next) {
    const old = beforeById.get(item.id);
    if (!old) added += 1;
    else if (old.title !== item.title || old.note !== item.note || old.url !== item.url)
      changed += 1;
  }
  const removed = before.filter((l) => !seen.has(l.id)).length;
  return { added, changed, removed };
}

/**
 * 그 반의 강의실 폴더를 뒤져 자료 파일을 받아 붙인다.
 *
 * 서버(관리자 PC)가 있으면 서버가 대신 받아 오고, 없으면 드라이브
 * API 키로 브라우저가 직접 받는다 — 수강생 기기가 이 경우다.
 */
export async function importLessonsFromDrive(
  klass: GuitarClass,
  online: boolean,
): Promise<{ added: number; changed: number; removed: number; files: number }> {
  if (!online && !hasDriveKey()) {
    throw new Error("공유 폴더를 읽을 수 없습니다. 설정에서 서버 주소를 확인해 주세요.");
  }
  const found: LessonFile[] = [];
  const list = await (online
    ? listShared(klass.lessonFolderId)
    : listSharedDirect(klass.lessonFolderId)
  ).catch(() => []);
  for (const f of list) {
    // 강의실 폴더에는 자료만 있으므로 이름을 가리지 않는다 —
    // 내용을 열어 우리 규격인지로 판단한다.
    try {
      const text = await (online ? downloadShared(f.id) : downloadDirectText(f.id));
      const data = JSON.parse(text) as unknown;
      if (!isLessonFile(data)) continue;
      found.push(data);
    } catch {
      // 한 파일이 깨져도 나머지는 받는다
    }
  }
  if (found.length === 0) return { added: 0, changed: 0, removed: 0, files: 0 };
  return { ...applyLessonFiles(klass, found), files: found.length };
}

export { CLASSES };
