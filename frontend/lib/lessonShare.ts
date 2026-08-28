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
 * 받은 자료를 그 반 강의실에 반영한다.
 *
 * 같은 자료(id)는 받은 것으로 갈아 끼운다 — 선생님이 고친 제목·설명이
 * 전해져야 한다. **파일에 없는 자료는 그대로 둔다** — 이 기기에서 따로
 * 담아 둔 것을 받기 한 번에 잃으면 안 된다. 자리도 지킨다.
 */
export function applyLessonFiles(
  klass: GuitarClass,
  files: LessonFile[],
): { added: number; changed: number; kept: number } {
  const shelf = classroomShelf(klass.id);
  const before = listLectures(shelf);

  // 받은 파일들을 id로 모은다(같은 id가 여러 파일에 있으면 앞선 것)
  const incoming = new Map<string, Lecture>();
  for (const file of files) {
    for (const item of file.items) {
      if (!item?.url || incoming.has(item.id)) continue;
      incoming.set(item.id, {
        ...item,
        videoId: item.videoId ?? videoIdOf(item.url) ?? undefined,
        site: item.site ?? siteOf(item.url),
      });
    }
  }

  let changed = 0;
  let kept = 0;
  const next: Lecture[] = before.map((old) => {
    const fresh = incoming.get(old.id);
    if (!fresh) {
      kept += 1;
      return old;
    }
    if (
      old.title !== fresh.title ||
      old.note !== fresh.note ||
      old.url !== fresh.url
    ) {
      changed += 1;
    }
    return fresh;
  });

  const have = new Set(before.map((l) => l.id));
  let added = 0;
  for (const [id, item] of incoming) {
    if (have.has(id)) continue;
    next.push(item);
    added += 1;
  }

  replaceLectures(shelf, next);
  return { added, changed, kept };
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
): Promise<{ added: number; changed: number; kept: number; files: number }> {
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
  if (found.length === 0) return { added: 0, changed: 0, kept: 0, files: 0 };
  return { ...applyLessonFiles(klass, found), files: found.length };
}

export { CLASSES };
