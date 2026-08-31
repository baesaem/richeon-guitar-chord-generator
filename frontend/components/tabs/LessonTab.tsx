"use client";

import { useEffect, useState } from "react";

import { Copyright } from "@/components/Copyright";
import { LinkShelf } from "@/components/LinkShelf";
import { Working } from "@/components/Working";
import { CLASSES, type GuitarClass } from "@/lib/classes";
import { Popup } from "@/components/Popup";
import { classroomShelf } from "@/lib/lectures";
import {
  downloadLessonFile,
  importLessonsFromDrive,
  lessonBlob,
  lessonFileName,
} from "@/lib/lessonShare";
import {
  driveConnect,
  driveConnectWait,
  driveStatus,
  driveUpload,
} from "@/lib/api";
import { openLink } from "@/lib/openLink";

/**
 * 강의실 — 밖에서 보며 배우는 것들.
 *
 * 강의실은 강사님이 올린 자료, 내 강좌는 각자 따로 듣는 것. 둘 다
 * 링크를 담아 두고 눌러서 그 자리로 가는 방식이다 — 영상을 앱 안에
 * 붙들어 두지 않는다. YouTube가 중심이지만 밴드·블로그·카페처럼
 * 영상이 아닌 자료도 담긴다.
 *
 * 강의실은 곡과 같은 길로 오간다. 강사님이 링크를 모아 파일로
 * 내보내 그 반 강의실 폴더에 올리면, 수강생이 「새 강좌 가져오기」로
 * 받는다. 반(초급·중급)마다 폴더도 목록도 따로다.
 */
