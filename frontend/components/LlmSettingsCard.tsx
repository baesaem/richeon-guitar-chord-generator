"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getLlmSettings,
  putLlmSettings,
  testLlmSettings,
  type LlmSettings,
} from "@/lib/api";
import {
  listLocalModels,
  localLlmKey,
  localLlmServerSnapshot,
  localLlmSnapshot,
  pickModel,
  saveLocalLlm,
  subscribeLocalLlm,
  testLocalLlm,
} from "@/lib/llmClient";

/**
 * 가사 도우미(AI) 설정.
 *
 * 하는 일은 하나다 — 영상 제목에서 가수·곡명을 가려내고 로마자 표기를
 * 만들어 가사를 더 잘 찾는 것. 코드 인식에는 쓰지 않는다(실제로 재 보니
 * 조성과 템포를 틀리게 답했다).
 *
 * 서버가 붙어 있으면 키를 서버에 저장한다(앞뒤만 남긴 형태로만 되돌아온다).
 * 서버가 없는 화면에서는 이 기기에만 저장하고 브라우저가 직접 부른다 —
 * 수강생 폰이나 외부 링크로 연 앱에서도 가사를 찾을 수 있게.
 */
export function LlmSettingsCard({ online }: { online: boolean }) {
  const [cfg, setCfg] = useState<LlmSettings | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!online) return;
    getLlmSettings()
      .then((c) => {
        setCfg(c);
        setModel(c.model);
        setBaseUrl(c.base_url);
      })
      .catch(() => {});
  }, [online]);

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

  /**
   * 연결을 확인하고 최신 모델로 맞춘다.
   *
   * 쓸 수 있는 모델을 서비스에 직접 물어 가장 새 것을 넣는다. 모델 이름을
   * 사용자가 외우거나 골라야 할 이유가 없다 — 새 모델이 나오면 연결 확인
   * 한 번으로 따라간다. 특정 모델을 쓰고 싶으면 아래 칸에 직접 적는다.
   */
  const test = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await testLlmSettings();
      if (!res.recommended) {
        setNotice({ ok: false, text: "쓸 수 있는 모델이 없습니다." });
        return;
      }
      if (res.recommended === cfg?.model) {
        setNotice({ ok: true, text: `${res.message} · 이미 최신입니다 (${cfg.model})` });
        return;
      }
      const next = await putLlmSettings({ model: res.recommended });
      setCfg(next);
      setModel(next.model);
      setNotice({ ok: true, text: `연결됨 · 최신 모델 ${next.model}로 맞췄습니다.` });
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

      {!online ? (
        <LocalKeyForm input={input} btn={btn} />
      ) : cfg?.configured ? (
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

      {online && (
      <>
      {/* 키가 이미 있으면 입력란을 두지 않는다. 바꿀 일이 있으면
          위의 「지우기」로 비우면 이 칸이 다시 나온다 */}
      {!cfg?.configured && (
        <div className="flex gap-1.5">
          <input
            className={input}
            type="password"
            placeholder="API 키 (sk-…)"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className={btn}
            disabled={busy || !key.trim()}
            onClick={async () => {
              await save({ api_key: key.trim() });
              // 키가 생겼으니 바로 물어보고 최신 모델로 맞춘다
              await test();
            }}
          >
            저장
          </button>
        </div>
      )}

      <div className="flex gap-1.5 [&:not(:first-child)]:mt-1.5">
        <input
          className={input}
          placeholder="모델 (연결 확인하면 자동으로 채워집니다)"
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
      <p className="mt-1 text-[10px] leading-snug text-gray-400">
        연결 확인을 누르면 쓸 수 있는 모델을 물어 가장 새 것으로 맞춥니다.
      </p>

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

      </>
      )}

      {online && (
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
      )}
    </section>
  );
}

