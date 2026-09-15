"use client";

/**
 * 반 표시 — 한 반 폴더에 올린 곡을 다른 반에도 보이게(강사님: 「같은 음원을 초급·
 * 중급 둘 다 쓰면 이중으로 올라간다」).
 *
 * 곡 파일은 드라이브 한 폴더에 한 번만 올린다. 다른 반에도 보일 곡은 그 반
 * 폴더에 작은 목록 파일(곡 번호 몇 개)만 둔다 — 노래방 목록(karaokeRemote)과
 * 같은 길이다. 곡을 고쳐 다시 올려도 한 번이면 두 반이 함께 새것을 받는다.
 *
 * - 강사님 기기: 음원목록 줄의 「초」「중」을 누르면, 목록이 달라진 반만 올린다
 * - 수강생 기기: 앱을 열 때 반 폴더의 목록 파일을 받아 두고, 그 곡을 그 반
 *   폴더 칸에도 보인다(곡의 폴더는 원래 반 그대로). 「음원받기」에서 반을 열면
 *   목록의 곡을 다른 폴더에서 찾아 함께 보여 주고 받는다
 */

import { downloadShared, driveUpload, listShared, type SharedFile } from "./api";
import { CLASSES, SONG_SHARES } from "./classes";
import { downloadDirectText, listSharedDirect } from "./driveDirect";
import { getSettings } from "./settings";
import {
  CLASS_LIST_FILE,
  audioIdFromName,
  instIdFromName,
  rmlIdFromName,
  vocalsIdFromName,
} from "./sharedFiles";

/** 강사님 기기의 표시 — 반 id → 곡 번호들 */
const MARKS_KEY = "chordgen.classMarks";
/** 수강생 기기가 받아 둔 강사님 반 목록 — 반 id → { 곡 번호들, 드라이브 고친 시각 } */
const REMOTE_KEY = "chordgen.classRemote";
/** 마지막으로 올린 반 목록 — 같으면 다시 올리지 않는다 */
const PUBLISHED_KEY = "chordgen.classPublished";

type IdLists = Record<string, string[]>;

function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null") as unknown;
    return v && typeof v === "object" ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장이 막혀도 이번 세션 동작에는 지장 없다
  }
}

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** (강사님 기기) 반마다 「이 반에도」 표시한 곡 */
export function classMarks(): IdLists {
  const raw = readJson<Record<string, unknown>>(MARKS_KEY, {});
  return Object.fromEntries(CLASSES.map((c) => [c.id, idList(raw[c.id])]));
}

/** 「이 반에도」 표시를 켜고 끈다. 이 기기의 표시만 고친다 — 올리기는 publish */
export function setClassMark(classId: string, id: string, on: boolean): IdLists {
  const marks = classMarks();
  const set = new Set(marks[classId] ?? []);
  if (on) set.add(id);
  else set.delete(id);
  marks[classId] = [...set].sort();
  writeJson(MARKS_KEY, marks);
  return marks;
}

/** 곡을 지우면 그 곡의 반 표시도 지운다 */
export function clearClassMarks(id: string): void {
  const marks = classMarks();
  let changed = false;
  for (const c of Object.keys(marks))
    if (marks[c].includes(id)) {
      marks[c] = marks[c].filter((x) => x !== id);
      changed = true;
    }
  if (changed) writeJson(MARKS_KEY, marks);
}

function remoteLists(): Record<string, { songs: string[]; ver?: string }> {
  const raw = readJson<Record<string, { songs?: unknown; ver?: string }>>(REMOTE_KEY, {});
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, { songs: idList(v?.songs), ver: v?.ver }]),
  );
}

/**
 * 이 반 칸에도 보이는 곡(곡의 폴더는 다른 반·노래방). 강사님 기기는 자기 표시,
 * 수강생 기기는 드라이브에서 받아 둔 강사님 목록.
 */
export function classExtras(classId: string): string[] {
  if (getSettings().adminMode) return classMarks()[classId] ?? [];
  return remoteLists()[classId]?.songs ?? [];
}

/** 올리는 중인 것 — 둘이 겹치면 드라이브에 같은 이름 파일이 두 개 생긴다 */
let inFlight: Promise<number> | null = null;

