"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Copyright } from "@/components/Copyright";
import { deleteResult, getResult, listResults } from "@/lib/api";
import {
  assignFolder,
  createFolder,
  deleteFolder,
  folderAssignments,
  listFolders,
} from "@/lib/folders";
import {
  exportAllToFile,
  exportToFile,
  getLocal,
  importFromFile,
  listLocal,
  removeLocal,
  saveLocal,
} from "@/lib/library";
import { spellKey } from "@/lib/notation";
import type { ResultSummary } from "@/lib/types";

interface Props {
  /** 목록에서 곡을 고르면 재생 화면으로 넘긴다 */
  onOpen: (id: string) => void;
  /** 탭이 보일 때만 목록을 새로 읽는다 */
  active: boolean;
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
 * 재생목록.
 *
 * 두 저장소를 함께 보여준다.
 *  - 기기 저장: 브라우저(IndexedDB)에 담긴 결과. 서버(PC)가 꺼져도 남는다
 *  - 서버: PC 캐시에 있는 결과. 서버가 꺼지면 이 섹션만 사라진다
 */
export function LibraryTab({ onOpen, active }: Props) {
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

    listResults()
      .then((rows) => {
        setServer(rows);
        setServerDown(false);
      })
      .catch(() => {
        setServer(null);
        setServerDown(true);
      });

    // 폴더는 동기 localStorage라 그냥 읽는다 (마이크로태스크로 미뤄 lint 규칙을 지킨다)
    Promise.resolve().then(() => {
      setFolders(listFolders());
      setAssignment(folderAssignments());
    });
  }, []);

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
    for (const item of targets) {
      try {
        await saveLocal(await getResult(item.id));
        ok += 1;
      } catch {
        // 한 곡이 실패해도 나머지는 계속 저장한다
      }
    }
    flash(`${ok}곡을 기기에 저장했습니다.`);
    reload();
  };

  const exportOne = async (id: string) => {
    try {
      const result = (await getLocal(id)) ?? (await getResult(id));
      exportToFile(result);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importOne = async (file: File) => {
    try {
      const results = await importFromFile(file);
      for (const result of results) await saveLocal(result);
      flash(
        results.length === 1
          ? `가져왔습니다: ${results[0].title || results[0].id}`
          : `${results.length}곡을 가져왔습니다.`,
      );
      reload();
    } catch (e) {
      setError(`가져오기 실패: ${(e as Error).message}`);
    }
  };

  const exportAll = async () => {
    try {
      const count = await exportAllToFile();
      if (count === 0) setError("기기에 저장된 곡이 없습니다");
      else flash(`${count}곡을 파일로 내보냈습니다.`);
    } catch (e) {
      setError((e as Error).message);
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
          {clock(item.duration)} · 코드 {item.chord_count}개
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
        <h2 className="text-lg font-bold">재생목록</h2>
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
          기기 저장 · 서버가 꺼져도 유지
        </h3>
        {device !== null && device.length > 0 && (
          <button className="text-[11px] text-gray-500 underline" onClick={exportAll}>
            전체 내보내기
          </button>
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
          onClick={() => {
            const name = window.prompt("새 폴더 이름");
            if (!name?.trim()) return;
            setFolders(createFolder(name));
            setCurrentFolder(name.trim());
          }}
        >
          + 새 폴더
        </button>
        {currentFolder !== "all" && (
          <button
            className="px-1.5 py-1 text-xs text-red-500"
            onClick={() => {
              if (!window.confirm(`「${currentFolder}」 폴더를 지울까요? 곡은 미분류로 남습니다.`))
                return;
              setFolders(deleteFolder(currentFolder));
              setAssignment(folderAssignments());
              setCurrentFolder("all");
            }}
          >
            폴더 삭제
          </button>
        )}
      </div>

      {device === null ? (
        <p className="py-2 text-xs text-gray-400">읽는 중…</p>
      ) : device.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">
          아직 없습니다. 아래 서버 목록에서 「저장」을 누르면 여기 담깁니다.
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
                  <button className={actionBtn} onClick={() => exportOne(item.id)}>
                    파일로
                  </button>
                  <button
                    className={actionBtn}
                    onClick={async () => {
                      await removeLocal(item.id);
                      reload();
                    }}
                  >
                    삭제
                  </button>
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

      {/* 서버 */}
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500">서버 (PC 캐시)</h3>
        {server !== null && server.length > 0 && (
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
      ) : server.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">서버에 분석된 곡이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {server.map((item) =>
            row(
              item,
              <>
                {saved.has(item.id) ? (
                  <span className="shrink-0 px-2 py-1 text-[10px] text-green-700">
                    저장됨
                  </span>
                ) : (
                  <button className={actionBtn} onClick={() => saveToDevice(item.id)}>
                    저장
                  </button>
                )}
                <button
                  className={actionBtn}
                  onClick={async () => {
                    try {
                      await deleteResult(item.id);
                      reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  삭제
                </button>
              </>,
            ),
          )}
        </ul>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        기기 저장 곡 중 YouTube 곡은 서버 없이도 재생과 코드 화면이 모두 동작합니다.
        업로드한 곡은 오디오가 서버에 있어 코드만 보입니다.
      </p>

      <Copyright />
    </div>
  );
}
