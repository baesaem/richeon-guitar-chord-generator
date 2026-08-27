"use client";

import { useEffect, useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { CLASSES } from "@/lib/classes";
import { listFolders } from "@/lib/folders";
import { listLocal } from "@/lib/library";
import { labelFor } from "@/lib/notation";
import { listRecent, type RecentEntry } from "@/lib/recent";
import { voicingFor } from "@/lib/voicings";

interface Props {
  /** 최근 재생 곡을 누르면 재생 화면으로 */
  onOpen: (id: string) => void;
  onImport: () => void;
  onLibrary: () => void;
  /** 반별 곡 목록 열기. 반 id를 넘긴다 */
  onShared: (classId: string) => void;
  onChords: () => void;
}

// 오늘의 코드 후보. 초보가 실제로 자주 쓰는 폼만 넣는다.
const PRACTICE: { root: string; quality: string }[] = [
  { root: "C", quality: "maj" },
  { root: "G", quality: "maj" },
  { root: "D", quality: "maj" },
  { root: "A", quality: "min" },
  { root: "E", quality: "min" },
  { root: "F", quality: "maj" },
  { root: "A", quality: "maj" },
  { root: "E", quality: "maj" },
  { root: "D", quality: "min" },
  { root: "B", quality: "min" },
  { root: "G", quality: "7" },
  { root: "C", quality: "maj7" },
];

function ago(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

/** 홈 대시보드: 이어듣기 · 빠른 실행 · 최근 재생 · 오늘의 코드. */
export function HomeDashboard({ onOpen, onImport, onLibrary, onShared, onChords }: Props) {
  const [songCount, setSongCount] = useState<number | null>(null);
  const [folderCount, setFolderCount] = useState(0);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  // 날짜로 고르므로 하루 동안 같은 코드가 유지된다
  const [practice, setPractice] = useState<(typeof PRACTICE)[number] | null>(null);

  useEffect(() => {
    listLocal()
      .then((rows) => setSongCount(rows.length))
      .catch(() => setSongCount(0));
    // localStorage는 동기지만, 렌더 중 setState를 피해 마이크로태스크로 미룬다
    Promise.resolve().then(() => {
      setFolderCount(listFolders().length);
      setRecent(listRecent());
      const day = Math.floor(Date.now() / 86400000);
      setPractice(PRACTICE[day % PRACTICE.length]);
    });
  }, []);

  const last = recent[0];
  const rest = recent.slice(1, 6);

  const quick = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    key?: string,
  ) => (
    <button
      key={key ?? label}
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 py-2.5 dark:border-gray-700 dark:bg-gray-900"
    >
      <span className="text-[var(--accent)]">{icon}</span>
      <span className="px-1 text-center text-[11px] font-medium leading-tight">
        {label}
      </span>
    </button>
  );

  const icon = (path: React.ReactNode) => (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );

  return (
    <div className="h-full space-y-2.5 overflow-y-auto p-3">
      {/* 이어듣기 — 마지막에 열었던 곡 */}
      {last && (
        <button
          onClick={() => onOpen(last.id)}
          className="flex w-full items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-2.5 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm text-white">
            ▶
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold text-[var(--accent)]">
              이어듣기
            </span>
            <span className="block truncate text-sm font-medium">{last.title}</span>
          </span>
          <span className="shrink-0 text-[10px] text-gray-500">{ago(last.at)}</span>
        </button>
      )}

      {/* 빠른 실행. 반이 둘이라 다섯 칸 — 3+2로 접힌다 */}
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-5">
        {CLASSES.map((c) =>
          quick(
            // 타일에는 반 이름만. "강상주민센터"는 타이틀바에 이미 있다
            c.name.replace("강상주민센터 ", ""),
            icon(
              <>
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M12 11v6M9 14l3 3 3-3" />
              </>,
            ),
            () => onShared(c.id),
            c.id,
          ),
        )}
        {quick(
          "가져오기",
          icon(
            <>
              <path d="M12 3.5v10M8.5 10 12 13.5 15.5 10" />
              <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </>,
          ),
          onImport,
        )}
        {quick(
          "재생목록",
          icon(
            <>
              <path d="M3 6h12M3 11h12M3 16h7" />
              <circle cx="17.5" cy="17" r="3" />
              <path d="M20.5 17V8l2.5 1.2" />
            </>,
          ),
          onLibrary,
        )}
        {quick(
          "코드표",
          icon(
            <>
              <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
              <path d="M8 3.5v17M12 3.5v17M16 3.5v17M4 9h16M4 15h16" />
            </>,
          ),
          onChords,
        )}
      </div>

      {/* 최근 재생 */}
      <section className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between py-1">
          <h3 className="text-[11px] font-semibold text-gray-500">최근 재생</h3>
          <span className="text-[10px] text-gray-400">
            내 곡 {songCount ?? "…"}
            {folderCount > 0 && ` · 폴더 ${folderCount}`}
          </span>
        </div>
        {recent.length === 0 ? (
          <p className="py-3 text-center text-xs text-gray-400">
            곡을 열면 여기에 쌓입니다.
          </p>
        ) : rest.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-gray-400">
            위의 이어듣기가 마지막으로 연 곡입니다.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rest.map((r) => (
              <li key={r.id}>
                <button
                  className="flex w-full items-center gap-2 py-2 text-left"
                  onClick={() => onOpen(r.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{r.title}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{ago(r.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 오늘의 코드 — 매일 하나씩 폼을 익힌다 */}
      {practice && (
        <button
          onClick={onChords}
          className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left dark:border-gray-700 dark:bg-gray-900"
        >
          <ChordDiagram
            voicing={voicingFor(practice.root, practice.quality)}
            label={labelFor(practice.root, practice.quality, false)}
            width={64}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold text-gray-500">
              오늘의 코드
            </span>
            <span className="block text-xl font-bold leading-tight">
              <ChordLabel label={labelFor(practice.root, practice.quality, false)} />
            </span>
            <span className="block text-[10px] text-gray-400">
              눌러서 코드표 전체 보기
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
