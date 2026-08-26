"use client";

import { useEffect, useState } from "react";

import { Copyright } from "@/components/Copyright";
import { Popup } from "@/components/Popup";
import { downloadShared, listShared, type SharedFile } from "@/lib/api";
import { localIds, parseResultsText, saveLocal } from "@/lib/library";
import { fetchedDriveIds, markFetched } from "@/lib/sharedFetched";
import { STAGE_LABEL, type Health, type JobStatus } from "@/lib/types";

const DRIVE_FOLDER_ID = "1hEKM-s_pNLuw7W2e2YsPNveE6qoQq-Nd";
const DRIVE_FOLDER_URL = `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`;

interface Props {
  health: Health | null;
  status: JobStatus | null;
  error: string | null;
  busy: boolean;
  separate: boolean;
  /** 관리자 모드일 때만 드라이브 폴더 관리 링크를 보여준다 */
  adminMode: boolean;
  onAnalyzeUrl: (url: string) => void;
  onAnalyzeFile: (file: File) => void;
}

type CardKind = "youtube" | "file" | "shared";

/** 카드 한 장. 아이콘 + 제목 + 설명, 누르면 모달이 열린다. */
function Card({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left dark:border-gray-700 dark:bg-gray-900"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-gray-800">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-[11px] leading-snug text-gray-500">
          {description}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-gray-400">›</span>
    </button>
  );
}

