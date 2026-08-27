"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { type YouTubePlayer } from "react-youtube";

import { apiBase } from "@/lib/api";
import { getLocalAudio } from "@/lib/library";
import { stemKey, type StemChoice } from "@/lib/sharedFiles";
import type { AnalysisResult } from "@/lib/types";

/** 재생 제어. YouTube든 업로드 오디오든 화면 쪽은 이 인터페이스만 안다. */
export interface Playback {
  getTime(): number;
  seek(t: number): void;
  play(): void;
  pause(): void;
  isPlaying(): boolean;
  setRate(rate: number): void;
}

interface Props {
  result: AnalysisResult;
  onReady: (playback: Playback) => void;
  /**
   * 영상을 접어 코드 표시에 자리를 넘긴다.
   *
   * 감추지 않고 잘라서 보여준다. iframe이 화면에서 완전히 사라지면
   * YouTube가 재생을 멈출 수 있어 크기만 줄인다.
   */
  compact?: boolean;
  /** 보컬을 뺀 반주로 듣는다 */
  /** 어떤 트랙을 들을지. off=전체(원곡), inst=반주만, vocals=보컬만 */
  stem?: StemChoice;
}

/** 영상 소리와 반주가 이만큼 벌어지면 맞춘다(초). */
const SYNC_TOLERANCE = 0.3;