/**
 * (강사님) 반 목록이 달라진 반만 그 반 드라이브 폴더에 올린다. 올린 반 수를
 * 돌려준다. 분석 서버·드라이브 연결이 없으면 실패한다(부르는 쪽이 알린다).
 */
export async function publishClassListsIfChanged(): Promise<number> {
  while (inFlight) await inFlight.catch(() => 0);
  const run = publishOnce();
  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

async function publishOnce(): Promise<number> {
  const marks = classMarks();
  const published = readJson<Record<string, string>>(PUBLISHED_KEY, {});
  let count = 0;
  for (const c of CLASSES) {
    const songs = marks[c.id] ?? [];
    const sig = JSON.stringify(songs);
    const last = published[c.id];
    // 한 번도 올린 적 없고 표시도 없으면 빈 목록 파일을 만들지 않는다
    if (last === sig || (last === undefined && songs.length === 0)) continue;
    const body = JSON.stringify({
      kind: "richeon-class-list",
      version: 1,
      klass: c.id,
      updated: new Date().toISOString(),
      songs,
    });
    await driveUpload(
      c.folderId,
      CLASS_LIST_FILE,
      new Blob([body], { type: "application/json" }),
    );
    published[c.id] = sig;
    writeJson(PUBLISHED_KEY, published);
    count += 1;
  }
  return count;
}

/**
 * 반 폴더 목록에서 반 목록 파일을 찾아, 바뀌었으면 받아 적는다. 그 반에도 보일
 * 곡 번호들을 돌려준다. 드라이브가 적어 둔 「고친 시각」이 같으면 받지 않는다.
 */
export async function pullClassList(
  classId: string,
  files: SharedFile[],
  online: boolean,
): Promise<string[]> {
  const all = remoteLists();
  const file = files.find((f) => f.name === CLASS_LIST_FILE);
  if (!file) {
    // 강사님이 목록 파일을 지웠으면 이 반에 더 보일 곡이 없다
    if (all[classId]) {
      delete all[classId];
      writeJson(REMOTE_KEY, all);
    }
    return [];
  }
  const cur = all[classId];
  if (cur && file.modified && cur.ver === file.modified) return cur.songs;
  const text = online ? await downloadShared(file.id) : await downloadDirectText(file.id);
  const songs = idList((JSON.parse(text) as { songs?: unknown }).songs);
  all[classId] = { songs, ver: file.modified };
  writeJson(REMOTE_KEY, all);
  return songs;
}

/**
 * 반 목록의 곡을 다른 폴더(다른 반·노래방)에서 찾는다 — 곡 파일(.rml)과 짝
 * 음원·반주·보컬. 이 반 폴더에 이미 같은 곡이 있으면 빼고, 여러 폴더에 있으면
 * 먼저 찾은 한 곳 것만 쓴다. from은 드라이브 파일 id → 그 파일이 있는 폴더(반 id).
 */
export async function borrowedFiles(
  classId: string,
  own: SharedFile[],
  songIds: string[],
  online: boolean,
): Promise<{ files: SharedFile[]; from: Map<string, string> }> {
  const have = new Set(own.map((f) => rmlIdFromName(f.name)).filter(Boolean));
  const want = new Set(songIds.filter((id) => !have.has(id)));
  const files: SharedFile[] = [];
  const from = new Map<string, string>();
  for (const share of SONG_SHARES) {
    if (share.id === classId || !want.size) continue;
    const list = await (online
      ? listShared(share.folderId)
      : listSharedDirect(share.folderId)
    ).catch(() => [] as SharedFile[]);
    // 이 폴더에 곡 파일이 있는 곡만 — 음원만 떨어져 있는 것은 받을 수 없다
    const here = new Set(
      list.map((f) => rmlIdFromName(f.name)).filter((id): id is string => !!id && want.has(id)),
    );
    for (const f of list) {
      const id =
        rmlIdFromName(f.name) ??
        audioIdFromName(f.name) ??
        instIdFromName(f.name) ??
        vocalsIdFromName(f.name);
      if (!id || !here.has(id)) continue;
      files.push(f);
      from.set(f.id, share.id);
    }
    for (const id of here) want.delete(id);
  }
  return { files, from };
}
