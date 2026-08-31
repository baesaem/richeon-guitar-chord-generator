"use client";

/**
 * AI가 유튜브를 직접 듣고 가사를 찾는다.
 *
 * 글자만으로 찾으면 두 가지가 틀린다 — 같은 곡의 다른 판(라이브·리메이크)
 * 가사가 붙거나, 시각이 음원과 어긋난다. 제미나이는 유튜브 링크를
 * 통째로 들을 수 있으니, **이 영상에서 실제로 부르는 가사**를 시각과
 * 함께 받아 낸다.
 *
 * 붙이기 전에 한 번 더 검증한다: 받아 낸 가사를 같은 영상과 함께 도로
 * 보여 주고 「줄마다 맞는지 확인하고 틀린 것을 고쳐라」고 시킨다.
 * 한 번에 받은 답은 뒷부분이 어긋나는 일이 있는데, 두 번째 눈이 그런
 * 자리를 잡아낸다.
 */

import { localLlmBase, localLlmKey, localLlmModel, providerOf } from "./llmClient";
import { parseLyricsText } from "./lrc";
import type { LyricLine } from "./types";

/** 이 기기에서 AI 듣기 가사를 쓸 수 있는가 (제미나이 키가 있어야 한다) */
export function canHearLyrics(): boolean {
  return providerOf(localLlmBase()) === "gemini" && !!localLlmKey();
}

function model(): string {
  return localLlmModel().trim().replace(/^(models\/)+/, "") || "gemini-3.6-flash";
}

async function gen(parts: unknown[]): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${localLlmKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 16000 },
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

/** 답에서 LRC 줄만 남긴다. 설명·코드 울타리가 붙어 올 때가 있다 */
function onlyLrc(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^```.*$/, ""))
    .filter((l) => /^\[\d{1,2}:\d{2}/.test(l))
    .join("\n");
}

/**
 * 유튜브 곡을 듣고 시각 붙은 가사를 만든다. 1~3분 걸린다.
 *
 * @param videoId 유튜브 영상 id (분석 결과의 id)
 * @param hint    가수·곡명. 사람이 적어 준 것이 우선이다
 */
export async function hearLyrics(
  videoId: string,
  hint: string,
  duration: number,
  onStatus?: (msg: string) => void,
): Promise<LyricLine[]> {
  const url = `https://youtu.be/${videoId}`;
  const say = (m: string) => onStatus?.(m);

  say("[1/2] 영상을 듣고 가사를 받아 적는 중… (1~2분)");
  const draft = await gen([
    { file_data: { file_uri: url } },
    {
      text: `이 영상의 노래를 듣고 가사를 받아 적으세요.${hint ? ` 곡 정보: ${hint}.` : ""}
- 이 영상에서 **실제로 부르는** 가사만. 다른 판(원곡·라이브)의 가사를 기억으로 채우지 말 것
- 한 줄에 한 소절, 각 줄 앞에 그 소절을 **부르기 시작하는 시각**을 [mm:ss.xx]로
- 간주·전주는 줄로 만들지 말 것. 라라라 같은 흥얼거림은 들리는 대로 적을 것
- LRC 형식만 출력, 설명 금지`,
    },
  ]);
  const first = onlyLrc(draft);
  if (!first) throw new Error("AI가 가사를 받아 적지 못했습니다");

  say("[2/2] 받아 적은 가사를 영상과 다시 맞춰 보는 중…");
  let final = first;
  try {
    const checked = await gen([
      { file_data: { file_uri: url } },
      {
        text: `아래는 이 영상에서 받아 적은 가사입니다. 영상을 다시 들으며 검증하세요.
- 글자가 틀린 줄은 고치고, 시각이 0.5초 넘게 어긋난 줄은 시각을 고칠 것
- 영상에 없는 줄은 지우고, 빠진 소절은 채울 것
- 고칠 것이 없으면 그대로 출력
- 최종 LRC만 출력, 설명 금지

${first}`,
      },
    ]);
    const second = onlyLrc(checked);
    // 검증 답이 앙상하면(반쯤 잘려 오면) 첫 답을 쓴다
    if (second && second.split("\n").length >= first.split("\n").length * 0.6)
      final = second;
  } catch {
    // 검증이 막혀도 첫 답으로 간다 — 없는 것보다 낫다
  }

  const lines = parseLyricsText(final, duration);
  if (!lines.length) throw new Error("가사 모양을 읽지 못했습니다");
  return lines;
}
