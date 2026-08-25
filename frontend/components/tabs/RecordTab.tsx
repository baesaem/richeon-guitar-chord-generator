"use client";

import { useEffect, useRef, useState } from "react";

import { Copyright } from "@/components/Copyright";
import { useClientValue } from "@/lib/browser";

interface Props {
  /** 녹음이 끝나면 파일로 넘겨 분석을 시작한다 */
  onRecorded: (file: File) => void;
  busy: boolean;
}

/** 마이크가 쓸 수 있는 상태인지. HTTPS 또는 localhost가 아니면 브라우저가 막는다. */
function micAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

/**
 * 마이크 녹음 탭.
 *
 * 스피커로 튼 곡이나 직접 친 연주를 녹음해 그대로 분석에 넘긴다.
 * 녹음물은 업로드 경로를 그대로 타므로 분석 파이프라인은 손댈 필요가 없다.
 */
export function RecordTab({ onRecorded, busy }: Props) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // 서버 렌더에서는 쓸 수 있다고 보고, 클라이언트에서 실제 값으로 맞춘다.
  const available = useClientValue(micAvailable, true);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // 탭을 벗어나거나 화면이 사라져도 마이크를 잡고 있지 않도록 정리한다
  useEffect(() => {
    return () => {
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // 음악을 잡아야 하므로 음성용 보정을 끈다
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) {
          onRecorded(new File([blob], `녹음-${Date.now()}.webm`, { type: "audio/webm" }));
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
    } catch (e) {
      setError(
        `마이크를 열 수 없습니다: ${(e as Error).message}. 브라우저 권한을 확인해 주세요.`,
      );
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3">
      <h2 className="mb-1 text-lg font-bold">마이크로 녹음</h2>
      <p className="text-xs text-gray-500">
        스피커로 튼 곡이나 직접 친 연주를 녹음해 코드를 뽑습니다.
      </p>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8">
        {!available ? (
          <p className="max-w-xs text-center text-sm text-amber-700">
            이 주소에서는 마이크를 쓸 수 없습니다. 브라우저가 HTTPS 또는 localhost에서만
            마이크를 허용합니다.
          </p>
        ) : (
          <>
            <div className="text-4xl font-bold tabular-nums">
              {mm}:{ss}
            </div>

            <button
              onClick={recording ? stop : start}
              disabled={busy}
              className={[
                "flex h-24 w-24 items-center justify-center rounded-full text-white disabled:opacity-40",
                recording ? "bg-gray-600" : "bg-red-600",
              ].join(" ")}
            >
              {recording ? (
                <span className="block h-8 w-8 rounded bg-white" />
              ) : (
                <span className="block h-9 w-9 rounded-full border-4 border-white" />
              )}
            </button>

            <p className="text-sm text-gray-500">
              {busy
                ? "분석 중…"
                : recording
                  ? "녹음 중입니다. 다시 누르면 멈추고 분석합니다."
                  : "누르면 녹음이 시작됩니다."}
            </p>
            <p className="max-w-xs text-center text-[11px] text-gray-400">
              코드 인식은 30초 이상 녹음해야 비트와 조성이 안정적으로 잡힙니다.
            </p>
          </>
        )}

        {error && (
          <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}
      </div>

      <Copyright />
    </div>
  );
}
