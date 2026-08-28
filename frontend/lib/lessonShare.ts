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
import { CLASSES } from "./classes";
import { downloadDirectText, hasDriveKey, listSharedDirect } from "./driveDirect";
import { addLecture, listLectures, siteOf, videoIdOf, type Lecture } from "./lectures";

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

/** 지금 강의실을 파일로 내려받는다. 이 파일을 공유 폴더에 올리면 끝이다. */
export function downloadLessonFile(className?: string): number {
  const items = listLectures("classroom");
  const file: LessonFile = {
    kind: KIND,
    version: 1,
    className,
    exported: new Date().toISOString().slice(0, 10),
    items,
  };
  // application/json으로 주면 Chrome이 .rml 뒤에 .json을 덧붙인다
  const blob = new Blob([JSON.stringify(file)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = lessonFileName(className);
  a.click();
  URL.revokeObjectURL(url);
  return items.length;
}

/** 받은 파일을 내 강의실에 붙인다. 이미 있는 링크는 건너뛴다. */
export function mergeLessonFile(file: LessonFile): number {
  const have = new Set(listLectures("classroom").map((l) => l.id));
  let added = 0;
  // 파일에 적힌 순서를 지키려면 뒤에서부터 넣는다(addLecture는 맨 앞에 꽂는다)
  for (const item of [...file.items].reverse()) {
    if (!item?.url || have.has(item.id)) continue;
    addLecture("classroom", {
      ...item,
      videoId: item.videoId ?? videoIdOf(item.url) ?? undefined,
      site: item.site ?? siteOf(item.url),
    });
    have.add(item.id);
    added += 1;
  }
  return added;
}

/**
 * 반 공유 폴더를 뒤져 강의실 파일을 받아 붙인다.
 *
 * 서버(관리자 PC)가 있으면 서버가 대신 받아 오고, 없으면 드라이브
 * API 키로 브라우저가 직접 받는다 — 수강생 기기가 이 경우다.
 */
export async function importLessonsFromDrive(
  online: boolean,
): Promise<{ added: number; files: number }> {
  if (!online && !hasDriveKey()) {
    throw new Error("공유 폴더를 읽을 수 없습니다. 설정에서 서버 주소를 확인해 주세요.");
  }
  let added = 0;
  let files = 0;
  for (const klass of CLASSES) {
    const list = await (online
      ? listShared(klass.folderId)
      : listSharedDirect(klass.folderId)
    ).catch(() => []);
    for (const f of list) {
      if (!LESSON_FILE_RE.test(f.name)) continue;
      try {
        const text = await (online ? downloadShared(f.id) : downloadDirectText(f.id));
        const data = JSON.parse(text) as unknown;
        if (!isLessonFile(data)) continue;
        added += mergeLessonFile(data);
        files += 1;
      } catch {
        // 한 파일이 깨져도 나머지는 받는다
      }
    }
  }
  return { added, files };
}
