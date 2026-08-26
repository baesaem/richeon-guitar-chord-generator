"use client";

import { downloadShared, listShared } from "./api";
import { parseResultsText, saveLocal } from "./library";
import { attemptedDriveIds, markFetched } from "./sharedFetched";

/**
 * 강상기타반 자동 동기화.
 *
 * 앱이 서버에 연결되면 한 번 돌면서, 아직 받아 본 적 없는 공유 파일을
 * 자동으로 내려받아 기기 저장 재생목록에 담는다. 사용자는 아무것도
 * 누를 필요가 없다.
 *
 * "받아 본 적 있음" 판정은 시도 기록(attemptedDriveIds) 기준이다.
 * 재생목록에서 지운 곡을 자동으로 되살리지 않기 위해서다.
 */
export async function syncShared(): Promise<{ added: number; titles: string[] }> {
  const files = await listShared();
  const attempted = attemptedDriveIds();
  const fresh = files.filter((f) => !attempted.has(f.id));

  let added = 0;
  const titles: string[] = [];
  for (const file of fresh) {
    try {
      const results = parseResultsText(await downloadShared(file.id));
      for (const result of results) {
        await saveLocal(result);
        titles.push(result.title || result.id);
      }
      markFetched(file.id, results.map((r) => r.id));
      added += results.length;
    } catch {
      // 한 파일이 깨져 있어도 나머지는 계속 받는다.
      // 실패한 파일은 기록하지 않으므로 다음 실행 때 다시 시도된다.
    }
  }
  return { added, titles };
}
