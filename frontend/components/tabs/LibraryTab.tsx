"use client";

import { useCallback, useEffect, useState } from "react";

import { Copyright } from "@/components/Copyright";
import { deleteResult, listResults } from "@/lib/api";
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

/** 분석해 둔 곡 목록. 결과가 캐시돼 있어 다시 열면 분석 없이 바로 뜬다. */
export function LibraryTab({ onOpen, active }: Props) {
  const [items, setItems] = useState<ResultSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listResults()
      .then((rows) => {
        setItems(rows);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (active) reload();
  }, [active, reload]);

  const remove = async (id: string) => {
    try {
      await deleteResult(id);
      setItems((cur) => cur?.filter((r) => r.id !== id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold">재생목록</h2>
        <button className="text-xs text-gray-500 underline" onClick={reload}>
          새로고침
        </button>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {items === null && !error && <p className="text-sm text-gray-400">불러오는 중…</p>}

      {items?.length === 0 && (
        <p className="py-10 text-center text-sm text-gray-400">
          아직 분석한 곡이 없습니다.
          <br />홈 탭에서 YouTube 주소를 넣어 보세요.
        </p>
      )}

      <ul className="divide-y divide-gray-200 dark:divide-gray-800">
        {items?.map((item) => (
          <li key={item.id} className="flex items-center gap-2 py-2.5">
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => onOpen(item.id)}
            >
              <div className="truncate text-sm font-medium">
                {item.title || item.id}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500">
                {item.key ? spellKey(item.key) : "조성 미상"} · {Math.round(item.bpm)} BPM ·{" "}
                {clock(item.duration)} · 코드 {item.chord_count}개
              </div>
              <div className="text-[10px] text-gray-400">
                {item.source === "youtube" ? "YouTube" : "업로드"} · {when(item.analyzed_at)}
              </div>
            </button>
            <button
              className="shrink-0 px-2 py-1 text-xs text-gray-400"
              onClick={() => remove(item.id)}
              aria-label="삭제"
            >
              삭제
            </button>
          </li>
        ))}
      </ul>

      <Copyright />
    </div>
  );
}
