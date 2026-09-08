"use client";

import { useRef, useState } from "react";

import { Popup } from "@/components/Popup";
import { msczParts, msczToAbc, type MsczPart } from "@/lib/msczToAbc";

/**
 * 타브 줄 위의 숫자를 **다른 악보에서** 가져온다 — 강사님 화면에만 나온다.
 *
 * 타브의 프렛 숫자는 abcjs가 멜로디 음에서 만들어 낸다. 멜로디를 어디서
 * 짚을지 나름대로 고른 것이라, 편곡자가 적어 둔 운지와는 다르다. 같은
 * 파일의 기타 보표(또는 다른 악보 파일)를 넣으면 오선·가사·코드는 그대로
 * 두고 숫자만 그쪽에서 가져온다.
 */
export function TabScorePick({
  has,
  onPick,
}: {
  /** 이미 가져다 둔 것이 있는가 */
  has: boolean;
  /** 고른 악보의 ABC. 뺐으면 null */
  onPick: (abc: string | null) => void;
}) {
  const pick = useRef<HTMLInputElement | null>(null);
  const [ask, setAsk] = useState<{ data: Uint8Array; name: string; parts: MsczPart[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const choose = async (file: File) => {
    setError(null);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const parts = msczParts(data, file.name);
      if (parts.length > 1) {
        setAsk({ data, name: file.name, parts });
        return;
      }
      onPick(msczToAbc(data, file.name, 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "악보를 읽지 못했습니다");
    }
  };

  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <button
        className="rounded bg-[var(--chip)] px-1.5 py-0.5 font-semibold text-[var(--foreground)]"
        onClick={() => pick.current?.click()}
        title="타브 줄 위의 프렛 숫자를 다른 악보의 기타 보표에서 가져옵니다. 코드 이름은 노래 보표에서 함께 옮겨 옵니다. 그림 악보(PDF·사진)에서 가져오려면 왼쪽 「타브 읽어 붙이기」를 쓰세요"
      >
        {has ? "타브 숫자 바꾸기" : "타브 숫자 가져오기"}
      </button>
      {has && (
        <button
          className="underline decoration-dotted"
          onClick={() => onPick(null)}
          title="가져온 것을 물립니다. 그림 악보에서 읽어 둔 타브가 있으면 그것을, 없으면 멜로디 악보에서 만든 숫자를 씁니다"
        >
          되돌리기
        </button>
      )}
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      <input
        ref={pick}
        type="file"
        accept=".mscz,.mscx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void choose(f);
        }}
      />
      {ask && (
        <Popup title="어느 보표의 숫자를 쓸까요" width="max-w-xs" onClose={() => setAsk(null)}>
          <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            기타 보표를 고르세요. 그 보표의 음이 타브 줄 위의 숫자가 됩니다.
          </p>
          <div className="space-y-1.5">
            {ask.parts.map((p) => (
              <button
                key={p.index}
                className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
                onClick={() => {
                  try {
                    onPick(msczToAbc(ask.data, ask.name, p.index));
                    setAsk(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "읽지 못했습니다");
                    setAsk(null);
                  }
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </Popup>
      )}
    </span>
  );
}
