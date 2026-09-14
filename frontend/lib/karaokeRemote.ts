"use client";

/**
 * 노래방 목록(🎤)을 드라이브에 올려 두고, 수강생 앱이 열 때 읽어 온다(강사님:
 * 「표시 데이터만 드라이브에 저장해 앱 실행 시 읽어오기 — 매번 배포도 어렵다」).
 *
 * 곡 파일에 실으면 수강생이 곡을 다시 받아야 하고, 앱에 담으면 매번 배포해야
 * 한다. 목록만 작은 파일(곡 번호 몇 개, 1KB 남짓) 하나로 드라이브 노래방 폴더에
 * 둔다.
 *
 * - 강사님 기기: 🎤를 누르거나 노래방 폴더를 바꾸면, 목록이 달라졌을 때만 올린다
 *   (같은 이름 파일을 갈아 끼운다)
 * - 수강생 기기: 앱을 열 때 새 곡 알림이 폴더 목록을 읽는 김에 이 파일을 찾아,
 *   바뀌었을 때만 받는다. 뒤에서 조용히 — 화면을 기다리게 하지 않는다
 */

import { downloadShared, driveUpload, type SharedFile } from "./api";
import { KARAOKE_SHARE } from "./classes";
import { downloadDirectText } from "./driveDirect";
import { remoteKaraoke, saveRemoteKaraoke, teacherKaraokeSongs } from "./folders";

// 목록 파일 이름은 곡 파일 규칙과 한 자리에 둔다 — 곡으로 세지 않게(sharedFiles)
import { KARAOKE_LIST_FILE } from "./sharedFiles";
export { KARAOKE_LIST_FILE };
/** 마지막으로 올린 목록 — 같으면 다시 올리지 않는다 */
const PUBLISHED_KEY = "chordgen.karaokePublished";

/** 올리는 중인 것 — 둘이 겹치면 드라이브에 같은 이름 파일이 두 개 생긴다 */
let inFlight: Promise<"same" | "done"> | null = null;

/**
 * (강사님) 노래방 목록이 달라졌으면 드라이브에 올린다. "same"이면 올릴 것이
 * 없었다. 분석 서버·드라이브 연결이 없으면 실패한다(부르는 쪽이 알린다).
 *
 * 한 번에 하나만 올린다. 음원목록을 여는 것과 🎤를 누르는 것이 겹치면(개발
 * 화면은 여는 일을 두 번 하기도 한다) 둘 다 「기존 파일 없음」으로 보고 새로
 * 만들어, 목록 파일이 두 개가 되었다. 올리는 중이면 끝나기를 기다렸다가 다시 본다.
 */
export async function publishKaraokeIfChanged(): Promise<"same" | "done"> {
  while (inFlight) await inFlight.catch(() => "same");
  const run = publishOnce();
  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

async function publishOnce(): Promise<"same" | "done"> {
  const songs = teacherKaraokeSongs();
  const sig = JSON.stringify(songs);
  let last: string | null = null;
  try {
    last = localStorage.getItem(PUBLISHED_KEY);
  } catch {
    // 읽지 못하면 올린다
  }
  if (last === sig) return "same";
  const body = JSON.stringify({
    kind: "richeon-karaoke-list",
    version: 1,
    updated: new Date().toISOString(),
    songs,
  });
  await driveUpload(
    KARAOKE_SHARE.folderId,
    KARAOKE_LIST_FILE,
    new Blob([body], { type: "application/json" }),
  );
  try {
    localStorage.setItem(PUBLISHED_KEY, sig);
  } catch {
    // 다음에 한 번 더 올릴 뿐이다
  }
  return "done";
}

/**
 * (수강생) 노래방 폴더 목록에서 목록 파일을 찾아, 바뀌었으면 받아 적는다.
 * 드라이브가 적어 둔 「고친 시각」이 같으면 받지 않는다. 받았으면 true.
 */
export async function pullKaraokeList(
  files: SharedFile[],
  online: boolean,
): Promise<boolean> {
  const file = files.find((f) => f.name === KARAOKE_LIST_FILE);
  if (!file) return false;
  const cur = remoteKaraoke();
  if (cur && file.modified && cur.ver === file.modified) return false;
  const text = online ? await downloadShared(file.id) : await downloadDirectText(file.id);
  const data = JSON.parse(text) as { songs?: unknown };
  if (!Array.isArray(data.songs)) return false;
  saveRemoteKaraoke(
    data.songs.filter((x): x is string => typeof x === "string"),
    file.modified,
  );
  return true;
}
