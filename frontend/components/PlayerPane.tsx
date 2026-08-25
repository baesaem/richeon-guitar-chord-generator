"use client";

import { useEffect, useRef } from "react";
import YouTube, { type YouTubePlayer } from "react-youtube";

import { apiBase } from "@/lib/api";
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
}

export function PlayerPane({ result, onReady }: Props) {
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

  useEffect(() => {
    if (result.source !== "youtube") return;
    // 업로드가 아닌 경우는 onReady에서 publish 한다
  }, [result.source]);

  if (result.source === "youtube") {
    return (
      <div className="aspect-video w-full bg-black">
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

  return (
    <audio
      ref={audioRef}
      className="w-full"
      src={`${apiBase()}/api/audio/${result.id}`}
      onLoadedMetadata={publish}
      onPlay={() => (playingRef.current = true)}
      onPause={() => (playingRef.current = false)}
    />
  );
}
