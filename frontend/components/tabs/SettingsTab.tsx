"use client";

import { useState } from "react";

import { Copyright } from "@/components/Copyright";
import { LlmSettingsCard } from "@/components/LlmSettingsCard";
import { Popup } from "@/components/Popup";
import {
  canPromptInstall,
  isInstalled,
  isIos,
  promptInstall,
} from "@/lib/installPrompt";
import { measureOutputLatency } from "@/lib/latency";
import { markAdminSession, type Notation, type Settings, type Theme } from "@/lib/settings";
import type { Health } from "@/lib/types";

// 관리자 모드를 켤 때 묻는 비밀번호. 수강생이 함부로 켜지 못하게 하는 잠금이며,
// 바꾸려면 이 값을 고치면 된다. (화면 잠금 수준의 보호이지 보안 장치는 아니다.)
const ADMIN_PIN = "noouk6118";

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

// swatch: 레이블 앞에 보여줄 그 테마의 주색(배경색) 견본
const THEMES: { value: Theme; label: string; swatch: string }[] = [
  { value: "system", label: "기기 설정", swatch: "linear-gradient(90deg,#ffffff 50%,#0a0a0a 50%)" },
  { value: "light", label: "밝게", swatch: "#ffffff" },
  { value: "dark", label: "어둡게", swatch: "#0a0a0a" },
  { value: "sepia", label: "세피아", swatch: "#f2e2bd" },
  { value: "aqua", label: "아쿠아", swatch: "#cfeef4" },
  { value: "royal", label: "로얄", swatch: "#e2d4f5" },
  { value: "naver", label: "네이버", swatch: "#d3f2df" },
];

const NOTATIONS: { value: Notation; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "sharp", label: "♯ 고정" },
  { value: "flat", label: "♭ 고정" },
];

