"use client";

import { useEffect, useRef, useState } from "react";

import { Copyright } from "@/components/Copyright";
import { RecordTab } from "@/components/tabs/RecordTab";
import { Popup } from "@/components/Popup";
import { Working } from "@/components/Working";
import { openLink } from "@/lib/openLink";
import {
  downloadShared,
  downloadSharedBlob,
  listShared,
  type SharedFile,
} from "@/lib/api";
import {
  downloadDirectBlob,
  downloadDirectText,
  hasDriveKey,
  listSharedDirect,
} from "@/lib/driveDirect";
import { bundleAdds, isBundle, openBundle } from "@/lib/bundle";
import { CLASSES } from "@/lib/classes";
import {
  localIds,
  parseResultsText,
  saveLocal,
  saveLocalAudio,
} from "@/lib/library";
import { hasLocalLlm } from "@/lib/llmClient";
import { fetchedDriveIds, fetchedVersion, markFetched } from "@/lib/sharedFetched";
import {
  audioBaseOf,
  audioIdFromName,
  instIdFromName,
  instKey,
  isRmlName,
  rmlBaseOf,
  songTitleOf,
} from "@/lib/sharedFiles";
import { changedSongs, alreadySame, type SongChange } from "@/lib/songDiff";
import {
  STAGE_LABEL,
  type AnalysisResult,
  type Health,
  type JobStatus,
} from "@/lib/types";

interface Props {
  health: Health | null;
  status: JobStatus | null;
  error: string | null;
  busy: boolean;
  separate: boolean;
  /** 관리자 모드일 때만 드라이브 폴더 관리 링크를 보여준다 */
  adminMode: boolean;
  /** 악보(ABC) 등록 창을 연다. 곡이 열려 있어야 붙일 수 있다 */
  onAbc?: () => void;
  /** 지금 열려 있는 곡 이름. 없으면 먼저 곡을 고르라고 안내한다 */
  abcSong?: string;
  /** 악보 만들기 창이 열려 있는가. 열려 있으면 이 뷰가 그 창이 된다 */
  abcOpen?: boolean;
  /** 악보 만들기 창의 내용(머리줄 + AI 악보생성기) */
  abcStudio?: React.ReactNode;
  /**
   * 탭을 열자마자 펼칠 카드. 홈의 「기타반」 바로가기가 쓴다.
   * 탭이 바뀔 때 이 컴포넌트가 다시 마운트되므로 초기값으로 충분하다.
   */
  autoOpen?: CardKind;
  onAnalyzeUrl: (url: string) => void;
  onAnalyzeFile: (file: File) => void;
  /** 서버 없이 AI로 코드를 만든다. 서버가 없을 때만 쓴다 */
  onAnalyzeWithAi: (url: string) => void;
}

// 반은 CLASSES의 id를 그대로 카드 종류로 쓴다("beginner"·"intermediate")
type CardKind = "youtube" | "file" | "ai" | "mic" | (string & {});
type SharedFilter = "unfetched" | "fetched" | "all";

const SHARED_FILTERS: { value: SharedFilter; label: string }[] = [
  { value: "unfetched", label: "받지 않음" },
  { value: "fetched", label: "받음" },
  { value: "all", label: "전체" },
];

/** 카드 한 장. 아이콘 + 제목 + 설명, 누르면 모달이 열린다. */
function Card({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] p-4 text-left"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          {description}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">›</span>
    </button>
  );
}

