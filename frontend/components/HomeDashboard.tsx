"use client";

import { useEffect, useState } from "react";

import { listFolders } from "@/lib/folders";
import { listLocal } from "@/lib/library";
import { listRecent, type RecentEntry } from "@/lib/recent";

interface Props {
  /** 최근 재생 곡을 누르면 재생 화면으로 */
  onOpen: (id: string) => void;
  onImport: () => void;
  onLibrary: () => void;
}

function ago(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

/** 홈 대시보드: 내 곡 요약 + 최근 재생. 재생 중이 아닐 때의 홈 화면. */
export function HomeDashboard({ onOpen, onImport, onLibrary }: Props) {
  const [songCount, setSongCount] = useState<number | null>(null);
  const [folderCount, setFolderCount] = useState(0);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  useEffect(() => {
    listLocal()
      .then((rows) => setSongCount(rows.length))
      .catch(() => setSongCount(0));
    // localStorage는 동기지만, 렌더 중 setState를 피해 마이크로태스크로 미룬다
    Promise.resolve().then(() => {
      setFolderCount(listFolders().length);
      setRecent(listRecent());
    });
  }, []);

  const stat = (label: string, value: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-left dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-gray-500">{label}</div>
    </button>
  );

  return (
    <div className="space-y-3 p-4">
      {/* 요약 */}
      <div className="flex gap-2">
        {stat("내 곡", songCount === null ? "…" : `${songCount}곡`, onLibrary)}
        {stat("폴더", `${folderCount}개`, onLibrary)}
      </div>

      <button
        onClick={onImport}
        className="w-full rounded-xl bg-black py-3.5 text-white dark:bg-white dark:text-black"
      >
        음원 가져오기
      </button>

      {/* 최근 재생 */}
      <section className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="py-1 text-xs font-semibold text-gray-500">최근 재생</h3>
        {recent.length === 0 ? (
          <p className="py-3 text-center text-xs text-gray-400">
            아직 재생한 곡이 없습니다. 곡을 열면 여기에 쌓입니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  className="flex w-full items-center gap-2 py-2.5 text-left"
                  onClick={() => onOpen(r.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{ago(r.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
