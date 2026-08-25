"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { type YouTubePlayer } from "react-youtube";

import { apiBase } from "@/lib/api";
import type { AnalysisResult } from "@/lib/types";

interface Props {
  result: AnalysisResult;
  onTime: (t: number) => void;
}

/**
 * 재생 영역.
 *
 * YouTube 결과는 IFrame 플레이어로 재생한다(오디오를 우리가 스트리밍하지 않는다).
 * 업로드 결과는 백엔드가 원본을 그대로 내보내므로 <audio>로 재생한다.
 */
export function PlayerPane({ result, onTime }: Props) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ready, setReady] = useState(false);

  // 콜백이 매 렌더 바뀌어도 rAF 루프를 다시 시작하지 않도록 ref에 담아 둔다.
  const onTimeRef = useRef(onTime);
  useEffect(() => {
    onTimeRef.current = onTime;
  }, [onTime]);

  useEffect(() => {
    if (!ready) return;

    let raf = 0;
    const loop = () => {
      const yt = playerRef.current;
      const audio = audioRef.current;
      if (yt?.getCurrentTime) {
        const t = yt.getCurrentTime();
        if (typeof t === "number") onTimeRef.current(t);
      } else if (audio) {
        onTimeRef.current(audio.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  if (result.source === "youtube") {
    return (
      <div className="aspect-video w-full bg-black">
        <YouTube
          videoId={result.id}
          className="h-full w-full"
          iframeClassName="h-full w-full"
          opts={{ playerVars: { playsinline: 1, rel: 0 } }}
          onReady={(e) => {
            playerRef.current = e.target;
            setReady(true);
          }}
        />
      </div>
    );
  }

  return (
    <audio
      ref={audioRef}
      controls
      className="w-full"
      src={`${apiBase()}/api/audio/${result.id}`}
      onLoadedMetadata={() => setReady(true)}
    />
  );
}