export function PlayerPane({ result, onReady, compact = false, stem = "off" }: Props) {
  const ytRef = useRef<YouTubePlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // YouTube 곡에서 영상 대신 소리를 내는 반주 트랙
  const instRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const rateRef = useRef(1);

  const isYouTube = result.source === "youtube";
  // 반주. 기기에 받아 둔 것이 있으면 그것을, 없으면 서버 것을 쓴다.
  // 공유 폴더에서 곡을 받은 수강생은 서버 없이도 보컬을 끌 수 있다.
  const [localInst, setLocalInst] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    if (stem === "off") return;
    getLocalAudio(stemKey(result.id, stem))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setLocalInst(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setLocalInst(null);
    };
  }, [result.id, stem]);
  const instUrl =
    localInst ??
    `${apiBase()}/api/audio/${result.id}/${stem === "vocals" ? "vocals" : "instrumental"}`;
  // 영상과 반주를 함께 몰아야 하는 상태
  const dual = isYouTube && stem !== "off";

  // 마지막으로 YouTube가 알려 준 시각과 그때의 시계. 사이를 이어 붙인다
  const tickRef = useRef({ at: -1, wall: 0 });

  const publish = () => {
    onReady({
      /**
       * 지금 재생 위치.
       *
       * YouTube의 getCurrentTime은 계단식으로 움직인다 — 초당 몇 번만
       * 갱신되어 그 사이에는 같은 값을 준다. 그대로 쓰면 코드가 최대
       * 4분의 1초쯤 늦게 넘어간다.
       *
       * 값이 그대로면 시계로 이어 붙인다. 새 값이 오면 거기에 맞춘다 —
       * 어긋나 봐야 갱신 간격만큼이고, 다음 갱신에 바로잡힌다.
       */
      getTime: () => {
        const yt = ytRef.current;
        if (yt?.getCurrentTime) {
          const raw = yt.getCurrentTime();
          if (typeof raw !== "number") return 0;

          const now = performance.now();
          if (raw !== tickRef.current.at) {
            tickRef.current = { at: raw, wall: now };
            return raw;
          }
          if (!playingRef.current) return raw;
          const rate = yt.getPlaybackRate?.() ?? 1;
          return raw + ((now - tickRef.current.wall) / 1000) * rate;
        }
        return audioRef.current?.currentTime ?? 0;
      },
      seek: (t) => {
        if (ytRef.current?.seekTo) ytRef.current.seekTo(t, true);
        else if (audioRef.current) audioRef.current.currentTime = t;
        if (instRef.current) instRef.current.currentTime = t;
      },
      play: () => {
        if (ytRef.current?.playVideo) ytRef.current.playVideo();
        else audioRef.current?.play();
        instRef.current?.play().catch(() => {});
      },
      pause: () => {
        if (ytRef.current?.pauseVideo) ytRef.current.pauseVideo();
        else audioRef.current?.pause();
        instRef.current?.pause();
      },
      isPlaying: () => playingRef.current,
      setRate: (rate) => {
        rateRef.current = rate;
        if (ytRef.current?.setPlaybackRate) ytRef.current.setPlaybackRate(rate);
        else if (audioRef.current) audioRef.current.playbackRate = rate;
        if (instRef.current) instRef.current.playbackRate = rate;
      },
    });
  };

  // 업로드 곡: 공유받아 기기에 저장된 음원이 있으면 그것으로 재생한다.
  // 서버가 꺼져 있어도 소리가 나고, 있어도 네트워크를 안 탄다.
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  useEffect(() => {
    if (isYouTube) return;

    let objectUrl: string | null = null;
    getLocalAudio(result.id)
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setLocalSrc(objectUrl);
        } else {
          setLocalSrc(`${apiBase()}/api/audio/${result.id}`);
        }
      })
      .catch(() => setLocalSrc(`${apiBase()}/api/audio/${result.id}`));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [result.id, isYouTube]);

  // 트랙을 골랐으면 그 트랙을 쓴다(기기에 받아 둔 것 → 서버 순)
  const audioSrc = stem !== "off" ? instUrl : localSrc;

  // 영상 소리와 반주를 맞춘다. 영상은 화면만 쓰고 소리는 반주가 낸다.
  useEffect(() => {
    const yt = ytRef.current;
    if (!isYouTube || !yt) return;

    if (!dual) {
      yt.unMute?.();
      return;
    }

    yt.mute?.();
    const inst = instRef.current;
    if (!inst) return;

    inst.playbackRate = rateRef.current;
    const now = yt.getCurrentTime?.();
    if (typeof now === "number") inst.currentTime = now;
    if (playingRef.current) inst.play().catch(() => {});

    // 두 재생기는 서로 조금씩 밀린다. 주기적으로 영상 시각에 반주를 맞춘다.
    const timer = setInterval(() => {
      const t = yt.getCurrentTime?.();
      if (typeof t !== "number") return;
      if (Math.abs(inst.currentTime - t) > SYNC_TOLERANCE) inst.currentTime = t;
      if (playingRef.current && inst.paused) inst.play().catch(() => {});
      if (!playingRef.current && !inst.paused) inst.pause();
    }, 500);

    return () => {
      clearInterval(timer);
      inst.pause();
      yt.unMute?.();
    };
  }, [dual, isYouTube]);

  if (isYouTube) {
    return (
      <>
        <div
          className={[
            "w-full shrink-0 overflow-hidden bg-black",
            compact ? "h-14" : "aspect-video",
          ].join(" ")}
        >
          <YouTube
            videoId={result.id}
            className="h-full w-full"
            iframeClassName="h-full w-full"
            opts={{ playerVars: { playsinline: 1, rel: 0 } }}
            onReady={(e) => {
              ytRef.current = e.target;
              publish();
            }}
            onStateChange={(e) => {
              playingRef.current = e.data === 1;
              const inst = instRef.current;
              if (!inst) return;
              if (e.data === 1) inst.play().catch(() => {});
              else inst.pause();
            }}
          />
        </div>
        {dual && <audio ref={instRef} src={instUrl} preload="auto" />}
      </>
    );
  }

  if (!audioSrc) return null;
  return (
    <audio
      ref={audioRef}
      className="w-full"
      src={audioSrc}
      onLoadedMetadata={publish}
      onPlay={() => (playingRef.current = true)}
      onPause={() => (playingRef.current = false)}
    />
  );
}
