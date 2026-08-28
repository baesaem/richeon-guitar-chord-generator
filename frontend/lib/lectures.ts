"use client";

/**
 * 레슨 링크 — 밖에서 보며 배우는 것들을 모아 둔다.
 *
 * 두 칸으로 나눈다.
 *  - 강의실: 기타반이 함께 보는 강좌·자료
 *  - 내 강좌: 각자 따로 듣는 것
 * 둘은 성격만 다르고 다루는 방식은 같아서 저장 칸만 나눈다.
 *
 * YouTube가 중심이지만 밴드·블로그·카페처럼 영상이 아닌 자료도 담는다.
 * 영상이면 섬네일과 제목을 앱이 알아서 가져오고, 아니면 사이트 이름을
 * 붙여 둔다(브라우저에서 남의 사이트 제목을 읽을 수는 없다).
 *
 * 링크 몇 줄이라 localStorage로 충분하다 — 기기에만 남는다.
 */

/**
 * 칸 이름. 강의실은 반마다 따로 둔다 — 초급과 중급은 나가는 자료가
 * 다르고, 한 칸에 섞으면 자기 반 것을 골라내야 한다.
 */
export type Shelf = "classroom:beginner" | "classroom:intermediate" | "mine";

const KEY: Record<Shelf, string> = {
  "classroom:beginner": "chordgen.classroom.beginner",
  "classroom:intermediate": "chordgen.classroom.intermediate",
  mine: "chordgen.lectures",
};

/** 반 id로 그 반의 강의실 칸 이름을 만든다 */
export const classroomShelf = (classId: string): Shelf =>
  (classId === "beginner"
    ? "classroom:beginner"
    : "classroom:intermediate") as Shelf;

export interface Lecture {
  /** 목록의 키. YouTube면 영상 id, 아니면 주소 자체 */
  id: string;
  url: string;
  title: string;
  /** YouTube 영상 id. 있으면 섬네일을 그릴 수 있다 */
  videoId?: string;
  /** 사이트 이름 — YouTube · 밴드 · 블로그처럼 사람이 읽는 말 */
  site: string;
  /**
   * 이 자료에 대한 짧은 안내. 제목만으로는 왜 보라는 것인지 알 수 없다
   * ("3번 패턴 연습에 좋습니다" 같은 한 줄).
   */
  note?: string;
}

/** URL에서 YouTube 영상 id를 꺼낸다. 영상이 아니면 null. */
export function videoIdOf(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}

export function thumbOf(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

/** 사람이 읽는 사이트 이름. 수업에서 실제로 쓰는 곳을 먼저 알아본다. */
export function siteOf(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "링크";
  }
  if (/youtube\.com|youtu\.be/.test(host)) return "YouTube";
  if (/band\.us/.test(host)) return "밴드";
  if (/blog\.naver\.com|tistory\.com|brunch\.co\.kr/.test(host)) return "블로그";
  if (/cafe\.naver\.com|cafe\.daum\.net/.test(host)) return "카페";
  if (/instagram\.com/.test(host)) return "인스타그램";
  if (/facebook\.com/.test(host)) return "페이스북";
  if (/drive\.google\.com|docs\.google\.com/.test(host)) return "드라이브";
  return host;
}

/**
 * YouTube 영상 제목을 알아본다. 영상이 아니거나 못 알아보면 null —
 * 부를 쪽이 사용자가 적은 제목이나 사이트 이름으로 대신한다.
 */
export async function fetchTitle(url: string): Promise<string | null> {
  if (!videoIdOf(url)) return null;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    return null;
  }
}

export function listLectures(shelf: Shelf): Lecture[] {
  try {
    const raw = localStorage.getItem(KEY[shelf]);
    const data = raw ? (JSON.parse(raw) as Lecture[]) : [];
    if (!Array.isArray(data)) return [];
    // 옛 기록(영상만 담던 시절)에는 site·videoId가 없다. 지금 규격으로 읽는다.
    return data.map((l) => ({
      ...l,
      videoId: l.videoId ?? videoIdOf(l.url) ?? undefined,
      site: l.site ?? siteOf(l.url),
    }));
  } catch {
    return [];
  }
}

function write(shelf: Shelf, items: Lecture[]): void {
  try {
    localStorage.setItem(KEY[shelf], JSON.stringify(items));
  } catch {
    // 저장이 막혀도 이번 화면에는 지장 없다
  }
}

/** 링크를 담는다. 같은 것이 이미 있으면 제목만 새로 쓴다. */
export function addLecture(shelf: Shelf, item: Lecture): Lecture[] {
  const items = listLectures(shelf).filter((l) => l.id !== item.id);
  items.unshift(item);
  write(shelf, items);
  return items;
}

/**
 * 담아 둔 자료를 고친다. 자리는 그대로 둔다 — 고쳤다고 목록 맨 위로
 * 올라오면 선생님이 정해 둔 차례가 흐트러진다.
 */
export function updateLecture(shelf: Shelf, id: string, next: Lecture): Lecture[] {
  const items = listLectures(shelf).map((l) => (l.id === id ? next : l));
  write(shelf, items);
  return items;
}

/**
 * 칸을 통째로 갈아 끼운다. 받아 오는 강의실이 쓴다 —
 * 선생님이 올린 파일이 정답이므로 고친 것·지운 것이 그대로 반영된다.
 */
export function replaceLectures(shelf: Shelf, items: Lecture[]): Lecture[] {
  write(shelf, items);
  return items;
}

export function removeLecture(shelf: Shelf, id: string): Lecture[] {
  const items = listLectures(shelf).filter((l) => l.id !== id);
  write(shelf, items);
  return items;
}
