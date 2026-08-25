"use client";

import { useState } from "react";

import { Copyright } from "@/components/Copyright";
import type { Notation, Settings, Theme } from "@/lib/settings";
import type { Health } from "@/lib/types";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  health: Health | null;
}

const ZOOMS = [
  { value: 60, label: "넓게" },
  { value: 90, label: "보통" },
  { value: 140, label: "좁게" },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "기기 설정" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
  { value: "sepia", label: "세피아" },
  { value: "aqua", label: "아쿠아" },
];

const NOTATIONS: { value: Notation; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "sharp", label: "♯ 고정" },
  { value: "flat", label: "♭ 고정" },
];

export function SettingsTab({ settings, onChange, health }: Props) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setTestResult(null);
    onChange({ ...settings, [key]: value });
  };

  // https 페이지에서 http 서버를 부르면 브라우저가 막는다. 미리 알려준다.
  const mixedContent =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    settings.apiBase.trim().startsWith("http://");

  const test = async () => {
    const base = settings.apiBase.trim().replace(/\/+$/, "");
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Health;
      setTestResult({
        ok: true,
        message: `연결됨 · ${body.device} · ${body.pipeline_version}`,
      });
    } catch (e) {
      setTestResult({ ok: false, message: `연결 실패: ${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  };

  const pill = (active: boolean) =>
    [
      "flex-1 rounded py-2 text-sm",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "bg-gray-100 dark:bg-gray-800",
    ].join(" ");

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <h2 className="mb-3 text-lg font-bold">설정</h2>

      <section className="mb-5">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.separate}
            onChange={(e) => set("separate", e.target.checked)}
          />
          <span>
            <span className="text-sm font-medium">음원 분리 사용</span>
            <span className="block text-[11px] text-gray-500">
              보컬·드럼을 걷어내면 코드 인식이 정확해지지만 분석이 느려집니다.
            </span>
          </span>
        </label>
      </section>

      <section className="mb-5">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.autoSave}
            onChange={(e) => set("autoSave", e.target.checked)}
          />
          <span>
            <span className="text-sm font-medium">분석 결과를 기기에 자동 저장</span>
            <span className="block text-[11px] text-gray-500">
              분석이 끝나면 이 기기(브라우저)에도 저장해, 서버(PC)가 꺼져 있어도
              재생목록에서 열 수 있게 합니다.
            </span>
          </span>
        </label>
      </section>

      <section className="mb-5">
        <div className="mb-1.5 text-sm font-medium">테마</div>
        <div className="grid grid-cols-3 gap-1.5">
          {THEMES.map((t) => (
            <button
              key={t.value}
              className={pill(settings.theme === t.value)}
              onClick={() => set("theme", t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          기기 설정은 휴대폰의 밝게/어둡게 모드를 그대로 따라갑니다.
        </p>
      </section>

      <section className="mb-5">
        <div className="mb-1.5 text-sm font-medium">파형 확대</div>
        <div className="flex gap-1.5">
          {ZOOMS.map((z) => (
            <button
              key={z.value}
              className={pill(settings.pixelsPerSecond === z.value)}
              onClick={() => set("pixelsPerSecond", z.value)}
            >
              {z.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          한 화면에 보이는 시간 폭을 정합니다. 빠른 곡은 넓게 두면 읽기 편합니다.
        </p>
      </section>

      <section className="mb-5">
        <div className="mb-1.5 text-sm font-medium">코드 표기</div>
        <div className="flex gap-1.5">
          {NOTATIONS.map((n) => (
            <button
              key={n.value}
              className={pill(settings.notation === n.value)}
              onClick={() => set("notation", n.value)}
            >
              {n.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          자동은 조표를 보고 정합니다. Ab장조면 G#이 아니라 Ab으로 적습니다.
        </p>
      </section>

      <section className="mb-5">
        <div className="mb-1.5 text-sm font-medium">분석 서버 주소</div>
        <input
          className="w-full rounded border px-3 py-2.5 text-sm"
          placeholder="예: http://192.168.1.199:8000"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={settings.apiBase}
          onChange={(e) => set("apiBase", e.target.value)}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            className="rounded bg-black px-3 py-2 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={testing}
            onClick={test}
          >
            연결 테스트
          </button>
          {settings.apiBase && (
            <button
              className="px-2 py-2 text-xs text-gray-500"
              onClick={() => set("apiBase", "")}
            >
              비우기
            </button>
          )}
          {testResult && (
            <span
              className={[
                "min-w-0 flex-1 truncate text-xs",
                testResult.ok ? "text-green-700" : "text-red-700",
              ].join(" ")}
            >
              {testResult.message}
            </span>
          )}
        </div>

        {mixedContent && (
          <p className="mt-1.5 rounded bg-amber-50 p-2 text-[11px] leading-snug text-amber-800">
            이 페이지는 https인데 서버 주소가 http입니다. 브라우저가 이런 요청을 막습니다.
            서버도 https로 열거나, 집 안에서 http 주소로 접속해 주세요.
          </p>
        )}

        <p className="mt-1 text-[11px] leading-snug text-gray-500">
          비워 두면 이 페이지와 같은 주소의 서버를 씁니다(집 안에서 쓰는 방식).
          외부에 올린 화면에서 집 서버를 쓰려면 여기에 서버 주소를 넣으세요.
        </p>
      </section>

      <section className="mb-5">
        <div className="mb-1.5 text-sm font-medium">서버 상태</div>
        <dl className="rounded border border-gray-200 text-xs dark:border-gray-800">
          {[
            ["연결", health ? "정상" : "연결 안 됨"],
            ["연산 장치", health?.device ?? "-"],
            ["ffmpeg", health ? (health.ffmpeg ? "있음" : "없음") : "-"],
            ["YouTube 입력", health ? (health.youtube_enabled ? "허용" : "차단") : "-"],
            ["파이프라인", health?.pipeline_version ?? "-"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between border-b border-gray-100 px-3 py-2 last:border-0 dark:border-gray-800"
            >
              <dt className="text-gray-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 text-[11px] text-gray-500">
          연산 장치가 cpu로 나오면 음원 분리와 코드 모델이 느립니다.
        </p>
      </section>

      <Copyright />
    </div>
  );
}
