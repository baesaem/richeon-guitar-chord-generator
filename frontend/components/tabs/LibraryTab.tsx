"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AskConfirm, AskText } from "@/components/Ask";
import { Working } from "@/components/Working";
import { Copyright } from "@/components/Copyright";
import { Popup } from "@/components/Popup";
import {
  deleteResult,
  driveUpload,
  getResult,
  listResults,
  renameResult,
} from "@/lib/api";
import {
  bundleFileName,
  downloadBundle,
  isBundle,
  makeBundle,
  openBundle,
  pickSaveFolder,
  writeBundleTo,
  type SongBundle,
} from "@/lib/bundle";
import {
  assignFolder,
  createFolder,
  deleteFolder,
  folderAssignments,
  listFolders,
  renameFolder,
} from "@/lib/folders";
import {
  getLocal,
  listLocal,
  localIds,
  parseResultsText,
  removeLocal,
  saveLocal,
} from "@/lib/library";
import { CLASSES, type GuitarClass } from "@/lib/classes";
import { markRemoved, removedIds, unmarkRemoved } from "@/lib/removed";
import { ensureDriveReady } from "@/lib/driveReady";
import { spellKey } from "@/lib/notation";
import type { ResultSummary } from "@/lib/types";

interface Props {
  /** 목록에서 곡을 고르면 재생 화면으로 넘긴다 */
  onOpen: (id: string) => void;
  /**
   * 곡을 다시 분석한다. 분석을 고치면 새로 분석해야 반영되는데,
   * 곡마다 주소를 다시 넣게 할 수는 없다. YouTube 곡만 가능하다.
   */
  /** 다시 분석. refetch면 음원부터 새로 받고, newUrl이 있으면 그 주소의 음원으로 새로 분석한다 */
  onReanalyze?: (item: ResultSummary, refetch: boolean, newUrl?: string) => void;
  /** 지금 다른 분석이 돌고 있다. 두 번 눌러 줄 세우지 않게 잠근다 */
  analyzing?: boolean;
  /** 탭이 보일 때만 목록을 새로 읽는다 */
  active: boolean;
  /** 관리자 모드: 공유 폴더에 올릴 음원 내보내기 버튼이 보인다 */
  adminMode: boolean;
}

