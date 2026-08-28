"use client";

import { useState } from "react";

import { Copyright } from "@/components/Copyright";
import { LinkShelf } from "@/components/LinkShelf";
import { Working } from "@/components/Working";
import { downloadLessonFile, importLessonsFromDrive } from "@/lib/lessonShare";

/**
 * 공부방 — 밖에서 보며 배우는 것들.
 *
 * 강의실은 선생님이 올린 자료, 내 강좌는 각자 따로 듣는 것. 둘 다
 * 링크를 담아 두고 눌러서 그 자리로 가는 방식이다 — 영상을 앱 안에
 * 붙들어 두지 않는다. YouTube가 중심이지만 밴드·블로그·카페처럼
 * 영상이 아닌 자료도 담긴다.
 *
 * 강의실은 곡과 같은 길로 오간다. 선생님이 링크를 모아 파일로
 * 내보내 공유 폴더에 올리면, 수강생이 「새 강좌 가져오기」로 받는다.
 */
export function LessonTab({
  adminMode,
  online,
}: {
  /** 관리자만 강의실을 파일로 내보낸다 */
  adminMode: boolean;
  /** 분석 서버가 붙어 있는가. 없으면 드라이브에서 직접 받는다 */
  online: boolean;
}) {
  const [page, setPage] = useState<"classroom" | "mine">("classroom");
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 받아 온 링크를 화면에 곧바로 비추려면 목록을 다시 읽어야 한다
  const [reloadKey, setReloadKey] = useState(0);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  };

  const importFromDrive = async () => {
    setWorking("새 강좌 찾는 중");
    setError(null);
    try {
      const { added, files } = await importLessonsFromDrive(online);
      if (files === 0) flash("공유 폴더에 올라온 강의실 자료가 아직 없습니다.");
      else if (added === 0) flash("이미 받은 것과 같습니다. 그대로 두었습니다.");
      else {
        flash(`강좌 ${added}개를 받았습니다.`);
        setReloadKey((k) => k + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const exportToFile = () => {
    setError(null);
    const count = downloadLessonFile();
    if (count === 0) setError("강의실에 담긴 링크가 없습니다.");
    else flash(`${count}개를 파일로 내보냈습니다. 공유 폴더에 올리세요.`);
  };

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      {working && <Working label={working} />}
      <h2 className="mb-2 text-lg font-bold roomy:hidden">공부방</h2>

      <div className="mb-3 flex gap-1">
        {(
          [
            ["classroom", "강의실"],
            ["mine", "내 강좌"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setPage(value)}
            className={[
              "flex-1 whitespace-nowrap rounded px-2 py-2 text-[13px]",
              page === value
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-gray-100 dark:bg-gray-800",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <p className="mb-2 rounded bg-green-50 p-2 text-xs text-green-800">{notice}</p>
      )}
      {error && (
        <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>
      )}

      {page === "classroom" ? (
        <>
          {/* 받기·내보내기. 수강생은 받기만, 선생님은 둘 다 쓴다 */}
          <div className="mb-2 flex gap-1.5">
            <button
              className="flex-1 rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
              onClick={importFromDrive}
            >
              새 강좌 가져오기
            </button>
            {adminMode && (
              <button
                className="shrink-0 rounded bg-gray-100 px-3 py-2.5 text-sm font-medium dark:bg-gray-800"
                onClick={exportToFile}
                title="강의실을 파일로 만들어 공유 폴더에 올립니다"
              >
                내보내기
              </button>
            )}
          </div>
          <LinkShelf
            key={reloadKey}
            shelf="classroom"
            addLabel="+ 강의실 링크 추가"
            canAdd={adminMode}
            blurb={
              adminMode
                ? "선생님이 올리는 강좌·자료입니다. 링크를 담고 「내보내기」로 파일을 만들어 반 공유 폴더에 올리면, 수강생이 「새 강좌 가져오기」로 받아 갑니다."
                : "선생님이 올린 강좌와 자료입니다. 「새 강좌 가져오기」를 누르면 기타반 공유 폴더에서 새 자료를 받아 옵니다."
            }
          />
        </>
      ) : (
        <LinkShelf
          shelf="mine"
          addLabel="+ 내 강좌 추가"
          blurb="따로 듣고 있는 강좌를 담아 두는 곳입니다. 이 기기에만 저장되고, 누르면 그 자리로 열립니다."
        />
      )}

      <Copyright />
    </div>
  );
}
