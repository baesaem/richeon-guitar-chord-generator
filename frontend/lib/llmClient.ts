"use client";

/**
 * 브라우저에서 직접 부르는 LLM.
 *
 * 분석 서버가 없는 화면(외부 링크로 연 앱, 수강생 폰)에서도 가사를 찾기
 * 위한 길이다. 서버가 있으면 서버가 하고, 없으면 여기서 한다.
 *
 * 키는 이 기기에만 저장된다. 서버에 저장한 키와 별개이며, 다른 사람에게
 * 건너가지 않는다 — 다만 이 기기를 쓰는 사람은 볼 수 있으므로 공용
 * 기기에는 넣지 않는 편이 좋다.
 */

const KEY = "chordgen.llmKey";
const MODEL_KEY = "chordgen.llmModel";
const BASE_KEY = "chordgen.llmBase";
/**
 * 저장된 모델이 없으면 비워 둔다.
 *
 * 서비스마다 모델 이름이 다르고 자주 바뀐다. 기본값을 박아 두면 제미나이를
 * 골랐는데 gpt 이름이 남아 있는 꼴이 된다. 연결 확인 한 번이면 채워진다.
 */
const DEFAULT_MODEL = "";

/**
 * 쓸 수 있는 서비스.
 *
 * 제미나이는 OpenAI 호환 주소를 따로 열어 둬서, 주소만 바꾸면 같은
 * 코드로 부를 수 있다. 실제로 브라우저에서 불러 확인했다.
 */
export const PROVIDERS = [
  {
    id: "gemini",
    name: "구글 제미나이",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    /** 브라우저에서 직접 부를 수 있는가 */
    fromBrowser: true,
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    base: "https://api.openai.com/v1",
    fromBrowser: false,
  },
] as const;

/**
 * 기기에서 직접 부를 때의 기본은 제미나이다.
 *
 * OpenAI는 브라우저에서 대화 요청을 막아 둔다. 실측: /v1/models는 401로
 * 답이 오지만 /v1/chat/completions는 Access-Control-Allow-Origin이 없어
 * 브라우저가 차단한다. 서버가 부를 때는 문제없다 — 브라우저만 막힌다.
 */
const DEFAULT_BASE: string = PROVIDERS[0].base;

/** 이 주소를 브라우저에서 직접 부를 수 있는가 */
export function callableFromBrowser(base: string): boolean {
  const known = PROVIDERS.find((p) => p.base === base.replace(/\/+$/, ""));
  // 모르는 주소는 막지 않는다. 직접 넣은 서버는 대개 CORS를 열어 둔다
  return known ? known.fromBrowser : true;
}