export function SettingsTab({ settings, onChange, health }: Props) {
  const [measuring, setMeasuring] = useState(false);
  // 앱 설치. 설치 창을 못 띄우는 환경에서는 방법을 글로 안내한다
  const [installed] = useState(() => isInstalled());
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  const install = async () => {
    setInstallMsg(null);
    if (canPromptInstall()) {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        setInstallMsg("설치했습니다. 홈 화면에서 아이콘을 찾아보세요.");
      }
      return;
    }
    if (isIos()) {
      setInstallMsg(
        "아이폰·아이패드: Safari에서 공유 단추(□↑)를 누르고 「홈 화면에 추가」를 고르세요.",
      );
    } else if (installed) {
      setInstallMsg(
        "이미 설치된 앱으로 실행 중입니다. 다시 설치하려면 홈 화면의 아이콘을 지우고, 브라우저로 이 주소를 열어 다시 설치하세요.",
      );
    } else {
      setInstallMsg(
        "브라우저 메뉴(⋮)에서 「홈 화면에 추가」 또는 「앱 설치」를 고르세요. 크롬에서 열면 단추 한 번으로 설치됩니다.",
      );
    }
  };
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  // 관리자 모드 잠금: 켜려면 비밀번호를 맞혀야 한다. 끄는 것은 자유.
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  // 로그인 유지: 끄면 브라우저를 닫을 때 관리자 모드가 자동으로 풀린다
  const [keepLogin, setKeepLogin] = useState(true);

  const submitPin = () => {
    if (pin === ADMIN_PIN) {
      setPinOpen(false);
      setPin("");
      setPinError(false);
      markAdminSession();
      onChange({ ...settings, adminMode: true, adminKeep: keepLogin });
    } else {
      setPinError(true);
      setPin("");
    }
  };

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
      "flex-1 rounded py-1 text-xs",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "bg-gray-100 dark:bg-gray-800",
    ].join(" ");

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <h2 className="mb-3 text-lg font-bold">설정</h2>

      {/* 앱 설치 — 맨 위. 수강생이 처음 받는 안내가 "홈 화면에 앱을
          만드세요"라서, 찾기 쉬운 자리에 있어야 한다 */}
      <section className="mb-5">
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">앱 설치</span>
            {installed && (
              <span className="rounded bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                설치된 앱으로 실행 중
              </span>
            )}
          </div>
          <p className="mb-2 text-[11px] leading-snug text-gray-500">
            홈 화면에 앱으로 설치하면 브라우저 없이 아이콘으로 바로
            열립니다. 재설치는 홈 화면의 아이콘을 지운 뒤 여기서 다시
            설치하면 됩니다.
          </p>
          <button
            className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
            onClick={install}
          >
            {installed ? "다시 설치하기" : "홈 화면에 설치"}
          </button>
          {installMsg && (
            <p className="mt-1.5 rounded bg-gray-100 px-2 py-1.5 text-[11px] leading-snug text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {installMsg}
            </p>
          )}
        </div>
      </section>

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
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.adminMode}
            onChange={(e) => {
              // 켜기는 비밀번호를 통과해야 한다. 끄기는 바로 된다.
              if (e.target.checked) {
                setPin("");
                setPinError(false);
                setKeepLogin(settings.adminKeep);
                setPinOpen(true);
              } else {
                set("adminMode", false);
              }
            }}
          />
          <span>
            <span className="text-sm font-medium">관리자 모드</span>
            <span className="block text-[11px] text-gray-500">
              공유 폴더 관리(드라이브에서 열기·음원 내보내기)와 분석 서버
              설정·상태 메뉴가 보입니다. 켜려면 관리자 번호가 필요합니다.
            </span>
          </span>
        </label>
      </section>

      <section className="mb-5">
        <div className="mb-1.5 text-sm font-medium">테마</div>
        {/* 내용 폭만 차지하는 칩으로 한 줄에 최대한 많이 넣는다 */}
        <div className="flex flex-wrap gap-1.5">
          {THEMES.map((t) => (
            <button
              key={t.value}
              className={[
                "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                settings.theme === t.value
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-gray-100 dark:bg-gray-800",
              ].join(" ")}
              onClick={() => set("theme", t.value)}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/25 dark:ring-white/30"
                style={{ background: t.swatch }}
                aria-hidden="true"
              />
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
        <div className="mb-1.5 text-sm font-medium">기기 지연 보정</div>
        <p className="mb-2 text-[11px] leading-snug text-gray-500">
          소리는 화면보다 조금 늦게 납니다. 블루투스 이어폰·스피커는 특히
          늦습니다. 브라우저가 알려 주는 값을 그대로 쓰며, 모든 곡에
          적용됩니다. 인터넷 속도와는 관계가 없습니다.
        </p>
        <div className="flex items-center gap-1.5">
          <button
            className="rounded bg-gray-100 px-3 py-1.5 text-xs dark:bg-gray-800"
            onClick={() =>
              set("latency", Math.max(Math.round((settings.latency - 0.02) * 100) / 100, 0))
            }
          >
            −
          </button>
          <span className="w-16 text-center text-sm tabular-nums">
            {settings.latency.toFixed(2)}초
          </span>
          <button
            className="rounded bg-gray-100 px-3 py-1.5 text-xs dark:bg-gray-800"
            onClick={() =>
              set("latency", Math.min(Math.round((settings.latency + 0.02) * 100) / 100, 1))
            }
          >
            +
          </button>
          <button
            className="ml-auto rounded bg-gray-100 px-2.5 py-1.5 text-[11px] disabled:opacity-40 dark:bg-gray-800"
            disabled={measuring}
            onClick={async () => {
              setMeasuring(true);
              const sec = await measureOutputLatency();
              set("latency", sec);
              setMeasuring(false);
            }}
          >
            {measuring ? "재는 중…" : "다시 재기"}
          </button>
        </div>
        {settings.latency === 0 && (
          <p className="mt-1.5 text-[11px] leading-snug text-gray-400">
            이 브라우저는 값을 알려 주지 않습니다(사파리 등). 소리보다 화면이
            빠르게 느껴지면 +로 조금씩 올려 보세요.
          </p>
        )}
      </section>

      {/* 서버 관련 메뉴는 관리자만. 수강생은 서버 없이 공유 폴더로 곡을 받는다. */}
      {settings.adminMode && (
      <>
      <LlmSettingsCard online={!!health} />

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
      </>
      )}

      <Copyright />

      {pinOpen && (
        <Popup title="관리자 비밀번호" onClose={() => setPinOpen(false)}>
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoFocus
            className="w-full rounded border px-3 py-3 text-center text-lg tracking-widest"
            placeholder="비밀번호"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setPinError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPin();
            }}
          />
          {pinError && (
            <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
              비밀번호가 맞지 않습니다.
            </p>
          )}
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={keepLogin}
              onChange={(e) => setKeepLogin(e.target.checked)}
            />
            <span>
              <span className="text-sm">로그인 유지</span>
              <span className="block text-[11px] text-gray-500">
                끄면 브라우저를 닫을 때 관리자 모드가 자동으로 꺼집니다.
              </span>
            </span>
          </label>
          <button
            className="mt-3 w-full rounded bg-black py-3 text-white disabled:opacity-40 dark:bg-white dark:text-black"
            disabled={!pin}
            onClick={submitPin}
          >
            확인
          </button>
        </Popup>
      )}
    </div>
  );
}
