"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SongInfoLine } from "@/components/SongInfoLine";
import { ViewSteppers } from "@/components/ViewSteppers";
import { apiBase } from "@/lib/api";
import { getSheetPage } from "@/lib/library";
import { useSmoothTime } from "@/lib/useSmoothTime";

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

/** 한 창에 담을 수 있는 마디의 최대. 이보다 늘리면 「줄 전체」가 된다 */
const MAX_BARS = 8;

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
  /**
   * 지금 재생 위치를 바로 읽는 길.
   *
   * 바깥의 time은 초당 네 번만 갱신된다(화면 전체를 다시 그리는 값이라
   * 그보다 자주 바꾸면 무겁다). 그 값으로 진행 바를 그리면 최대 0.25초
   * 뒤처져 보인다. 이 창만 제 시계로 매 프레임 따라간다.
   */
  getTime?: () => number;
  /** 그림 위에 덮어쓸 코드. 마디마다 [{at 0~1, label}] */
  /**
   * 그림 위에 덮어쓸 코드.
   *
   * 음높이(카포)를 바꾸면 인쇄된 코드는 더 이상 맞지 않는다. 그때만
   * 우리 코드를 얹는다 — 손대지 않았으면 악보에 적힌 대로가 옳다.
   */
  chords?: { bar: number; at: number; label: string }[];
  showChords: boolean;
  onZoom?: (zoom: number) => void;
  /**
   * 코드 싱크(초). 화면이 노래보다 이르거나 늦을 때 맞춘다.
   *
   * 연주설정에도 있지만 악보를 보며 맞추는 것이라, 악보 옆에 두어야
   * 한 번에 고칠 수 있다. 곡마다 저장된다.
   */
  sync?: number;
  onSync?: (sec: number) => void;
  musicKey: string;
  timeSignature: string;
  playNotes?: string[];
  headerRight?: React.ReactNode;
  onSeek?: (t: number) => void;
  /** 한 번에 보일 줄 수 */
  lines?: number;
  /**
   * 한 번에 볼 마디 수. 0이면 줄 전체.
   *
   * 배율(1.5배·2배)보다 이 편이 알기 쉽다 — 사람이 세는 것은 마디이지
   * 배율이 아니다. 폰에서도 네 마디는 보여야 한 악구가 눈에 들어온다.
   */
  barsView?: number;
  /**
   * 악보에 코드가 인쇄돼 있지 않을 때 대신 얹을 코드(음원에서 딴 것).
   *
   * 멜로디만 그려진 악보가 흔하다. 그런 악보를 그대로 띄우면 기타를
   * 칠 수가 없다 — 코드가 하나도 없으니까. 인쇄된 코드가 있으면
   * 그쪽이 옳으므로 이것은 쓰지 않는다.
   */
  autoChords?: { start: number; end: number; label: string }[];
  /**
   * 마디 번호를 적을지.
   *
   * 인쇄된 번호는 네 마디마다 하나뿐이고 판마다 다르다. 앱이 세는
   * 번호가 보여야 「몇째 마디가 어긋난다」고 짚을 수 있고, 수강생도
   * 「스물세째 마디부터」를 찾을 수 있다.
   */
  numbers?: boolean;
  /**
   * 안내줄 위에 함께 붙박이로 세울 것(강사님 악보설정).
   *
   * 따로 두면 각자 붙박이가 되어 서로 겹친다. 한 상자에 담아야
   * 위아래로 쌓인 채 함께 남는다.
   */
  topBar?: React.ReactNode;
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
  time: rawTime,
  getTime,
  chords,
  showChords,
  onZoom,
  sync = 0,
  onSync,
  musicKey,
  timeSignature,
  playNotes,
  headerRight,
  onSeek,
  lines = 2,
  barsView = 4,
  autoChords,
  numbers = true,
  topBar,
}: Props) {
  const time = useSmoothTime(rawTime, getTime);
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

  // 인쇄된 코드가 없는 악보에 얹을 코드. 마디마다 시각을 알고 있으므로
  // (커서가 그것으로 움직인다) 그 안에 걸린 코드를 그 자리에 놓는다.
  const auto = useMemo(() => {
    if (!autoChords?.length || !steps.length) return [];
    // 음원에서 잡은 코드 바뀜은 몇십 분의 일 초쯤 흔들린다. 그대로
    // 얹으면 글자가 마디 한가운데에 어정쩡하게 앉고, 마디선보다 살짝
    // 이른 것은 **앞 마디 끝**에 붙어 한 박자 어긋나 보인다.
    // 가장 가까운 박으로 당겨 붙이되, 마디를 넘어가는 것은 넘겨 준다.
    const perBar = Math.max(
      Number.parseInt((timeSignature || "4/4").split("/")[0], 10) || 4,
      1,
    );
    const out: { bar: number; at: number; label: string }[] = [];
    const taken = new Set<string>();
    let last = "";
    let si = 0;

    for (const c of autoChords) {
      // 악보가 시작하기 전(전주)이나 끝난 뒤의 코드는 적을 자리가 없다
      if (c.start < steps[0].start - 0.3) continue;
      while (si < steps.length - 1 && c.start >= steps[si].end) si += 1;
      const s = steps[si];
      if (c.start >= s.end + 0.3) continue;

      const span = Math.max(s.end - s.start, 0.01);
      let idx = si;
      let beat = Math.round(((c.start - s.start) / span) * perBar);
      if (beat >= perBar) {
        // 마디선을 넘어섰다 — 다음 마디 첫 박이 제자리다
        if (si + 1 < steps.length) {
          idx = si + 1;
          beat = 0;
        } else {
          beat = perBar - 1;
        }
      }
      if (beat < 0) beat = 0;

      if (c.label === last) continue;
      last = c.label;
      const key = `${idx}:${beat}`;
      if (taken.has(key)) continue; // 한 박에 둘을 겹쳐 적지 않는다
      taken.add(key);
      out.push({ bar: steps[idx].bar, at: beat / perBar, label: c.label });
    }
    return out;
  }, [autoChords, steps, timeSignature]);

  /** 화면에 적을 코드. 인쇄된 것을 고쳐 적거나, 없으면 딴 것을 얹는다 */
  const shownChords = showChords && chords?.length ? chords : auto;

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

  // 창을 몇 줄만 띄울 때는 지금 줄이 맨 위에 온다. 곡 전체를 펴는
  // 화면(전체보기)에서는 처음부터 죽 보인다.
  const current = systems.findIndex((s) => s.bars.includes(at));
  const whole = lines >= systems.length;
  const from = whole ? 0 : Math.max(current < 0 ? 0 : current, 0);
  const shown = systems.slice(from, from + lines);

  // 곡 전체를 펴 놓으면 악보가 화면보다 길다. 노래가 나아가면 지금 줄이
  // 화면 아래로 밀려나 진행 바가 보이지 않는다 — 줄이 바뀔 때마다 그
  // 줄을 화면 가운데로 끌어온다. 매 프레임이 아니라 줄이 바뀔 때만
  // 움직이므로 손으로 훑어볼 때 방해가 되지 않는다.
  const hereRow = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!whole || current < 0) return;
    hereRow.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [whole, current]);

  return (
    <div>
      {/* 악보설정과 안내줄을 한 상자에 담아 함께 붙박이로 세운다 */}
      <div className="sticky top-0 z-20 bg-[var(--background)]">
      {topBar}
      <SongInfoLine
        musicKey={musicKey}
        timeSignature={timeSignature}
        playNotes={playNotes}
        right={headerRight}
      >
        <ViewSteppers
          sync={sync}
          onSync={onSync}
          bars={barsView}
          onBars={onZoom}
          barsMax={MAX_BARS}
          barsLabel="줄 전체"
        />
      </SongInfoLine>
      </div>

      {/* 줄과 줄을 붙여 한 장의 악보처럼 보이게 한다 */}
      <div className="overflow-hidden rounded bg-white">
      {/* 첫 줄이 보일 때는 악보 머리(제목·가수·작사작곡)도 함께 띄운다.
          종이 악보를 펴면 맨 위에 제목이 있는 것과 같다. 곡이 나아가
          다음 줄로 넘어가면 저절로 사라진다. */}
      {from === 0 && <TitleBand resultId={resultId} sheet={sheet} />}
      {shown.map((row, i) => (
        <SystemRow
          key={`${row.page}:${row.system}`}
          innerRef={from + i === current ? hereRow : undefined}
          resultId={resultId}
          sheet={sheet}
          row={row}
          steps={steps}
          step={step}
          time={time}
          at={at}
          barsView={barsView}
          chords={shownChords.length ? shownChords : undefined}
          showNumbers={numbers}
          onSeek={onSeek}
        />
      ))}
      </div>
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
/**
 * 악보 첫 쪽의 머리 — 제목·가수·작사작곡.
 *
 * 첫 줄 오선 위의 여백이 곧 그 자리다. 따로 찾을 것이 없다. 연주
 * 화면에서는 자리가 아까워 잘라내지만, 전체보기는 곡을 처음부터 죽
 * 펴 보는 자리라 제목이 있어야 무슨 악보인지 안다.
 */
function TitleBand({ resultId, sheet }: { resultId: string; sheet: SheetData }) {
  const src = usePageUrl(resultId, 0);
  const page = sheet.pages[0];
  const first = sheet.bars.find((b) => b.page === 0);
  // 첫 줄 띠가 시작하는 바로 그 자리에서 끊는다. 조금이라도 겹치거나
  // 벌어지면 빠르기표(♩=113)처럼 경계에 걸친 글자가 잘린다.
  const bottom = Math.max(first?.viewTop ?? 0, 0);
  const x0 = Math.max(page?.left ?? 0, 0);
  const x1 = Math.min(page?.right ?? 1, 1);
  const viewW = Math.max(x1 - x0, 0.02);
  // 머리가 없는 악보(바로 오선부터 시작)는 아예 그리지 않는다
  if (!page || bottom < 0.02) return null;
  const ratio = (bottom * page.height) / (viewW * page.width);

  return (
    <div
      className="relative w-full overflow-hidden bg-white"
      style={{ paddingTop: `${ratio * 100}%` }}
    >
      <img
        src={src}
        alt=""
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: `${(100 / viewW).toFixed(3)}%`,
          left: `${(-x0 / viewW) * 100}%`,
          top: 0,
        }}
        draggable={false}
      />
    </div>
  );
}

