"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AskConfirm } from "@/components/Ask";
import { Popup } from "@/components/Popup";
import { Working } from "@/components/Working";
import {
  alignLyrics,
  deleteLyrics,
  fetchLyrics,
  putLyrics,
  songPhrases,
} from "@/lib/api";
import { placeOnPhrases, spreadEvenly } from "@/lib/placeLyrics";
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
  /**
   * 가사를 고칠 수 있는가(관리자).
   *
   * 수강생 화면에서는 찾기·바꾸기·지우기를 감춘다 — 받은 가사를
   * 손댈 일이 없고, 잘못 눌러 지우면 곡을 다시 받아야 한다.
   */
  canEdit?: boolean;
}

/**
 * 가사 화면.
 *
 * 코드 박스·곡 전체 코드가 있던 자리를 대신 차지한다. 현재 줄을 강조하고
 * 화면 가운데로 따라 올린다 — 노래방처럼 눈이 한 자리를 본다.
 */
export function LyricsPane({
  result,
  time,
  online,
  onLyrics,
  onSeek,
  canEdit = true,
}: Props) {
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
  // 가사 지우기 확인 창. 지우면 수동 표식도 걷혀 다음부터 자동으로 찾는다
  const [confirmClear, setConfirmClear] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [index]);

  /** 가사를 결과·기기 저장분 양쪽에 반영한다. */
  const apply = async (next: LyricLine[], approx = false, manual = false) => {
    onLyrics(next);
    await saveLocal({
      ...result,
      lyrics: next,
      lyrics_approx: approx,
      lyrics_manual: manual,
    }).catch(() => {});
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
   * 시간 태그가 붙은 LRC·자막이면 그 시각이 정답이라 손대지 않는다.
   *
   * 시각이 없는 글은 **이미 있는 자막을 자로 삼아 AI가 맞춘다.** 자막은
   * 글자가 틀려도 언제 부르는지는 맞아서, 소절마다 제자리를 찾을 수 있다.
   *
   * 자막도 없으면 보컬이 시작하는 자리에 고르게 놓는다. 노래 길이에 고르게
   * 펴는 것보다는 낫지만 소절마다 맞지는 않아, 그렇다고 알린다.
   */
  const applyPasted = async () => {
    setError(null);
    setBusy(true);
    try {
      // 시간 태그가 있으면 그 시각이 정답이다. 손대지 않는다.
      const timed = parseLyricsText(draft, 0);
      let next = timed;

      if (!timed.length || timed.every((line) => line.t === 0)) {
        // 시각이 없는 글이다. 분석 결과를 보고 노래 자리에 놓는다.
        const texts = draft
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (!texts.length) throw new Error("가사를 읽지 못했습니다");

        // 1) 이 곡에 시각이 붙은 글(자막)이 남아 있으면 AI가 그것을 자로
        //    삼아 맞춘다. 글자는 틀려도 언제 부르는지는 맞기 때문에, 소절
        //    단위로 제자리를 찾는다.
        // 붙어 있는 가사가 없어도 서버가 영상 자막을 받아 자로 쓴다.
        // 그러니 여기서 줄 수를 따지지 않는다.
        let placed: LyricLine[] | null = null;
        if (online) {
          placed = await alignLyrics(result.id, texts)
            .then((r) => r.lyrics ?? null)
            .catch(() => null);
        }

        if (placed?.length) {
          next = placed;
        } else {
          // 2) 자막이 없으면 노래가 시작하는 자리에 고르게 놓는다.
          const starts = online
            ? await songPhrases(result.id, texts.length)
                .then((r) => r.starts)
                .catch(() => [])
            : [];
          next = starts.length
            ? placeOnPhrases(texts, starts, result.duration)
            : spreadEvenly(texts, result.duration);
        }
      }

      if (!next.length) throw new Error("가사를 읽지 못했습니다");
      await apply(next, false, true);
      // 서버가 있으면 그쪽에도 남겨 다음에 열 때 바로 나오게 한다
      if (online) await putLyrics(result.id, next).catch(() => {});
      setPasting(false);
      setDraft("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 가사를 맞추는 데 몇 초 걸린다. 화면 한가운데에 알린다 —
          버튼 글자만 바꿔서는 눌렸는지 몰라 또 누르게 된다 */}
      {busy && (
        <Working
          label={pasting ? "가사 맞추는 중" : "가사 찾는 중"}
          note={pasting ? "노래에서 실제 부른 자리를 찾아 시각을 붙입니다" : undefined}
        />
      )}

      {confirmClear && (
        <AskConfirm
          title="가사 지우기"
          message="이 곡의 가사를 모두 지웁니다. 지운 뒤에는 다시 찾거나 붙여넣을 수 있습니다."
          confirmLabel="지우기"
          danger
          onConfirm={async () => {
            await apply([], false, false);
            if (online) await deleteLyrics(result.id).catch(() => {});
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}

      {pasting && (
        <Popup title="가사 붙여넣기" onClose={() => setPasting(false)}>
          <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            가사를 붙여넣으세요. 시간이 적힌 가사(.lrc)나 자막 글이면 그 시각을
            그대로 쓰고, 그냥 가사면 <b>노래에서 실제 부른 자리를 찾아</b> 줄마다
            시각을 붙입니다.
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
            disabled={!draft.trim() || busy}
            onClick={applyPasted}
          >
            {busy ? "맞추는 중…" : "이 가사로 바꾸기"}
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
          <p className="text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            {busy ? "가사를 찾는 중…" : "이 곡의 가사가 아직 없습니다."}
          </p>
          {!canEdit && (
            <p className="text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              이 곡에는 가사가 들어 있지 않습니다.
            </p>
          )}
          {canEdit && !online && !hasLocalLlm() && (
            <p className="text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              설정에서 가사 도우미 키를 넣으면 한국 가요도 잘 찾습니다.
            </p>
          )}
          {canEdit && (
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
                className="shrink-0 rounded bg-[var(--panel)] px-2 py-1.5 text-xs disabled:opacity-40"
                disabled={busy || !query.trim()}
                onClick={() => search(query.trim())}
              >
                검색
              </button>
            </div>
            <button
              className="rounded bg-[var(--panel)] py-2 text-xs"
              onClick={() => setPasting(true)}
            >
              가사 붙여넣기
            </button>
          </div>
          )}
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
                    : "text-sm text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]",
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
          <div className="flex shrink-0 items-center justify-end gap-2 px-3 pb-1 text-[10px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            <span>{groups.length}묶음 · {lines.length}줄</span>
            {canEdit && (
              <>
                <button className="underline" onClick={() => setPasting(true)}>
                  가사 바꾸기
                </button>
                <button
                  className="text-red-500 underline"
                  onClick={() => setConfirmClear(true)}
                >
                  지우기
                </button>
                <button
                  className="underline disabled:opacity-40"
                  disabled={busy}
                  onClick={() => search("")}
                >
                  다시 찾기
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
