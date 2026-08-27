"use client";

import { hasLocalLlm, songInfo } from "./llmClient";
import type { AnalysisResult, Beat, Chord } from "./types";

/**
 * 분석 서버 없이 AI로 코드 만들기.
 *
 * **먼저 알아야 할 것.** 이 길은 잘 되지 않는다. 실제로 재 본 결과다.
 *
 *   - AI가 아는 코드를 물었더니 세 곡 모두 "모른다"고 답했다
 *     (혜화동 · 그건 너 · 사람이 꽃보다 아름다워).
 *   - 오디오를 들려주는 방법도 재 봤다. 혜화동(실제 B♭장조 96.8BPM)에
 *     G장조 84BPM이라고 답했고, 다른 곡에서는 "음원을 분석하는 기능은
 *     제공하지 않습니다"라며 거부했다.
 *
 * 그래서 이 기능은 **되면 좋고 안 되면 마는** 자리에 둔다. 화음 인식은
 * 집 서버의 전용 모델(BTC)이 하는 일이고, 그쪽은 실제로 웹 악보와 맞는
 * 답을 낸다. 수강생은 강상기타반에서 받는 편이 언제나 낫다.
 *
 * 되는 경우에도 **음원을 듣고 만든 것이 아니다.** AI가 아는 코드를 BPM에
 * 맞춰 늘어놓을 뿐이라, 전주 길이나 반복 횟수가 실제 녹음과 다르면 처음
 * 몇 마디부터 어긋난다. 화면에 그 사실을 밝힌다.
 */

const PROMPT = `다음 곡의 기타 코드 진행을 알려주세요.

가수: {artist}
곡명: {title}

규칙:
- 원곡 조성(key)과 빠르기(BPM), 박자를 적으세요.
- 구간별로 코드를 적되, chords는 **한 마디에 하나씩** 순서대로 나열하세요.
- repeat은 그 구간이 연달아 몇 번 반복되는지입니다.
- 이 곡을 모르면 {"known": false} 만 출력하세요. 절대 지어내지 마세요.
  틀린 코드는 없는 것보다 나쁩니다.

JSON만 출력하세요.
{"known": true, "key": "Bb major", "bpm": 97, "time_signature": "4/4",
 "sections": [{"name": "Intro", "chords": ["Bb","F","Gm","Eb"], "repeat": 1}]}`;

interface Section {
  name?: string;
  chords?: unknown;
  repeat?: number;
}

interface Answer {
  known?: boolean;
  key?: string;
  bpm?: number;
  time_signature?: string;
  sections?: Section[];
}

/** AI가 이 곡을 모를 때 알려 줄 이유 */
export class NotKnown extends Error {}

async function ask(prompt: string): Promise<Answer | null> {
  // chat()은 모듈 안에 감춰져 있어 songInfo와 같은 경로를 쓴다
  const { chatOnce } = await import("./llmClient");
  const raw = await chatOnce(prompt);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return JSON.parse(raw.slice(start, end + 1)) as Answer;
}

/** 마디마다 코드 하나씩. 구간 반복을 펼친다. */
function barChords(sections: Section[]): string[] {
  const bars: string[] = [];
  for (const section of sections) {
    const chords = Array.isArray(section.chords)
      ? section.chords.map((c) => String(c).trim()).filter(Boolean)
      : [];
    if (!chords.length) continue;
    const repeat = Math.min(Math.max(Number(section.repeat) || 1, 1), 16);
    for (let r = 0; r < repeat; r++) bars.push(...chords);
  }
  return bars.slice(0, 400);
}

/**
 * AI가 아는 코드로 분석 결과를 만든다.
 *
 * 모르면 NotKnown을 던진다 — 지어낸 코드를 받아 오는 것보다 낫다.
 */
export async function analyzeWithAi(
  id: string,
  title: string,
  duration: number,
): Promise<AnalysisResult> {
  if (!hasLocalLlm()) throw new Error("설정에서 AI 키를 먼저 넣어 주세요");

  const info = await songInfo(title);
  const answer = await ask(
    PROMPT.replace("{artist}", info?.artist || "(모름)").replace(
      "{title}",
      info?.title || title,
    ),
  );
  if (!answer || answer.known === false) {
    throw new NotKnown("AI가 이 곡의 코드를 모른다고 답했습니다");
  }

  const bars = barChords(answer.sections ?? []);
  if (!bars.length) throw new NotKnown("AI가 코드를 내놓지 않았습니다");

  const bpm = Math.min(Math.max(Number(answer.bpm) || 100, 40), 240);
  const signature = /^\d+\/\d+$/.test(String(answer.time_signature))
    ? String(answer.time_signature)
    : "4/4";
  const perBar = Number(signature.split("/")[0]) || 4;
  const beat = 60 / bpm;

  // 첫 마디를 0초에 둔다. 전주가 있으면 그만큼 통째로 어긋나는데,
  // 어디서 시작하는지는 음원을 들어야 알 수 있고 우리는 못 듣는다.
  const beats: Beat[] = [];
  const chords: Chord[] = [];
  bars.forEach((label, bar) => {
    const start = bar * perBar * beat;
    for (let b = 0; b < perBar; b++) {
      beats.push({ t: +(start + b * beat).toFixed(3), beat: b + 1, bar: bar + 1 });
    }
    const last = chords[chords.length - 1];
    if (last && last.label === label) {
      // 같은 코드가 이어지면 한 덩어리로 둔다
      last.end = +(start + perBar * beat).toFixed(3);
      return;
    }
    chords.push({
      start: +start.toFixed(3),
      end: +(start + perBar * beat).toFixed(3),
      label,
      root: label.match(/^[A-G][#b♯♭]?/)?.[0] ?? null,
      quality: /m(?!aj)/.test(label.slice(1)) ? "min" : "maj",
      bass: label.includes("/") ? label.split("/")[1] : null,
      // 낮게 둔다. 음원을 들은 결과가 아니다
      confidence: 0.4,
      edited: false,
    });
  });

  const span = bars.length * perBar * beat;
  return {
    id,
    source: "youtube",
    title,
    duration: duration || span,
    bpm,
    time_signature: signature,
    key: String(answer.key ?? ""),
    beats,
    chords,
    sections: [],
    lyrics: [],
    peaks: [],
    peaks_per_second: 0,
    confidence: 0.4,
    // 이 결과가 어디서 왔는지 남긴다. 화면이 경고를 띄우는 근거이자,
    // 나중에 서버로 다시 분석했을 때 무엇이 바뀌었는지 알 수 있게 한다.
    meta: {
      pipeline_version: "ai-knowledge",
      separated: false,
      beat_model: "none",
      chord_model: "ai-knowledge",
      device: "browser",
      elapsed_sec: 0,
    },
  } as AnalysisResult;
}