function SystemRow({
  innerRef,
  resultId,
  sheet,
  row,
  steps,
  step,
  time,
  at,
  barsView,
  chords,
  onSeek,
  showNumbers,
}: {
  /** 지금 연주 중인 줄에만 붙는다. 화면을 이 줄로 끌어오는 데 쓴다 */
  innerRef?: React.Ref<HTMLDivElement>;
  resultId: string;
  sheet: SheetData;
  row: { page: number; system: number; bars: number[] };
  steps: { bar: number; start: number; end: number }[];
  step: number;
  time: number;
  at: number;
  barsView: number;
  chords?: { bar: number; at: number; label: string }[];
  onSeek?: (t: number) => void;
  showNumbers?: boolean;
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

  // 마디 몇 개를 창에 담을지로 자른다. 배율이 아니라 마디 수로 정하면
  // 여백이 저절로 빠지고, 몇 마디가 보일지도 사람이 미리 안다.
  const rowBars = row.bars;
  const firstX = rowBars.length ? sheet.bars[rowBars[0]].x0 : 0;
  const lastX = rowBars.length ? sheet.bars[rowBars[rowBars.length - 1]].x1 : 1;
  const count = barsView > 0 ? Math.min(barsView, rowBars.length) : rowBars.length;
  // 지금 마디가 창 안에 들어오게. 줄의 끝을 넘지 않는다.
  const hereAt = Math.max(rowBars.indexOf(at), 0);
  const start = Math.min(
    Math.max(hereAt - Math.floor((count - 1) / 2), 0),
    Math.max(rowBars.length - count, 0),
  );
  // 마디선에 바싹 붙여 자르면 그 자리의 음표 머리가 반쯤 잘린다.
  const pad = (lastX - firstX) * 0.022;
  // 줄의 첫 마디를 보일 때는 **자리표와 조표까지** 담아야 한다.
  // 그것들은 첫 마디선보다 왼쪽에 있어서, 마디선에서 자르면 사라진다.
  const x0 =
    start === 0
      ? Math.max(page?.left ?? 0, 0)
      : Math.max(sheet.bars[rowBars[start]].x0 - pad, 0);
  // 줄의 마지막 마디까지 보일 때는 쪽 오른쪽 끝에 맞춘다. 여기에 또
  // 여유를 더하면 오선 오른쪽에 흰 자리가 남아 악보가 작아 보인다.
  const lastOne = start + count >= rowBars.length;
  const x1 = Math.min(
    sheet.bars[rowBars[Math.min(start + count, rowBars.length) - 1]].x1 + pad,
    lastOne ? (page?.right ?? 1) : 1,
  );
  const viewW = Math.max(x1 - x0, 0.02);
  /** 쪽 가로 자리(0~1) → 창 안의 자리(0~1) */
  const toX = (px: number) => (px - x0) / viewW;

  // 창의 세로:가로 비율
  const ratio = (height * (page?.height ?? 1)) / (viewW * (page?.width ?? 1));
  // 지금 마디 안에서 얼마나 왔는지가 커서 자리다
  const cursorX = toX(
    live && hereBar
      ? hereBar.x0 + (hereBar.x1 - hereBar.x0) * Math.min(Math.max(progress, 0), 1)
      : x0,
  );

  return (
    <div
      ref={innerRef}
      className="relative w-full overflow-hidden bg-white"
      style={{ paddingTop: `${ratio * 100}%` }}
    >
      {/* 쪽 그림. 이 줄이 창에 꽉 차도록 위로 끌어올린다 */}
      <img
        src={src}
        alt=""
        // max-w-none이 없으면 Tailwind의 기본값(max-width:100%)이 폭을
        // 100%로 되돌린다 — 잘라내기도 확대도 전혀 먹지 않는다.
        className="pointer-events-none absolute max-w-none select-none"
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

      {/* 마디 번호. 인쇄된 번호는 네 마디마다 하나뿐이고 판마다 다르다 —
          앱이 세는 번호를 적어 두어야 「몇째 마디가 어긋난다」고 짚을 수
          있고, 마디 맞추기도 이 번호를 보고 한다. */}
      {showNumbers &&
        row.bars.slice(start, start + count).map((bi) => {
          const b = sheet.bars[bi];
          if (!b) return null;
          return (
            <span
              key={`n${bi}`}
              className="pointer-events-none absolute rounded-sm bg-white/80 px-[1px] text-[7px] font-semibold leading-none text-gray-400 roomy:text-[9px]"
              style={{ left: `${toX(b.x0) * 100}%`, top: 0 }}
            >
              {bi + 1}
            </span>
          );
        })}

      {/* 코드 덮어쓰기. 인쇄된 코드가 있는 자리(오선 바로 위)에 얹는다 —
          줄 맨 위에 찍으면 앞 줄 가사 위에 뜬다. */}
      {chords?.map((c, i) => {
        const b = sheet.bars[c.bar];
        if (!b || b.page !== row.page || b.system !== row.system) return null;
        // 인쇄된 코드는 마디선이 아니라 그 박의 음표 위에 놓인다.
        // 조금 오른쪽으로 밀어야 겹친다. 줄의 첫 마디는 자리표와 조표가
        // 앞을 차지하므로 더 밀어야 한다.
        const nudge = c.bar === row.bars[0] ? 0.12 : 0.035;
        const x = toX(b.x0 + (b.x1 - b.x0) * (c.at + nudge));
        return (
          <span
            key={i}
            // 인쇄된 코드를 가리고 그 자리에 앉는다. 흰 바탕을 조금
            // 넉넉히 두어 아래 글자가 비쳐 보이지 않게 한다.
            className="pointer-events-none absolute rounded-sm bg-white px-[2px] text-[8.5px] font-extrabold leading-[1.15] roomy:text-[11px]"
            style={{
              left: `${x * 100}%`,
              // 인쇄된 코드를 덮어쓴 것이니 또렷해야 한다. 강조색을
              // 그대로 쓰면 흰 바탕에서 옅어 인쇄 글자보다 흐려 보인다.
              color: "color-mix(in srgb, var(--accent) 65%, #000)",
              // 인쇄된 코드는 오선 바로 위 한 칸쯤에 앉는다. 그 자리를
              // 덮도록 오선 윗줄보다 조금 올려 놓는다.
              bottom: `${(1 - (first.top - top - (first.bottom - first.top) * 0.3) / height) * 100}%`,
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