/** 음원 가져오기: 방식을 카드로 고르고, 세부 입력·목록은 모달에서. */
export function ImportTab({
  health,
  status,
  error,
  busy,
  separate,
  adminMode,
  onAnalyzeUrl,
  onAnalyzeFile,
}: Props) {
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState<CardKind | null>(null);

  // 강상기타반 공유 재생목록 (구글드라이브, 서버가 프록시)
  const [shared, setShared] = useState<SharedFile[] | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [sharedNotice, setSharedNotice] = useState<string | null>(null);
  // 이미 받아서 기기에 남아 있는 드라이브 파일들
  const [fetched, setFetched] = useState<Set<string>>(new Set());

  const refreshFetched = () =>
    localIds()
      .then((ids) => setFetched(fetchedDriveIds(ids)))
      .catch(() => {});

  useEffect(() => {
    if (!health) return;
    listShared()
      .then((files) => {
        setShared(files);
        setSharedError(null);
      })
      .catch((e) => setSharedError((e as Error).message));
    refreshFetched();
  }, [health]);

  /** 공유 파일을 내려받아 기기 저장 재생목록에 바로 넣는다. */
  const fetchShared = async (file: SharedFile) => {
    setFetching(file.id);
    setSharedError(null);
    setSharedNotice(null);
    try {
      const results = parseResultsText(await downloadShared(file.id));
      for (const result of results) await saveLocal(result);
      markFetched(file.id, results.map((r) => r.id));
      await refreshFetched();
      setSharedNotice(
        results.length === 1
          ? `저장했습니다: ${results[0].title || results[0].id}`
          : `${results.length}곡을 기기에 저장했습니다. 재생목록에서 여세요.`,
      );
    } catch (e) {
      setSharedError(`가져오기 실패: ${(e as Error).message}`);
    } finally {
      setFetching(null);
    }
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <header>
        <h2 className="text-lg font-bold">음원 가져오기</h2>
        <p className="text-sm text-gray-500">
          {health
            ? `${health.device} · ${health.pipeline_version}` +
              (health.youtube_enabled ? "" : " · 업로드 전용")
            : "분석 서버 미연결 — 강상기타반 받기는 가능"}
        </p>
      </header>

      {health && !health.ffmpeg && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          ffmpeg / ffprobe를 찾을 수 없습니다. 설치 후 PATH에 추가해야 분석이 가능합니다.
        </p>
      )}

      {/* ---- 방식 카드 ---- */}
      {health?.youtube_enabled && (
        <Card
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
              <rect x="1" y="5" width="22" height="14" rx="4" fill="#FF0000" />
              <path d="M10 8.8v6.4l5.5-3.2z" fill="#fff" />
            </svg>
          }
          title="YouTube 주소"
          description="영상 주소를 붙여넣어 코드를 분석합니다"
          onClick={() => setOpen("youtube")}
        />
      )}

      <Card
        icon={
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 text-gray-600 dark:text-gray-300"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 18V6l10-2v11" />
            <circle cx="6.5" cy="18" r="2.5" />
            <circle cx="16.5" cy="15" r="2.5" />
          </svg>
        }
        title="오디오 파일"
        description="mp3 · wav · m4a · flac · ogg 파일을 분석합니다"
        onClick={() => setOpen("file")}
      />

      <Card
        icon={
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6 text-gray-600 dark:text-gray-300"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M12 11v6M9 14l3 3 3-3" />
          </svg>
        }
        title="강상기타반"
        description="공유 폴더의 코드 목록을 받아 재생목록에 담습니다"
        onClick={() => setOpen("shared")}
      />

      <p className="text-xs text-gray-500">
        음원 분리 {separate ? "사용" : "안 함"} · 설정 탭에서 바꿀 수 있습니다.
      </p>

      {status && (
        <section className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{STAGE_LABEL[status.stage]}</span>
            <span>{Math.round(status.progress * 100)}%</span>
          </div>
          <div className="h-2 w-full rounded bg-gray-200">
            <div
              className="h-2 rounded bg-black transition-all dark:bg-white"
              style={{ width: `${status.progress * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">{status.message}</p>
        </section>
      )}

      {sharedNotice && (
        <p className="rounded bg-green-50 p-2 text-xs text-green-800">{sharedNotice}</p>
      )}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Copyright />

      {/* ---- YouTube 모달 ---- */}
      {open === "youtube" && (
        <Popup title="YouTube 주소" onClose={() => setOpen(null)}>
          <div className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded border px-3 py-3 text-base"
              placeholder="https://www.youtube.com/watch?v=..."
              inputMode="url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {/* 곡을 찾아 주소를 복사해 오도록 유튜브를 새 탭으로 연다 */}
            <a
              href="https://www.youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded border"
              aria-label="YouTube 열기"
              title="YouTube 열기"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
                <rect x="1" y="5" width="22" height="14" rx="4" fill="#FF0000" />
                <path d="M10 8.8v6.4l5.5-3.2z" fill="#fff" />
              </svg>
            </a>
          </div>
          <button
            className="mt-3 w-full rounded bg-black py-3 text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={!url || busy}
            onClick={() => {
              setOpen(null);
              onAnalyzeUrl(url);
            }}
          >
            분석
          </button>
        </Popup>
      )}

      {/* ---- 오디오 파일 모달 ---- */}
      {open === "file" && (
        <Popup title="오디오 파일" onClose={() => setOpen(null)}>
          <input
            type="file"
            accept="audio/*"
            className="block w-full text-sm"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setOpen(null);
                onAnalyzeFile(f);
              }
            }}
          />
          <p className="mt-2 text-[11px] text-gray-500">mp3 · wav · m4a · flac · ogg</p>
        </Popup>
      )}

      {/* ---- 강상기타반 모달 ---- */}
      {open === "shared" && (
        <Popup title="강상기타반" onClose={() => setOpen(null)}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] leading-snug text-gray-500">
              공유 폴더의 코드 목록(.rml)입니다.
            </p>
            {adminMode && (
              <a
                href={DRIVE_FOLDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] text-gray-500 underline"
              >
                드라이브에서 열기
              </a>
            )}
          </div>

          {sharedNotice && (
            <p className="mb-2 rounded bg-green-50 p-2 text-xs text-green-800">
              {sharedNotice}
            </p>
          )}
          {sharedError && (
            <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">
              {sharedError}
            </p>
          )}

          {!health ? (
            // 서버가 없으면(외부 링크로 연 화면) 드라이브 폴더 뷰를 그대로 임베드한다.
            <>
              <iframe
                src={`https://drive.google.com/embeddedfolderview?id=${DRIVE_FOLDER_ID}#list`}
                className="h-64 w-full rounded border border-gray-200 bg-white dark:border-gray-700"
                title="강상기타반 공유 폴더"
              />
              <p className="mt-2 text-[11px] leading-snug text-gray-500">
                파일을 누르면 드라이브에서 내려받아집니다. 받은 파일은 재생목록의
                「파일 가져오기」로 담으세요.
              </p>
            </>
          ) : shared === null && !sharedError ? (
            <p className="text-xs text-gray-400">목록 불러오는 중…</p>
          ) : shared !== null && shared.length === 0 ? (
            <p className="text-xs text-gray-400">폴더에 아직 파일이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {shared?.map((file) => {
                const done = fetched.has(file.id);
                return (
                  <li key={file.id}>
                    <button
                      className="flex w-full items-center gap-2 py-2.5 text-left disabled:opacity-50"
                      disabled={done || fetching !== null}
                      onClick={() => fetchShared(file)}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {file.name}
                      </span>
                      <span
                        className={[
                          "shrink-0 text-[11px]",
                          done ? "text-green-700" : "text-gray-500",
                        ].join(" ")}
                      >
                        {done ? "받았음" : fetching === file.id ? "받는 중…" : "받기"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Popup>
      )}
    </div>
  );
}
