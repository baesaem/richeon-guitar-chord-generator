"use client";

/**
 * 내 강좌 — 수강자가 개인적으로 듣는 YouTube 강좌 링크 모음.
 *
 * 곡이 아니라 "배우는 영상"이라 재생목록과 섞지 않는다. 개인 취향이라
 * 공유 폴더에도 싣지 않는다 — 이 기기의 localStorage 에만 산다.
 */

const KEY = "chordgen.lectures";

export interface Lecture {
  /** YouTube 영상 id. 목록의 키이자 섬네일 주소의 재료 */
  id: string;
  url: string;
  title: string;
}

/** URL에서 YouTube 영상 id를 꺼낸다. 영상이 아니면 null. */
export function videoIdOf(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}

export function thumbOf(id: string): string {
  return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

/**
 * 영상 제목을 YouTube oEmbed로 알아본다. 못 알아보면 null —
 * 부를 쪽이 사용자가 적은 제목이나 주소로 대신한다.
 */
export async function fetchTitle(url: string): Promise<string | null> {
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

export function listLectures(): Lecture[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as Lecture[]) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function write(items: Lecture[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 저장이 막혀도 이번 화면에는 지장 없다
  }
}

/** 강좌를 담는다. 같은 영상이 이미 있으면 제목만 새로 쓴다. */
export function addLecture(item: Lecture): Lecture[] {
  const items = listLectures().filter((l) => l.id !== item.id);
  items.unshift(item);
  write(items);
  return items;
}

export function removeLecture(id: string): Lecture[] {
  const items = listLectures().filter((l) => l.id !== id);
  write(items);
  return items;
}
