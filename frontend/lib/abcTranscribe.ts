"use client";

/**
 * AI 채보 — 제미나이가 유튜브 음원을 직접 듣고 ABC 악보를 만든다.
 *
 * 설정의 LLM 키(제미나이)를 그대로 쓴다. 다만 chat API가 아니라 네이티브
 * generateContent를 부른다 — 유튜브 URL을 입력으로 받는 것은 그쪽뿐이다.
 *
 * 악보생성 앱에서 검증한 프롬프트다. 결과는 AI가 들은 것이라 세부 리듬이
 * 정확하지 않을 수 있다 — 정식 악보(.mscz)가 있으면 그쪽이 언제나 낫고,
 * 이것은 악보가 없는 곡의 출발점이다.
 */

import { localLlmBase, localLlmKey, localLlmModel, providerOf } from "./llmClient";

/**
 * 모델은 설정(AI 연결)에 넣어 둔 것을 그대로 쓴다 — 악보생성 앱과 같다.
 * 「models/gemini-…」처럼 앞가지가 붙어 저장된 것도 있어 떼고 쓴다.
 */
function transcribeModel(): string {
  return (
    localLlmModel().trim().replace(/^(models\/)+/, "") || "gemini-3.6-flash"
  );
}

/** 지금 설정으로 AI 채보를 부를 수 있는가 (제미나이 키가 있어야 한다) */
export function canTranscribe(): boolean {
  return providerOf(localLlmBase()) === "gemini" && !!localLlmKey();
}

/* 악보생성 앱의 PROMPT_WITH_AUDIO와 같은 글이다. 두 곳의 채보가 서로
   다른 악보를 내면 어느 쪽이 맞는지 가릴 수 없다 — 그쪽을 고치면
   여기도 같이 고친다. */
const PROMPT_REPEATS = `- 되돌이표와 진행 기호를 빠짐없이 옮길 것:
  · 도돌이 시작 |:  · 도돌이 끝 :|  · 양쪽 도돌이 ::
  · 1번 괄호 [1  · 2번 괄호 [2  (예: |: ... |[1 ... :|[2 ... |)
  · 겹세로줄 ||  · 끝세로줄 |]
  · 세뇨 !segno!  · 코다 !coda!  · 피네 !fine!
  · D.C./D.S./To Coda 는 "^D.S. al Coda" 처럼 따옴표 글자로 마디 끝 음표 앞에
- 반복 구간을 풀어 쓰지 말고 견본 악보에 적힌 기호 그대로 적을 것`;

const PROMPT = `첨부한 참고 자료와 음원은 같은 곡입니다.
실제 음원을 기준으로 정확하게 채보해서 ABC notation으로 변환해 주세요.

규칙:
- 음원에서 들리는 실제 멜로디의 음정과 리듬을 최우선 기준으로 삼을 것 (악보 파일은 코드·가사·구조 참고용)
- 헤더: T:(제목), C:(작곡가), M:(박자), L:(기본음길이), Q:(음원의 실제 템포, 예: Q:1/4=72), K:(조성)
- 실제 음원의 조성이 악보와 다르면 음원 기준으로
- 코드는 "Bb" 같은 따옴표 심볼, 가사는 각 행 아래 w: 줄
- 전조가 있으면 마디 안이 아니라 새 줄에 K: 를 단독으로 쓸 것
${PROMPT_REPEATS}
- 응답은 곡 끝까지 완성된 ABC notation 코드 블록 하나만 출력 (설명 금지)`;

/**
 * 유튜브 곡을 채보한다. 몇 분 걸릴 수 있다.
 * 실패하면 이유를 담아 던진다 — 화면이 그대로 보여 준다.
 */