/** 음원받기: 방식을 카드로 고르고, 세부 입력·목록은 모달에서. */
export function ImportTab({
  health,
  status,
  error,
  busy,
  separate,
  adminMode,
  onAbc,
  abcSong,
  abcOpen,
  abcStudio,
  autoOpen,
  onAnalyzeUrl,
  onAnalyzeFile,
  onAnalyzeWithAi,
}: Props) {
  const [url, setUrl] = useState("");
  /** 오디오 음원 등록 — 카드를 누르면 이 입력을 대신 연다 */
  const audioInputRef = useRef<HTMLInputElement>(null);
  // 반주·보컬 트랙도 저장할지. 기기 공간을 아끼려는 사람은 끈다
  const [wantInst, setWantInst] = useState(true);
  const [wantVocals, setWantVocals] = useState(false);
  const [open, setOpen] = useState<CardKind | null>(autoOpen ?? null);
  // 지금 열어 둔 반. 카드마다 폴더가 다르다
  const klass = CLASSES.find((c) => c.id === open) ?? null;

  // 기타반 공유 음원목록 (구글드라이브, 서버가 프록시)
  const [shared, setShared] = useState<{
    folderId: string;
    files: SharedFile[];
  } | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [sharedNotice, setSharedNotice] = useState<string | null>(null);
  // 받아 보니 기기에 있는 것과 달라진 곡들. 물어보고 나서 덮어쓴다.
  const [pending, setPending] = useState<{
    changes: SongChange[];
    apply: () => Promise<void>;
  } | null>(null);
  // 이미 받아서 기기에 남아 있는 드라이브 파일들
  const [fetched, setFetched] = useState<Set<string>>(new Set());
  // 목록 필터. 자동 동기화가 대부분 받아 두므로 기본은 '받지 않음'만 보여준다.
  const [filter, setFilter] = useState<SharedFilter>("unfetched");

  const refreshFetched = () =>
    localIds()
      .then((ids) => setFetched(fetchedDriveIds(ids)))
      .catch(() => {});

  // 공유 폴더 접근 경로: 서버가 있으면 프록시, 없으면(외부 링크 정적 배포)
  // 드라이브 API 직접 조회. 어느 쪽이든 화면(곡 목록)은 똑같다.
  const canList = !!health || hasDriveKey();
  const fileText = (id: string) =>
    health ? downloadShared(id) : downloadDirectText(id);
  const fileBlob = (id: string) =>
    health ? downloadSharedBlob(id) : downloadDirectBlob(id);

  useEffect(() => {
    if (!klass) return;
    if (!health && !hasDriveKey()) return;
    // 반을 바꾸면 앞 반의 목록이 잠깐 보이면 안 된다. 목록 자체를 반
    // 기준으로 담아 두고, 지금 반의 것만 골라 쓴다.
    let alive = true;
    (health ? listShared(klass.folderId) : listSharedDirect(klass.folderId))
      .then((files) => {
        if (!alive) return;
        setShared({ folderId: klass.folderId, files });
        setSharedError(null);
      })
      .catch((e) => {
        if (alive) setSharedError((e as Error).message);
      });
    refreshFetched();
    return () => {
      alive = false;
    };
  }, [health, klass]);

  // 목록에는 곡(.rml)만 보여준다. 음원 파일은 파일명 속 결과 id로
  // 곡과 짝을 맞춰, 곡을 받을 때 함께 내려받는다.
  // 지금 열어 둔 반의 목록만 쓴다. 반을 막 바꿨을 때 앞 반의 곡이
  // 스쳐 보이지 않게 한다.
  const files =
    shared && klass && shared.folderId === klass.folderId ? shared.files : null;
  const sharedSongs = files?.filter((f) => isRmlName(f.name)) ?? null;
  // 같은 이름의 음원이 올라와 있는 곡 (목록에 "음원 포함" 표시용)
  const audioBases = new Set(
    (files ?? []).map((f) => audioBaseOf(f.name)).filter(Boolean),
  );
  // 지금 걸러 놓은 것 기준으로 화면에 보이는 곡. 목록과 「모두 받기」가
  // 같은 것을 보게 한 곳에서 계산한다.
  const visible = (sharedSongs ?? []).filter((file) => {
    /* 받은 뒤 강사님이 고쳐 다시 올린 곡은 「받지 않음」으로 돌린다.
       받음 쪽에 숨어 있으면, 알림을 보고 온 수강생이 목록에서 그 곡을
       찾지 못한다 — 기본 필터가 받지 않음이라서다. */
    const stale =
      !!file.modified && !!fetchedVersion(file.id) &&
      fetchedVersion(file.id) !== file.modified;
    const done = fetched.has(file.id) && !stale;
    if (filter === "unfetched") return !done;
    if (filter === "fetched") return done;
    return true;
  });

  /**
   * 공유 파일을 받아 해석만 한다. 저장은 아직 하지 않는다.
   *
   * 받아 봐야 기기에 있는 것과 같은지 알 수 있고, 다르면 물어보고 나서
   * 덮어야 하기 때문에 「받기」와 「담기」를 나눴다.
   */
  const loadShared = async (file: SharedFile) => {
    const text = await fileText(file.id);
    const data = JSON.parse(text) as unknown;
    // 곡 꾸러미면 코드뿐 아니라 웹 악보·연주설정까지 함께 들어 있다.
    // 옛 파일(분석 결과만)도 그대로 읽힌다.
    const results = isBundle(data) ? [data.result] : parseResultsText(text);
    return { data, results };
  };

  /** 해석해 둔 것을 기기에 담는다. 짝 음원도 함께. */
  const applyShared = async (
    file: SharedFile,
    data: unknown,
    results: AnalysisResult[],
  ) => {
    let bundleAudio = false;
    let brought: string[] = [];
    if (isBundle(data)) {
      const got = await openBundle(data, {
        inst: wantInst,
        vocals: wantVocals,
      });
      bundleAudio = got.includes("음원");
      // 악보가 함께 왔는지 눈에 보이게 알려 준다
      brought = got.filter((x) => x.includes("악보"));
    } else {
      for (const result of results) await saveLocal(result);
    }
    markFetched(
      file.id,
      results.map((r) => r.id),
      file.modified,
    );

    // 짝이 되는 음원(파일명에 결과 id가 든 오디오)이 폴더에 있으면 같이 받는다.
    // 업로드 곡도 서버 없이 소리가 나게 하기 위해서다. 반주(.inst)가 있으면
    // 그것도 담는다 — 수강생도 서버 없이 보컬을 끌 수 있게.
    let withAudio = bundleAudio ? 1 : 0;
    for (const audioFile of files ?? []) {
      const audioId = audioIdFromName(audioFile.name);
      if (audioId && results.some((r) => r.id === audioId)) {
        await saveLocalAudio(audioId, await fileBlob(audioFile.id));
        markFetched(audioFile.id, [audioId], audioFile.modified);
        withAudio += 1;
        continue;
      }
      const instId = instIdFromName(audioFile.name);
      if (instId && wantInst && results.some((r) => r.id === instId)) {
        await saveLocalAudio(instKey(instId), await fileBlob(audioFile.id));
        markFetched(audioFile.id, [instId], audioFile.modified);
      }
    }
    return { results, withAudio, brought };
  };

  /** 담은 뒤 알림 한 줄 */
  const doneNotice = async (
    results: AnalysisResult[],
    withAudio: number,
    brought: string[] = [],
  ) => {
    await refreshFetched();
    const parts = [...(withAudio > 0 ? ["음원"] : []), ...brought];
    const suffix = parts.length ? ` (${parts.join(" · ")} 포함)` : "";
    setSharedNotice(
      results.length === 1
        ? `음원목록에 담았습니다: ${results[0].title || results[0].id}${suffix}`
        : `${results.length}곡을 음원목록에 담았습니다.${suffix}`,
    );
  };

  /**
   * 한 곡 받기 버튼. 이미 받은 곡이 달라졌으면 물어보고 덮는다.
   *
   * force면 같아 보여도 그냥 다시 받는다 — 「다시 받기」를 눌렀는데
   * 「그대로 두었습니다」라고 하면 누른 사람은 아무 일도 일어나지
   * 않았다고 느낀다. 겉으로 같아도 악보나 음원이 빠졌을 수 있다.
   */
  const fetchShared = async (file: SharedFile, force = false) => {
    setFetching(file.id);
    setSharedError(null);
    setSharedNotice(null);
    try {
      const { data, results } = await loadShared(file);
      const changes = await changedSongs(results);

      if (changes.length > 0) {
        setPending({
          changes,
          apply: async () => {
            const got = await applyShared(file, data, results);
            await doneNotice(got.results, got.withAudio, got.brought);
          },
        });
        return;
      }
      // 코드가 같아도 악보가 새로 실려 왔으면 「같다」가 아니다
      const adds = isBundle(data) ? await bundleAdds(data) : [];
      if (!force && adds.length === 0 && (await alreadySame(results))) {
        /* 같은 곡이면 다시 담지는 않되, 「받았음」으로는 적어 둔다.
           적어 두지 않으면 이미 가진 곡이 「받지 않음」 목록에 남아,
           눌러도 「그대로 두었습니다」만 되풀이된다. */
        markFetched(
          file.id,
          results.map((r) => r.id),
          file.modified,
        );
        await refreshFetched();
        setSharedNotice("이미 받은 것과 같습니다. 그대로 두었습니다.");
        return;
      }
      const got = await applyShared(file, data, results);
      await doneNotice(got.results, got.withAudio, got.brought);
    } catch (e) {
      setSharedError(`가져오기 실패: ${(e as Error).message}`);
    } finally {
      setFetching(null);
    }
  };

  /**
   * 목록에 보이는 곡을 모두 받는다.
   *
   * 한 곡이 실패해도 멈추지 않는다 — 스무 곡 받다가 하나 깨졌다고 나머지
   * 열아홉 곡을 못 받으면 곤란하다. 끝에 몇 곡이 실패했는지 알려 준다.
   */
  const fetchAll = async (files: SharedFile[], force = false) => {
    setSharedError(null);
    setSharedNotice(null);
    let songs = 0;
    let audio = 0;
    const failed: string[] = [];
    // 왜 못 받았는지도 남긴다 — 이름만 늘어놓으면 무엇을 해야 할지 모른다
    let why = "";

    let same = 0;
    const conflicts: {
      file: SharedFile;
      data: unknown;
      results: AnalysisResult[];
      changes: SongChange[];
    }[] = [];

    for (const file of files) {
      setFetching(file.id);
      try {
        const { data, results } = await loadShared(file);
        const changes = await changedSongs(results);
        if (changes.length > 0) {
          conflicts.push({ file, data, results, changes });
          continue;
        }
        const adds = isBundle(data) ? await bundleAdds(data) : [];
        if (!force && adds.length === 0 && (await alreadySame(results))) {
          // 이미 가진 곡도 「받았음」으로 적어 둔다 — 위 fetchShared와 같다
          markFetched(
            file.id,
            results.map((r) => r.id),
          );
          same += 1;
          continue;
        }
        const got = await applyShared(file, data, results);
        songs += got.results.length;
        audio += got.withAudio;
      } catch (e) {
        failed.push(songTitleOf(file.name));
        why = why || (e as Error).message;
      }
    }
    setFetching(null);
    await refreshFetched();

    const tail =
      (same > 0 ? ` · ${same}곡은 그대로(같음)` : "") +
      (failed.length > 0 ? ` · ${failed.length}곡 실패` : "");

    // 달라진 곡은 한 번에 물어본다. 스무 곡을 하나씩 묻지 않는다.
    if (conflicts.length > 0) {
      setPending({
        changes: conflicts.flatMap((c) => c.changes),
        apply: async () => {
          let more = 0;
          let moreAudio = 0;
          for (const c of conflicts) {
            try {
              const got = await applyShared(c.file, c.data, c.results);
              more += got.results.length;
              moreAudio += got.withAudio;
            } catch {
              failed.push(songTitleOf(c.file.name));
            }
          }
          await refreshFetched();
          const audioNote =
            audio + moreAudio > 0 ? ` (음원 ${audio + moreAudio}곡 포함)` : "";
          setSharedNotice(
            `${songs + more}곡을 음원목록에 담았습니다.${audioNote}${tail}`,
          );
        },
      });
      return;
    }

    if (songs === 0 && same === 0 && failed.length > 0) {
      setSharedError(
        `받지 못했습니다: ${failed.join(", ")}` + (why ? ` — ${why}` : ""),
      );
      return;
    }
    const suffix = audio > 0 ? ` (음원 ${audio}곡 포함)` : "";
    setSharedNotice(
      (songs > 0
        ? `${songs}곡을 음원목록에 담았습니다.`
        : "새로 받을 것이 없습니다.") +
        suffix +
        tail,
    );
  };

  // 악보를 만드는 동안에는 이 뷰가 통째로 그 창이 된다. 카드 목록으로는
  // 「← 등록 화면」으로 돌아온다 — 창을 따로 띄우지 않아 자리를 잃지 않는다.
  if (abcOpen && abcStudio) {
    return <div className="flex h-full min-h-0 flex-col p-3">{abcStudio}</div>;
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <header>
        <h2 className="text-lg font-bold">
          {adminMode ? "음원등록" : "음원받기"}
        </h2>
        {/* 서버 상태는 관리자에게만. 수강생 화면에는 서버 이야기를 하지 않는다. */}
        {adminMode && (
          <p className="text-sm text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            {health
              ? `${health.device} · ${health.pipeline_version}` +
                (health.youtube_enabled ? "" : " · 업로드 전용")
              : "분석 서버 미연결 — 기타반 받기는 가능"}
          </p>
        )}
      </header>

      {adminMode && health && !health.ffmpeg && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          ffmpeg / ffprobe를 찾을 수 없습니다. 설치 후 PATH에 추가해야 분석이
          가능합니다.
        </p>
      )}

      {/* 수강생 화면 — 곡을 받는 길만 둔다.
          음원을 새로 들여오는 일(파일·유튜브·녹음)은 분석 서버가
          있어야 하는 강사님 몫이라, 여기 두면 눌러도 되지 않는 카드가
          늘어설 뿐이다. */}
      {!adminMode &&
        CLASSES.map((c) => (
          <Card
            key={c.id}
            icon={
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 text-[var(--accent)]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M12 11v6M9 14l3 3 3-3" />
              </svg>
            }
            title={c.name.replace("강상주민센터 ", "") + " 받기"}
            description="강사님이 올린 곡을 내려받습니다"
            onClick={() => setOpen(c.id)}
          />
        ))}

      {/* ---- 방식 카드 ----
           반별 곡 받기는 홈 대시보드의 「음원받기」로 옮겼다. 여기는
           음원을 새로 들여오는 길만 둔다. */}
      {adminMode && (
        <>
          <Card
            icon={
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 text-[var(--foreground)]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18V6l10-2v11" />
                <circle cx="6.5" cy="18" r="2.5" />
                <circle cx="16.5" cy="15" r="2.5" />
              </svg>
            }
            title="오디오 음원 등록"
            description="mp3 · wav · m4a · flac · ogg 파일을 골라 등록합니다"
            onClick={() => audioInputRef.current?.click()}
          />
          {/* 카드를 누르면 곧바로 파일 고르기 창이 뜬다 — 파일을 고르는
          일 하나뿐이라 중간에 창을 한 번 더 띄울 이유가 없다 */}
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onAnalyzeFile(f);
            }}
          />

          {!health && hasLocalLlm() && (
            <Card
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-[var(--foreground)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              }
              title="AI로 코드 만들기"
              description="서버 없이 씁니다. 되는 곡이 드물고 실제 녹음과 어긋납니다"
              onClick={() => setOpen("ai")}
            />
          )}

          {health?.youtube_enabled && (
            <Card
              icon={
                <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
                  <rect
                    x="1"
                    y="5"
                    width="22"
                    height="14"
                    rx="4"
                    fill="#FF0000"
                  />
                  <path d="M10 8.8v6.4l5.5-3.2z" fill="#fff" />
                </svg>
              }
              title="YouTube 음원 등록"
              description="영상 주소를 붙여넣어 음원을 등록하고 코드를 분석합니다"
              onClick={() => setOpen("youtube")}
            />
          )}

          {/* 악보(ABC) 등록 — 음원과 짝이 되는 악보를 곡에 붙인다.
          MuseScore 파일·AI 채보·붙여넣기 모두 이 자리에서 한다. */}
          {onAbc && (
            <Card
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-[var(--foreground)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {/* 오선과 음표 */}
                  <path d="M3 6h18M3 10h18M3 14h18M3 18h18" />
                  <circle
                    cx="8"
                    cy="16"
                    r="2"
                    fill="currentColor"
                    stroke="none"
                  />
                  <path d="M10 16V7l6-1.5V14" />
                </svg>
              }
              title="ABC 악보 생성 등록"
              description={
                abcSong
                  ? `음원·참고 악보·코드로 악보를 만듭니다 — 「${abcSong}」에 실립니다`
                  : "음원 링크·참고 악보·코드를 넣어 새 악보를 만듭니다"
              }
              onClick={onAbc}
            />
          )}

          {/* 마이크 녹음 — 음원을 들여오는 또 하나의 길이라 여기에 둔다.
          하단 메뉴 한 자리를 차지할 만큼 자주 쓰지는 않는다 */}
          <Card
            icon={
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7 text-[var(--accent)]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="9" y="2.5" width="6" height="11" rx="3" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
              </svg>
            }
            title="마이크로 녹음"
            description="스피커로 튼 곡이나 직접 친 연주를 녹음해 분석합니다"
            onClick={() => setOpen("mic")}
          />

          <p className="text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            음원 분리 {separate ? "사용" : "안 함"} · 설정 탭에서 바꿀 수
            있습니다.
          </p>
        </>
      )}

      {status && (
        <section className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{STAGE_LABEL[status.stage]}</span>
            <span>{Math.round(status.progress * 100)}%</span>
          </div>
          <div className="h-2 w-full rounded bg-[var(--chip)]">
            <div
              className="h-2 rounded bg-[var(--pick)] transition-all"
              style={{ width: `${status.progress * 100}%` }}
            />
          </div>
          <p className="text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">{status.message}</p>
        </section>
      )}

      {sharedNotice && (
        <p className="rounded bg-green-50 p-2 text-xs text-green-800">
          {sharedNotice}
        </p>
      )}
      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <Copyright />

      {/* ---- 마이크 녹음 모달 ---- */}
      {open === "mic" && (
        <Popup title="마이크로 녹음" onClose={() => setOpen(null)}>
          <RecordTab
            busy={busy}
            embedded
            onRecorded={(file) => {
              setOpen(null);
              onAnalyzeFile(file);
            }}
          />
        </Popup>
      )}

      {/* ---- YouTube 모달 ---- */}
      {open === "youtube" && (
        <Popup title="YouTube 주소" onClose={() => setOpen(null)}>
          <div className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded border px-3 py-3 text-base"
              placeholder="https://www.youtube.com/watch?v=..."
              inputMode="url"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {/* 곡을 찾아 주소를 복사해 오도록 유튜브를 새 탭으로 연다 */}
            <a
              href="https://www.youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded border"
              aria-label="YouTube 열기"
              title="YouTube 열기"
              onClick={(e) => {
                e.preventDefault();
                openLink("https://www.youtube.com");
              }}
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
                <rect
                  x="1"
                  y="5"
                  width="22"
                  height="14"
                  rx="4"
                  fill="#FF0000"
                />
                <path d="M10 8.8v6.4l5.5-3.2z" fill="#fff" />
              </svg>
            </a>
          </div>
          <button
            className="mt-3 w-full rounded bg-[var(--pick)] py-3 text-[var(--pick-ink)] disabled:opacity-40"
            disabled={!url || busy}
            onClick={() => {
              setOpen(null);
              onAnalyzeUrl(url);
            }}
          >
            분석
          </button>
        </Popup>
      )}

      {/* ---- AI로 코드 만들기 모달 ---- */}
      {open === "ai" && (
        <Popup title="AI로 코드 만들기" onClose={() => setOpen(null)}>
          <p className="mb-2 rounded bg-amber-50 px-2 py-2 text-[11px] leading-snug text-amber-800">
            분석 서버가 없을 때 쓰는 대체 수단입니다. AI가{" "}
            <b>음원을 듣지 않고</b> 아는 코드를 적어 주는 것이라, 되는 곡이
            드물고 되더라도 전주 길이나 반복 횟수가 실제 녹음과 어긋납니다.
            기타반에서 받은 곡이 언제나 더 정확합니다.
          </p>
          <input
            className="w-full rounded border px-3 py-3 text-base"
            placeholder="https://www.youtube.com/watch?v=..."
            inputMode="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            className="mt-3 w-full rounded bg-[var(--pick)] py-3 text-[var(--pick-ink)] disabled:opacity-40"
            disabled={!url || busy}
            onClick={() => {
              setOpen(null);
              onAnalyzeWithAi(url);
            }}
          >
            AI로 만들기
          </button>
        </Popup>
      )}

      {/* 여러 곡을 받으면 한참 걸린다. 어디까지 왔는지 알린다 */}
      {fetching !== null && (
        <Working
          label="곡 받는 중"
          note={songTitleOf(
            (shared?.files ?? []).find((f) => f.id === fetching)?.name ?? "",
          )}
        />
      )}

      {/* ---- 바뀐 곡 덮어쓸지 묻기 ---- */}
      {/* 목록 창 위에 얹힌다 — 같은 층에 두면 뒤에 그려진 목록 창에
          가려 「새 것으로 바꿀까요?」가 보이지 않는다 */}
      {pending && (
        <Popup
          title="바뀐 곡이 있습니다"
          onClose={() => setPending(null)}
          width="max-w-xs"
          layer="z-[60]"
        >
          <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            이미 받아 둔 곡과 내용이 다릅니다. 새 것으로 바꿀까요? 바꾸면 지금
            기기에 있는 것은 없어집니다.
          </p>
          <ul className="mb-3 max-h-48 space-y-1.5 overflow-y-auto">
            {pending.changes.map((c) => (
              <li
                key={c.title}
                className="rounded bg-[var(--panel)] p-2"
              >
                <div className="truncate text-xs font-medium">{c.title}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                  {c.notes.join(" · ")}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              className="flex-1 rounded bg-[var(--panel)] py-2.5 text-sm"
              onClick={() => {
                setPending(null);
                setSharedNotice("그대로 두었습니다.");
              }}
            >
              그대로 두기
            </button>
            <button
              className="flex-1 rounded bg-[var(--pick)] py-2.5 text-sm text-[var(--pick-ink)]"
              onClick={async () => {
                const job = pending.apply;
                setPending(null);
                await job().catch((e) => setSharedError((e as Error).message));
              }}
            >
              새 것으로
            </button>
          </div>
        </Popup>
      )}

      {/* ---- 반별 곡 목록 모달 ---- */}
      {klass && (
        <Popup title={klass.name} onClose={() => setOpen(null)}>
          <p className="mb-1.5 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            필요한 곡을 골라 「받기」를 누르세요. 음원목록(기기 저장)에
            담깁니다.
          </p>
          {/* 분리 트랙은 곡당 4~5MB씩 — 받을지 수강자가 고른다 */}
          <div className="mb-2 space-y-1">
            <label className="flex items-start gap-1.5 text-[11px] text-[var(--foreground)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={wantInst}
                onChange={(e) => setWantInst(e.target.checked)}
              />
              <span>반주(노래를 뺀 트랙)도 함께 저장</span>
            </label>
            <label className="flex items-start gap-1.5 text-[11px] text-[var(--foreground)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={wantVocals}
                onChange={(e) => setWantVocals(e.target.checked)}
              />
              <span>보컬(노래만 남긴 트랙)도 함께 저장</span>
            </label>
            <p className="text-[10px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              연주설정의 원음/반주/보컬 전환에 쓰입니다. 끄면 저장 공간을
              아낍니다.
            </p>
          </div>

          {sharedNotice && (
            <p className="mb-2 rounded bg-green-50 p-2 text-xs text-green-800">
              {sharedNotice}
            </p>
          )}
          {sharedError && (
            <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">
              {sharedError}
            </p>
          )}

          {!canList ? (
            // 서버도 드라이브 키도 없으면 드라이브 폴더 뷰를 그대로 임베드한다.
            <>
              <iframe
                src={`https://drive.google.com/embeddedfolderview?id=${klass.folderId}#list`}
                className="h-64 w-full rounded border border-[var(--panel-line)] bg-white"
                title={`${klass.name} 공유 폴더`}
              />
              <p className="mt-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                파일을 누르면 드라이브에서 내려받아집니다. 받은 파일은
                음원목록의 「파일 가져오기」로 담으세요.
              </p>
            </>
          ) : sharedSongs === null && !sharedError ? (
            <p className="text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">목록 불러오는 중…</p>
          ) : sharedSongs !== null && sharedSongs.length === 0 ? (
            <p className="text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">폴더에 아직 곡이 없습니다.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-1.5">
                {SHARED_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFilter(f.value)}
                    className={[
                      "flex-1 rounded-full py-1.5 text-xs",
                      filter === f.value
                        ? "bg-[var(--pick)] text-[var(--pick-ink)]"
                        : "bg-[var(--panel)]",
                    ].join(" ")}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* 지금 보이는 곡을 한 번에. 스무 곡을 하나씩 누르게 하지 않는다 */}
              {visible.length > 0 && (
                <button
                  className="mb-2 w-full rounded bg-[var(--pick)] py-2 text-xs text-[var(--pick-ink)] disabled:opacity-40"
                  disabled={fetching !== null}
                  // 「다시 받기」로 적힌 자리에서는 무조건 다시 받는다
                  onClick={() => fetchAll(visible, filter === "fetched")}
                >
                  {fetching !== null
                    ? "받는 중…"
                    : filter === "fetched"
                      ? `보이는 ${visible.length}곡 다시 받기`
                      : `보이는 ${visible.length}곡 모두 받기`}
                </button>
              )}

              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {visible.map((file) => {
                  const done = fetched.has(file.id);
                  const hasAudio = audioBases.has(rmlBaseOf(file.name));
                  return (
                    <li key={file.id}>
                      {/* 받은 곡도 다시 받을 수 있다. 강사님이 코드를 고쳐
                        올렸을 때 새 것으로 바꿔야 한다 */}
                      <button
                        className="flex w-full items-center gap-2 py-2.5 text-left disabled:opacity-50"
                        disabled={fetching !== null}
                        onClick={() => fetchShared(file, done)}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {songTitleOf(file.name)}
                          {hasAudio && (
                            <span className="ml-1.5 text-[10px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                              ♪ 음원
                            </span>
                          )}
                        </span>
                        <span
                          className={[
                            "shrink-0 text-[11px]",
                            done ? "text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]" : "text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]",
                          ].join(" ")}
                        >
                          {fetching === file.id
                            ? "받는 중…"
                            : done
                              ? "다시 받기"
                              : "받기"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {filter === "unfetched" &&
                sharedSongs !== null &&
                sharedSongs.every((f) => fetched.has(f.id)) && (
                  <p className="py-2 text-center text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                    모두 받았습니다. 「받음」이나 「전체」에서 확인하세요.
                  </p>
                )}
            </>
          )}
        </Popup>
      )}
    </div>
  );
}
