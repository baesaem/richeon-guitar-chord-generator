"use client";

import { useEffect, useRef, useState } from "react";

import { AskConfirm } from "@/components/Ask";
import { Working } from "@/components/Working";
import { openLink } from "@/lib/openLink";
import { deleteMySheet, mySheetUrl, uploadMySheet } from "@/lib/api";
import { getLocalSheet, removeLocalSheet } from "@/lib/library";

/**
 * 내가 가진 악보.
 *
 * 웹에서 찾은 악보를 매번 다시 검색하기는 번거롭다. 손에 있는 악보를
 * (사진을 찍었든 PDF를 받았든) 곡에 붙여 두면 그 곡을 열 때마다 바로
 * 펼쳐 볼 수 있다. 파일은 서버에 두므로 폰에서 열어도 같은 악보가 보인다.
 *
 * 악보는 세로로 넘겨 보는 것이 자연스럽다. 가로로 찍힌 사진은 세워서
 * 보여 주되 원본은 건드리지 않는다 — 되돌리고 싶을 수 있다.
 *
 * 곡 파일로 받은 악보는 기기에 들어 있다. 서버가 없는 수강생 화면에서도
 * 그것을 그대로 펼친다 — 등록은 못 해도 받은 것은 볼 수 있어야 한다.
 */
export function MySheet({ resultId, online }: { resultId: string; online: boolean }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [kind, setKind] = useState<"image" | "pdf">("image");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 가로로 찍힌 사진인가. 그럴 때만 세우기 버튼을 보여 준다.
  const [landscape, setLandscape] = useState(false);
  const [rotate, setRotate] = useState(false);
  // 같은 주소로 다시 올리면 브라우저가 옛 그림을 보여준다. 그때마다 바꾼다.
  const [stamp, setStamp] = useState(0);
  // 기기에 받아 둔 악보. 곡 파일로 함께 온 것이다
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 기기에 있는 것을 먼저 본다. 서버가 없어도 받은 악보는 열려야 한다.
  useEffect(() => {
    let alive = true;
    let made = "";
    getLocalSheet(resultId)
      .then((sheet) => {
        if (!alive || !sheet) return;
        made = URL.createObjectURL(sheet.blob);
        setLocalUrl(made);
        setKind(sheet.kind);
        setHas(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [resultId]);

  useEffect(() => {
    if (!online || localUrl) return;
    let alive = true;
    fetch(mySheetUrl(resultId), { method: "HEAD" })
      .then((res) => {
        if (!alive) return;
        setHas(res.ok);
        setKind((res.headers.get("content-type") ?? "").includes("pdf") ? "pdf" : "image");
      })
      .catch(() => {
        if (alive) setHas(false);
      });
    return () => {
      alive = false;
    };
  }, [resultId, online, localUrl]);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const res = await uploadMySheet(resultId, file);
      setHas(true);
      setKind(res.kind);
      setRotate(false);
      setStamp(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (online) await deleteMySheet(resultId).catch(() => {});
      await removeLocalSheet(resultId).catch(() => {});
      setLocalUrl(null);
      setHas(false);
      setRotate(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 서버도 없고 기기에 받아 둔 것도 없으면 할 수 있는 일이 없다
  if (!online && !localUrl) {
    return (
      <p className="py-4 text-center text-xs leading-relaxed text-gray-500">
        받아 둔 악보가 없습니다.
        <br />
        악보를 직접 등록하려면 분석 서버가 필요합니다.
      </p>
    );
  }

  const url = localUrl ?? `${mySheetUrl(resultId)}?v=${stamp}`;

  return (
    <>
      {busy && <Working label="악보 올리는 중" />}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = "";
        }}
      />

      <div className="mb-2 flex items-center gap-2">
        {online && (
          <button
            className="rounded bg-gray-200/70 px-2.5 py-1.5 text-xs font-medium disabled:opacity-40 dark:bg-gray-800"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {has ? "다른 악보로 바꾸기" : "악보 등록하기"}
          </button>
        )}
        {has && (
          <button
            className="px-2 py-1.5 text-xs text-gray-500 disabled:opacity-40"
            disabled={busy}
            onClick={() => setConfirmRemove(true)}
          >
            지우기
          </button>
        )}
        {confirmRemove && (
          <AskConfirm
            title="내 악보 지우기"
            message="이 곡에 붙여 둔 악보를 지웁니다."
            confirmLabel="지우기"
            danger
            onConfirm={remove}
            onClose={() => setConfirmRemove(false)}
          />
        )}
        {online && (
          <span className="ml-auto text-[10px] text-gray-400">
            이미지 · PDF · 20MB까지
          </span>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded bg-red-50 p-2 text-[11px] text-red-700">{error}</p>
      )}

      {has === null && <p className="py-4 text-center text-xs text-gray-400">확인 중…</p>}

      {has === false && (
        <p className="py-6 text-center text-xs leading-relaxed text-gray-500">
          등록된 악보가 없습니다.
          <br />
          가지고 있는 악보를 사진으로 찍거나 PDF로 올려 두면
          <br />이 곡을 열 때마다 여기서 바로 볼 수 있습니다.
        </p>
      )}

      {has && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700">
          {kind === "image" ? (
            <div className="flex justify-center overflow-auto bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="등록한 악보"
                onLoad={(e) => {
                  const el = e.currentTarget;
                  const wide = el.naturalWidth > el.naturalHeight * 1.15;
                  setLandscape(wide);
                  setRotate(wide); // 가로 사진은 세워서 펼친다
                }}
                className={rotate ? "origin-center rotate-90" : "h-auto w-full"}
                style={
                  rotate
                    ? { width: "auto", height: "min(70vh, 90vw)", maxWidth: "none" }
                    : undefined
                }
              />
            </div>
          ) : (
            <object
              data={url}
              className="h-[70vh] w-full rounded-lg"
              type="application/pdf"
            >
              <div className="p-4 text-center text-xs text-gray-500">
                여기서 열리지 않습니다.{" "}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  onClick={(e) => {
                    e.preventDefault();
                    openLink(url);
                  }}
                >
                  새 창에서 열기 ↗
                </a>
              </div>
            </object>
          )}

          <div className="flex items-center gap-2 border-t border-gray-200 px-2 py-1 dark:border-gray-700">
            {kind === "image" && landscape && (
              <button
                className="text-[11px] text-gray-500 underline"
                onClick={() => setRotate((v) => !v)}
              >
                {rotate ? "원래 방향으로" : "세로로 세우기"}
              </button>
            )}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[11px] text-gray-500 underline"
              onClick={(e) => {
                e.preventDefault();
                openLink(url);
              }}
            >
              크게 보기 ↗
            </a>
          </div>
        </div>
      )}
    </>
  );
}
