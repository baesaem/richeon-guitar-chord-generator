"use client";

import { useEffect, useRef, useState } from "react";

import { fetchLyrics, putLyrics } from "@/lib/api";
import { saveLocal } from "@/lib/library";
import { lyricIndexAt, parseLyricsText } from "@/lib/lrc";
import type { AnalysisResult, LyricLine } from "@/lib/types";

interface Props {
  result: AnalysisResult;
  time: number;
  /** 서버가 붙어 있을 때만 「가사 찾기」를 보여준다 */
  online: boolean;
  /** 가사를 새로 받으면 재생 중인 결과에도 반영한다 */
  onLyrics: (lines: LyricLine[]) => void;
  onSeek: (t: number) => void;
}

/**
 * 가사 화면.
 *
 * 코드 박스·곡 전체 코드가 있던 자리를 대신 차지한다. 현재 줄을 강조하고
 * 화면 가운데로 따라 올린다 — 노래방처럼 눈이 한 자리를 본다.
 */
export function LyricsPane({ result, time, online, onLyrics, onSeek }: Props) {
  const lines = result.lyrics ?? [];
  const index = lyricIndexAt(lines, time);

  const activeRef = useRef<HTMLLIElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index]);

  /** 가사를 결과·기기 저장분 양쪽에 반영한다. */
  const apply = async (next: LyricLine[]) => {
    onLyrics(next);
    await saveLocal({ ...result, lyrics: next }).catch(() => {});
  };

  const search = async (q: string) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await fetchLyrics(result.id, q);
      await apply(updated.lyrics ?? []);
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      const next = parseLyricsText(await file.text(), result.duration);
      if (!next.length) throw new Error("가사를 읽지 못했습니다");
      await apply(next);
      // 서버가 있으면 그쪽에도 남겨 다음에 열 때 바로 나오게 한다
      if (online) await putLyrics(result.id, next).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        ref={fileRef}
        type="file"
        accept=".lrc,.vtt,.srt,.txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="shrink-0 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </p>
      )}

      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
          <p className="text-xs text-gray-500">
            {busy ? "가사를 찾는 중…" : "이 곡의 가사가 아직 없습니다."}
          </p>
          <div className="flex w-full max-w-xs flex-col gap-1.5">
            {online && (
              <>
                <button
                  className="rounded bg-black py-2 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black"
                  disabled={busy}
                  onClick={() => search("")}
                >
                  가사 찾기
                </button>
                <div className="flex gap-1.5">
                  <input
                    className="min-w-0 flex-1 rounded border px-2 py-1.5 text-xs"
                    placeholder="가수 곡명으로 직접 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && query.trim()) search(query.trim());
                    }}
                  />
                  <button
                    className="shrink-0 rounded bg-gray-100 px-2 py-1.5 text-xs disabled:opacity-40 dark:bg-gray-800"
                    disabled={busy || !query.trim()}
                    onClick={() => search(query.trim())}
                  >
                    검색
                  </button>
                </div>
              </>
            )}
            <button
              className="rounded bg-gray-100 py-2 text-xs dark:bg-gray-800"
              onClick={() => fileRef.current?.click()}
            >
              가사 파일 넣기 (.lrc · 자막)
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-center">
            {lines.map((line, i) => (
              <li
                key={`${line.t}-${i}`}
                ref={i === index ? activeRef : undefined}
                onClick={() => onSeek(line.t)}
                className={[
                  "cursor-pointer leading-snug transition-colors",
                  i === index
                    ? "text-base font-bold text-[var(--accent)]"
                    : "text-sm text-gray-500",
                ].join(" ")}
              >
                {line.text}
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 items-center justify-end gap-2 px-3 pb-1 text-[10px] text-gray-400">
            <span>{lines.length}줄</span>
            <button className="underline" onClick={() => fileRef.current?.click()}>
              가사 바꾸기
            </button>
            {online && (
              <button
                className="underline disabled:opacity-40"
                disabled={busy}
                onClick={() => search("")}
              >
                다시 찾기
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
