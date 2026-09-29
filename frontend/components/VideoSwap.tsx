"use client";

/**
 * 곡의 영상만 바꾼다(강사님: 「현재 생성된 음원에 유튜브 영상만 교체 — 영상 소리는
 * 끄고 음원 시간과 비슷하게」).
 *
 * 소리는 곡의 음원 그대로, 그림은 붙인 유튜브 영상을 음소거로 음원 시각에 맞춰
 * 돌린다. 뮤직비디오는 같은 녹음이라도 앞에 장면이 몇 초 더 있다 — 서버가 영상의
 * 소리를 받아 곡의 음원과 견주어 몇 초 늦은지(와 조금 빠르거나 느린지) 찾는다.
 * 다른 녹음(라이브)이라 소리로 못 맞추면 손으로 ± 몇 초를 맞춘다.
 */

import { useState } from "react";
import { alignVideo } from "@/lib/api";
import type { AnalysisResult } from "@/lib/types";
import { youtubeIdOf } from "@/lib/videoLink";

interface Props {
  result: AnalysisResult;
  onSave: (v: { url: string | null; offset: number; scale: number }) => void;
  onClose: () => void;
}

const fmt = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(s).toFixed(1)}초`;

export function VideoSwap({ result, onSave, onClose }: Props) {
  const own = result.source === "youtube" ? result.id : null;
  const [url, setUrl] = useState(result.video_url ?? "");
  const [offset, setOffset] = useState(result.video_offset ?? 0);
  const [scale, setScale] = useState(result.video_scale || 1);
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
      setOffset(r.offset);
      setScale(r.scale || 1);
      const late =
        Math.abs(r.offset) < 0.05
          ? "영상과 음원이 같은 자리에서 시작합니다"
          : r.offset > 0
            ? `영상이 음원보다 ${r.offset.toFixed(1)}초 늦게 시작합니다(앞 장면)`
            : `영상이 음원보다 ${(-r.offset).toFixed(1)}초 먼저 시작합니다`;
      const speed =
        Math.abs((r.scale || 1) - 1) > 0.001
          ? ` · 영상이 ${Math.abs((r.scale - 1) * 100).toFixed(1)}% ${r.scale > 1 ? "빠릅니다" : "느립니다"}`
          : "";
      const part =
        r.share < 0.8
          ? ` · 곡의 ${Math.round(r.share * 100)}%만 영상과 맞습니다(편집된 영상) — 맞지 않는 곳에서는 영상이 기다리거나 어긋납니다`
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

  const step = (d: number) => setOffset((o) => Math.round((o + d) * 10) / 10);

  return (
    <div className="space-y-2.5 text-sm">
      <p className="text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
        소리는 이 곡의 음원 그대로, 화면만 붙인 유튜브 영상으로 바꿉니다. 영상 소리는
        꺼지고 음원 시각에 맞춰 따라갑니다.
      </p>
      <input
        className="w-full rounded border border-[var(--panel-line)] bg-[var(--panel)] px-2 py-1.5 text-sm"
        placeholder="유튜브 주소 (https://youtu.be/…)"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setNote(null);
          setBlocked(false);
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
          <button
            className="w-full rounded bg-[var(--chip)] py-2 text-[13px] font-semibold disabled:opacity-50"
            disabled={busy}
            onClick={() => void autoAlign()}
          >
            {busy ? "맞추는 중…" : "음원 시간에 자동 맞추기"}
          </button>
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
            onClick={() => onSave({ url: null, offset: 0, scale: 1 })}
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
          onClick={() => onSave({ url: url.trim(), offset, scale })}
        >
          저장
        </button>
      </div>
    </div>
  );
}