export function LessonTab({
  adminMode,
  online,
  openClass,
}: {
  /** 열자마자 펼칠 반. 새 강좌 알림이 넘겨준다 */
  openClass?: string;
  /** 관리자만 강의실을 파일로 내보낸다 */
  adminMode: boolean;
  /** 분석 서버가 붙어 있는가. 없으면 드라이브에서 직접 받는다 */
  online: boolean;
}) {
  // 탭: 반별 강의실 + 내 강좌
  const [page, setPage] = useState<string>(openClass ?? CLASSES[0].id);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 받아 온 링크를 화면에 곧바로 비추려면 목록을 다시 읽어야 한다
  const [reloadKey, setReloadKey] = useState(0);
  // 관리자가 고른 자료. 고른 것이 있으면 그것만 올린다
  const [picked, setPicked] = useState<string[]>([]);
  // 올릴 반을 묻는 창(고른 것을 다른 반에도 올릴 수 있게)
  const [askFolder, setAskFolder] = useState<"upload" | "file" | null>(null);
  // 드라이브에 바로 올릴 수 있는가(관리자 PC에서 한 번 연결해 두면 계속)
  const [driveReady, setDriveReady] = useState(false);
  useEffect(() => {
    if (!adminMode || !online) return;
    driveStatus()
      .then((s) => setDriveReady(s.connected))
      .catch(() => setDriveReady(false));
  }, [adminMode, online]);

  const klass = CLASSES.find((c) => c.id === page) ?? null;

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  };

  const importFromDrive = async () => {
    if (!klass) return;
    setWorking("새 강좌 찾는 중");
    setError(null);
    try {
      const { added, changed, files } = await importLessonsFromDrive(klass, online);
      if (files === 0) {
        flash("이 반의 강의실에 올라온 자료가 아직 없습니다.");
      } else if (added + changed === 0) {
        flash("이미 받은 것과 같습니다. 그대로 두었습니다.");
      } else {
        const parts = [];
        if (added) parts.push(`새 강좌 ${added}개`);
        if (changed) parts.push(`고쳐진 것 ${changed}개`);

        flash(`${parts.join(" · ")}를 반영했습니다.`);
        setReloadKey((k) => k + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  /**
   * 드라이브에 곧장 올린다. 처음 한 번은 구글 동의를 받는다 —
   * 서버가 연 주소를 열어 계정을 고르면, 그 뒤로는 누르면 끝이다.
   */
  const uploadToDrive = async (target: GuitarClass) => {
    setAskFolder(null);
    // 담는 자료는 지금 보고 있는 반의 것, 올라가는 곳은 고른 반이다 —
    // 초급에서 정리한 자료를 중급에도 그대로 올릴 수 있다
    const source = klass ?? target;
    const { blob, count } = lessonBlob(source, picked);
    if (count === 0) {
      setError("이 반 강의실에 담긴 링크가 없습니다.");
      return;
    }
    setError(null);
    try {
      if (!driveReady) {
        setWorking("구글 계정 연결 중");
        const { url } = await driveConnect();
        openLink(url);
        await driveConnectWait();
        setDriveReady(true);
      }
      setWorking("드라이브에 올리는 중");
      const res = await driveUpload(
        target.lessonFolderId,
        lessonFileName(target.name),
        blob,
      );
      flash(
        `${count}개를 ${shortName(target.name)} 강의실에 올렸습니다` +
          `${res.replaced ? " (기존 파일 교체)" : ""}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const exportToFile = (target: GuitarClass) => {
    setAskFolder(null);
    setError(null);
    const count = downloadLessonFile(klass ?? target, picked, target.name);
    if (count === 0) setError("올릴 자료가 없습니다.");
    else
      flash(
        `${count}개를 파일로 내보냈습니다. ${shortName(target.name)} 강의실 폴더에 올리세요.`,
      );
  };

  // 탭 이름은 반 이름만 — 「강상주민센터 기타반(초급)」은 탭에 들어가지 않고,
  // 어느 반 강의실인지는 아래 안내줄이 적어 준다
  const shortName = (name: string) =>
    name.match(/\(([^)]+)\)/)?.[1] ?? name;

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      {working && <Working label={working} />}
      <h2 className="mb-2 text-lg font-bold roomy:hidden">강의실</h2>

      <div className="mb-3 flex gap-1">
        {[
          ...CLASSES.map((c) => [c.id, shortName(c.name)] as const),
          ["all", "모두(초급,중급)"] as const,
          ["mine", "내 강좌"] as const,
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setPage(value)}
            className={[
              "flex-1 whitespace-nowrap rounded px-2 py-2 text-[13px]",
              page === value
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-[var(--panel)]",
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

      {klass ? (
        <>
          {/* 받기·내보내기. 수강생은 받기만, 강사님은 둘 다 쓴다 */}
          {/* 자주 누르는 단추가 아니다. 크게 벌려 두면 목록이 밀린다 */}
          <div className="mb-2 flex flex-wrap justify-end gap-1.5">
            <button
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
              onClick={importFromDrive}
            >
              새 강좌 가져오기
            </button>
            {adminMode && online && (
              <button
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => setAskFolder("upload")}
                title="이 반 강의실을 드라이브 폴더에 곧장 올립니다"
              >
                {picked.length > 0 ? `고른 ${picked.length}개 올리기` : "드라이브에 올리기"}
              </button>
            )}
            {adminMode && (
              <button
                className="rounded bg-[var(--panel)] px-3 py-1.5 text-xs font-medium"
                onClick={() => setAskFolder("file")}
                title="파일로 내려받아 직접 올릴 때 씁니다"
              >
                파일로
              </button>
            )}
          </div>
          <LinkShelf
            key={`${klass.id}-${reloadKey}`}
            shelf={classroomShelf(klass.id)}
            onSelected={setPicked}
            addLabel="+ 강좌 추가"
            canAdd={adminMode}
            blurb={
              adminMode
                ? `${klass.name}이(가) 함께 보는 자료입니다. 링크를 담고 「내보내기」로 파일을 만들어 이 반 강의실 폴더에 올리면, 수강생이 받아 갑니다.`
                : `${klass.name}의 강좌와 자료입니다. 「새 강좌 가져오기」를 누르면 새 자료를 받아 옵니다.`
            }
          />
        </>
      ) : page === "all" ? (
        <LinkShelf
          key={`all-${reloadKey}`}
          shelf={classroomShelf(CLASSES[0].id)}
          merged={CLASSES.map((c) => ({
            shelf: classroomShelf(c.id),
            label: shortName(c.name),
          }))}
          blurb="초급·중급 강의실을 한 목록으로 봅니다. 어느 반 자료인지 아래에 적혀 있습니다."
        />
      ) : (
        <LinkShelf
          shelf="mine"
          addLabel="+ 내 강좌 추가"
          blurb="따로 듣고 있는 강좌를 담아 두는 곳입니다. 이 기기에만 저장되고, 누르면 그 자리로 열립니다."
        />
      )}

      {/* 올릴 반 고르기 — 초급에서 만든 자료를 중급에도 올릴 수 있다 */}
      {askFolder && (
        <Popup
          title={askFolder === "upload" ? "어느 반에 올릴까요" : "어느 반 파일로 만들까요"}
          width="max-w-xs"
          onClose={() => setAskFolder(null)}
        >
          <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            {picked.length > 0
              ? `고른 ${picked.length}개를 담습니다.`
              : "이 반 강의실 전체를 담습니다."}{" "}
            같은 이름 파일이 있으면 갈아 끼웁니다.
          </p>
          <div className="space-y-1.5">
            {CLASSES.map((c) => (
              <button
                key={c.id}
                className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
                onClick={() =>
                  askFolder === "upload" ? uploadToDrive(c) : exportToFile(c)
                }
              >
                {c.name}
              </button>
            ))}
          </div>
        </Popup>
      )}

      <Copyright />
    </div>
  );
}
