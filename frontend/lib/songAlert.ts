"use client";

/**
 * 반 공유 폴더에 새 곡이 올라왔는지 살핀다.
 *
 * 강좌 알림(lessonShare)과 같은 뜻이다 — 강사님이 올려 둔 것을 수강생이
 * 「음원받기」를 눌러 볼 생각을 못 하면 영영 못 받는다. 앱을 열 때
 * 조용히 돌아보고, 새 것이 있으면 한 번 알린다.
 *
 * 이미 받은 것과 한 번 닫은 것은 세지 않는다. 음원목록에서 지운 곡도
 * 세지 않는다 — 지운 것을 다시 받으라고 조르면 성가시다.
 */

import { CLASSES, type GuitarClass } from "./classes";
import { listShared } from "./api";
import { hasDriveKey, listSharedDirect } from "./driveDirect";
import { attemptedDriveIds } from "./sharedFetched";
import { isRmlName } from "./sharedFiles";

const SEEN_KEY = "chordgen.songAlertSeen";

function seenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const rows = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(rows) ? rows : []);
  } catch {
    return new Set();
  }
}

/** 알림을 닫았음을 적어 둔다. 같은 곡으로 두 번 부르지 않게. */
export function markSongsSeen(ids: string[]): void {
  try {
    const all = [...seenIds(), ...ids];
    // 오래된 것부터 버린다. 무한정 쌓을 까닭이 없다.
    localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-500)));
  } catch {
    // 저장이 막혀도 이번에 알린 것으로 충분하다
  }
}

export interface NewSongs {
  klass: GuitarClass;
  /** 아직 받지 않은 드라이브 파일 id */
  ids: string[];
}

export async function findNewSongs(online: boolean): Promise<NewSongs[]> {
  if (!online && !hasDriveKey()) return [];
  const seen = seenIds();
  const mine = attemptedDriveIds();
  const out: NewSongs[] = [];

  for (const klass of CLASSES) {
    const list = await (online
      ? listShared(klass.folderId)
      : listSharedDirect(klass.folderId)
    ).catch(() => []);

    // 곡(.rml)만 센다. 음원 파일은 곡에 딸려 오는 것이라 따로 세지 않는다.
    const ids = list
      .filter((f) => isRmlName(f.name))
      .filter((f) => !mine.has(f.id) && !seen.has(f.id))
      .map((f) => f.id);

    if (ids.length) out.push({ klass, ids });
  }
  return out;
}
