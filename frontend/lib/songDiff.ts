"use client";

import { getLocal } from "./library";
import type { AnalysisResult } from "./types";

/**
 * 받은 곡이 기기에 있는 것과 다른가.
 *
 * 선생님이 코드를 고쳐 다시 올리는 일이 잦다. 그때 받은 것을 말없이
 * 덮어쓰면 학생은 무엇이 바뀌었는지 모른 채 연습하던 화면이 달라진다.
 * 그래서 무엇이 달라졌는지 먼저 보여주고 물어본다.
 *
 * 파형(peaks)까지 전부 비교하지는 않는다. 값은 조금씩 달라도 연습에
 * 영향이 없는 것들이라, 눈에 보이는 것만 본다.
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
  }
  const oldLy = old.lyrics?.length ?? 0;
  const newLy = next.lyrics?.length ?? 0;
  if (oldLy !== newLy) {
    notes.push(oldLy === 0 ? `가사 ${newLy}줄 추가` : `가사 ${oldLy}줄 → ${newLy}줄`);
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