/**
 * 서버 없이 쓰는 키 입력.
 *
 * 여기 넣은 키는 이 기기의 브라우저에만 남고 어디로도 보내지 않는다
 * (가사를 찾을 때 OpenAI로 직접 갈 뿐이다). 공용 기기에는 넣지 않는 게 낫다.
 */
function LocalKeyForm({ input, btn }: { input: string; btn: string }) {
  const stored = useSyncExternalStore(
    subscribeLocalLlm,
    localLlmSnapshot,
    localLlmServerSnapshot,
  );
  const saved = stored.key;

  // 입력 중인 모델 이름. 비어 있으면 저장된 값을 보여준다
  const [draftModel, setDraftModel] = useState("");
  const model = draftModel || stored.model;
  const setModel = setDraftModel;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const store = (nextKey: string, nextModel?: string) => {
    saveLocalLlm(nextKey, nextModel);
    setKey("");
    setNotice({ ok: true, text: nextKey ? "이 기기에 저장했습니다." : "지웠습니다." });
  };

  /**
   * 연결을 확인하고 최신 모델로 맞춘다.
   *
   * 쓸 수 있는 모델을 서비스에 직접 물어 가장 새 것을 넣는다. 모델 이름을
   * 고르게 하지 않는다 — 새 모델이 나오면 연결 확인 한 번으로 따라간다.
   */
  const test = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const found = await listLocalModels();
      if (!found.length) throw new Error("쓸 수 있는 모델이 없습니다");
      const best = pickModel(found);
      if (best !== stored.model) {
        saveLocalLlm(localLlmKey(), best);
        setDraftModel("");
      }
      // 목록만 보고 끝내지 않는다. 실제로 한 번 물어봐야 되는지 안다
      const res = await testLocalLlm();
      setNotice({
        ok: res.ok,
        text: res.ok ? `연결됨 · 최신 모델 ${best}` : res.message,
      });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {saved ? (
        <div className="mb-2 flex items-center gap-2 rounded bg-green-50 px-2 py-1.5 text-[11px] text-green-800">
          <span>이 기기에 저장됨 · {saved.slice(0, 6)}…{saved.slice(-4)}</span>
          <button className="ml-auto underline" onClick={() => store("")}>
            지우기
          </button>
        </div>
      ) : (
        <p className="mb-2 rounded bg-gray-50 px-2 py-1.5 text-[11px] leading-snug text-gray-500 dark:bg-gray-800">
          키를 넣으면 이 기기에만 저장되고, 가사를 찾을 때만 씁니다. 넣지
          않아도 가사 찾기는 동작합니다 — 한국 가요를 덜 찾을 뿐입니다.
        </p>
      )}

      {/* 키가 있으면 입력란을 감춘다. 「지우기」로 비우면 다시 나온다 */}
      {!saved && (
        <div className="flex gap-1.5">
          <input
            className={input}
            type="password"
            placeholder="API 키 (sk-…)"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            className={btn}
            disabled={busy || !key.trim()}
            onClick={async () => {
              store(key.trim());
              await test();
            }}
          >
            저장
          </button>
        </div>
      )}

      <div className="flex gap-1.5 [&:not(:first-child)]:mt-1.5">
        <input
          className={input}
          placeholder="모델 (연결 확인하면 자동으로 채워집니다)"
          autoComplete="off"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <button
          className={btn}
          disabled={!model.trim()}
          onClick={() => {
            saveLocalLlm(localLlmKey(), model.trim());
            setNotice({ ok: true, text: "모델을 바꿨습니다." });
          }}
        >
          적용
        </button>
        <button className={btn} disabled={busy || !saved} onClick={test}>
          연결 확인
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-gray-400">
        연결 확인을 누르면 쓸 수 있는 모델을 물어 가장 새 것으로 맞춥니다.
      </p>

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

      <p className="mt-1.5 text-[10px] leading-snug text-gray-400">
        키는 이 브라우저에만 남습니다. 여럿이 쓰는 기기라면 넣지 마세요.
      </p>
    </div>
  );
}
