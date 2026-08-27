"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Popup } from "@/components/Popup";
import { fetchLyrics, putLyrics } from "@/lib/api";
import { saveLocal } from "@/lib/library";
import { hasLocalLlm } from "@/lib/llmClient";
import { groupBySentence, groupIndexAt } from "@/lib/lyricGroups";
import { parseLyricsText } from "@/lib/lrc";
import { findLyrics } from "@/lib/lyricsClient";
import type { AnalysisResult, LyricLine } from "@/lib/types";

interface Props {
  result: AnalysisResult;
  time: number;
  /** 서버가 붙어 있으면 서버가, 없으면 브라우저가 직접 가사를 찾는다 */
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
  const lines = useMemo(() => result.lyrics ?? [], [result.lyrics]);
  // 문장 단위로 끊는다. 자막에서 온 가사는 숨 쉬는 자리마다 토막나
  // 그대로 늘어놓으면 어디까지가 한 소절인지 알 수 없다.
  const groups = useMemo(() => groupBySentence(lines), [lines]);
  const index = groupIndexAt(groups, time);

  const activeRef = useRef<HTMLLIElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 가사를 붙여넣는 창. 파일을 고르는 것보다 이쪽이 손에 익다 —
  // 가사는 대개 웹에서 긁어 오지 파일로 받지 않는다.
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index]);

  /** 가사를 결과·기기 저장분 양쪽에 반영한다. */
  const apply = async (next: LyricLine[], approx = false) => {
    onLyrics(next);
    await saveLocal({ ...result, lyrics: next, lyrics_approx: approx }).catch(
      () => {},
    );
  };

  const search = async (q: string) => {
    setBusy(true);
    setError(null);
    try {
      if (online) {
        const updated = await fetchLyrics(result.id, q);
        await apply(updated.lyrics ?? [], !!updated.lyrics_approx);
      } else {
        // 서버가 없으면 브라우저가 직접 찾는다. 가사 목록(LRCLIB)은
        // 키 없이 열려 있어 이 기기에서 바로 부를 수 있다.
        const found = await findLyrics(result.title, result.duration, q);
        if (!found.lines.length) throw new Error("이 곡의 가사를 찾지 못했습니다");
        await apply(found.lines, found.approx);
      }
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 붙여넣은 글을 가사로 삼는다.
   *
   * 시간 태그가 붙은 LRC면 그 시각을 그대로 쓰고, 자막 파일이면 자막
   * 시각을, 그냥 가사 글이면 노래 길이에 고르게 편다. 어느 쪽이든
   * 붙여넣기만 하면 된다.
   */
  const applyPasted = async () => {
    setError(null);
    try {
      const next = parseLyricsText(draft, result.duration);
      if (!next.length) throw new Error("가사를 읽지 못했습니다");
      await apply(next);
      // 서버가 있으면 그쪽에도 남겨 다음에 열 때 바로 나오게 한다
      if (online) await putLyrics(result.id, next).catch(() => {});
      setPasting(false);
      setDraft("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {pasting && (
        <Popup title="가사 붙여넣기" onClose={() => setPasting(false)}>
          <p className="mb-2 text-[11px] leading-snug text-gray-500">
            가사를 붙여넣으세요. 시간이 적힌 가사(.lrc)나 자막 글이면 그 시각을
            그대로 쓰고, 그냥 가사면 노래 길이에 고르게 나눠 붙입니다.
          </p>
          <textarea
            className="h-48 w-full rounded border px-3 py-2 text-sm"
            placeholder={"한 줄에 한 소절씩 붙여넣으세요"}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="mt-3 w-full rounded bg-[var(--accent)] py-3 text-sm font-medium text-white disabled:opacity-40"
            disabled={!draft.trim()}
            onClick={applyPasted}
          >
            이 가사로 바꾸기
          </button>
        </Popup>
      )}

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
          {!online && !hasLocalLlm() && (
            <p className="text-[11px] leading-snug text-gray-400">
              설정에서 가사 도우미 키를 넣으면 한국 가요도 잘 찾습니다.
            </p>
          )}
          <div className="flex w-full max-w-xs flex-col gap-1.5">
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
            <button
              className="rounded bg-gray-100 py-2 text-xs dark:bg-gray-800"
              onClick={() => setPasting(true)}
            >
              가사 붙여넣기
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-center">
            {groups.map((g, i) => (
              <li
                key={`${g.start}-${i}`}
                ref={i === index ? activeRef : undefined}
                onClick={() => onSeek(g.start)}
                className={[
                  "cursor-pointer leading-snug transition-colors",
                  i === index
                    ? "text-base font-bold text-[var(--accent)]"
                    : "text-sm text-gray-500",
                ].join(" ")}
              >
                {g.text}
              </li>
            ))}
          </ul>
          {result.lyrics_approx && (
            <p className="shrink-0 px-3 text-[10px] leading-snug text-amber-700">
              동기화 가사를 못 찾아 줄을 고르게 폈습니다. 글자는 맞지만
              넘어가는 시점은 맞지 않습니다.
            </p>
          )}
          <div className="flex shrink-0 items-center justify-end gap-2 px-3 pb-1 text-[10px] text-gray-400">
            <span>{groups.length}묶음 · {lines.length}줄</span>
            <button className="underline" onClick={() => setPasting(true)}>
              가사 바꾸기
            </button>
            <button
              className="underline disabled:opacity-40"
              disabled={busy}
              onClick={() => search("")}
            >
              다시 찾기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
