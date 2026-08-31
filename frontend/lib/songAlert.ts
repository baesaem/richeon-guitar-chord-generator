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
import { attemptedDriveIds, fetchedVersion } from "./sharedFetched";
import { isRmlName } from "./sharedFiles";

const SEEN_KEY = "chordgen.songAlertSeen";

/** 닫아 둔 알림. 값은 그때의 「고친 시각」 — 같은 판으로 두 번 안 부른다 */
function seenMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const data = raw ? (JSON.parse(raw) as string[] | Record<string, string>) : {};
    // 옛 저장(배열)도 읽는다 — 판은 모르는 채로
    if (Array.isArray(data))
      return Object.fromEntries(data.map((id) => [id, ""]));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/** 알림을 닫았음을 적어 둔다. 같은 곡·같은 판으로 두 번 부르지 않게. */
export function markSongsSeen(rows: { id: string; ver?: string }[]): void {
  try {
    const map = seenMap();
    for (const r of rows) map[r.id] = r.ver ?? "";
    const entries = Object.entries(map).slice(-500);
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 저장이 막혀도 이번에 알린 것으로 충분하다
  }
}

export interface NewSongs {
  klass: GuitarClass;
  /** 아직 받지 않은 드라이브 파일 id */
  ids: string[];
  /** 받은 뒤 강사님이 고쳐 다시 올린 파일 id */
  changed: string[];
  /** 알림을 닫을 때 적어 둘 (id, 판) */
  stamp: { id: string; ver?: string }[];
}

export async function findNewSongs(online: boolean): Promise<NewSongs[]> {
  if (!online && !hasDriveKey()) return [];
  const seen = seenMap();
  const mine = attemptedDriveIds();
  const out: NewSongs[] = [];

  for (const klass of CLASSES) {
    const list = await (online
      ? listShared(klass.folderId)
      : listSharedDirect(klass.folderId)
    ).catch(() => []);

    // 곡(.rml)만 센다. 음원 파일은 곡에 딸려 오는 것이라 따로 세지 않는다.
    const songs = list.filter((f) => isRmlName(f.name));
    const ids = songs
      .filter((f) => !mine.has(f.id) && !(f.id in seen))
      .map((f) => f.id);

    /* 받은 뒤 강사님이 고쳐 다시 올린 곡.
       파일을 같은 자리에 갈아 끼우므로 id는 그대로고 「고친 시각」만
       바뀐다 — 받을 때 적어 둔 시각과 다르면 새 판이다. 같은 판으로
       이미 알렸으면(닫았으면) 다시 부르지 않는다. */
    const changed = songs
      .filter((f) => {
        if (!f.modified || !mine.has(f.id)) return false;
        const got = fetchedVersion(f.id);
        return !!got && got !== f.modified && seen[f.id] !== f.modified;
      })
      .map((f) => f.id);

    if (ids.length || changed.length)
      out.push({
        klass,
        ids,
        changed,
        stamp: [...ids, ...changed].map((id) => ({
          id,
          ver: songs.find((f) => f.id === id)?.modified,
        })),
      });
  }
  return out;
}