export async function transcribeYoutube(videoId: string): Promise<string> {
  const key = localLlmKey();
  if (!canTranscribe()) {
    throw new Error(
      "설정에서 제미나이 API 키를 먼저 넣어 주세요 (설정 → AI 연결)",
    );
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${transcribeModel()}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { file_data: { file_uri: `https://youtu.be/${videoId}` } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 32000 },
    }),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `채보 실패 (HTTP ${res.status})`);
  }
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");

  // 코드블록이 여럿이면 X: 헤더가 있는 가장 긴 것을 고른다
  const fences = [...text.matchAll(/```(?:abc)?\s*\n([\s\S]*?)```/g)].map((m) =>
    m[1].trim(),
  );
  const candidates = fences.filter((f) => /^X:/m.test(f));
  if (candidates.length)
    return candidates.sort((a, b) => b.length - a.length)[0];
  const idx = text.search(/^X:/m);
  if (idx >= 0) return text.slice(idx).replace(/```/g, "").trim();
  throw new Error("응답에서 ABC 악보를 찾지 못했습니다");
}

/* ── 고정밀 채보 — 악보생성 앱의 analyzeHQ를 그대로 옮긴 것 ─────────
 *
 * 곡을 통째로 한 번에 들려주면 긴 곡에서 뒷부분이 뭉개진다. 그래서
 * ① flash 모델로 곡 길이·템포·조성을 먼저 읽고
 * ② 음원을 50초 구간으로 잘라 pro 모델이 구간마다 정밀하게 듣고
 * ③ 구간들을 이어 붙인다. 구간당 1~2분, 곡 전체로 5~10분 걸린다.
 */

/** 제미나이 한 번 호출 — analyzeHQ가 쓰는 낮은 층 */
async function geminiGen(
  key: string,
  model: string,
  parts: unknown[],
  maxTokens = 16000,
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
      }),
    },
  );
  const json = (await res.json()) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
}

/**
 * 유튜브 곡을 구간별로 정밀 채보한다. 5~10분 걸린다.
 * onStatus로 진행 상황을 알린다 — 화면이 그대로 보여 준다.
 */
export async function transcribeYoutubeHQ(
  videoId: string,
  onStatus?: (msg: string) => void,
): Promise<string> {
  const key = localLlmKey();
  if (!canTranscribe())
    throw new Error("설정에서 제미나이 API 키를 먼저 넣어 주세요 (설정 → AI 연결)");
  const youtubeUrl = `https://youtu.be/${videoId}`;
  const say = (m: string) => onStatus?.(m);

  say("[1/3] 곡 길이·템포·조성 분석 중…");
  const metaText = await geminiGen(key, "gemini-3.6-flash", [
    { file_data: { file_uri: youtubeUrl } },
    {
      text: `이 곡을 분석해서 JSON만 출력: {"duration_sec": 곡 전체 길이(정수 초), "bpm": 템포, "meter": "4/4" 같은 박자, "key": "Bb" 같은 조성, "title": "곡 제목", "artist": "가수", "vocal_start_sec": 보컬 시작 초}`,
    },
  ]);
  const metaMatch = metaText.match(/\{[\s\S]*\}/);
  if (!metaMatch) throw new Error("곡 정보를 읽지 못했습니다");
  const meta = JSON.parse(metaMatch[0]) as {
    duration_sec: number; bpm: number; meter: string;
    key: string; title: string; artist: string;
  };

  const SEG = 50;
  const segs: [number, number][] = [];
  for (let t = 0; t < meta.duration_sec; t += SEG)
    segs.push([t, Math.min(t + SEG, meta.duration_sec)]);

  const bodies: string[] = [];
  let prevTail = "";
  for (let i = 0; i < segs.length; i++) {
    const [s, e] = segs[i];
    say(`[2/3] 구간 ${i + 1}/${segs.length} (${s}~${e}초) 정밀 채보 중… 구간당 1~2분 걸립니다.`);
    const contPrompt = prevTail
      ? `\n직전 구간의 마지막 부분 (이어지도록 하되 중복 채보 금지):\n${prevTail}`
      : "";
    let body: string | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3 && body === null; attempt++) {
      try {
        // 구간을 정밀하게 듣는 것은 pro 모델 몫이다 — flash보다 느리지만 귀가 밝다
        body = await geminiGen(key, "gemini-pro-latest", [
          {
            file_data: { file_uri: youtubeUrl },
            video_metadata: { start_offset: `${s}s`, end_offset: `${e}s` },
          },
          {
            text: `이 음원은 '${meta.title}'(${meta.artist}, ${meta.meter}, 약 ${meta.bpm}bpm)이며 이 음원의 조성은 ${meta.key}입니다.
지정된 구간(${s}초~${e}초)의 **보컬 멜로디**를 한 음도 빠짐없이 정확하게 채보하세요.
음원을 반복해서 듣는다고 생각하고 각 음의 음정과 길이를 신중하게 판단하세요.
중요: 반드시 ${meta.key} 조성 기준 음이름으로 표기하세요. 다른 조성으로의 표기 금지.${contPrompt}

출력 형식: ABC notation 본문만 (X:,T:,M:,L:,Q:,K: 등 헤더 절대 금지), L:1/16 기준, 마디는 | 로 구분, 4~5마디마다 줄바꿈.
코드를 "C" "Am7" 형태로 마디 위에, 가사는 각 행 아래 w: 줄로.
보컬 없는 전주/간주는 z16 쉼표 마디로. 코드블록 하나만 출력, 설명 금지.`,
          },
        ]);
      } catch (err) {
        lastErr = err as Error;
        say(`[2/3] 구간 ${i + 1} 재시도 중… (${(err as Error).message.slice(0, 60)})`);
        await new Promise((r) => setTimeout(r, 20000));
      }
    }
    if (body === null) throw lastErr ?? new Error("구간 채보 실패");
    const fence = body.match(/```(?:abc)?\s*\n([\s\S]*?)```/);
    // 구간 결과에 섞여 들어온 헤더·코드펜스 제거
    const clean = (fence ? fence[1] : body)
      .split("\n")
      .filter((l) => !/^\s*(```|X:|T:|C:|M:|L:|Q:|K:)/.test(l))
      .join("\n")
      .trim();
    bodies.push(clean);
    const lines = clean
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("w:") && !l.startsWith("%"));
    prevTail = lines.slice(-2).join("\n");
  }

  say("[3/3] 악보 합치는 중…");
  return `X:1
T:${meta.title}
C:${meta.artist}
M:${meta.meter}
L:1/16
Q:1/4=${meta.bpm}
K:${meta.key}
` + bodies.join("\n");
}
