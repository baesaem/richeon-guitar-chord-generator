"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { apiBase } from "@/lib/api";
import { getSheetPage } from "@/lib/library";

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
  pages: {
    index: number;
    width: number;
    height: number;
    /** 쪽 여백을 뺀 가로 범위(0~1) */
    left?: number;
    right?: number;
  }[];
  bars: SheetBar[];
  /**
   * 부르는 차례. 걸음마다 「그림의 몇 번째 마디」와 그 시각.
   *
   * 도돌이표를 편 곡은 같은 마디가 여러 번 나온다 — 종이 악보를 보며
   * 연주할 때 D.S.를 만나면 사람도 그 마디로 되돌아간다. 화면도 그런다.
   */
  passes: { bar: number; start: number; end: number }[][];
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
  onZoom?: (zoom: number) => void;
  musicKey: string;
  timeSignature: string;
  playNotes?: string[];
  headerRight?: React.ReactNode;
  onSeek?: (t: number) => void;
  /** 한 번에 보일 줄 수 */
  lines?: number;
  /** 확대 배율. 1보다 크면 지금 마디를 가운데 두고 옆으로 따라간다 */
  zoom?: number;
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
  onZoom,
  musicKey,
  timeSignature,
  playNotes,
  headerRight,
  onSeek,
  lines = 2,
  zoom = 1,
}: Props) {
  const pass = passAt(sheet, time);
  const steps = sheet.passes[pass] ?? [];

  // 지금 몇 번째 걸음인가
  const step = useMemo(() => {
    let found = -1;
    for (let i = 0; i < steps.length; i++) {
      if (time >= steps[i].start) found = i;
      else break;
    }
    return Math.max(found, 0);
  }, [steps, time]);
  /** 지금 걸음이 가리키는 그림 위 마디 */
  const at = steps[step]?.bar ?? 0;

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
        {onZoom && (
          <button
            className="ml-1.5 shrink-0 rounded px-1.5 py-0.5 text-gray-500 underline decoration-dotted underline-offset-2"
            onClick={() => onZoom(zoom >= 2 ? 1 : zoom + 0.5)}
            title="지금 마디를 가운데 두고 크게 봅니다"
          >
            {zoom > 1 ? `${zoom}배` : "확대"}
          </button>
        )}
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
          steps={steps}
          step={step}
          time={time}
          at={at}
          zoom={zoom}
          chords={showChords ? chords : undefined}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}

/**
 * 쪽 그림의 주소.
 *
 * 기기에 받아 둔 것을 먼저 본다 — 수강생 화면에는 분석 서버가 없다.
 * 곡 파일로 받은 악보는 기기에 들어 있으므로, 서버 없이도 펼쳐진다.
 */
