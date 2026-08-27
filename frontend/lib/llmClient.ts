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
const DEFAULT_MODEL = "gpt-5.4-mini";

export function localLlmKey(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function localLlmModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** 화면이 값 변화를 따라올 수 있게 하는 구독 목록 */
const listeners = new Set<() => void>();
/** useSyncExternalStore는 같은 값이면 같은 객체를 돌려줘야 한다 */
let snapshot = { key: "", model: DEFAULT_MODEL };

export function saveLocalLlm(key: string, model?: string): void {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
    if (model) localStorage.setItem(MODEL_KEY, model);
  } catch {
    // 저장이 막혀도 이번 세션 동안은 쓸 수 있다
  }
  snapshot = { key: localLlmKey(), model: localLlmModel() };
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
  if (key !== snapshot.key || model !== snapshot.model) snapshot = { key, model };
  return snapshot;
}

const EMPTY = { key: "", model: DEFAULT_MODEL };
export const localLlmServerSnapshot = () => EMPTY;

/** 이 기기에서 LLM을 쓸 수 있는가 */
export const hasLocalLlm = () => localLlmKey().length > 0;

async function chat(prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${localLlmKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: localLlmModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
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

JSON만 출력하세요. 설명을 붙이지 마세요.
{"artist": "...", "title": "...", "romanized": ["가수 곡명 로마자", "곡명 영문 번역"]}`;

export interface SongInfo {
  artist: string;
  title: string;
  romanized: string[];
}

/** 영상 제목에서 가수·곡명·로마자를 뽑는다. 실패하면 null. */
export async function songInfo(videoTitle: string): Promise<SongInfo | null> {
  if (!hasLocalLlm() || !videoTitle.trim()) return null;
  try {
    const raw = await chat(PROMPT.replace("{title}", videoTitle));
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const data = JSON.parse(raw.slice(start, end + 1)) as Partial<SongInfo>;
    const roman = Array.isArray(data.romanized)
      ? data.romanized
      : data.romanized
        ? [String(data.romanized)]
        : [];
    return {
      artist: String(data.artist ?? "").trim(),
      title: String(data.title ?? "").trim(),
      romanized: roman.map((r) => String(r).trim()).filter(Boolean),
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

/** 가사 정리에 쓸 만하지 않은 모델 */
const NOT_CHAT = [
  "embed",
  "tts",
  "whisper",
  "image",
  "realtime",
  "audio",
  "moderation",
  "search",
  "transcribe",
  "dall-e",
  "sora",
];

/**
 * 이 키로 쓸 수 있는 대화 모델. 새로 나온 것부터.
 *
 * OpenAI가 주는 created는 그 모델이 나온 시각이라 그대로 정렬하면
 * 최신 모델이 앞에 온다. 목록을 손으로 관리하지 않아도 새 모델이 나오면
 * 저절로 맨 앞에 나타난다.
 */
export async function listLocalModels(): Promise<string[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
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
    .slice()
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((m) => m.id)
    .filter(
      (id) =>
        /^(gpt-|o1|o3|o4)/.test(id) && !NOT_CHAT.some((bad) => id.includes(bad)),
    );
}

/**
 * 목록에서 쓸 모델 하나를 고른다 — 가장 새 것.
 *
 * 날짜가 붙은 스냅샷(gpt-5.5-2026-04-23)은 건너뛴다. 같은 모델을 가리키면서
 * 언젠가 사라지는 이름이라, 날짜 없는 쪽을 두면 새 판이 나와도 따라간다.
 */
export function pickModel(models: string[]): string {
  const stable = models.filter((m) => !/-(19|20)\d{2}-\d{2}-\d{2}$/.test(m));
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