export function localLlmBase(): string {
  try {
    return localStorage.getItem(BASE_KEY) || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

/** 지금 주소가 어느 서비스인지. 목록에 없으면 빈 문자열 */
export function providerOf(base: string): string {
  return PROVIDERS.find((p) => p.base === base.replace(/\/+$/, ""))?.id ?? "";
}

export function localLlmKey(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function localLlmModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** 화면이 값 변화를 따라올 수 있게 하는 구독 목록 */
const listeners = new Set<() => void>();
/** useSyncExternalStore는 같은 값이면 같은 객체를 돌려줘야 한다 */
let snapshot = { key: "", model: DEFAULT_MODEL, base: DEFAULT_BASE };

export function saveLocalLlm(key: string, model?: string, base?: string): void {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
    // 빈 문자열은 "지우기". 서비스를 바꾸면 이전 모델 이름은 못 쓴다
    if (model !== undefined) {
      if (model) localStorage.setItem(MODEL_KEY, model);
      else localStorage.removeItem(MODEL_KEY);
    }
    if (base) localStorage.setItem(BASE_KEY, base.replace(/\/+$/, ""));
  } catch {
    // 저장이 막혀도 이번 세션 동안은 쓸 수 있다
  }
  snapshot = { key: localLlmKey(), model: localLlmModel(), base: localLlmBase() };
  listeners.forEach((fn) => fn());
}

export function subscribeLocalLlm(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 브라우저에 저장된 값. 서버 렌더 때는 비어 있다. */
export function localLlmSnapshot() {
  const key = localLlmKey();
  const model = localLlmModel();
  const base = localLlmBase();
  if (key !== snapshot.key || model !== snapshot.model || base !== snapshot.base) {
    snapshot = { key, model, base };
  }
  return snapshot;
}

const EMPTY = { key: "", model: DEFAULT_MODEL, base: DEFAULT_BASE };
export const localLlmServerSnapshot = () => EMPTY;

/** 이 기기에서 LLM을 쓸 수 있는가 */
export const hasLocalLlm = () => localLlmKey().length > 0;

/** 다른 모듈에서도 같은 경로로 부를 수 있게 열어 둔다 */
export const chatOnce = (prompt: string) => chat(prompt);

async function chat(prompt: string): Promise<string> {
  const model = localLlmModel();
  if (!model) throw new Error("모델이 정해지지 않았습니다. 연결 확인을 눌러 주세요.");
  if (!callableFromBrowser(localLlmBase())) {
    throw new Error(
      "OpenAI는 브라우저에서 직접 부를 수 없게 막아 두었습니다. " +
        "설정에서 구글 제미나이를 고르거나, 집 서버에 연결해 주세요.",
    );
  }

  const res = await fetch(`${localLlmBase()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${localLlmKey()}`,
      "Content-Type": "application/json",
    },
    // temperature는 보내지 않는다. gpt-5.6 계열이 0을 거부한다
    // ("Only the default (1) value is supported"). 최신 모델을 자동으로
    // 고르는 이상, 거부당할 값은 애초에 안 보내는 편이 안전하다.
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`,
    );
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

const PROMPT = `다음은 음악 영상의 제목입니다. 여기서 가수 이름과 곡 제목만 가려내세요.

제목: {title}

규칙:
- 발매연도, [MV], [Lyric Video], 방송사명, 프로그램명 같은 부가 정보는 버립니다.
- 한국 곡이면 가수와 곡명의 로마자 표기도 함께 주세요. 해외 가사
  데이터베이스에 영문으로 등록된 경우가 많습니다.
- 모르면 빈 문자열로 두세요. 지어내지 마세요.
- artist_romanized에는 **가수 이름만** 로마자로 여러 표기 넣으세요.
  곡명은 넣지 마세요. 찾은 결과가 이 가수의 곡인지 맞춰 보는 데 씁니다.

JSON만 출력하세요. 설명을 붙이지 마세요.
{"artist": "...", "title": "...", "artist_romanized": ["Cho Yong Pil", "Jo Yong-pil"], "romanized": ["가수 곡명 로마자", "곡명 영문 번역"]}`;

export interface SongInfo {
  artist: string;
  title: string;
  romanized: string[];
  /**
   * 가수 이름만 로마자로.
   *
   * 찾은 결과가 이 가수의 곡인지 맞춰 보는 데 쓴다. 곡명 로마자를 섞으면
   * 안 된다 — 번역 제목("That's You")이 무관한 영어 곡을 통과시킨다.
   */
  artistRomanized: string[];
}

/** 영상 제목에서 가수·곡명·로마자를 뽑는다. 실패하면 null. */
export async function songInfo(videoTitle: string): Promise<SongInfo | null> {
  if (!hasLocalLlm() || !videoTitle.trim()) return null;
  try {
    const raw = await chat(PROMPT.replace("{title}", videoTitle));
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const list = (key: string): string[] => {
      const value = data[key];
      const rows = Array.isArray(value) ? value : value ? [value] : [];
      return rows.map((r) => String(r).trim()).filter(Boolean);
    };
    return {
      artist: String(data.artist ?? "").trim(),
      title: String(data.title ?? "").trim(),
      romanized: list("romanized"),
      artistRomanized: list("artist_romanized"),
    };
  } catch {
    return null;
  }
}

/** 가사를 찾을 때 던져 볼 검색어들. 그럴듯한 순서대로. */
export function searchQueries(info: SongInfo | null, fallback: string): string[] {
  const out: string[] = [];
  if (info) {
    if (info.artist && info.title) out.push(`${info.artist} ${info.title}`);
    if (info.title) out.push(info.title);
    out.push(...info.romanized);
  }
  out.push(fallback);
  const seen = new Set<string>();
  return out.filter((q) => q && !seen.has(q) && seen.add(q));
}

/**
 * 모델 목록 고르기 — 백엔드 llm.py와 같은 규칙.
 *
 * OpenAI든 제미나이든 /models 응답 모양은 같다. 다만 제미나이는
 * "models/gemini-2.5-flash" 꼴로 주고 created를 빼는 일이 있어, 그럴
 * 때는 이름에 박힌 판번호로 새 것을 가린다.
 */
const NOT_CHAT = [
  "embed", "tts", "whisper", "image", "realtime", "audio", "moderation",
  "transcribe", "search", "dall-e", "sora", "veo", "aqa", "computer-use",
];
const CHAT_PREFIX = /^(gpt-|o1|o3|o4|claude|gemini)/;
/** gpt-5.5-2026-04-23 처럼 날짜가 붙은 스냅샷 */
const SNAPSHOT = /-(19|20)\d{2}-\d{2}-\d{2}$/;

/** 제미나이는 "models/…" 앞머리를 붙여 준다 */
const bare = (id: string) => id.split("/").pop() ?? id;

const version = (id: string) => Number(bare(id).match(/\d+(\.\d+)?/)?.[0] ?? 0);

const isChatModel = (id: string) =>
  CHAT_PREFIX.test(bare(id)) && !NOT_CHAT.some((bad) => bare(id).includes(bad));

/** 이 키로 쓸 수 있는 대화 모델. 새로 나온 것부터. */
export async function listLocalModels(): Promise<string[]> {
  const res = await fetch(`${localLlmBase()}/models`, {
    headers: { Authorization: `Bearer ${localLlmKey()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`,
    );
  }
  const data = (await res.json()) as { data: { id: string; created?: number }[] };
  return data.data
    .filter((m) => isChatModel(m.id))
    .slice()
    .sort(
      (a, b) =>
        (b.created ?? 0) - (a.created ?? 0) || version(b.id) - version(a.id),
    )
    .map((m) => m.id);
}

/**
 * 목록에서 쓸 모델 하나 — 가장 새 것.
 *
 * 날짜가 붙은 스냅샷은 건너뛴다. 같은 모델을 가리키면서 언젠가 사라지는
 * 이름이라, 날짜 없는 쪽을 두면 새 판이 나와도 그대로 따라간다.
 */
export function pickModel(models: string[]): string {
  const stable = models.filter((m) => !SNAPSHOT.test(bare(m)));
  return stable[0] ?? models[0] ?? DEFAULT_MODEL;
}

/** 이 기기에 넣은 키가 실제로 되는지 확인한다. */
export async function testLocalLlm(): Promise<{ ok: boolean; message: string }> {
  if (!hasLocalLlm()) return { ok: false, message: "키가 없습니다." };
  try {
    const info = await songInfo("조용필 - 단발머리 [KBS 가요무대]");
    if (!info) throw new Error("응답을 읽지 못했습니다");
    const name = [info.artist, info.title].filter(Boolean).join(" ");
    return { ok: true, message: `연결됨 · 시험 결과: ${name || "(비어 있음)"}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}


const QUERIES_PROMPT = `다음 곡을 해외 가사 데이터베이스에서 찾으려 합니다.
검색어 후보를 만들어 주세요.

가수: {artist}
곡명: {title}

규칙:
- 한 줄에 하나씩, 최대 6개.
- 로마자 표기를 여러 방식으로(띄어쓰기·하이픈 차이 포함) 넣으세요.
- 영어 번역 제목, 널리 쓰이는 다른 표기(예명·한자 표기)도 넣으세요.
- 설명 없이 검색어만 출력하세요.`;

/**
 * 가사를 못 찾았을 때 던져 볼 검색어를 더 만든다.
 *
 * 한국 가요가 가사 데이터베이스에 어떤 표기로 올라 있는지는 곡마다 다르다.
 * 실측: "이장희 그건 너" → Lee Jang Hee / Yi Jang-hui / That's You / 李章熙.
 */
export async function moreQueries(info: SongInfo | null): Promise<string[]> {
  if (!hasLocalLlm() || !info?.title) return [];
  try {
    const raw = await chat(
      QUERIES_PROMPT.replace("{artist}", info.artist || "(모름)").replace(
        "{title}",
        info.title,
      ),
    );
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-*\d.\s]+/, "").trim())
      .filter((line) => line && line.length < 80)
      .slice(0, 6);
  } catch {
    return [];
  }
}

const LYRICS_PROMPT = `다음 곡의 가사를 알려주세요.

가수: {artist}
곡명: {title}

규칙:
- 가사 본문만 한 줄에 한 소절씩 적으세요.
- 번호, 굵은 글씨, [Verse]·[후렴] 같은 구조 표시는 넣지 마세요.
- 설명이나 머리말을 붙이지 마세요.
- 이 곡의 가사를 모르면 정확히 \`MODR\` 네 글자만 출력하세요. 절대
  지어내지 마세요. 비슷한 다른 곡의 가사를 적는 것이 가장 나쁩니다.`;

const REFUSAL = [
  "저작권", "제공할 수 없", "제공해 드릴 수 없", "도와드릴 수 없", "죄송",
  "알려드릴 수 없", "copyright", "can't provide", "cannot provide",
  "unable to provide", "sorry",
];

/**
 * AI가 아는 이 곡의 가사. 모르거나 거부하면 빈 목록.
 *
 * **대개 거부한다.** 실측: "이장희 그건 너"에 "저작권이 있는 노래 가사
 * 전문은 제공할 수 없습니다"라고 답했다. 마지막 수단으로만 두고, 앞의
 * 수단(가사 목록 검색)이 먼저다.
 */
export async function lyricsFromAi(info: SongInfo | null): Promise<string[]> {
  if (!hasLocalLlm() || !info?.title) return [];
  try {
    const raw = await chat(
      LYRICS_PROMPT.replace("{artist}", info.artist || "(모름)").replace(
        "{title}",
        info.title,
      ),
    );
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];
    if (lines.slice(0, 2).some((line) => line.replace(/[`* ]/g, "") === "MODR")) {
      return [];
    }
    // 거부 문구가 가사로 둔갑하지 않게 막는다
    const head = lines.slice(0, 2).join(" ").toLowerCase();
    if (lines.length <= 3 && REFUSAL.some((w) => head.includes(w.toLowerCase()))) {
      return [];
    }
    return lines
      .filter((line) => !/^[[(].{0,20}[\])]$/.test(line))
      .slice(0, 200);
  } catch {
    return [];
  }
}


/** 이 곡을 가리키는 가수 이름들. 검색 결과를 맞춰 보는 데 쓴다. */
export const artistNames = (info: SongInfo | null): string[] =>
  info ? [info.artist, ...info.artistRomanized].filter(Boolean) : [];
