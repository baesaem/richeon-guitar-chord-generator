"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { type YouTubePlayer } from "react-youtube";

import { apiBase } from "@/lib/api";
import { getLocalAudio } from "@/lib/library";
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
}

export function PlayerPane({ result, onReady, compact = false }: Props) {
  const ytRef = useRef<YouTubePlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);

  const publish = () => {
    onReady({
      getTime: () => {
        const yt = ytRef.current;
        if (yt?.getCurrentTime) {
          const t = yt.getCurrentTime();
          return typeof t === "number" ? t : 0;
        }
        return audioRef.current?.currentTime ?? 0;
      },
      seek: (t) => {
        if (ytRef.current?.seekTo) ytRef.current.seekTo(t, true);
        else if (audioRef.current) audioRef.current.currentTime = t;
      },
      play: () => {
        if (ytRef.current?.playVideo) ytRef.current.playVideo();
        else audioRef.current?.play();
      },
      pause: () => {
        if (ytRef.current?.pauseVideo) ytRef.current.pauseVideo();
        else audioRef.current?.pause();
      },
      isPlaying: () => playingRef.current,
      setRate: (rate) => {
        if (ytRef.current?.setPlaybackRate) ytRef.current.setPlaybackRate(rate);
        else if (audioRef.current) audioRef.current.playbackRate = rate;
      },
    });
  };

  // 업로드 곡: 공유받아 기기에 저장된 음원이 있으면 그것으로 재생한다.
  // 서버가 꺼져 있어도 소리가 나고, 있어도 네트워크를 안 탄다.
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  useEffect(() => {
    if (result.source === "youtube") return;

    let objectUrl: string | null = null;
    getLocalAudio(result.id)
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setAudioSrc(objectUrl);
        } else {
          setAudioSrc(`${apiBase()}/api/audio/${result.id}`);
        }
      })
      .catch(() => setAudioSrc(`${apiBase()}/api/audio/${result.id}`));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [result.id, result.source]);

  if (result.source === "youtube") {
    return (
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
          }}
        />
      </div>
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
