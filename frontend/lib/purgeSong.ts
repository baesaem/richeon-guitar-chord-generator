"use client";

/**
 * 곡 하나의 흔적을 이 기기에서 모두 지운다(강사님: 「삭제하면 모든 흔적까지」).
 *
 * 예전에는 곡 본문만 지웠다. ABC 악보·연주설정·타브 수정·음원 같은 곡 번호에
 * 딸린 것들이 남아, 같은 곡(같은 유튜브 주소)을 다시 등록하면 옛 악보와 설정이
 * 새 곡에 도로 붙었다 — 「완전 삭제가 안 된다」.
 *
 * 드라이브에서 받은 기록(sharedFetched)은 남긴다 — 지우면 수강생 기기가 지운
 * 곡을 「새 곡」이라고 다시 조른다. 받기 목록에서는 「받지 않음」으로 보여
 * 원하면 손수 다시 받을 수 있다.
 */

import { removeLocal, removeLocalAudio, removeSheetsOf } from "./library";
import { instKey, stemKey } from "./sharedFiles";
import { removeAbc } from "./abcStore";
import { removeSetup } from "./perSong";
import { setTabEdits } from "./tabEdits";
import { removeSheets } from "./sheetCache";
import { removeVocalTiming } from "./vocalStore";
import { assignFolder, setKaraokeExtra } from "./folders";
import { clearClassMarks } from "./classMarks";
import { listFavorites, saveOrder, savedOrder, toggleFavorite } from "./songOrder";
import { removeRecent } from "./recent";

export async function purgeSongLocal(id: string): Promise<void> {
  await removeLocal(id);
  // 원곡·반주·보컬, 악보 그림(판마다 다른 이름까지)
  for (const key of [id, instKey(id), stemKey(id, "vocals")])
    await removeLocalAudio(key).catch(() => {});
  await removeSheetsOf(id).catch(() => {});

  removeAbc(id);
  removeSetup(id);
  setTabEdits(id, {});
  removeSheets(id);
  removeVocalTiming(id);
  assignFolder(id, null);
  setKaraokeExtra(id, false);
  clearClassMarks(id);
  if (listFavorites().includes(id)) toggleFavorite(id);
  const order = savedOrder();
  if (order.includes(id)) saveOrder(order.filter((x) => x !== id));
  removeRecent(id);

  // 고치기 전에 남겨 둔 백업들(chordgen.abc.backup.{id}… 따위)
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("chordgen.") && k.includes(`.${id}`)) localStorage.removeItem(k);
  } catch {
    // 못 지우면 자리만 차지할 뿐이다
  }
}