function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = String(Math.floor(t % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

function when(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

/**
 * 음원목록.
 *
 * 두 저장소를 함께 보여준다.
 *  - 기기 저장: 브라우저(IndexedDB)에 담긴 결과. 서버(PC)가 꺼져도 남는다
 *  - 서버: PC 캐시에 있는 결과. 서버가 꺼지면 이 섹션만 사라진다
 */
export function LibraryTab({
  onOpen,
  onReanalyze,
  analyzing = false,
  active,
  adminMode,
}: Props) {
  // 시스템 prompt()/confirm()을 쓰지 않는다. 폰 웹앱에서 막혀 있다.
  // 몇 초 이상 걸리는 일. 화면 한가운데에 알린다
  const [working, setWorking] = useState<string | null>(null);
  /** 여러 곡 작업을 사람이 멈추었는가. 다음 곡으로 넘어가기 전에 본다 */
  const stopRef = useRef(false);
  const [asking, setAsking] = useState<
    "folder" | "deleteFolder" | "renameFolder" | null
  >(null);
  const [refetching, setRefetching] = useState<ResultSummary | null>(null);
  /** 음원교체 창에 넣은 새 유튜브 주소. 비우면 같은 영상을 다시 받는다 */
  const [refetchUrl, setRefetchUrl] = useState("");
  // 삭제 확인. server가 true면 서버 캐시에서 지우는 것이다
  const [confirmDelete, setConfirmDelete] = useState<{
    item: ResultSummary;
    server: boolean;
  } | null>(null);
  // 이름 바꾸는 중인 곡
  const [renaming, setRenaming] = useState<ResultSummary | null>(null);
  /**
   * 드라이브에 올릴 대상. 어느 반 폴더에 넣을지 물어야 해서 반 고르기
   * 창을 띄운다 — 곡이 초급 것인지 중급 것인지는 앱이 알 수 없다.
   */
  const [uploading, setUploading] = useState<
    { ids: string[]; label: string } | null
  >(null);
  const [device, setDevice] = useState<ResultSummary[] | null>(null);
  const [server, setServer] = useState<ResultSummary[] | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 폴더 분류 (localStorage). "all"은 전체 보기.
  const [folders, setFolders] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<Record<string, string>>({});
  const [currentFolder, setCurrentFolder] = useState<string>("all");

  const reload = useCallback(() => {
    // 기기 저장분은 서버와 무관하게 항상 읽는다.
    // setState는 전부 비동기 콜백 안에서만 한다(이펙트 동기 setState 회피).
    listLocal()
      .then((rows) => {
        setDevice(rows);
        setSaved(new Set(rows.map((r) => r.id)));
        setError(null);
      })
      .catch((e) => setError((e as Error).message));

    // 서버 목록은 관리자 화면에만 있다. 수강생 기기에서는 부르지도 않는다.
    if (adminMode) {
      listResults()
        .then(async (rows) => {
          setServer(rows);
          setServerDown(false);
          /* 서버에만 있는 곡은 스스로 기기에 담는다 — 기기와 서버가
             실시간으로 같아지는 마당에 「가져오기」 단추를 남길 까닭이
             없다. 지운 곡만은 담지 않는다(무덤 표식) — 담으면 지워도
             지워지지 않는 꼴이 된다. */
          const local = await localIds().catch(() => new Set<string>());
          const gone = removedIds();
          const fresh = rows.filter(
            (r) => !local.has(r.id) && !gone.has(r.id),
          );
          if (!fresh.length) return;
          let put = 0;
          for (const r of fresh) {
            try {
              await saveLocal(await getResult(r.id));
              put += 1;
            } catch {
              // 한 곡이 막혀도 나머지는 담는다
            }
          }
          if (put) {
            flash(`서버의 곡 ${put}곡을 기기에 담았습니다.`);
            listLocal()
              .then((rows2) => {
                setDevice(rows2);
                setSaved(new Set(rows2.map((r) => r.id)));
              })
              .catch(() => {});
          }
        })
        .catch(() => {
          setServer(null);
          setServerDown(true);
        });
    }

    // 폴더는 동기 localStorage라 그냥 읽는다 (마이크로태스크로 미뤄 lint 규칙을 지킨다)
    Promise.resolve().then(() => {
      setFolders(listFolders());
      setAssignment(folderAssignments());
    });
  }, [adminMode]);

  useEffect(() => {
    if (active) reload();
  }, [active, reload]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 2500);
  };

  const saveToDevice = async (id: string) => {
    try {
      const result = await getResult(id);
      await saveLocal(result);
      unmarkRemoved(id);
      flash("기기에 저장했습니다. 서버가 꺼져도 열 수 있습니다.");
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** 서버 목록 전체를 기기에 저장한다. 이미 저장된 곡은 건너뛴다. */
  const saveAll = async () => {
    if (!server) return;
    const targets = server.filter((item) => !saved.has(item.id));
    if (targets.length === 0) {
      flash("서버의 모든 곡이 이미 기기에 저장돼 있습니다.");
      return;
    }
    let ok = 0;
    setWorking(`${targets.length}곡 저장하는 중`);
    for (const item of targets) {
      try {
        await saveLocal(await getResult(item.id));
        ok += 1;
      } catch {
        // 한 곡이 실패해도 나머지는 계속 저장한다
      }
    }
    setWorking(null);
    flash(`${ok}곡을 기기에 저장했습니다.`);
    reload();
  };

  /**
   * (관리자) 음원과 분석 결과를 함께 내려받는다.
   *
   * 파일명 "리천 노래명(출처).{결과id}.{확장자}" — 수강생 앱이 이 id로
   * 둘을 한 곡으로 묶는다. 음원만 올리면 수강생 화면에 코드도 가사도
   * 없으므로, 두 파일을 한 번에 내보내 빠뜨리지 않게 한다.
   *
   * 결과 파일(.rml)에는 코드·비트·가사·파형이 모두 들어 있다.
   */
  /**
   * 곡 파일에 담을 알맹이를 고른다 — 서버 것을 먼저 본다.
   *
   * 기기에 저장된 것은 담을 때의 모습으로 굳어 있다. 그 뒤 강사님이
   * 악보를 붙이거나 코드를 고치면 서버 것만 새로워진다. 그대로 올리면
   * 「재배포했는데 반영이 안 된다」가 된다 — 실제로 악보를 붙인 곡을
   * 올렸는데 받은 파일에는 악보가 없었다.
   *
   * 서버에 닿지 못하면(수강생 기기·서버 꺼짐) 기기 것을 쓴다.
   */
  /**
   * 내보내기·올리기가 쓸 곡. **기기 사본이 원본이다.**
   *
   * 예전에는 서버 것을 먼저 썼다 — 악보 맞춤이 서버에서 이루어지던
   * 때의 버릇이다. 그러나 고치는 일은 모두 기기에 먼저 적히고, 서버가
   * 꺼진 사이의 수정은 기기에만 있다. 서버 것을 먼저 쓰면 그런 수정이
   * 빠진 옛것이 올라간다. 기기에 없는 곡(서버에만 있는 곡)만 서버에서
   * 가져온다.
   */
  const freshest = async (id: string) => {
    const local = await getLocal(id).catch(() => null);
    if (local) return local;
    const mine = await getResult(id).catch(() => null);
    if (!mine) throw new Error("곡을 찾지 못했습니다");
    return mine;
  };

  /**
   * (관리자) 곡을 통째로 한 파일에 담아 내려받는다.
   *
   * 코드·가사·음원·반주가 전부 .rml 하나에 들어간다(곡당 10~20MB).
   * 파일을 여럿 챙기게 하면 빠뜨린다 — 반주만 빠진 채 공유된 실사고가
   * 있었다. 드라이브 공유 폴더에는 이 파일 하나만 올리면 된다.
   */
  const exportAudio = async (item: ResultSummary) => {
    setWorking("곡 꾸러미 만드는 중");
    try {
      const result = await getResult(item.id);
      const bundle = await makeBundle(result);
      downloadBundle(bundle);
      flash(
        `곡 파일 하나(${bundleParts(bundle).join(" · ")})로 내려받았습니다. ` +
          "드라이브 공유 폴더에 이 파일만 올리면 됩니다.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  /**
   * 곡을 드라이브 공유 폴더에 곧장 올린다.
   *
   * 「내보내기 → 드라이브 웹에서 올리기」 두 걸음을 없앤다. 같은 이름
   * 파일이 있으면 서버가 갈아 끼우므로, 곡을 고쳐 다시 올려도 폴더에
   * 사본이 쌓이지 않는다.
   */
  const uploadToDrive = async (klass: GuitarClass, ids: string[]) => {
    setUploading(null);
    setError(null);
    try {
      await ensureDriveReady(setWorking);
      let done = 0;
      const failed: string[] = [];
      const titleOf = (id: string) =>
        device?.find((d) => d.id === id)?.title || id;
      stopRef.current = false;
      for (const id of ids) {
        if (stopRef.current) break;
        setWorking(`드라이브에 올리는 중 (${done + 1}/${ids.length})`);
        // 어느 곡에서, 어느 걸음에서 어긋났는지 적어 준다. 「500」 한
        // 마디만 남으면 곡이 열 개일 때 무엇을 손봐야 할지 알 수 없다.
        let step = "곡 읽기";
        try {
          const result = await freshest(id);
          step = "곡 파일 만들기";
          const bundle = await makeBundle(result);
          const blob = new Blob([JSON.stringify(bundle)], {
            type: "application/octet-stream",
          });
          // 너무 크면 올리다 끊긴다. 끊긴 뒤 「500」을 보는 것보다
          // 왜 못 올리는지 미리 말해 주는 편이 낫다.
          const mb = blob.size / 1024 / 1024;
          if (mb > 60) {
            throw new Error(
              `곡 파일이 ${mb.toFixed(0)}MB로 너무 큽니다. ` +
                "연주설정에서 반주·보컬을 다시 만들면 가벼워집니다.",
            );
          }
          step = "드라이브에 올리기";
          await driveUpload(
            klass.folderId,
            bundleFileName(bundle),
            blob,
            (part, of) =>
              setWorking(
                of > 1
                  ? `드라이브에 올리는 중 (${done + 1}/${ids.length}) · ${part}/${of}토막`
                  : `드라이브에 올리는 중 (${done + 1}/${ids.length})`,
              ),
          );
        } catch (e) {
          /* 한 곡이 막혀도 나머지는 올린다.
             열세 곡을 올리다 첫 곡에서 멈추면 「전체 올리기가 안 된다」가
             된다 — 실제로 개별 올리기는 되는데 전체만 안 되는 꼴이었다. */
          failed.push(
            `${titleOf(id)} — ${step}에서 막힘(${(e as Error).message})`,
          );
          continue;
        }
        done += 1;
      }
      if (done === 0 && failed.length) {
        setError(`올리지 못했습니다 · ${failed.join(" · ")}`);
        return;
      }
      flash(
        `${done}곡을 ${klass.name} 폴더에 올렸습니다.` +
          (failed.length ? ` · ${failed.length}곡 실패: ${failed.join(" · ")}` : ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const exportOne = async (id: string) => {
    try {
      const result = await freshest(id);
      downloadBundle(await makeBundle(result));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importOne = async (file: File) => {
    setWorking("곡 가져오는 중");
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;

      // 곡 꾸러미면 코드뿐 아니라 웹 악보·내 악보·연주설정까지 함께 푼다
      if (isBundle(data)) {
        const got = await openBundle(data);
        flash(`가져왔습니다: ${data.result.title || data.result.id} (${got.join(" · ")})`);
        reload();
        return;
      }

      const results = parseResultsText(text);
      for (const result of results) await saveLocal(result);
      flash(
        results.length === 1
          ? `가져왔습니다: ${results[0].title || results[0].id}`
          : `${results.length}곡을 가져왔습니다.`,
      );
      reload();
    } catch (e) {
      setError(`가져오기 실패: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  };

  /**
   * 곡마다 따로 한 파일씩 내보낸다. 묶음 한 파일이 아니다 —
   * 드라이브 공유 폴더는 곡 단위 파일을 기대하므로, 묶음으로 내보내면
   * 그대로 올릴 수 없어 다시 쪼개야 했다.
   *
   * 저장 위치는 처음 한 번만 묻는다. 폴더 선택 API가 있는 브라우저
   * (Chrome·Edge)에서는 고른 폴더에 나머지를 바로 쓰고, 없는 브라우저는
   * 한 파일씩 내려받기로 물러난다.
   */
  const exportAll = async () => {
    try {
      const items = device ?? [];
      if (items.length === 0) {
        setError("기기에 저장된 곡이 없습니다");
        return;
      }

      // 폴더를 먼저 고른다 — 진행 표시가 뜬 채로 창이 열리면 가려진다
      let dir: Awaited<ReturnType<typeof pickSaveFolder>> = null;
      try {
        dir = await pickSaveFolder();
      } catch (e) {
        // 창을 닫은 것은 취소다. 그 밖의 까닭은 화면에 적는다 —
        // 조용히 돌아서면 단추가 고장 난 것처럼 보인다.
        const why = (e as Error).message;
        if (why !== "cancelled") setError(`전체 내보내기: ${why}`);
        return;
      }
      if (!dir) {
        flash(
          `${items.length}곡을 한 파일씩 내려받습니다. ` +
            "브라우저가 「여러 파일 받기」를 물으면 허용해 주세요.",
        );
      }

      /* 고른 폴더에 정말 쓸 수 있는지 곡을 만들기 전에 먼저 재 본다.
         크롬은 폴더를 고른 뒤 「변경 허용?」을 한 번 더 묻는데, 이것이
         거절되어 있으면 곡마다 조용히 실패한다 — 폴더 창은 떴는데 그
         뒤 아무 일도 없는 것이 이것이다. 못 쓰면 내려받기로 물러난다. */
      if (dir) {
        try {
          const probe = await dir.getFileHandle("리천-쓰기확인.tmp", {
            create: true,
          });
          const w = await probe.createWritable();
          await w.write("ok");
          await w.close();
          // 확인용 부스러기는 지운다 — 남기면 곡 파일 사이에 낀다
          await (
            dir as unknown as { removeEntry?: (n: string) => Promise<void> }
          ).removeEntry?.("리천-쓰기확인.tmp");
        } catch {
          dir = null;
          flash(
            "고른 폴더에 쓸 권한이 없어(브라우저가 막음) 한 파일씩 " +
              "내려받기로 바꿉니다. 브라우저가 물으면 「허용」을 눌러 주세요.",
          );
        }
      }

      let count = 0;
      // 한 곡이 깨져도 멈추지 않는다 — 스무 곡을 내보내다 하나가
      // 어긋났다고 나머지 열아홉 곡을 잃으면 곤란하다
      const failed: string[] = [];
      stopRef.current = false;
      for (const item of items) {
        if (stopRef.current) break;
        setWorking(`전체 내보내는 중 (${count + failed.length + 1}/${items.length})`);
        // 큰 곡을 잇달아 굳히면 화면이 굳는다 — 곡 사이에 숨 돌릴 틈
        await new Promise((r) => setTimeout(r, 50));
        try {
          const result = await freshest(item.id);
          const bundle = await makeBundle(result);
          if (dir) {
            await writeBundleTo(dir, bundle);
          } else {
            downloadBundle(bundle);
            // 연속 다운로드를 너무 몰아치면 브라우저가 일부를 흘린다
            await new Promise((r) => setTimeout(r, 400));
          }
          count += 1;
        } catch (e) {
          failed.push(`${item.title || item.id}(${(e as Error).message})`);
        }
      }
      const tail =
        (failed.length ? ` · ${failed.length}곡 실패: ${failed.join(", ")}` : "") +
        (stopRef.current ? " · 사람이 멈춤" : "");
      if (count === 0 && failed.length) {
        setError(`전체 내보내기 실패${tail}`);
        return;
      }
      flash(
        (dir
          ? `${count}곡을 고른 폴더에 저장했습니다.`
          : `${count}곡을 각각의 파일로 내보냈습니다.`) + tail,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const row = (
    item: ResultSummary,
    actions: React.ReactNode,
  ) => (
    <li key={item.id} className="flex items-center gap-2 py-2.5">
      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(item.id)}>
        <div className="truncate text-sm font-medium">{item.title || item.id}</div>
        <div className="mt-0.5 text-[11px] text-gray-500">
          {item.key ? spellKey(item.key) : "조성 미상"} · {Math.round(item.bpm)} BPM ·{" "}
          {clock(item.duration)}
        </div>
        <div className="text-[10px] text-gray-400">
          {item.source === "youtube" ? "YouTube" : "업로드"} · {when(item.analyzed_at)}
        </div>
      </button>
      {actions}
    </li>
  );

  const actionBtn = "shrink-0 px-2 py-1 text-xs text-gray-500";

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold md:hidden">음원목록</h2>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-gray-500 underline"
            onClick={() => fileRef.current?.click()}
          >
            파일 가져오기
          </button>
          <button className="text-xs text-gray-500 underline" onClick={reload}>
            새로고침
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".rml,.json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importOne(f);
          e.target.value = "";
        }}
      />

      {notice && (
        <p className="mb-2 rounded bg-green-50 p-2 text-xs text-green-800">{notice}</p>
      )}
      {error && (
        <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>
      )}

      {/* 기기 저장 */}
      <div className="mt-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500">
          {adminMode ? "기기 저장 · 서버가 꺼져도 유지" : "내 곡"}
        </h3>
        {device !== null && device.length > 0 && (
          <span className="flex items-center gap-2">
            {adminMode && (
              <button
                className="text-[11px] text-[var(--accent)] underline"
                onClick={() =>
                  setUploading({
                    ids: device.map((d) => d.id),
                    label: `${device.length}곡`,
                  })
                }
              >
                전체 올리기
              </button>
            )}
            <button className="text-[11px] text-gray-500 underline" onClick={exportAll}>
              전체 내보내기
            </button>
          </span>
        )}
      </div>

      {/* 폴더 칩 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {["all", ...folders].map((f) => (
          <button
            key={f}
            onClick={() => setCurrentFolder(f)}
            className={[
              "rounded-full px-2.5 py-1 text-xs",
              currentFolder === f
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-gray-100 dark:bg-gray-800",
            ].join(" ")}
          >
            {f === "all" ? "전체" : f}
          </button>
        ))}
        <button
          className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 dark:border-gray-600"
          onClick={() => setAsking("folder")}
        >
          + 새 폴더
        </button>
        {currentFolder !== "all" && (
          <>
            <button
              className="px-1.5 py-1 text-xs text-gray-500 underline"
              onClick={() => setAsking("renameFolder")}
            >
              이름 바꾸기
            </button>
            <button
              className="px-1.5 py-1 text-xs text-red-500"
              onClick={() => setAsking("deleteFolder")}
            >
              폴더 삭제
            </button>
          </>
        )}
      </div>

      {device === null ? (
        <p className="py-2 text-xs text-gray-400">읽는 중…</p>
      ) : device.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">
          {adminMode
            ? "아직 없습니다. 아래 서버 목록에서 「저장」을 누르면 여기 담깁니다."
            : "아직 없습니다. 음원받기의 기타반에서 곡을 받으면 여기 담깁니다."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {device
            .filter((item) =>
              currentFolder === "all" ? true : assignment[item.id] === currentFolder,
            )
            .map((item) =>
              row(
                item,
                <>
                  {/* 폴더 배정. 모바일 네이티브 선택 UI를 그대로 쓴다 */}
                  {folders.length > 0 && (
                    <select
                      className="max-w-16 shrink-0 rounded border border-gray-200 bg-transparent px-1 py-1 text-[10px] text-gray-500 dark:border-gray-700"
                      value={assignment[item.id] ?? ""}
                      onChange={(e) => {
                        assignFolder(item.id, e.target.value || null);
                        setAssignment(folderAssignments());
                      }}
                    >
                      <option value="">폴더 없음</option>
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  )}
                  {onReanalyze && (
                    <ReanalyzeButtons
                      item={item}
                      onReanalyze={onReanalyze}
                      onAskRefetch={setRefetching}
                      analyzing={analyzing}
                    />
                  )}
                  {adminMode && (
                    <IconButton
                      label="드라이브에 올리기"
                      onClick={() =>
                        setUploading({ ids: [item.id], label: item.title || item.id })
                      }
                    >
                      {CloudIcon}
                    </IconButton>
                  )}
                  <IconButton label="이름 바꾸기" onClick={() => setRenaming(item)}>
                    {EditIcon}
                  </IconButton>
                  <IconButton label="저장" onClick={() => exportOne(item.id)}>
                    {SaveIcon}
                  </IconButton>
                  <IconButton
                    label="삭제"
                    danger
                    onClick={() => setConfirmDelete({ item, server: false })}
                  >
                    {TrashIcon}
                  </IconButton>
                </>,
              ),
            )}
        </ul>
      )}
      {device !== null &&
        device.length > 0 &&
        currentFolder !== "all" &&
        device.filter((i) => assignment[i.id] === currentFolder).length === 0 && (
          <p className="py-2 text-xs text-gray-400">
            이 폴더는 비어 있습니다. 곡의 폴더 선택에서 「{currentFolder}」를 고르면
            담깁니다.
          </p>
        )}

      {/* 서버 목록은 관리자 전용 — 그리고 **기기에 없는 곡만** 보인다.
          기기와 서버가 실시간으로 같아지므로, 같은 곡을 두 번 늘어놓으면
          어느 쪽을 만져야 하는지부터 헷갈린다. 기기 줄이 원본이고, 이
          칸은 「아직 기기로 안 가져온 곡」을 줍는 자리다. 다 가져왔으면
          칸째 사라진다. */}
      {adminMode && (server === null || serverDown ||
        server.some((i) => !saved.has(i.id))) && (
      <>
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500">
          서버에만 있는 곡
        </h3>
        {server !== null && server.some((i) => !saved.has(i.id)) && (
          <button className="text-[11px] text-gray-500 underline" onClick={saveAll}>
            전체 저장
          </button>
        )}
      </div>
      {serverDown ? (
        <p className="py-2 text-xs text-amber-700">
          서버에 연결되지 않았습니다. 기기 저장분만 열 수 있습니다.
        </p>
      ) : server === null ? (
        <p className="py-2 text-xs text-gray-400">읽는 중…</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {server
            .filter((item) => !saved.has(item.id))
            .map((item) =>
            row(
              item,
              <>
                {adminMode && (
                  <>
                    <button className={actionBtn} onClick={() => exportAudio(item)}>
                      음원
                    </button>
                    <button
                      className={actionBtn}
                      onClick={() =>
                        setUploading({ ids: [item.id], label: item.title || item.id })
                      }
                    >
                      올리기
                    </button>
                  </>
                )}
                {onReanalyze && (
                  <ReanalyzeButtons
                      item={item}
                      onReanalyze={onReanalyze}
                      onAskRefetch={setRefetching}
                      analyzing={analyzing}
                    />
                )}
                <IconButton label="기기에 저장" onClick={() => saveToDevice(item.id)}>
                  {SaveIcon}
                </IconButton>
                <IconButton
                  label="서버에서 삭제"
                  danger
                  onClick={() => setConfirmDelete({ item, server: true })}
                >
                  {TrashIcon}
                </IconButton>
              </>,
            ),
          )}
        </ul>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        기기 저장 곡 중 YouTube 곡은 서버 없이도 재생과 코드 화면이 모두 동작합니다.
        업로드한 곡은 함께 받은 음원이 기기에 있으면 서버 없이 재생됩니다.
      </p>
      </>
      )}

      {working && (
        <Working
          label={working}
          onCancel={
            working.includes("/") ? () => (stopRef.current = true) : undefined
          }
        />
      )}

      {asking === "folder" && (
        <AskText
          title="새 폴더"
          placeholder="폴더 이름"
          onSubmit={(name) => {
            setFolders(createFolder(name));
            setCurrentFolder(name);
          }}
          onClose={() => setAsking(null)}
        />
      )}

      {asking === "renameFolder" && (
        <AskText
          title="폴더 이름 바꾸기"
          placeholder="새 이름"
          initial={currentFolder}
          confirmLabel="바꾸기"
          onSubmit={(name) => {
            const next = renameFolder(currentFolder, name);
            setFolders(next);
            setAssignment(folderAssignments());
            // 같은 이름이 이미 있으면 바뀌지 않는다 — 그때는 그대로 둔다
            if (!next.includes(currentFolder)) setCurrentFolder(name.trim());
          }}
          onClose={() => setAsking(null)}
        />
      )}

      {confirmDelete && (
        <AskConfirm
          title={confirmDelete.server ? "서버에서 삭제" : "음원목록에서 삭제"}
          message={
            confirmDelete.server
              ? `「${confirmDelete.item.title || confirmDelete.item.id}」의 분석 결과를 서버에서 지웁니다. 기기에 저장된 곡은 남습니다.`
              : `「${confirmDelete.item.title || confirmDelete.item.id}」을(를) 음원목록(기기 저장)에서 지웁니다.`
          }
          confirmLabel="삭제"
          danger
          onConfirm={async () => {
            try {
              if (confirmDelete.server) await deleteResult(confirmDelete.item.id);
              else {
                await removeLocal(confirmDelete.item.id);
                // 자동 담기가 도로 살리지 않게 표식을 남긴다
                markRemoved(confirmDelete.item.id);
              }
              reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {uploading && (
        <Popup
          title="어느 반에 올릴까요"
          width="max-w-xs"
          onClose={() => setUploading(null)}
        >
          <p className="mb-2 text-[11px] leading-snug text-gray-500">
            「{uploading.label}」을(를) 드라이브 공유 폴더에 올립니다. 같은
            이름 파일이 있으면 갈아 끼웁니다.
          </p>
          <div className="space-y-1.5">
            {CLASSES.map((c) => (
              <button
                key={c.id}
                className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
                onClick={() => uploadToDrive(c, uploading.ids)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </Popup>
      )}

      {renaming && (
        <AskText
          title="음원 이름 바꾸기"
          placeholder="새 이름"
          initial={renaming.title || renaming.id}
          confirmLabel="바꾸기"
          onSubmit={async (title) => {
            try {
              // 기기 저장분과 서버 양쪽에 적는다. 서버가 없으면 기기만.
              const local = await getLocal(renaming.id).catch(() => null);
              if (local) await saveLocal({ ...local, title });
              await renameResult(renaming.id, title).catch(() => {});
              reload();
              flash("이름을 바꿨습니다. 내보내는 파일 이름에도 적용됩니다.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          onClose={() => setRenaming(null)}
        />
      )}

      {asking === "deleteFolder" && (
        <AskConfirm
          title="폴더 삭제"
          message={`「${currentFolder}」 폴더를 지울까요? 곡은 미분류로 남습니다.`}
          confirmLabel="지우기"
          danger
          onConfirm={() => {
            setFolders(deleteFolder(currentFolder));
            setAssignment(folderAssignments());
            setCurrentFolder("all");
          }}
          onClose={() => setAsking(null)}
        />
      )}

      {refetching && (
        /* 음원교체 — 어떤 음원으로 바꿀지 먼저 받는다.
           예전에는 묻지 않고 같은 영상을 다시 받기만 했는데, 정작 바꾸고
           싶은 것은 「다른 영상」인 경우가 많았다(음질이 나쁘거나 지워짐). */
        <Popup title="음원교체" width="max-w-sm" onClose={() => setRefetching(null)}>
          <p className="mb-2 text-[11px] leading-snug text-gray-500">
            새 유튜브 주소를 넣으면 그 음원으로 분석합니다(새 곡으로 목록에
            생깁니다). 비워 두면 같은 영상을 새로 받아 처음부터 분석합니다.
            시간이 걸립니다.
          </p>
          <input
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-900"
            placeholder="새 유튜브 주소 (선택)"
            value={refetchUrl}
            onChange={(e) => setRefetchUrl(e.target.value)}
          />
          <div className="mt-2 flex gap-1.5">
            <button
              className="flex-1 rounded bg-black py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
              onClick={() => {
                onReanalyze?.(refetching, true, refetchUrl.trim() || undefined);
                setRefetching(null);
                setRefetchUrl("");
              }}
            >
              {refetchUrl.trim() ? "이 주소로 분석" : "같은 영상 다시 받기"}
            </button>
            <button
              className="rounded bg-gray-100 px-3 py-1.5 text-xs dark:bg-gray-800"
              onClick={() => {
                setRefetching(null);
                setRefetchUrl("");
              }}
            >
              취소
            </button>
          </div>
        </Popup>
      )}

      <Copyright />
    </div>
  );
}


/**
 * 다시 분석 버튼 묶음.
 *
 * 「다시 분석」은 받아 둔 음원을 그대로 쓴다 — 파이프라인만 다시 돌리므로
 * 빠르다. 「음원부터」는 내려받기부터 새로 한다. YouTube가 영상을 바꿔
 * 올렸거나 받다가 깨진 경우가 아니면 쓸 일이 없어 따로 두었다.
 */
function ReanalyzeButtons({
  item,
  onReanalyze,
  onAskRefetch,
  analyzing,
}: {
  item: ResultSummary;
  onReanalyze: (item: ResultSummary, refetch: boolean) => void;
  /** 음원 교체는 오래 걸린다. 묻고 나서 한다 */
  onAskRefetch: (item: ResultSummary) => void;
  /** 다른 분석이 도는 중 */
  analyzing: boolean;
}) {
  return (
    <>
      <IconButton
        label={
          analyzing ? "분석이 끝나면 누를 수 있습니다" : "분석만 (받아 둔 음원 그대로)"
        }
        disabled={analyzing}
        onClick={() => onReanalyze(item, false)}
      >
        {RerunIcon}
      </IconButton>
      {item.source === "youtube" && (
        <IconButton
          label={analyzing ? "분석이 끝나면 누를 수 있습니다" : "음원교체 (새로 받아 분석)"}
          disabled={analyzing}
          onClick={() => onAskRefetch(item)}
        >
          {ReplaceAudioIcon}
        </IconButton>
      )}
    </>
  );
}


/**
 * 목록 줄의 아이콘 버튼.
 *
 * 폰 폭에서 곡 한 줄에 버튼이 넷씩 붙으면 글자 버튼으로는 자리가 없다.
 * 자주 쓰는 저장·삭제만 아이콘으로 줄이고, 무엇인지는 길게 눌러(title)
 * 확인할 수 있게 한다. 화면 낭독기에는 aria-label로 이름이 간다.
 */
function IconButton({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={[
        "shrink-0 rounded p-1.5 disabled:opacity-30",
        danger ? "text-red-500" : "text-gray-500 dark:text-gray-400",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

/** 내려받아 저장 */
const SaveIcon = (
  <>
    <path d="M12 3v11M8 11l4 4 4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </>
);

/** 분석만 다시 — 같은 음원을 한 바퀴 더 돌린다 */
const CloudIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M7 18a4 4 0 0 1 .6-7.96 5.5 5.5 0 0 1 10.6 1.2A3.5 3.5 0 0 1 17.5 18H7z" />
    <path d="M12 21v-7M9.5 16.5 12 14l2.5 2.5" />
  </svg>
);

const EditIcon = (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const RerunIcon = (
  <>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4h-4" />
  </>
);

/** 음원교체 — 음원을 새 것으로 갈아 끼운다 */
const ReplaceAudioIcon = (
  <>
    <path d="M9 17V7l9-2v10" />
    <circle cx="6.5" cy="17.5" r="2.5" />
    <path d="M3 5h6M6 2v6" />
  </>
);

/** 지우기 */
const TrashIcon = (
  <>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M9 7V4h6v3" />
  </>
);


/** 꾸러미에 무엇이 담겼는지 사람 말로 */
function bundleParts(bundle: SongBundle): string[] {
  const parts = ["코드"];
  if (bundle.result.lyrics?.length) parts.push("가사");
  if (bundle.audio) parts.push("음원");
  if (bundle.inst) parts.push("반주");
  if (bundle.vocals) parts.push("보컬");
  if (bundle.sheets?.items.length) parts.push("웹 악보");
  if (bundle.setup) parts.push("연주설정");
  return parts;
}

