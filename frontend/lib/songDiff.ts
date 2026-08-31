"use client";

import { getLocal } from "./library";
import type { AnalysisResult } from "./types";

/**
 * 받은 곡이 기기에 있는 것과 다른가.
 *
 * 강사님이 코드를 고쳐 다시 올리는 일이 잦다. 그때 받은 것을 말없이
 * 덮어쓰면 학생은 무엇이 바뀌었는지 모른 채 연습하던 화면이 달라진다.
 * 그래서 무엇이 달라졌는지 먼저 보여주고 물어본다.
 *
 * 파형(peaks)까지 전부 비교하지는 않는다. 값은 조금씩 달라도 연습에
 * 영향이 없는 것들이라, 눈에 보이는 것만 본다.
 *
 * 다만 **개수만 세지는 않는다.** 가사 싱크를 맞추거나 코드 이름을
 * 고치면 개수는 그대로다. 개수만 보면 「같은 곡」이라 그냥 두게 되어,
 * 애써 고친 것이 수강생에게 가지 않는다.
 */

export interface SongChange {
  title: string;
  /** 무엇이 달라졌는지 사람 말로. 예: "코드 120개 → 145개" */
  notes: string[];
}

function notesBetween(old: AnalysisResult, next: AnalysisResult): string[] {
  const notes: string[] = [];
  if (old.key !== next.key) notes.push(`조성 ${old.key || "미상"} → ${next.key || "미상"}`);
  if (Math.abs(old.bpm - next.bpm) >= 0.5) {
    notes.push(`${Math.round(old.bpm)} → ${Math.round(next.bpm)} BPM`);
  }
  if (old.chords.length !== next.chords.length) {
    notes.push(`코드 ${old.chords.length}개 → ${next.chords.length}개`);
  } else {
    // 개수가 같아도 이름이 바뀌었을 수 있다 — 강사님이 고쳐 적은 것이다
    const fixed = old.chords.filter(
      (c, i) => c.label !== next.chords[i]?.label,
    ).length;
    if (fixed) notes.push(`코드 ${fixed}자리 고쳐짐`);
  }
  const oldLy = old.lyrics ?? [];
  const newLy = next.lyrics ?? [];
  if (oldLy.length !== newLy.length) {
    notes.push(
      oldLy.length === 0
        ? `가사 ${newLy.length}줄 추가`
        : `가사 ${oldLy.length}줄 → ${newLy.length}줄`,
    );
  } else {
    /* 줄 수만 보면 안 된다.
     *
     * 가사 싱크를 맞추거나 글자를 고치면 줄 수는 그대로다. 그러면
     * 「같은 곡」으로 보아 그냥 두었고, 애써 맞춘 것이 수강생에게는
     * 영영 가지 않았다 — 악보에서 겪은 것과 같은 일이다.
     */
    const moved = oldLy.filter(
      (l, i) => Math.abs(l.t - (newLy[i]?.t ?? l.t)) >= 0.15,
    ).length;
    if (moved) notes.push(`가사 시각 ${moved}줄 달라짐`);
    const reworded = oldLy.filter(
      (l, i) => (l.text ?? "").trim() !== (newLy[i]?.text ?? "").trim(),
    ).length;
    if (reworded) notes.push(`가사 글자 ${reworded}줄 달라짐`);
  }
  if (old.meta?.pipeline_version !== next.meta?.pipeline_version) {
    notes.push(`분석판 ${old.meta?.pipeline_version} → ${next.meta?.pipeline_version}`);
  }
  return notes;
}

/**
 * 받은 곡들 중 기기에 있는 것과 달라진 것만 골라 낸다.
 *
 * 기기에 없는 곡(처음 받는 곡)은 바뀐 것이 아니므로 빠진다 — 물어볼
 * 이유가 없다.
 */
export async function changedSongs(results: AnalysisResult[]): Promise<SongChange[]> {
  const changes: SongChange[] = [];
  for (const next of results) {
    const old = await getLocal(next.id).catch(() => null);
    if (!old) continue;
    const notes = notesBetween(old, next);
    if (notes.length) changes.push({ title: next.title || next.id, notes });
  }
  return changes;
}

/** 기기에 이미 있고, 달라진 것도 없는가 */
export async function alreadySame(results: AnalysisResult[]): Promise<boolean> {
  for (const next of results) {
    const old = await getLocal(next.id).catch(() => null);
    if (!old || notesBetween(old, next).length) return false;
  }
  return results.length > 0;
}
