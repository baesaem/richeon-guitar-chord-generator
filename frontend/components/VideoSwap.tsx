"use client";

/**
 * 곡의 영상만 바꾼다(강사님: 「현재 생성된 음원에 유튜브 영상만 교체 — 영상 소리는
 * 끄고 음원 시간과 비슷하게」).
 *
 * 소리는 곡의 음원 그대로, 그림은 붙인 유튜브 영상을 음소거로 음원 시각에 맞춰
 * 돌린다. 뮤직비디오는 같은 녹음이라도 앞에 장면이 몇 초 더 있다 — 서버가 영상의
 * 소리를 받아 곡의 음원과 견주어 몇 초 늦은지(와 조금 빠르거나 느린지) 찾는다.
 * 다른 녹음(라이브)이라 소리로 못 맞추면 손으로 ± 몇 초를 맞춘다.
 *
 * 「음악 시간 자동 맞추기」를 끄면 영상 0초가 음원 0초 — 맞춘 값은 기억해 두어 다시
 * 켜면 곧바로 돌아온다. 「리셋」은 곡에 적힌 바꾸기 값을 모두 지우고 새 링크를
 * 받는다(강사님).
 */

import { useRef, useState } from "react";
import { alignVideo } from "@/lib/api";
import type { AnalysisResult } from "@/lib/types";
import { youtubeIdOf } from "@/lib/videoLink";

interface Props {
  result: AnalysisResult;
  onSave: (v: { url: string | null; offset: number; scale: number; auto: boolean }) => void;
  /** 곡에 적힌 바꾸기 값을 지운다 — 창은 열어 두고 새 링크를 받는다 */
  onReset: () => void;
  onClose: () => void;
}

