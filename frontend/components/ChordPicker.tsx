"use client";

import { useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { AskConfirm } from "@/components/Ask";
import { Popup } from "@/components/Popup";
import { labelFor } from "@/lib/notation";
import { voicingFor } from "@/lib/voicings";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** 코드표와 같은 이름·같은 순서. 두 화면이 다르면 같은 코드인지 헷갈린다 */
const QUALITIES = [
  { value: "maj", label: "M" },
  { value: "min", label: "m" },
  { value: "7", label: "7" },
  { value: "maj7", label: "M7" },
  { value: "min7", label: "m7" },
  { value: "sus4", label: "Sus4" },
  { value: "sus2", label: "Sus2" },
  { value: "dim", label: "dim" },
];

/**
 * 마디 코드 고르기.
 *
 * 근음과 성질을 따로 고른다. 코드 이름 전부를 늘어놓으면 96칸이라
 * 폰에서 찾을 수 없다.
 *
 * 고른 코드의 운지를 바로 보여준다 — 이름만 보고 고르면 잡을 수 없는
 * 코드를 넣게 된다.
 */
export function ChordPicker({
  barNumber,
  current,
  flats,
  onPick,
  onClear,
  onClose,
}: {
  barNumber: number;
  /** 지금 이 마디의 코드. { root, quality } */
  current: { root: string; quality: string } | null;
  flats: boolean;
  onPick: (root: string, quality: string) => void;
  /** 이 마디의 코드를 지운다. 간주처럼 코드를 잡지 않는 자리에 쓴다 */
  onClear: () => void;
  onClose: () => void;
}) {
  const [root, setRoot] = useState(current?.root ?? "C");
  const [quality, setQuality] = useState(current?.quality ?? "maj");
  const [confirmClear, setConfirmClear] = useState(false);
  const label = labelFor(root, quality, flats);

  return (
    <Popup title={`${barNumber}마디 코드`} onClose={onClose}>
      <div className="mb-2 flex items-center gap-3">
        <div className="shrink-0">
          <ChordDiagram voicing={voicingFor(root, quality)} label={label} width={84} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold">
            <ChordLabel label={label} />
          </div>
          {current && (
            <div className="mt-0.5 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              지금: <ChordLabel label={labelFor(current.root, current.quality, flats)} />
            </div>
          )}
          <p className="mt-1 text-[10px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            이 마디만 바뀝니다. 앞뒤 마디는 그대로입니다.
          </p>
        </div>
      </div>

      <div className="mb-1.5 grid grid-cols-6 gap-1">
        {ROOTS.map((r) => (
          <button
            key={r}
            onClick={() => setRoot(r)}
            className={[
              "rounded py-2 text-xs",
              r === root
                ? "bg-[var(--pick)] text-[var(--pick-ink)]"
                : "bg-[var(--panel)]",
            ].join(" ")}
          >
            <ChordLabel label={labelFor(r, "maj", flats)} />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-1">
        {QUALITIES.map((q) => (
          <button
            key={q.value}
            onClick={() => setQuality(q.value)}
            className={[
              "rounded py-2 text-xs",
              q.value === quality
                ? "bg-[var(--pick)] text-[var(--pick-ink)]"
                : "bg-[var(--panel)]",
            ].join(" ")}
          >
            {q.label}
          </button>
        ))}
      </div>

      <button
        className="mt-3 w-full rounded bg-[var(--accent)] py-3 text-sm font-medium text-white"
        onClick={() => {
          onPick(root, quality);
          onClose();
        }}
      >
        {labelFor(root, quality, flats)} 로 바꾸기
      </button>

      {/* 코드를 아예 없애는 자리. 간주처럼 코드를 잡지 않는 마디가 있다 */}
      {current && (
        <button
          className="mt-1.5 w-full rounded py-2.5 text-sm text-red-600"
          onClick={() => setConfirmClear(true)}
        >
          이 마디 코드 지우기
        </button>
      )}
      {confirmClear && (
        <AskConfirm
          title="코드 지우기"
          message="이 마디의 코드를 지웁니다. 되돌리기로 되살릴 수 있습니다."
          confirmLabel="지우기"
          danger
          onConfirm={() => {
            onClear();
            onClose();
          }}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </Popup>
  );
}
