"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { apiBase } from "@/lib/api";

/** 그림 위 마디 하나. 자리는 0~1 비율이라 화면 크기와 무관하다 */
export interface SheetBar {
  page: number;
  system: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** 잘라 보일 띠 — 오선 위 코드와 아래 가사까지 */
  viewTop: number;
  viewBottom: number;
}

export interface SheetData {
  pages: { index: number; width: number; height: number }[];
  bars: SheetBar[];
  /** 되풀이마다 마디별 시작·끝 시각 */
  passes: { start: number; end: number }[][];
  /** "score"면 악보 파일의 정렬, "grid"면 박 격자에 고르게 얹은 것 */
  source: "score" | "grid";
  offset: number;
  repeats: number;
}

/** 지금 시각이 몇 바퀴째인가 */
function passAt(sheet: SheetData, time: number): number {
  let best = 0;
  sheet.passes.forEach((bars, i) => {
    if (bars.length && time >= bars[0].start) best = i;
  });
  return best;
}

interface Props {
  resultId: string;
  sheet: SheetData;
  time: number;
  /** 그림 위에 덮어쓸 코드. 마디마다 [{at 0~1, label}] */
  chords?: { bar: number; at: number; label: string }[];
  showChords: boolean;
  onToggleChords: () => void;
  musicKey: string;
  timeSignature: string;
  playNotes?: string[];
  headerRight?: React.ReactNode;
  onSeek?: (t: number) => void;
  /** 한 번에 보일 줄 수 */
  lines?: number;
}

/**
 * 악보 그림 위의 진행 바.
 *
 * 음표를 우리가 그리면 아무리 손봐도 인쇄된 악보를 못 따라간다. 그래서
 * 그림은 강사님이 올린 그대로 두고, **마디선만 찾아** 그 위로 커서를
 * 지나가게 한다. 지금 줄만 크게 보이고, 줄이 끝나면 다음 줄로 넘어간다.
 *
 * 코드는 덮어쓸 수 있다 — 악보가 짚기 쉬운 조로 옮겨 적혀 있으면
 * 인쇄된 코드가 원곡과 다르기 때문이다(하얀나비는 악보 사장조,
 * 원곡 가장조).
 */
