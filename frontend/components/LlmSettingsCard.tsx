"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { AskConfirm } from "@/components/Ask";

import {
  getLlmSettings,
  putLlmSettings,
  testLlmSettings,
  type LlmSettings,
} from "@/lib/api";
import {
  PROVIDERS,
  listLocalModels,
  localLlmKey,
  localLlmServerSnapshot,
  localLlmSnapshot,
  callableFromBrowser,
  pickModel,
  providerOf,
  saveLocalLlm,
  subscribeLocalLlm,
  testLocalLlm,
} from "@/lib/llmClient";

/** 서비스마다 키 모양이 달라 안내를 맞춰 준다 */
function keyHint(base: string): string {
  return providerOf(base) === "gemini"
    ? "제미나이 API 키 (AIza…)"
    : "API 키 (sk-…)";
}

/**
 * 어느 서비스를 쓸지 고르는 줄.
 *
 * 제미나이도 OpenAI 호환 주소를 열어 둬서 주소만 바꾸면 같은 코드로
 * 부를 수 있다. 서비스를 바꾸면 키도 모델도 그 서비스 것이라야 한다.
 */
function ProviderPicker({
  base,
  disabled,
  onPick,
}: {
  base: string;
  disabled: boolean;
  onPick: (base: string) => void;
}) {
  const current = providerOf(base);

  return (
    <div className="mb-2 flex gap-1">
      {PROVIDERS.map((p) => (
        <button
          key={p.id}
          disabled={disabled}
          className={[
            "flex-1 rounded py-1.5 text-[11px] disabled:opacity-40",
            current === p.id
              ? "bg-[var(--accent)] text-white"
              : "bg-[var(--panel)] text-[var(--foreground)]",
          ].join(" ")}
          onClick={() => onPick(p.base)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

/**
 * 모델 고르는 칸.
 *
 * 목록을 받아 왔으면 그중에서 고르게 한다. 아직 못 받아 왔으면 지금 값을
 * 보여만 준다 — 빈 칸에 이름을 외워 적게 하지 않는다.
 */
function ModelPicker({
  value,
  models,
  disabled,
  onPick,
}: {
  value: string;
  models: string[];
  disabled: boolean;
  onPick: (model: string) => void;
}) {
  // 지금 쓰는 모델이 목록에 없을 수도 있다(옛 이름을 저장해 둔 경우).
  // 그래도 칸에는 보여야 하므로 앞에 끼워 넣는다.
  const options = models.includes(value) || !value ? models : [value, ...models];

  if (options.length === 0) {
    return (
      <div className="w-full rounded border px-3 py-2 text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
        {value || "연결 확인을 누르면 채워집니다"}
      </div>
    );
  }

  return (
    <select
      className="w-full rounded border px-2 py-2 text-xs"
      value={value}
      disabled={disabled}
      onChange={(e) => onPick(e.target.value)}
    >
      {options.map((m, i) => (
        <option key={m} value={m}>
          {m}
          {i === 0 && models[0] === m ? " (최신)" : ""}
        </option>
      ))}
    </select>
  );
}

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
  const [models, setModels] = useState<string[]>([]);
  // 시스템 confirm()을 쓰지 않는다. 폰 웹앱에서 막히는 환경이 있다
  const [switchTo, setSwitchTo] = useState("");

  useEffect(() => {
    if (!online) return;
    let alive = true;
    getLlmSettings()
      .then(async (c) => {
        if (!alive) return;
        setCfg(c);
        setModel(c.model);
        setBaseUrl(c.base_url);
        // 키가 있으면 고를 목록을 미리 채워 둔다. 모델을 바꾸지는 않는다
        if (!c.configured) return;
        const probe = await testLlmSettings().catch(() => null);
        if (alive && probe) setModels(probe.models);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
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
      setModels(res.models);
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
    "shrink-0 whitespace-nowrap rounded bg-[var(--panel)] px-3 py-1.5 text-xs " +
    "disabled:opacity-40";

  return (
    <section className="mb-5">
      <div className="mb-1.5 text-sm font-medium">가사 도우미 (AI)</div>
      <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
        영상 제목에서 가수·곡명을 가려내 가사를 더 잘 찾습니다. 한국 가요가
        가사 목록에 영문으로 올라 있어 한글로는 안 찾히는 경우를 메웁니다.
        코드 인식에는 쓰지 않습니다.
      </p>

      {online && cfg && (
        <ProviderPicker
          base={cfg.base_url}
          disabled={busy}
          onPick={async (next) => {
            // 서비스가 바뀌면 이전 키·모델은 못 쓴다. 같이 비운다.
            // 키를 지우는 일이니 저장된 게 있으면 먼저 물어본다
            if (cfg.configured) {
              setSwitchTo(next);
              return;
            }
            setModels([]);
            await save({ base_url: next, api_key: "", model: "" });
          }}
        />
      )}

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
        <p className="mb-2 rounded bg-[var(--panel)] px-2 py-1.5 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
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
            placeholder={keyHint(cfg?.base_url ?? "")}
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
        <ModelPicker
          value={model}
          models={models}
          disabled={busy}
          onPick={(m) => save({ model: m })}
        />
        <button className={btn} disabled={busy || !cfg?.configured} onClick={test}>
          연결 확인
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
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

      {switchTo && (
        <AskConfirm
          title="서비스 바꾸기"
          message="저장된 키가 지워집니다. 새 서비스의 키를 다시 넣어야 합니다."
          confirmLabel="바꾸기"
          danger
          onConfirm={async () => {
            setModels([]);
            await save({ base_url: switchTo, api_key: "", model: "" });
          }}
          onClose={() => setSwitchTo("")}
        />
      )}

      {online && (
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          주소 직접 넣기 (OpenAI 호환)
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
        <p className="mt-1 text-[10px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          위 두 서비스 말고도 OpenAI 호환 API면 무엇이든 됩니다. 내 PC에서
          돌리는 모델도 주소만 바꾸면 쓸 수 있습니다.
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

  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [switchTo, setSwitchTo] = useState("");

  // 키가 있으면 고를 목록을 미리 채워 둔다. 모델을 바꾸지는 않는다
  useEffect(() => {
    if (!stored.key) return;
    let alive = true;
    listLocalModels()
      .then((found) => {
        if (alive) setModels(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stored.key, stored.base]);
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
      setModels(found);
      if (!found.length) throw new Error("쓸 수 있는 모델이 없습니다");
      const best = pickModel(found);
      if (best !== stored.model) saveLocalLlm(localLlmKey(), best);
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
      <ProviderPicker
        base={stored.base}
        disabled={busy}
        onPick={(next) => {
          // 서비스가 바뀌면 이전 키·모델은 못 쓴다. 같이 비운다.
          // 키를 지우는 일이니 저장된 게 있으면 먼저 물어본다
          if (saved) {
            setSwitchTo(next);
            return;
          }
          setModels([]);
          saveLocalLlm("", "", next);
          setNotice(null);
        }}
      />

      {!callableFromBrowser(stored.base) && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
          OpenAI는 브라우저에서 직접 부를 수 없게 막아 두었습니다(제공사
          정책). 서버 없이 쓰려면 <b>구글 제미나이</b>를 고르세요. 집 서버에
          연결해서 쓸 때는 OpenAI도 그대로 됩니다.
        </p>
      )}

      {saved ? (
        <div className="mb-2 flex items-center gap-2 rounded bg-green-50 px-2 py-1.5 text-[11px] text-green-800">
          <span>이 기기에 저장됨 · {saved.slice(0, 6)}…{saved.slice(-4)}</span>
          <button className="ml-auto underline" onClick={() => store("")}>
            지우기
          </button>
        </div>
      ) : (
        <p className="mb-2 rounded bg-[var(--panel)] px-2 py-1.5 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
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
            placeholder={keyHint(stored.base)}
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
        <ModelPicker
          value={stored.model}
          models={models}
          disabled={busy}
          onPick={(m) => {
            saveLocalLlm(localLlmKey(), m);
            setNotice({ ok: true, text: `${m} 로 바꿨습니다.` });
          }}
        />
        <button className={btn} disabled={busy || !saved} onClick={test}>
          연결 확인
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
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

      <p className="mt-1.5 text-[10px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
        키는 이 브라우저에만 남습니다. 여럿이 쓰는 기기라면 넣지 마세요.
      </p>

      {switchTo && (
        <AskConfirm
          title="서비스 바꾸기"
          message="이 기기에 저장된 키가 지워집니다. 새 서비스의 키를 다시 넣어야 합니다."
          confirmLabel="바꾸기"
          danger
          onConfirm={() => {
            setModels([]);
            saveLocalLlm("", "", switchTo);
            setNotice(null);
          }}
          onClose={() => setSwitchTo("")}
        />
      )}
    </div>
  );
}
