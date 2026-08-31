"use client";

import { useEffect, useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { CLASSES } from "@/lib/classes";
import { listFolders } from "@/lib/folders";
import { listLocal } from "@/lib/library";
import { labelFor, spellKey } from "@/lib/notation";
import { listRecent, type RecentEntry } from "@/lib/recent";
import { voicingFor } from "@/lib/voicings";

interface Props {
  /** 최근 재생 곡을 누르면 재생 화면으로 */
  onOpen: (id: string) => void;
  onImport: () => void;
  onLibrary: () => void;
  /** 강의실 열기. 반 id나 "mine"(내 강좌)을 넘긴다 */
  onLesson: (classId?: string) => void;
  onChords: () => void;
  /** 반별 공유 폴더에서 곡 받기. 수강생이 곡을 얻는 유일한 길이다 */
  onClassSongs: (classId: string) => void;
  /** 음원을 새로 들여오는 일(직접 가져오기)은 강사님 몫이다 */
  adminMode: boolean;
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
export function HomeDashboard({
  onOpen,
  onImport,
  onLibrary,
  onLesson,
  onChords,
  adminMode,
  onClassSongs,
}: Props) {
  /** 받기 상자의 탭 — 음원과 강좌를 나눠 담는다. 수강생은 강좌만 */
  const [fetchTab, setFetchTab] = useState<"song" | "lesson">("song");
  const [songCount, setSongCount] = useState<number | null>(null);
  const [folderCount, setFolderCount] = useState(0);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  /** 등록된 음원 전체. 홈에서 바로 골라 연습실로 간다 */
  const [songs, setSongs] = useState<Awaited<ReturnType<typeof listLocal>>>([]);
  // 날짜로 고르므로 하루 동안 같은 코드가 유지된다
  const [practice, setPractice] = useState<(typeof PRACTICE)[number] | null>(
    null,
  );

  useEffect(() => {
    listLocal()
      .then((rows) => {
        setSongCount(rows.length);
        setSongs(rows);
      })
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
      className="flex flex-col items-center gap-1 rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] py-2.5"
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
    /* 홈은 통째로 스크롤하지 않는다 — 음원 리스트만 제 칸 안에서 흐르고,
       이어듣기·빠른 실행·최근 재생·오늘의 코드는 늘 제자리에 있다 */
    <div className="flex h-full flex-col gap-2.5 p-3">
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
            <span className="block truncate text-sm font-medium">
              {last.title}
            </span>
          </span>
          <span className="shrink-0 text-[10px] text-gray-500">
            {ago(last.at)}
          </span>
        </button>
      )}

      {/* 받기 상자 — 음원받기와 강좌받기를 탭으로 나눈다 */}
      <section className="rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] px-3 py-2">
        <div className="mb-2 flex rounded-lg bg-[var(--panel-line)] p-0.5">
          {/* 음원받기는 수강생에게도 보여야 한다. 감춰 두었더니 곡을
              받을 길이 아주 없어져, 강사님이 새 곡을 올렸다는 알림을
              놓치면 그것으로 끝이었다. */}
          {(
            [
              ["song", "음원받기"],
              ["lesson", "강좌받기"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFetchTab(value)}
              className={[
                "min-w-0 flex-1 truncate rounded-md py-1 text-[12px] font-medium transition-colors",
                fetchTab === value
                  ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                  : "text-gray-500",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
        {fetchTab === "song" ? (
          <div className="grid grid-cols-3 gap-2">
            {CLASSES.map((c) =>
              quick(
                // 타일에는 반 이름만. 받은 곡은 음원목록에서 관리하므로
                // 누르면 음원목록으로 간다
                c.name.replace("강상주민센터 ", "") + " 받기",
                icon(
                  <>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <path d="M12 11v6M9 14l3 3 3-3" />
                  </>,
                ),
                // 강사님은 받아 둔 곡을 음원목록에서 관리한다.
                // 수강생에게는 그 자리가 곧 받는 자리다.
                () => (adminMode ? onLibrary() : onClassSongs(c.id)),
                c.id,
              ),
            )}
            {adminMode &&
              quick(
                "직접 가져오기",
                icon(
                  <>
                    <path d="M12 3.5v10M8.5 10 12 13.5 15.5 10" />
                    <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                  </>,
                ),
                onImport,
              )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {CLASSES.map((c) =>
              quick(
                c.name.replace("강상주민센터 ", "") + " 강의실",
                icon(
                  <>
                    <path d="M4 19.5V6a2 2 0 0 1 2-2h13v13.5" />
                    <path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H19v3.5H5.5A1.5 1.5 0 0 1 4 19.5z" />
                  </>,
                ),
                () => onLesson(c.id),
                "lesson-" + c.id,
              ),
            )}
            {quick(
              "내 강좌",
              icon(
                <>
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 20a7 7 0 0 1 14 0" />
                </>,
              ),
              () => onLesson("mine"),
            )}
          </div>
        )}
      </section>

      {/* 늘 쓰는 곳 — 음원목록·코드표 */}
      <div className="grid grid-cols-2 gap-2">
        {quick(
          "음원목록",
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
      {/* 좁은 화면: 최근 재생 위, 등록된 음원 아래.
          넓은 화면: 두 프레임을 나란히 — 왼쪽 최근 재생, 오른쪽 음원 목록. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 md:flex-row">
        <section className="rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] px-3 py-1.5 md:flex md:min-h-0 md:w-[42%] md:shrink-0 md:flex-col">
          <div className="flex shrink-0 items-center justify-between py-1">
            <h3 className="text-[11px] font-semibold text-gray-500">
              최근 재생
            </h3>
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
            <ul className="divide-y divide-gray-100 md:min-h-0 md:flex-1 md:overflow-y-auto dark:divide-gray-800">
              {rest.map((r) => (
                <li key={r.id}>
                  <button
                    className="flex w-full items-center gap-2 py-2 text-left"
                    onClick={() => onOpen(r.id)}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {r.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {ago(r.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 등록된 음원 — 누르면 바로 연습실로 간다 */}
        {songs.length > 0 && (
          <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] px-3 py-1.5">
            <div className="flex shrink-0 items-center justify-between py-1">
              <h3 className="text-[11px] font-semibold text-gray-500">
                등록된 음원
              </h3>
              <button
                className="text-[10px] text-gray-400 underline"
                onClick={onLibrary}
              >
                관리는 음원목록에서
              </button>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
              {songs.map((s) => (
                <li key={s.id}>
                  {/* 한 줄짜리 컴팩트 행 — 목록이 화면을 다 먹으면 아래
                    오늘의 코드·저작권 문구가 밀려난다 */}
                  <button
                    className="flex w-full items-center gap-1.5 py-1 text-left"
                    onClick={() => onOpen(s.id)}
                  >
                    <span className="shrink-0 text-[10px] text-[var(--accent)]">
                      ▶
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {s.title || s.id}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {spellKey(s.key)} · {Math.floor(s.duration / 60)}:
                      {String(Math.floor(s.duration % 60)).padStart(2, "0")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* 오늘의 코드 — 매일 하나씩 폼을 익힌다 */}
      {practice && (
        <button
          onClick={onChords}
          className="flex w-full items-center gap-3 rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] px-3 py-2 text-left"
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
              <ChordLabel
                label={labelFor(practice.root, practice.quality, false)}
              />
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