export function SheetScore({
  resultId,
  sheet,
  time,
  chords,
  showChords,
  onToggleChords,
  musicKey,
  timeSignature,
  playNotes,
  headerRight,
  onSeek,
  lines = 2,
}: Props) {
  const pass = passAt(sheet, time);
  const bars = sheet.passes[pass] ?? [];

  // 지금 마디
  const at = useMemo(() => {
    let found = -1;
    for (let i = 0; i < bars.length; i++) {
      if (time >= bars[i].start) found = i;
      else break;
    }
    return Math.max(found, 0);
  }, [bars, time]);

  // 그림의 줄(system)을 쪽별로 묶는다. 화면은 줄 단위로 넘어간다.
  const systems = useMemo(() => {
    const map = new Map<string, { page: number; system: number; bars: number[] }>();
    sheet.bars.forEach((b, i) => {
      const key = `${b.page}:${b.system}`;
      const row = map.get(key) ?? { page: b.page, system: b.system, bars: [] };
      row.bars.push(i);
      map.set(key, row);
    });
    return [...map.values()];
  }, [sheet.bars]);

  const current = systems.findIndex((s) => s.bars.includes(at));
  const from = Math.max(current < 0 ? 0 : current, 0);
  const shown = systems.slice(from, from + lines);

  return (
    <div className="space-y-1">
      <SongInfoLine
        musicKey={musicKey}
        timeSignature={timeSignature}
        playNotes={playNotes}
        right={headerRight}
      >
        <button
          className={[
            "shrink-0 rounded px-1.5 py-0.5",
            showChords
              ? "bg-[var(--accent)] text-white"
              : "text-gray-500 underline decoration-dotted underline-offset-2",
          ].join(" ")}
          onClick={onToggleChords}
          title="악보에 적힌 코드 위에 이 음원의 코드를 덮어 씁니다"
        >
          코드 바꿔 보기
        </button>
        <span className="ml-2 shrink-0">
          {sheet.passes.length > 1 ? `${pass + 1}번째 · ` : ""}
          {from + 1}–{Math.min(from + lines, systems.length)} / {systems.length}줄
        </span>
      </SongInfoLine>

      {shown.map((row) => (
        <SystemRow
          key={`${row.page}:${row.system}`}
          resultId={resultId}
          sheet={sheet}
          row={row}
          bars={bars}
          time={time}
          at={at}
          chords={showChords ? chords : undefined}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}

/**
 * 악보 한 줄.
 *
 * 쪽 그림을 통째로 넣고 그 줄만 보이게 창을 씌운다. 잘라낸 그림을
 * 따로 만들지 않는 편이 낫다 — 서버가 쪽마다 한 장만 주면 되고,
 * 화면이 커지면 그만큼 또렷해진다.
 */
function SystemRow({
  resultId,
  sheet,
  row,
  bars,
  time,
  at,
  chords,
  onSeek,
}: {
  resultId: string;
  sheet: SheetData;
  row: { page: number; system: number; bars: number[] };
  bars: { start: number; end: number }[];
  time: number;
  at: number;
  chords?: { bar: number; at: number; label: string }[];
  onSeek?: (t: number) => void;
}) {
  const page = sheet.pages[row.page];
  const first = sheet.bars[row.bars[0]];
  // 잘라 보일 띠는 서버가 줄 사이 간격을 재어 정해 두었다
  const top = first.viewTop ?? Math.max(first.top - 0.05, 0);
  const bottom = first.viewBottom ?? Math.min(first.bottom + 0.05, 1);
  const height = Math.max(bottom - top, 0.02);
  // 창의 세로:가로 비율. 그림을 폭에 맞추면 높이가 이만큼 된다.
  const ratio = (height * (page?.height ?? 1)) / (page?.width ?? 1);

  const live = row.bars.includes(at);
  const hereBar = sheet.bars[at];
  const span = bars[at] ? Math.max(bars[at].end - bars[at].start, 0.05) : 1;
  const progress = bars[at] ? (time - bars[at].start) / span : 0;
  const cursorX = live && hereBar
    ? hereBar.x0 + (hereBar.x1 - hereBar.x0) * Math.min(Math.max(progress, 0), 1)
    : 0;

  return (
    <div
      className="relative w-full overflow-hidden rounded bg-white"
      style={{ paddingTop: `${ratio * 100}%` }}
    >
      {/* 쪽 그림. 이 줄이 창에 꽉 차도록 위로 끌어올린다 */}
      <img
        src={`${apiBase()}/api/sheets/${resultId}/page/${row.page}`}
        alt=""
        className="pointer-events-none absolute left-0 select-none"
        style={{ width: "100%", top: `${(-top / height) * 100}%` }}
        draggable={false}
      />

      {/* 지금 마디 */}
      {live && hereBar && (
        <div
          className="pointer-events-none absolute bg-[var(--accent)]/10"
          style={{
            left: `${hereBar.x0 * 100}%`,
            width: `${(hereBar.x1 - hereBar.x0) * 100}%`,
            top: 0,
            bottom: 0,
          }}
        />
      )}

      {/* 진행 바 */}
      {live && hereBar && (
        <div
          className="pointer-events-none absolute w-[2px] bg-[var(--accent)]"
          style={{ left: `${cursorX * 100}%`, top: 0, bottom: 0 }}
        />
      )}

      {/* 코드 덮어쓰기 */}
      {chords?.map((c, i) => {
        const b = sheet.bars[c.bar];
        if (!b || b.page !== row.page || b.system !== row.system) return null;
        const x = b.x0 + (b.x1 - b.x0) * c.at;
        return (
          <span
            key={i}
            className="pointer-events-none absolute top-0 rounded bg-white px-1 text-[11px] font-bold leading-tight text-[var(--accent)] roomy:text-[15px]"
            style={{ left: `${x * 100}%` }}
          >
            {c.label}
          </span>
        );
      })}

      {/* 눌러서 그 마디로 */}
      {onSeek &&
        row.bars.map((bi) => {
          const b = sheet.bars[bi];
          const t = bars[bi]?.start;
          if (t === undefined) return null;
          return (
            <button
              key={bi}
              className="absolute cursor-pointer"
              style={{
                left: `${b.x0 * 100}%`,
                width: `${(b.x1 - b.x0) * 100}%`,
                top: 0,
                bottom: 0,
              }}
              onClick={() => onSeek(t)}
              aria-label={`${bi + 1}마디로`}
            />
          );
        })}
    </div>
  );
}
