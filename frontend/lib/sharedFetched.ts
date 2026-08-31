"use client";

/**
 * 강상기타반 공유 파일을 "받았음"으로 표시하기 위한 기록.
 *
 * 공유 목록에는 드라이브 파일명만 있고 결과 id는 내려받아야 알 수 있으므로,
 * 받을 때 (드라이브 파일 id → 담긴 결과 id들) 매핑을 남긴다.
 *
 * "받았음" 판정은 매핑에 있고 **그 결과가 아직 기기 저장에 남아 있을 때**만
 * 참이다. 음원목록에서 곡을 지우면 별도 정리 없이 자동으로 다시 받을 수
 * 있는 상태가 된다.
 */

const KEY = "chordgen.sharedFetched";

/** 받은 기록 한 칸. ver는 받을 때 드라이브의 「고친 시각」 */
interface Fetched {
  ids: string[];
  ver?: string;
}

type FetchedMap = Record<string, Fetched>;

function read(): FetchedMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, string[] | Fetched>;
      if (data && typeof data === "object") {
        // 옛 저장(결과 id 배열만)도 그대로 읽는다
        const out: FetchedMap = {};
        for (const [k, v] of Object.entries(data))
          out[k] = Array.isArray(v) ? { ids: v } : v;
        return out;
      }
    }
  } catch {
    // 깨진 저장값은 초기화로 간다
  }
  return {};
}

export function markFetched(
  driveId: string,
  resultIds: string[],
  ver?: string,
): void {
  const data = read();
  data[driveId] = { ids: resultIds, ver };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 저장이 막혀도 이번 세션 동작에는 지장 없다
  }
}

/** 받을 때 적어 둔 드라이브 「고친 시각」. 받은 적 없으면 undefined */
export function fetchedVersion(driveId: string): string | undefined {
  return read()[driveId]?.ver;
}

/**
 * 받기를 시도한 적이 있는 드라이브 파일 id 집합 (로컬 존재 여부 무관).
 *
 * 자동 동기화는 이 기준을 쓴다 — 사용자가 음원목록에서 지운 곡을
 * 자동으로 되살리면 안 되기 때문이다. 지운 곡은 수동 「받기」로만 복구한다.
 */
export function attemptedDriveIds(): Set<string> {
  return new Set(Object.keys(read()));
}

/** 받았고 결과가 아직 기기에 남아 있는 드라이브 파일 id 집합 */
export function fetchedDriveIds(localResultIds: Set<string>): Set<string> {
  const data = read();
  const done = new Set<string>();
  for (const [driveId, rec] of Object.entries(data)) {
    if (rec.ids.length > 0 && rec.ids.every((id) => localResultIds.has(id))) {
      done.add(driveId);
    }
  }
  return done;
}
