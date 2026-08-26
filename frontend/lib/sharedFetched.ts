"use client";

/**
 * 강상기타반 공유 파일을 "받았음"으로 표시하기 위한 기록.
 *
 * 공유 목록에는 드라이브 파일명만 있고 결과 id는 내려받아야 알 수 있으므로,
 * 받을 때 (드라이브 파일 id → 담긴 결과 id들) 매핑을 남긴다.
 *
 * "받았음" 판정은 매핑에 있고 **그 결과가 아직 기기 저장에 남아 있을 때**만
 * 참이다. 재생목록에서 곡을 지우면 별도 정리 없이 자동으로 다시 받을 수
 * 있는 상태가 된다.
 */

const KEY = "chordgen.sharedFetched";

type FetchedMap = Record<string, string[]>;

function read(): FetchedMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as FetchedMap;
      if (data && typeof data === "object") return data;
    }
  } catch {
    // 깨진 저장값은 초기화로 간다
  }
  return {};
}

export function markFetched(driveId: string, resultIds: string[]): void {
  const data = read();
  data[driveId] = resultIds;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 저장이 막혀도 이번 세션 동작에는 지장 없다
  }
}

/** 받았고 결과가 아직 기기에 남아 있는 드라이브 파일 id 집합 */
export function fetchedDriveIds(localResultIds: Set<string>): Set<string> {
  const data = read();
  const done = new Set<string>();
  for (const [driveId, resultIds] of Object.entries(data)) {
    if (resultIds.length > 0 && resultIds.every((id) => localResultIds.has(id))) {
      done.add(driveId);
    }
  }
  return done;
}
