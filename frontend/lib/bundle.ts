"use client";

import { apiBase, makeInstrumental, makeVocals, type SheetHit } from "./api";
import {
  getLocalAudio,
  getLocalSheet,
  saveLocal,
  saveLocalAudio,
  saveLocalSheet,
} from "./library";
import { DEFAULT_SETUP, loadSetup, saveSetup, type SongSetup } from "./perSong";
import { instKey, stemKey } from "./sharedFiles";
import { getAbc, saveAbc, setAbcFollow, setAbcTabScore } from "./abcStore";
import { getTabEdits, setTabEdits, type TabBarEdit } from "./tabEdits";
import type { TabScore } from "./msczToAbc";
import { loadSheets, saveSheets } from "./sheetCache";
import { getSheetPage, saveSheetPage, sheetRev } from "./library";
import type { AnalysisResult } from "./types";

/**
 * 곡 꾸러미 — 한 곡에 딸린 모든 것을 한 파일에.
 *
 * 음원만 건네면 수강생 화면에는 코드도 가사도 없다. 파일을 여럿 챙기게
 * 하면 빠뜨린다(반주만 빠진 채 공유된 실사고). 그래서 전부 한 파일에:
 *
 *   - 분석 결과 (코드·비트·가사와 그 시각·파형)
 *   - 음원과 반주 트랙 (base64 — 곡당 10~20MB, 와이파이에서 받는 조건)
 *   - 찾아 둔 웹 악보 목록
 *   - 곡별 연주설정 (카포·빠르기·반복·싱크 보정·주법)
 *
 * 받는 쪽은 파일 하나만 가져오면 만든 사람과 같은 화면·소리를 얻는다.
 * 반주는 받는 쪽이 저장할지 고를 수 있다(openBundle 옵션).
 *
 * **내 악보는 담지 않는다.** 받은 꾸러미에 들어 있으면 풀기는 한다 —
 * 예전에 만든 파일이 그냥 버려지지는 않게.
 */

const KIND = "richeon-song-bundle";

export interface SongBundle {
  kind: typeof KIND;
  version: 1;
  result: AnalysisResult;
  sheets?: { query: string; items: SheetHit[]; at: number };
  setup?: SongSetup;
  /** 원곡 음원. data URI — JSON 한 덩어리로 주고받기 위해 */
  audio?: { dataUrl: string; ext: string };
  /** 반주(보컬 뺀) 트랙. mp3 */
  inst?: { dataUrl: string };
  /** 보컬만 남긴 트랙. mp3 */
  vocals?: { dataUrl: string };
  /** 내 악보. data URI로 담는다 — JSON 한 덩어리로 주고받기 위해 */
  mySheet?: { kind: "image" | "pdf"; dataUrl: string };
  /**
   * 「악보」 화면이 띄우는 쪽 그림(서버가 PDF를 펴 둔 것).
   *
   * 수강생 화면에는 분석 서버가 없다. 여기 실어 보내지 않으면 코드와
   * 가사는 오는데 악보만 빈 칸이 된다.
   */
  sheetPages?: string[];
  /**
   * ABC 악보와 그 마디 밀기, 타브 보표, 악보 따르기.
   *
   * 악보 파일(.mscz)이나 AI 채보로 만든 악보는 강사님 기기에만 있었다 —
   * 코드도 가사도 가는데 정작 악보만 안 갔다. 몇 KB뿐이라 담아 보낸다.
   *
   * 타브 보표(tabScore)도 함께 담는다. 이것이 빠지면 받는 기기는 타브를
   * 멜로디에서 지어내어, 편곡자가 적은 것과 전혀 다른 숫자를 늘어놓는다
   * — 파일로 저장했다 읽어 오면 예전 판으로 보이던 까닭이 이것이다.
   */
  abc?: {
    abc: string;
    barOffset: number;
    tabScore?: TabScore;
    follow?: boolean;
    /** 강사님이 손으로 옮긴 타브 자리. 곡과 함께 간다 */
    tabEdits?: Record<number, TabBarEdit>;
  };
}

export function isBundle(data: unknown): data is SongBundle {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { kind?: string }).kind === KIND &&
    !!(data as { result?: unknown }).result
  );
}

