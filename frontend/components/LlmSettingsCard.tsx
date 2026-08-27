"use client";

import { useEffect, useState } from "react";

import {
  getLlmSettings,
  putLlmSettings,
  testLlmSettings,
  type LlmSettings,
} from "@/lib/api";

/** 손으로 고르기 좋은 후보. 목록에 없는 모델도 직접 적을 수 있다. */
const SUGGESTED = ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4", "gpt-5.5"];

/**
 * 가사 도우미(AI) 설정.
 *
 * 하는 일은 하나다 — 영상 제목에서 가수·곡명을 가려내고 로마자 표기를
 * 만들어 가사를 더 잘 찾는 것. 코드 인식에는 쓰지 않는다(실제로 재 보니
 * 조성과 템포를 틀리게 답했다).
 *
 * 키는 서버에만 저장되고, 화면에는 앞뒤만 남긴 형태로만 돌아온다.
 */
export function LlmSettingsCard() {
  const [cfg, setCfg] = useState<LlmSettings | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    getLlmSettings()
      .then((c) => {
        setCfg(c);
        setModel(c.model);
        setBaseUrl(c.base_url);
      })
      .catch(() => {});
  }, []);

  const save = async (patch: { api_key?: string; base_url?: string; model?: string }) => {
    setBusy(true);
    setNotice(null);
    try {
      const next = await putLlmSettings(patch);
      setCfg(next);
      setModel(next.model);
      setBaseUrl(next.base_url);
      setKey("");
      setNotice({ ok: true, text: "저장했습니다." });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await testLlmSettings();
      setModels(res.models);
      setNotice({ ok: res.model_available, text: res.message });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded border px-3 py-2 text-xs";
  const btn =
    "shrink-0 whitespace-nowrap rounded bg-gray-100 px-3 py-1.5 text-xs " +
    "disabled:opacity-40 dark:bg-gray-800";

  return (
    <section className="mb-5">
      <div className="mb-1.5 text-sm font-medium">가사 도우미 (AI)</div>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        영상 제목에서 가수·곡명을 가려내 가사를 더 잘 찾습니다. 한국 가요가
        가사 목록에 영문으로 올라 있어 한글로는 안 찾히는 경우를 메웁니다.
        코드 인식에는 쓰지 않습니다.
      </p>

      {cfg?.configured ? (
        <div className="mb-2 flex items-center gap-2 rounded bg-green-50 px-2 py-1.5 text-[11px] text-green-800">
          <span>키 저장됨 · {cfg.masked_key}</span>
          <button
            className="ml-auto underline disabled:opacity-40"
            disabled={busy}
            onClick={() => save({ api_key: "" })}
          >
            지우기
          </button>
        </div>
      ) : (
        <p className="mb-2 rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-500 dark:bg-gray-800">
          키가 없어 이 기능은 꺼져 있습니다. 나머지 기능은 그대로 동작합니다.
        </p>
      )}

      <div className="flex gap-1.5">
        <input
          className={input}
          type="password"
          placeholder={cfg?.configured ? "새 키로 바꾸려면 입력" : "API 키 (sk-…)"}
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          className={btn}
          disabled={busy || !key.trim()}
          onClick={() => save({ api_key: key.trim() })}
        >
          저장
        </button>
      </div>

      <div className="mt-1.5 flex gap-1.5">
        <input
          className={input}
          placeholder="모델 (예: gpt-5.4-mini)"
          autoComplete="off"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <button
          className={btn}
          disabled={busy || !model.trim() || model === cfg?.model}
          onClick={() => save({ model: model.trim() })}
        >
          적용
        </button>
        <button className={btn} disabled={busy || !cfg?.configured} onClick={test}>
          연결 확인
        </button>
      </div>

      {/* 연결 확인에서 받아 온 목록. 눌러서 바로 고른다 */}
      {models.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {models.slice(0, 12).map((m) => (
            <button
              key={m}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-800"
              onClick={() => save({ model: m })}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {models.length === 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {SUGGESTED.map((m) => (
            <button
              key={m}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800"
              onClick={() => setModel(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p
          className={[
            "mt-1.5 rounded p-2 text-[11px]",
            notice.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700",
          ].join(" ")}
        >
          {notice.text}
        </p>
      )}

      <details className="mt-1.5">
        <summary className="cursor-pointer text-[11px] text-gray-500">
          다른 서비스 쓰기 (OpenAI 호환 주소)
        </summary>
        <div className="mt-1.5 flex gap-1.5">
          <input
            className={input}
            placeholder="https://api.openai.com/v1"
            autoComplete="off"
            spellCheck={false}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <button
            className={btn}
            disabled={busy || !baseUrl.trim() || baseUrl === cfg?.base_url}
            onClick={() => save({ base_url: baseUrl.trim() })}
          >
            적용
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-gray-400">
          OpenAI 호환 API면 무엇이든 됩니다. 내 PC에서 돌리는 모델도 주소만
          바꾸면 쓸 수 있습니다.
        </p>
      </details>
    </section>
  );
}
