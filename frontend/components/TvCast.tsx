"use client";

import { useState } from "react";

import { Popup } from "@/components/Popup";

/**
 * TV로 보기 — 같은 와이파이의 TV에 이 화면을 띄우는 길을 알려 준다(강사님).
 *
 * 웹 페이지는 보안 때문에 네트워크의 TV를 스스로 찾지 못한다. 그래서 기기에
 * 들어 있는 화면 보내기(스마트뷰·AirPlay·크롬 탭 전송)를 쓰게 하고, 연결된
 * 뒤에는 「TV 화면으로」로 보던 악보를 크게 펼친다. 폰 화면이 그대로 TV에
 * 가므로 재생·정지·곡 넘기기도 폰에서 하면 된다.
 */

type Kind = "android" | "ios" | "windows" | "mac" | "other";

interface Guide {
  name: string;
  steps: string[];
  /** 이 길로 연결되는 TV */
  tv: string;
}

const GUIDES: Record<Kind, Guide> = {
  android: {
    name: "안드로이드 폰·태블릿",
    steps: [
      "화면 맨 위를 두 번 쓸어내려 빠른 설정을 엽니다",
      "「Smart View」(삼성) 또는 「화면 전송」을 누릅니다",
      "목록에서 TV를 고르고 「지금 시작」을 누릅니다",
    ],
    tv: "삼성 TV, 크롬캐스트·구글 TV, 화면 미러링이 되는 TV",
  },
  ios: {
    name: "아이폰·아이패드",
    steps: [
      "화면 오른쪽 위를 쓸어내려 제어 센터를 엽니다",
      "「화면 미러링」을 누릅니다",
      "목록에서 TV를 고릅니다 — TV에 번호가 뜨면 그 번호를 넣습니다",
    ],
    tv: "애플 TV, AirPlay가 되는 삼성·LG TV(대개 2019년 이후 제품)",
  },
  windows: {
    name: "윈도우 PC",
    steps: [
      "크롬 오른쪽 위 ⋮ 메뉴에서 「전송…」을 누릅니다(엣지는 ⋯ → 「기타 도구」 → 「미디어를 장치로 캐스트」)",
      "「소스」에서 「탭 전송」을 고르고 TV를 누릅니다",
      "TV가 목록에 없으면 키보드 ⊞(윈도우) + K 로 무선 디스플레이에 연결합니다",
    ],
    tv: "크롬캐스트·구글 TV, 미라캐스트(무선 디스플레이)가 되는 TV",
  },
  mac: {
    name: "맥",
    steps: [
      "메뉴 막대 오른쪽의 제어 센터에서 「화면 미러링」을 누릅니다",
      "목록에서 TV를 고릅니다",
      "크롬을 쓰면 ⋮ 메뉴 → 「전송…」으로 이 탭만 보낼 수도 있습니다",
    ],
    tv: "애플 TV, AirPlay가 되는 삼성·LG TV, 크롬캐스트",
  },
  other: {
    name: "이 기기",
    steps: [
      "기기의 「화면 미러링」 또는 「화면 전송」 기능을 켭니다",
      "목록에서 TV를 고릅니다",
    ],
    tv: "화면 미러링을 받는 TV",
  },
};

/** 누른 기기가 무엇인가. 아이패드는 맥처럼 자신을 밝히므로 터치로 가린다 */
function deviceKind(): Kind {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh/.test(ua)) return "mac";
  return "other";
}

const DIM = "text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]";

export function TvCast({ onTvMode }: { onTvMode?: () => void }) {
  // 창을 열 때 기기를 알아본다 — 그리기 전(정적 내보내기)에는 navigator가 없다
  const [kind, setKind] = useState<Kind | null>(null);
  const guide = kind ? GUIDES[kind] : null;
  const phone = kind === "ios" || kind === "android";

  return (
    <>
      <button
        onClick={() => setKind(deviceKind())}
        className="shrink-0 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]"
        title="같은 와이파이의 TV에 이 화면을 띄웁니다"
      >
        TV로 보기
      </button>
      {kind && guide && (
        <Popup title="TV로 보기" onClose={() => setKind(null)}>
          <p className="mb-2 text-[12px] leading-snug">
            이 {phone ? "폰과" : "기기와"} TV가 <b>같은 와이파이</b>에 있어야 합니다. 화면이
            그대로 TV에 가므로 재생·정지·곡 넘기기는 여기서 하면 됩니다.
          </p>
          <div className="mb-1 text-[13px] font-semibold text-[var(--accent)]">{guide.name}</div>
          <ol className="mb-1 list-decimal space-y-1 pl-5 text-[13px] leading-snug">
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className={`mb-3 text-[11px] ${DIM}`}>연결되는 TV: {guide.tv}</p>
          {onTvMode && (
            <button
              className="mb-1 w-full rounded bg-[var(--pick)] py-2.5 text-sm font-semibold text-[var(--pick-ink)]"
              onClick={() => {
                setKind(null);
                onTvMode();
              }}
            >
              TV 화면으로
            </button>
          )}
          <p className={`mb-3 text-[11px] leading-snug ${DIM}`}>
            TV에 연결한 뒤 누르세요 — 보던 악보를 크게 펼치고 화면을 가득 채웁니다.
            {phone ? " 폰을 가로로 돌리면 TV를 가득 채웁니다." : ""}
          </p>
          <details className="text-[12px]">
            <summary className={`cursor-pointer ${DIM}`}>다른 기기로 연결할 때</summary>
            {(Object.keys(GUIDES) as Kind[])
              .filter((k) => k !== kind && k !== "other")
              .map((k) => (
                <div key={k} className="mt-2">
                  <div className="font-semibold">{GUIDES[k].name}</div>
                  <ol className="list-decimal pl-5 leading-snug">
                    {GUIDES[k].steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              ))}
          </details>
        </Popup>
      )}
    </>
  );
}