async function fromDataUrl(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 음원 MIME → 파일 확장자. 재생에는 MIME이 중요하고 이름은 참고용 */
function extOf(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  return "mp3";
}

/**
 * 곡의 원곡 음원을 구한다. 이 기기(수강생) 것을 먼저 보고, 없으면
 * 서버(관리자 PC)에서 받는다. 어디에도 없으면 null — 꾸러미에서 빠진다.
 */
/**
 * 시간 제한이 있는 fetch.
 *
 * 곡 꾸러미를 만들 때 서버에서 음원·반주를 가져오는데, 서버가 wav를
 * mp3로 바꾸는 중이거나 멈춰 있으면 응답이 영영 오지 않는다 — 그러면
 * 「전체 내보내기」가 첫 곡에서 조용히 멎는다. 실제로 폴더를 고른 뒤
 * 아무 일도 없다는 말이 이것이었다. 3분을 넘기면 그 트랙은 포기하고
 * 다음으로 간다 — 트랙이 빠질 뿐 내보내기는 끝까지 간다.
 */
/**
 * 곡 파일에 실을 것을 서버에서 받는다. **캐시는 건너뛴다.**
 *
 * 음원은 재생기(<audio>)가, 악보 쪽은 화면(<img>)이 먼저 불러 둔다. 그
 * 둘은 CORS 없이 받으므로 CORS 표시가 없는 응답이 캐시에 남고, 여기서
 * 같은 주소를 받으면 그것을 꺼내다 CORS에 막혀 실패한다 — 그래서
 * 내보내기에서 악보가 조용히 빠졌다. 내보내기는 언제나 새로 받는다.
 */
function fetchWithTimeout(url: string, ms = 180_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, cache: "no-store" }).finally(() =>
    clearTimeout(timer),
  );
}