function usePageUrl(resultId: string, index: number): string {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made = "";
    getSheetPage(resultId, index)
      .then((blob) => {
        if (!alive || !blob) return;
        made = URL.createObjectURL(blob);
        setLocal(made);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [resultId, index]);
  return local ?? `${apiBase()}/api/sheets/${resultId}/page/${index}`;
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
  steps,
  step,
  time,
  at,
  zoom,
  chords,
  onSeek,
}: {
  resultId: string;
  sheet: SheetData;
  row: { page: number; system: number; bars: number[] };
  steps: { bar: number; start: number; end: number }[];
  step: number;
  time: number;
  at: number;
  zoom: number;
  chords?: { bar: number; at: number; label: string }[];
  onSeek?: (t: number) => void;
}) {
  const page = sheet.pages[row.page];
  const first = sheet.bars[row.bars[0]];
  const src = usePageUrl(resultId, row.page);
  // 잘라 보일 띠는 서버가 줄 사이 간격을 재어 정해 두었다
  const top = first.viewTop ?? Math.max(first.top - 0.05, 0);
  const bottom = first.viewBottom ?? Math.min(first.bottom + 0.05, 1);
  const height = Math.max(bottom - top, 0.02);

  const live = row.bars.includes(at);
  const hereBar = sheet.bars[at];
  const now = steps[step];
  const span = now ? Math.max(now.end - now.start, 0.05) : 1;
  const progress = now ? (time - now.start) / span : 0;

  // 쪽 여백을 빼고, 배율만큼 좁게 잘라 본다. 배율이 1보다 크면 지금
  // 마디를 한가운데 두고 옆으로 따라간다 — 어르신 화면에서 음표가
  // 작으면 아무 소용이 없다.
  const cropL = page?.left ?? 0;
  const cropR = page?.right ?? 1;
  const cropW = Math.max(cropR - cropL, 0.05);
  const viewW = cropW / zoom;
  const centre =
    live && hereBar
      ? hereBar.x0 + (hereBar.x1 - hereBar.x0) * Math.min(Math.max(progress, 0), 1)
      : row.bars.length
        ? sheet.bars[row.bars[0]].x0
        : cropL;
  const x0 = Math.min(
    Math.max(centre - viewW / 2, cropL),
    Math.max(cropR - viewW, cropL),
  );
  /** 쪽 가로 자리(0~1) → 창 안의 자리(0~1) */
  const toX = (px: number) => (px - x0) / viewW;

  // 창의 세로:가로 비율
  const ratio = (height * (page?.height ?? 1)) / (viewW * (page?.width ?? 1));
  const cursorX = toX(centre);

  return (
    <div
      className="relative w-full overflow-hidden rounded bg-white"
      style={{ paddingTop: `${ratio * 100}%` }}
    >
      {/* 쪽 그림. 이 줄이 창에 꽉 차도록 위로 끌어올린다 */}
      <img
        src={src}
        alt=""
        className="pointer-events-none absolute select-none"
        style={{
          width: `${(100 / viewW).toFixed(3)}%`,
          left: `${(-x0 / viewW) * 100}%`,
          top: `${(-top / height) * 100}%`,
        }}
        draggable={false}
      />

      {/* 지금 마디 */}
      {live && hereBar && (
        <div
          className="pointer-events-none absolute bg-[var(--accent)]/10"
          style={{
            left: `${toX(hereBar.x0) * 100}%`,
            width: `${((hereBar.x1 - hereBar.x0) / viewW) * 100}%`,
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

      {/* 코드 덮어쓰기. 인쇄된 코드가 있는 자리(오선 바로 위)에 얹는다 —
          줄 맨 위에 찍으면 앞 줄 가사 위에 뜬다. */}
      {chords?.map((c, i) => {
        const b = sheet.bars[c.bar];
        if (!b || b.page !== row.page || b.system !== row.system) return null;
        const x = toX(b.x0 + (b.x1 - b.x0) * c.at);
        return (
          <span
            key={i}
            className="pointer-events-none absolute rounded-sm bg-white px-0.5 text-[10px] font-bold leading-none text-[var(--accent)] roomy:text-[13px]"
            style={{
              left: `${x * 100}%`,
              bottom: `${(1 - (first.top - top) / height) * 100}%`,
            }}
          >
            {c.label}
          </span>
        );
      })}

      {/* 눌러서 그 마디로 */}
      {onSeek &&
        row.bars.map((bi) => {
          const b = sheet.bars[bi];
          // 되돌아가는 곡은 같은 마디를 여러 번 부른다. 지금 자리에서
          // 가장 가까운 걸음으로 보낸다 — 늘 처음으로 튀면 곤란하다.
          let t: number | undefined;
          let best = Infinity;
          for (const st of steps) {
            if (st.bar !== bi) continue;
            const d = Math.abs(st.start - time);
            if (d < best) {
              best = d;
              t = st.start;
            }
          }
          if (t === undefined) return null;
          return (
            <button
              key={bi}
              className="absolute cursor-pointer"
              style={{
                left: `${toX(b.x0) * 100}%`,
                width: `${((b.x1 - b.x0) / viewW) * 100}%`,
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
