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
  slots,
  slot,
  onSlot,
  canAdd,
  flats,
  onPick,
  onClear,
  onDrop,
  onClose,
}: {
  barNumber: number;
  /** 지금 고르고 있는 자리의 코드. { root, quality } */
  current: { root: string; quality: string } | null;
  /**
   * 이 마디에 놓인 코드들. 한 마디에 둘 이상인 곡이 흔하다 —
   * 「Am … B7」처럼 가운데서 바뀐다. 눌러서 고칠 자리를 고른다.
   */
  slots: string[];
  /** 몇 번째 자리를 고치는가. slots 길이와 같으면 새로 놓는 자리다 */
  slot: number;
  onSlot: (i: number) => void;
  /** 한 자리를 더 놓을 수 있는가. 마디가 너무 잘게 나뉘면 못 놓는다 */
  canAdd: boolean;
  flats: boolean;
  onPick: (root: string, quality: string) => void;
  /** 고른 자리의 코드를 지운다. 간주처럼 코드를 잡지 않는 자리에 쓴다 */
  onClear: () => void;
  /**
   * 고른 자리를 아예 없앤다. 앞 코드가 그 자리까지 이어진다.
   *
   * 지우기와 다르다 — 지우면 빈칸이 남고, 없애면 한 마디에 둘로 잡힌
   * 코드가 하나로 돌아간다. 자리가 둘 이상일 때만 낸다.
   */
  onDrop?: () => void;
  onClose: () => void;
}) {
  const [root, setRoot] = useState(current?.root ?? "C");
  const [quality, setQuality] = useState(current?.quality ?? "maj");
  const [confirmClear, setConfirmClear] = useState(false);
  const label = labelFor(root, quality, flats);

  return (
    <Popup title={`${barNumber}마디 코드`} onClose={onClose}>
      {/* 이 마디에 놓인 코드들. 어느 자리를 고치는지 눌러서 고른다 */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          이 마디
        </span>
        {slots.map((name, i) => (
          <button
            key={i}
            onClick={() => onSlot(i)}
            className={[
              "rounded px-2 py-0.5 text-[12px] font-semibold",
              slot === i
                ? "bg-[var(--pick)] text-[var(--pick-ink)]"
                : "bg-[var(--chip)] text-[var(--foreground)]",
            ].join(" ")}
          >
            {name || "빈칸"}
          </button>
        ))}
        {canAdd && (
          <button
            onClick={() => onSlot(slots.length)}
            className={[
              "rounded px-2 py-0.5 text-[12px] font-semibold",
              slot >= slots.length
                ? "bg-[var(--pick)] text-[var(--pick-ink)]"
                : "bg-[var(--chip)] text-[var(--foreground)]",
            ].join(" ")}
            title="이 마디 뒤쪽 절반에 코드를 하나 더 놓습니다"
          >
            ＋ 추가
          </button>
        )}
      </div>

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
            {slot >= slots.length
              ? "이 마디 뒤쪽 절반에 새로 놓습니다."
              : "고른 자리만 바뀝니다. 앞뒤 마디는 그대로입니다."}
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

      {/*
       * 지우는 단추는 하나다.
       *
       * 마디에 코드가 둘 이상이면 그 자리를 없애고 앞 코드를 그만큼
       * 늘인다. 하나뿐이면 늘일 앞 코드가 없으므로 마디를 비운다 —
       * 간주처럼 코드를 잡지 않는 자리가 있다. 하는 일이 다르니 말도
       * 다르게 적지만, 누르는 자리는 한 곳이어야 헷갈리지 않는다.
       */}
      {current && slot < slots.length && (
        <button
          className="mt-1.5 w-full rounded py-2.5 text-sm text-red-600"
          onClick={() => {
            if (onDrop && slots.length > 1) {
              onDrop();
              onClose();
            } else setConfirmClear(true);
          }}
        >
          {slots.length > 1
            ? "이 코드 삭제 (앞 코드가 이어짐)"
            : "이 마디 코드 삭제"}
        </button>
      )}
      {confirmClear && (
        <AskConfirm
          title="코드 삭제"
          message="이 마디를 코드 없이 비웁니다. 되돌리기로 되살릴 수 있습니다."
          confirmLabel="삭제"
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