async function findAudio(id: string): Promise<{ blob: Blob; ext: string } | null> {
  const local = await getLocalAudio(id).catch(() => null);
  if (local) return { blob: local, ext: extOf(local.type) };

  try {
    const res = await fetchWithTimeout(`${apiBase()}/api/audio/${id}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") ?? "";
    const ext = cd.match(/\.([A-Za-z0-9]+)"?$/)?.[1] ?? extOf(blob.type);
    return { blob, ext };
  } catch {
    return null;
  }
}

/**
 * 무거운 트랙의 잣대.
 *
 * 분리가 남기는 wav는 4분 곡이 40MB다. 반주·보컬 둘이면 80MB,
 * 곡 파일에 담으면 base64로 110MB가 넘어 드라이브에 올리다 막힌다.
 * 8MB를 넘으면 wav로 본다 — 같은 길이 mp3는 4MB 안쪽이다.
 */
const HEAVY = 8 * 1024 * 1024;

/**
 * 분리 트랙(반주·보컬). 기기 → 서버(없으면 만들어 달라고 한다) 순서.
 *
 * 기기에 예전 wav가 남아 있으면 서버의 mp3로 바꿔 담는다. 예전에 받아
 * 둔 것 때문에 곡 파일이 열 배로 부풀지 않게.
 */
async function findStem(
  id: string,
  kind: "instrumental" | "vocals",
): Promise<Blob | null> {
  const key = kind === "instrumental" ? instKey(id) : stemKey(id, "vocals");
  const local = await getLocalAudio(key).catch(() => null);
  if (local && local.size <= HEAVY) return local;

  const fromServer = async (): Promise<Blob | null> => {
    try {
      let res = await fetchWithTimeout(`${apiBase()}/api/audio/${id}/${kind}`);
      if (!res.ok) {
        await (kind === "instrumental" ? makeInstrumental(id) : makeVocals(id));
        res = await fetchWithTimeout(`${apiBase()}/api/audio/${id}/${kind}`);
      }
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  };

  const fresh = await fromServer();
  // 서버가 줄여 주었으면 기기 것도 갈아 끼운다 — 다음부터는 가볍다
  if (fresh && fresh.size <= HEAVY) {
    await saveLocalAudio(key, fresh).catch(() => {});
    return fresh;
  }
  // 서버에 닿지 못했으면 있는 것이라도 담는다
  return fresh ?? local;
}

/**
 * 이 곡에 딸린 것을 모아 꾸러미로 만든다.
 *
 * 없는 것은 그냥 빠진다 — 악보를 등록하지 않았다고 내보내기가 실패하면
 * 안 된다.
 */
/**
 * 곡에 적힌 **강사 기준값**(「기준값 저장」). 없으면 null.
 *
 * 서버는 카포·빠르기·싱크·가사 싱크·주법·스트로크·코드 자동만 적는다.
 * 구간 반복은 연습하던 흔적이라 기준값이 아니다.
 */
export function baselineOf(result: AnalysisResult): SongSetup | null {
  const raw = (result as { setup?: Partial<SongSetup> | null }).setup;
  if (!raw || typeof raw !== "object" || !Object.keys(raw).length) return null;
  return { ...DEFAULT_SETUP, ...raw, loop: null };
}

export async function makeBundle(result: AnalysisResult): Promise<SongBundle> {
  const bundle: SongBundle = { kind: KIND, version: 1, result };

  const sheets = loadSheets(result.id);
  if (sheets) bundle.sheets = sheets;

  // 악보 그림의 쪽들. 기기에 있으면 그것을, 없으면 서버에서 가져온다.
  const pages = (result.sheet as { pages?: unknown[] } | null)?.pages;
  if (pages?.length) {
    /* 이 판의 쪽만 싣는다. 판을 안 따지면 악보를 바꾼 뒤에도 기기에 남은
       옛 그림이 곡 파일에 실려, 수강생에게 틀린 악보가 간다 */
    const rev = sheetRev(result.sheet as never);
    const got: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      try {
        const local = await getSheetPage(result.id, i, rev);
        if (local) {
          got.push(await toDataUrl(local));
          continue;
        }
        const res = await fetchWithTimeout(
          `${apiBase()}/api/sheets/${result.id}/page/${i}?v=${rev}`,
        );
        if (res.ok) got.push(await toDataUrl(await res.blob()));
      } catch {
        // 한 쪽이 빠져도 나머지는 담는다
      }
    }
    if (got.length) bundle.sheetPages = got;
  }

  // 내 악보(기기에 붙여 둔 그림·PDF). 여태 받기만 하고 담지 않아,
  // 강사님이 붙인 악보가 내보내기에서 조용히 빠졌다.
  const mine = await getLocalSheet(result.id).catch(() => null);
  if (mine) {
    bundle.mySheet = { kind: mine.kind, dataUrl: await toDataUrl(mine.blob) };
  }

  // ABC 악보. 그림악보가 없는 곡은 이것이 유일한 악보다.
  const abc = getAbc(result.id);
  if (abc?.abc?.trim())
    bundle.abc = {
      abc: abc.abc,
      barOffset: abc.barOffset,
      tabScore: abc.tabScore,
      follow: abc.follow,
      tabEdits: getTabEdits(result.id),
    };

  /*
   * 연주설정은 **강사님이 「기준값 저장」으로 적어 둔 값**만 싣는다.
   *
   * 예전에는 이 기기에서 그 곡에 마지막으로 쓴 설정을 실었다. 그러면
   * 강사님이 연습하느라 걸어 둔 구간 반복·0.8배 빠르기가 수강생에게까지
   * 따라갔다. 기준값은 강사님이 「이 값으로 시작하라」고 정한 것이다.
   * 적어 두지 않은 곡은 싣지 않는다 — 받는 쪽이 앱 기본값으로 시작한다.
   */
  const base = baselineOf(result);
  if (base) bundle.setup = base;

  // 음원·반주도 담는다 — 파일 하나로 곡이 통째로 옮겨지도록.
  // 못 구하면 빠질 뿐, 내보내기가 실패하지는 않는다.
  const audio = await findAudio(result.id);
  if (audio) {
    bundle.audio = { dataUrl: await toDataUrl(audio.blob), ext: audio.ext };
    const inst = await findStem(result.id, "instrumental");
    if (inst) bundle.inst = { dataUrl: await toDataUrl(inst) };
    const vocals = await findStem(result.id, "vocals");
    if (vocals) bundle.vocals = { dataUrl: await toDataUrl(vocals) };
  }

  return bundle;
}

/**
 * 꾸러미에 이 기기가 아직 갖지 않은 것이 있는가.
 *
 * 코드·가사·박만 견주면 「같은 곡」이라 넘겨 버린다 — 악보를 새로 붙여
 * 다시 올려도 이미 받아 둔 기기에는 영영 가지 않는다. 실제로 ABC 악보를
 * 실어 보냈는데 수강생 화면은 「악보가 없다」고 했다.
 *
 * 무엇이 더 왔는지 사람 말로 돌려준다. 비어 있으면 더 온 것이 없다.
 */
export async function bundleAdds(bundle: SongBundle): Promise<string[]> {
  const id = bundle.result.id;
  const adds: string[] = [];

  if (bundle.abc?.abc?.trim()) {
    const mine = getAbc(id);
    if (!mine?.abc?.trim() || mine.abc !== bundle.abc.abc) adds.push("ABC 악보");
    // 악보 글은 같아도 마디 맞춤(barOffset)을 고쳤을 수 있다
    else if ((mine.barOffset ?? 0) !== (bundle.abc.barOffset ?? 0))
      adds.push("악보 마디 맞춤");
    // 악보 글이 같아도 타브 보표는 새로 붙였을 수 있다
    if (bundle.abc.tabScore && !mine?.tabScore) adds.push("타브 악보");
  }
  if (bundle.sheetPages?.length) {
    // 첫 쪽만 보면 쪽수가 달라진 것(다시 자른 악보)을 놓친다
    const rev = sheetRev(bundle.result?.sheet as never);
    const first = await getSheetPage(id, 0, rev).catch(() => null);
    const last = await getSheetPage(id, bundle.sheetPages.length - 1, rev).catch(
      () => null,
    );
    if (!first || !last) adds.push(`악보 그림 ${bundle.sheetPages.length}쪽`);
  }
  if (bundle.mySheet) {
    const mine = await getLocalSheet(id).catch(() => null);
    if (!mine) adds.push("내 악보");
  }
  return adds;
}

/**
 * 꾸러미를 이 기기에 푼다. 무엇이 들어왔는지 사람 말로 돌려준다.
 *
 * 한 조각이 실패해도 나머지는 들어간다 — 악보 이미지가 깨졌다고 코드까지
 * 못 받으면 곤란하다.
 */
export async function openBundle(
  bundle: SongBundle,
  opts: { inst?: boolean; vocals?: boolean } = {},
): Promise<string[]> {
  const got: string[] = [];

  await saveLocal(bundle.result);
  got.push("코드");
  if (bundle.result.lyrics?.length) got.push("가사");

  if (bundle.audio) {
    try {
      await saveLocalAudio(bundle.result.id, await fromDataUrl(bundle.audio.dataUrl));
      got.push("음원");
    } catch {
      /* 음원이 깨져도 코드는 들어간다 */
    }
  }
  // 반주·보컬은 받는 쪽이 고른다. 기본은 저장 — 빼겠다고 한 경우만 건너뛴다
  if (bundle.inst && opts.inst !== false) {
    try {
      await saveLocalAudio(
        instKey(bundle.result.id),
        await fromDataUrl(bundle.inst.dataUrl),
      );
      got.push("반주");
    } catch {
      /* 무시 */
    }
  }
  if (bundle.vocals && opts.vocals !== false) {
    try {
      await saveLocalAudio(
        stemKey(bundle.result.id, "vocals"),
        await fromDataUrl(bundle.vocals.dataUrl),
      );
      got.push("보컬");
    } catch {
      /* 무시 */
    }
  }

  if (bundle.sheetPages?.length) {
    try {
      const rev = sheetRev(bundle.result.sheet as never);
      for (let i = 0; i < bundle.sheetPages.length; i++) {
        await saveSheetPage(
          bundle.result.id,
          i,
          await fromDataUrl(bundle.sheetPages[i]),
          rev,
        );
      }
      got.push(`악보 ${bundle.sheetPages.length}쪽`);
    } catch {
      // 악보가 안 들어가도 코드·가사는 들어간다
    }
  }

  if (bundle.sheets) {
    try {
      saveSheets(bundle.result.id, bundle.sheets.query, bundle.sheets.items);
      got.push(`웹 악보 ${bundle.sheets.items.length}건`);
    } catch {
      /* 없어도 곡은 열린다 */
    }
  }
  /*
   * 받을 때마다 그 곡의 연주설정을 **처음부터 새로** 만든다.
   *
   * 새 곡이든 다시 받는 곡이든 같다. 수강생이 전에 맞춰 둔 값은 모두
   * 지우고, 앱 기본값 위에 강사님이 보낸 기준값만 얹는다. 기준값이
   * 없으면 앱 기본값으로 돌아간다. 구간 반복은 연습하던 흔적이라 늘 비운다.
   */
  try {
    const base = baselineOf(bundle.result) ?? bundle.setup ?? null;
    saveSetup(bundle.result.id, { ...DEFAULT_SETUP, ...(base ?? {}), loop: null });
    got.push(base ? "강사 기준값" : "연주설정 초기화");
  } catch {
    /* 설정이 안 들어가도 곡은 열린다 */
  }
  if (bundle.abc?.abc?.trim()) {
    try {
      saveAbc(bundle.result.id, bundle.abc.abc, bundle.abc.barOffset ?? 0);
      got.push("ABC 악보");
      /* saveAbc는 칸을 새로 만든다 — 타브와 따르기는 그 뒤에 얹는다 */
      if (bundle.abc.tabScore) {
        setAbcTabScore(bundle.result.id, bundle.abc.tabScore);
        got.push("타브 악보");
      }
      if (bundle.abc.follow) setAbcFollow(bundle.result.id, true);
      if (bundle.abc.tabEdits)
        setTabEdits(bundle.result.id, bundle.abc.tabEdits);
    } catch {
      /* 자리가 모자라도 코드·가사는 들어간다 */
    }
  }
  if (bundle.mySheet) {
    try {
      const blob = await fromDataUrl(bundle.mySheet.dataUrl);
      await saveLocalSheet(bundle.result.id, blob, bundle.mySheet.kind);
      got.push("내 악보");
    } catch {
      /* 무시 */
    }
  }
  return got;
}


/** 공유 규약 파일명: 리천 노래명(출처).{id}.rml */
export function bundleFileName(bundle: SongBundle): string {
  const result = bundle.result;
  const name = (result.title || result.id)
    .replace(/[\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 60);
  const source = result.source === "youtube" ? "YouTube" : "업로드";
  return `리천 ${name}(${source}).${result.id}.rml`;
}

/** 꾸러미를 파일로 내려받는다. */
export function downloadBundle(bundle: SongBundle): void {
  // application/json으로 주면 Chrome이 .rml 뒤에 .json을 덧붙인다
  const blob = new Blob([JSON.stringify(bundle)], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = bundleFileName(bundle);
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------ 폴더에 바로 저장

/** 폴더 선택 API(Chrome·Edge). 폴더를 한 번 고르면 그 안에 바로 쓴다 */
interface DirHandle {
  getFileHandle(
    name: string,
    opts: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(data: Blob | string): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}

/**
 * 저장할 폴더를 한 번 묻는다. 지원하지 않는 브라우저면 null —
 * 부를 쪽이 한 파일씩 내려받기로 물러난다. 사용자가 창을 닫으면
 * "cancelled"를 던진다.
 *
 * 창을 닫은 것과 **막힌 것**을 가른다. 예전에는 무엇이 잘못되든 모두
 * "cancelled"로 삼켜, 폴더 고르기가 막힌 브라우저에서는 단추를 눌러도
 * 아무 일도 일어나지 않았다 — 「전체 내보내기가 안 된다」는 말이 그것이다.
 */
export async function pickSaveFolder(): Promise<DirHandle | null> {
  const w = window as unknown as {
    showDirectoryPicker?: (opts: { mode: string }) => Promise<DirHandle>;
  };
  if (!w.showDirectoryPicker) return null;
  try {
    return await w.showDirectoryPicker({ mode: "readwrite" });
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === "AbortError") throw new Error("cancelled");
    if (err?.name === "SecurityError")
      throw new Error(
        "브라우저가 폴더 고르기를 막았습니다. 단추를 다시 한 번 눌러 주세요.",
      );
    if (err?.name === "NotAllowedError")
      throw new Error(
        "그 폴더에는 쓸 수 없습니다. 바탕화면이나 문서 아래 폴더를 골라 주세요.",
      );
    throw new Error(
      `폴더를 고르지 못했습니다: ${err?.message || err?.name || "알 수 없는 까닭"}`,
    );
  }
}

/** 고른 폴더 안에 꾸러미를 바로 쓴다. 같은 이름이 있으면 덮어쓴다. */
export async function writeBundleTo(
  dir: DirHandle,
  bundle: SongBundle,
): Promise<void> {
  const handle = await dir.getFileHandle(bundleFileName(bundle), {
    create: true,
  });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(bundle));
  await writable.close();
}