const fmt = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(1)}초`;

export function VideoSwap({ result, onSave, onReset, onClose }: Props) {
  const own = result.source === "youtube" ? result.id : null;
  const [url, setUrl] = useState(result.video_url ?? "");
  // 예전에 저장한 곡은 켬·끔이 없다 — 어긋남이 적혀 있으면 켠 것으로 본다
  const savedAuto =
    result.video_auto ?? (!!result.video_offset || (!!result.video_scale && result.video_scale !== 1));
  const [auto, setAuto] = useState(savedAuto);
  /** 자동으로 맞춘 값(켜면 쓰는 바탕). 끄면 바탕은 0초·같은 빠르기 */
  const [aligned, setAligned] = useState<{ offset: number; scale: number } | null>(
    savedAuto ? { offset: result.video_offset ?? 0, scale: result.video_scale || 1 } : null,
  );
  /** 손으로 더한 초(± 단추) — 켬·끔 어느 쪽에서도 바탕 위에 더한다 */
  const [nudge, setNudge] = useState(savedAuto ? 0 : (result.video_offset ?? 0));
  const offset = Math.round(((auto && aligned ? aligned.offset : 0) + nudge) * 100) / 100;
  const scale = auto && aligned ? aligned.scale : 1;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** 올린 사람이 다른 사이트 재생을 막아 둔 영상 — 앱에서 「동영상을 재생할 수 없음」만 나온다 */
  const [blocked, setBlocked] = useState(false);
  const id = youtubeIdOf(url);
  const bad = !!url.trim() && !id;

  const autoAlign = async () => {
    if (!id) return;
    setBusy(true);
    setNote("영상의 소리를 받아 음원과 견주는 중… (30초~1분)");
    try {
      const r = await alignVideo(result.id, url.trim());
      if (r.embeddable === false) {
        setBlocked(true);
        setNote(
          `「${r.video_title || "이 영상"}」은 올린 사람이 다른 사이트에서 재생하지 못하게 막아 두어 앱에서 볼 수 없습니다 — 다른 영상을 골라 주세요`,
        );
        return;
      }
      setAligned({ offset: r.offset, scale: r.scale || 1 });
      setNudge(0);
      setAuto(true);
      const late =
        Math.abs(r.offset) < 0.05
          ? "영상과 음원이 같은 자리에서 시작합니다"
          : r.offset > 0
            ? `영상에 앞 장면이 ${r.offset.toFixed(1)}초 더 있어 그만큼 건너뛰고 맞춥니다`
            : "맞는 자리를 찾았습니다";
      const speed =
        Math.abs((r.scale || 1) - 1) > 0.001
          ? ` · 영상이 ${Math.abs((r.scale - 1) * 100).toFixed(1)}% ${r.scale > 1 ? "빠릅니다" : "느립니다"}`
          : "";
      // 영상이 곡 몇 초부터 나오는가(영상 0초 = 음원 이 자리)
      const from = -r.offset / (r.scale || 1);
      const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
      const part =
        from > 1
          ? ` · 영상은 음원 ${mmss(from)}부터 나옵니다 — 그 앞부분은 이 영상에 없어 그동안 영상이 첫 장면에서 기다립니다`
          : r.share < 0.8
            ? ` · 곡의 ${Math.round(r.share * 100)}%만 영상과 맞습니다(편집된 영상) — 맞지 않는 곳에서는 영상이 어긋납니다`
            : "";
      setNote(
        r.confidence < 0.3
          ? `소리가 잘 겹치지 않습니다(다른 녹음·라이브일 수 있음) — 찾은 값: ${fmt(r.offset)}. 재생해 보며 ± 로 맞춰 주세요`
          : `${late}${speed}${part}`,
      );
    } catch (e) {
      setNote(`맞추지 못했습니다 — ${(e as Error).message}. ± 로 직접 맞춰 주세요`);
    } finally {
      setBusy(false);
    }
  };

  const step = (d: number) => setNudge((o) => Math.round((o + d) * 10) / 10);

  /** 켬: 맞춘 값이 없으면 지금 맞춘다. 끔: 영상 0초 = 음원 0초(맞춘 값은 남겨 둔다) */
  const toggleAuto = () => {
    if (auto) {
      setAuto(false);
      setNote("자동 맞추기를 껐습니다 — 영상이 음원과 같이 0초부터 흐릅니다");
      return;
    }
    if (aligned) {
      setAuto(true);
      setNote(null);
    } else void autoAlign();
  };

  const reset = () => {
    onReset();
    setUrl("");
    setAuto(false);
    setAligned(null);
    setNudge(0);
    setBlocked(false);
    setNote("바꾸기 값을 지웠습니다 — 새 유튜브 주소를 넣어 주세요");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="space-y-2.5 text-sm">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          소리는 이 곡의 음원 그대로, 화면만 붙인 유튜브 영상으로 바꿉니다. 영상 소리는
          꺼지고 음원 시각에 맞춰 따라갑니다.
        </p>
        <button
          className="shrink-0 rounded border border-red-500/60 px-2 py-1 text-[12px] font-semibold text-red-600 disabled:opacity-40"
          disabled={busy || (!result.video_url && !url.trim())}
          onClick={reset}
          title="이 곡에 적힌 영상 바꾸기 값(링크·시작·빠르기)을 모두 지우고 새 링크를 받습니다"
        >
          리셋
        </button>
      </div>
      <input
        ref={inputRef}
        className="w-full rounded border border-[var(--panel-line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        placeholder="유튜브 주소 (https://youtu.be/…)"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setNote(null);
          setBlocked(false);
          // 다른 영상이면 맞춘 값은 쓸 수 없다
          setAligned(null);
          setAuto(false);
          setNudge(0);
        }}
        inputMode="url"
      />
      {bad && <p className="text-[11px] text-red-600">유튜브 주소가 아닙니다</p>}
      {id && id === own && (
        <p className="text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          이 곡을 등록한 영상입니다 — 바꾸지 않은 것과 같습니다
        </p>
      )}
      {id && id !== own && (
        <>
          <div className="flex items-center gap-1.5">
            <button
              role="switch"
              aria-checked={auto}
              className={[
                "flex flex-1 items-center justify-between rounded px-2.5 py-2 text-[13px] font-semibold disabled:opacity-50",
                auto ? "bg-[var(--accent)] text-white" : "bg-[var(--chip)]",
              ].join(" ")}
              disabled={busy}
              onClick={toggleAuto}
              title="켜면 영상의 소리를 음원과 견주어 시작·빠르기를 맞춥니다. 끄면 영상 0초가 음원 0초입니다"
            >
              <span>{busy ? "맞추는 중…" : "음악 시간 자동 맞추기"}</span>
              <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px]">{auto ? "켬" : "끔"}</span>
            </button>
            {auto && aligned && (
              <button
                className="shrink-0 rounded bg-[var(--chip)] px-2 py-2 text-[12px] disabled:opacity-50"
                disabled={busy}
                onClick={() => void autoAlign()}
                title="영상의 소리를 다시 받아 맞춥니다"
              >
                다시 맞추기
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-1 text-[12px]">
            <span className="shrink-0">영상 시작</span>
            <span className="flex items-center gap-1">
              {[-1, -0.1].map((d) => (
                <button key={d} className="rounded bg-[var(--chip)] px-2 py-1" onClick={() => step(d)}>
                  {d}
                </button>
              ))}
              <span className="w-16 text-center font-semibold tabular-nums">{fmt(offset)}</span>
              {[0.1, 1].map((d) => (
                <button key={d} className="rounded bg-[var(--chip)] px-2 py-1" onClick={() => step(d)}>
                  +{d}
                </button>
              ))}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            + 는 영상에 앞 장면이 더 있을 때(영상이 늦게 시작) — 영상이 소리보다 늦어 보이면
            + 로, 빨라 보이면 − 로 옮깁니다.
            {Math.abs(scale - 1) > 0.001 &&
              ` 빠르기 차이 ${((scale - 1) * 100).toFixed(1)}%도 함께 맞춥니다.`}
          </p>
        </>
      )}
      {note && (
        <p className={["text-[12px] leading-snug", blocked ? "font-semibold text-red-600" : ""].join(" ")}>
          {note}
        </p>
      )}
      <div className="flex gap-1.5">
        {result.video_url && (
          <button
            className="flex-1 rounded bg-[var(--panel)] py-2 text-[13px]"
            onClick={() => onSave({ url: null, offset: 0, scale: 1, auto: false })}
            title="붙인 영상을 떼고 원래대로 봅니다"
          >
            원래 영상으로
          </button>
        )}
        <button className="flex-1 rounded bg-[var(--panel)] py-2 text-[13px]" onClick={onClose}>
          닫기
        </button>
        <button
          className="flex-1 rounded bg-[var(--accent)] py-2 text-[13px] font-semibold text-white disabled:opacity-50"
          disabled={!id || id === own || busy || blocked}
          onClick={() => onSave({ url: url.trim(), offset, scale, auto })}
        >
          저장
        </button>
      </div>
    </div>
  );
}
