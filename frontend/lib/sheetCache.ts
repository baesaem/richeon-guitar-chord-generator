"use client";

import type { SheetHit } from "./api";

/**
 * 찾은 악보 페이지를 곡마다 기억해 둔다.
 *
 * 악보 탭을 열 때마다 다시 검색하면 몇 초씩 기다려야 하고, 검색 결과가
 * 그때그때 달라져 어제 눌렀던 링크가 사라지기도 한다. 한 번 찾은 것은
 * 그대로 두고, 다시 찾고 싶을 때만 사용자가 누른다.
 */

const KEY = "chordgen.sheetHits";

export interface CachedSheets {
  query: string;
  items: SheetHit[];
  /** 찾은 시각(유닉스 밀리초). 화면에 "언제 찾음"으로 보여준다 */
  at: number;
}

type Store = Record<string, CachedSheets>;

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

export function loadSheets(id: string): CachedSheets | null {
  return read()[id] ?? null;
}

export function saveSheets(id: string, query: string, items: SheetHit[]): void {
  try {
    const store = read();
    store[id] = { query, items, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 저장이 막혀도 이번 화면에는 결과가 그대로 있다
  }
}
