"use client";

import { useEffect, useState } from "react";

import { Copyright } from "@/components/Copyright";
import { folderAssignments, listFolders } from "@/lib/folders";
import { listLocal } from "@/lib/library";
import { spellKey } from "@/lib/notation";
import type { ResultSummary } from "@/lib/types";

/**
 * 편집 — 고칠 곡 고르기.
 *
 * 인식이 아무리 좋아져도 틀리는 마디는 남는다. 강사님이 귀로 듣고 고칠
 * 자리다. 폴더로 먼저 좁히고(반별·진도별로 나눠 두는 경우가 많다) 곡을
 * 고르면 악보가 열린다.
 *
 * 고치는 일 자체는 악보에서 한다 — 마디를 길게 누르면 코드 고르는 창이
 * 뜬다. 재생하면서 고칠 수 있게 재생 화면을 그대로 쓴다.
 */
export function EditTab({ onPick }: { onPick: (id: string) => void }) {
  const [songs, setSongs] = useState<ResultSummary[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState("all");

  useEffect(() => {
    let alive = true;
    listLocal()
      .then((list) => {
        if (!alive) return;
        setSongs(list);
        setFolders(listFolders());
        setAssignment(folderAssignments());
      })
      .catch(() => {
        if (alive) setSongs([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = (songs ?? []).filter((s) =>
    current === "all" ? true : assignment[s.id] === current,
  );

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <h2 className="mb-1 text-lg font-bold md:hidden">편집</h2>
      <p className="mb-3 text-[11px] leading-snug text-gray-500">
        고칠 곡을 고르세요. 악보에서 마디를 <b>3초 길게 누르면</b>(마우스는
        오른쪽 클릭) 그 마디의 코드를 바꿉니다. 재생하면서 고칠 수 있습니다.
      </p>

      {/* 폴더 칩. 곡이 쌓이면 폴더로 먼저 좁히는 편이 빠르다 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[{ id: "all", label: "전체" }, ...folders.map((f) => ({ id: f, label: f }))].map(
          (f) => (
            <button
              key={f.id}
              onClick={() => setCurrent(f.id)}
              className={[
                "rounded-full px-2.5 py-1 text-xs",
                current === f.id
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-gray-100 dark:bg-gray-800",
              ].join(" ")}
            >
              {f.label}
            </button>
          ),
        )}
      </div>

      {songs === null ? (
        <p className="py-2 text-xs text-gray-400">읽는 중…</p>
      ) : shown.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">
          {current === "all"
            ? "기기에 저장된 곡이 없습니다. 음원목록에서 먼저 곡을 담으세요."
            : `「${current}」 폴더에 곡이 없습니다.`}
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {shown.map((song) => (
            <li key={song.id}>
              <button
                className="w-full py-2.5 text-left"
                onClick={() => onPick(song.id)}
              >
                <div className="truncate text-sm font-medium">
                  {song.title || song.id}
                </div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {song.key ? spellKey(song.key) : "조성 미상"} ·{" "}
                  {Math.round(song.bpm)} BPM
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Copyright />
    </div>
  );
}
