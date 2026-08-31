"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { BottomNav, NAV_ITEMS, type Tab } from "@/components/BottomNav";
import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { ChordStrip, type ChordStripHandle } from "@/components/ChordStrip";
import { ChordScore } from "@/components/ChordScore";
import { AbcScore } from "@/components/AbcScore";
import { unifyChords } from "@/lib/abcChords";
import { PracticeRoom } from "@/components/PracticeRoom";
import { MelodyScore } from "@/components/MelodyScore";
import {
  getAbc,
  removeAbc,
  saveAbc,
  setAbcOffset,
  type AbcEntry,
} from "@/lib/abcStore";
import { clearDirty, listDirty, markDirty } from "@/lib/dirty";
import { ScoreAttach } from "@/components/ScoreAttach";
import { SheetScore, type SheetData } from "@/components/SheetScore";
import { sheetChords } from "@/lib/sheetChords";
import { ChordSheet } from "@/components/ChordSheet";
import { Copyright } from "@/components/Copyright";
import { HelpButton } from "@/components/Help";
import { SideNav } from "@/components/SideNav";
import { HomeDashboard } from "@/components/HomeDashboard";
import { LyricsPane } from "@/components/LyricsPane";
import { PlayerPane, type Playback } from "@/components/PlayerPane";
import { MySheet } from "@/components/MySheet";
import { EditTab } from "@/components/tabs/EditTab";
import { ChordPicker } from "@/components/ChordPicker";
import { LyricEditor, LyricRow } from "@/components/LyricEditor";
import { SongInfoLine } from "@/components/SongInfoLine";
import { ViewSteppers } from "@/components/ViewSteppers";
import { Working } from "@/components/Working";
import { NotKnown, analyzeWithAi } from "@/lib/aiAnalyze";
import { localLlmKey, localLlmModel } from "@/lib/llmClient";
import { measureOutputLatency } from "@/lib/latency";
import { stemKey, type StemChoice } from "@/lib/sharedFiles";
import { clearChordAt, setChordAt } from "@/lib/editChords";
import { Popup } from "@/components/Popup";
import { PlaySettings, SeekBar } from "@/components/TransportBar";
import { StrumPickModal } from "@/components/StrumPick";
import { ChordsTab } from "@/components/tabs/ChordsTab";
import { ImportTab } from "@/components/tabs/ImportTab";
import { LessonTab } from "@/components/tabs/LessonTab";
import { LibraryTab } from "@/components/tabs/LibraryTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import {
  analyzeUpload,
  analyzeUrl,
  putResult,
  tidyLyrics,
  reanalyze,
  getHealth,
  getResult,
  listResults,
  moveSheetImage,
  makeInstrumental,
  makeVocals,
  watchJob,
} from "@/lib/api";
import { barIndexAt, buildBars, chordIndexAt } from "@/lib/bars";
import { getLocal, getLocalAudio, listLocal, saveLocal } from "@/lib/library";
import { LYRIC_LEAD, groupBySentence, groupIndexAt } from "@/lib/lyricGroups";
import { lyricIndexAt } from "@/lib/lrc";
import {
  labelFor,
  resolveFlats,
  simplifyQuality,
  spellKey,
  transposeRoot,
} from "@/lib/notation";
import {
  findNewLessons,
  markLessonsSeen,
  type NewLessons,
} from "@/lib/lessonShare";
import { findNewSongs, markSongsSeen, type NewSongs } from "@/lib/songAlert";
import { DEFAULT_SETUP, hasSetup, loadSetup, saveSetup } from "@/lib/perSong";
import { addRecent, listRecent } from "@/lib/recent";
import { patchSettings, useSettings } from "@/lib/settings";
import { useBigScreen, useWideScreen } from "@/lib/useMedia";
import { PATTERNS, suggestStrum } from "@/lib/strumLibrary";
import { tidyChords } from "@/lib/tidy";
import {
  STAGE_LABEL,
  type AnalysisResult,
  type Chord,
  type LyricLine,
  type Health,
  type JobStatus,
  type ResultSummary,
} from "@/lib/types";
import { voicingFor } from "@/lib/voicings";

/** 연주기 곡 고르기의 앞·뒤 단추 */
const SONG_STEP =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--chip)] text-[10px] text-[var(--foreground)] disabled:opacity-30";

/** 전체보기 탭 줄의 되감기·정지·끝으로 단추 */
const TRANSPORT =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--chip)] text-[var(--foreground)] disabled:opacity-40";

/**
 * 곡 화면을 예전 UI로 볼지.
 *
 * 연습실은 AI 악보앱과 같은 짜임(영상/설정줄/악보만 스크롤)으로 바꿨다.
 * 예전 화면(코드 격자 중심)이 다시 필요해지면 이 값만 켜면 된다 —
 * 코드는 지우지 않고 두었다.
 */
const LEGACY_SONG_UI = false;

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  // 홈에서 「기타반」으로 들어오면 그 카드를 바로 펼친다
  const [importCard, setImportCard] = useState<string | undefined>(undefined);
  const [settings, setSettings] = useSettings();

  const [health, setHealth] = useState<Health | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [playback, setPlayback] = useState<Playback | null>(null);
  const stripRef = useRef<ChordStripHandle | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [chordIdx, setChordIdx] = useState(-1);
  const [barIdx, setBarIdx] = useState(0);

  const [transpose, setTranspose] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState<{ a: number; b: number } | null>(null);
  // 싱크 보정(초). 기기마다 소리 나오는 시점이 달라 곡마다 맞춰 둔다
  const [sync, setSync] = useState(0);
  const [lyricSync, setLyricSync] = useState(0);
  // 주법. 0 = 스트로크, 1~ = 아르페지오 패턴 번호
  const [arp, setArp] = useState(0);
  // 직접 고른 스트로크 패턴 이름. 빈 문자열이면 자동 추천
  const [strumName, setStrumName] = useState("");
  /** 악보에 코드를 얹을지(곡마다). 멜로디만 그려진 악보에 쓴다 */
  const [autoChords, setAutoChords] = useState(false);
  // 가사 보기: 켜면 코드 박스와 곡 전체 코드 자리를 가사가 대신 쓴다
  const [showLyrics, setShowLyrics] = useState(false);
  // 곡 전체 악보 모달
  const [showSheet, setShowSheet] = useState(false);
  // 스트로크 패턴 고르기 팝업
  const [showStrums, setShowStrums] = useState(false);
  // 코드 고치기: 지금 고르고 있는 마디 번호(없으면 null)
  const [editBar, setEditBar] = useState<number | null>(null);
  // 편집으로 들어왔는가. 고치는 데 쓰지 않는 탭은 감춘다
  const [editMode, setEditMode] = useState(false);
  // 되돌리기용. 고치기 전 코드를 쌓아 둔다 — 잘못 눌렀을 때 돌아갈 자리다
  const [undo, setUndo] = useState<Chord[][]>([]);
  // 가사 고치기: 지금 고르고 있는 줄 번호(없으면 null)
  const [editLyric, setEditLyric] = useState<number | null>(null);
  const [lyricBusy, setLyricBusy] = useState(false);
  // 기기가 소리를 내보내는 데 걸리는 시간. 한 번만 재서 설정에 담는다.
  // 곡이 아니라 기기의 성질이라 모든 곡에 함께 적용된다.
  useEffect(() => {
    if (settings.latency !== 0) return;
    let alive = true;
    measureOutputLatency().then((sec) => {
      // 측정하는 몇 초 사이 다른 설정이 바뀌었을 수 있다 — 마운트 때의
      // settings로 통째 저장하면 그 변화(관리자 모드 등)를 되돌려 버린다
      if (alive && sec > 0) patchSettings({ latency: sec });
    });
    return () => {
      alive = false;
    };
    // 한 번만 잰다. 설정이 바뀔 때마다 다시 잴 이유가 없다.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 악보보기 모달에서 무엇을 볼지
  const [sheetTab, setSheetTab] = useState<
    "score" | "melody" | "grid" | "lyrics" | "mine"
  >("score");
  /* 연습실 악보 칸에 무엇을 볼지. 기본은 강사님이 붙인 ABC 악보다 —
     음표가 다 있어 따라 치기 좋다. 나머지 셋은 같은 곡을 다른 눈으로
     보는 것이라 같은 자리에서 갈아 끼운다. */
  const [roomView, setRoomView] = useState<"abc" | "tab" | "wave" | "grid">(
    "abc",
  );
  // 보컬 끄기(반주만). 서버가 만든 반주 트랙이 있어야 한다.
  // 어떤 트랙을 들을지. off=전체(원곡), inst=반주만, vocals=보컬만
  const [stem, setStem] = useState<StemChoice>("off");
  const [vocalBusy, setVocalBusy] = useState(false);
  const [vocalError, setVocalError] = useState<string | null>(null);

  const [backendDown, setBackendDown] = useState(false);
  /**
   * 올라온 새 강좌. 앱을 열 때 한 번 살펴 띠로 알린다 — 수강생이
   * 「새 강좌 가져오기」를 눌러 볼 생각을 못 하면 영영 못 받는다.
   */
  const [newLessons, setNewLessons] = useState<NewLessons[]>([]);
  /** 올라온 새 곡. 강좌와 같은 자리에서 한 번에 알린다 */
  const [newSongs, setNewSongs] = useState<NewSongs[]>([]);
  // 공부방을 열 때 펼칠 반(알림에서 건너온 경우)
  const [lessonClass, setLessonClass] = useState<string | undefined>(undefined);
  useEffect(() => {
    // 서버 확인이 끝난 뒤에 조용히 살핀다. 실패하면 그냥 넘어간다.
    let alive = true;
    const timer = setTimeout(() => {
      findNewLessons(!!health)
        .then((found) => {
          if (alive) setNewLessons(found);
        })
        .catch(() => {});
      findNewSongs(!!health)
        .then((found) => {
          if (alive) setNewSongs(found);
        })
        .catch(() => {});
    }, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [health]);

  // 설정에서 서버 주소를 바꾸면 다시 확인한다.
  // 기타반 곡은 자동으로 담지 않는다 - 수강생이 음원받기의
  // 기타반 목록에서 필요한 곡만 골라 받는다.
  useEffect(() => {
    /* 서버가 살아나는 순간을 잡으려고 주기적으로 살핀다.
       살아나면, 꺼진 사이 기기에만 적힌 곡(명단)을 통째로 밀어 넣어
       두 벌을 같게 만든다 — 실시간 동기화의 나머지 절반이다. */
    let alive = true;
    const check = () =>
      getHealth()
        .then(async (h) => {
          if (!alive) return;
          setHealth(h);
          setBackendDown(false);
          for (const id of listDirty()) {
            const local = await getLocal(id).catch(() => null);
            if (!local) {
              clearDirty(id);
              continue;
            }
            await putResult(local)
              .then(() => clearDirty(id))
              .catch(() => {});
          }
        })
        .catch(() => {
          if (!alive) return;
          setHealth(null);
          setBackendDown(true);
        });
    check();
    const timer = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [settings.apiBase]);

  // 테마 적용: html에 .dark 클래스를 붙였다 뗀다. system이면 기기 설정을 따라간다.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      // 세피아·아쿠아는 라이트 기반 색조 팔레트
      if (["sepia", "aqua", "royal", "naver"].includes(settings.theme)) {
        document.documentElement.dataset.theme = settings.theme;
      } else {
        delete document.documentElement.dataset.theme;
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  // 곡에 붙인 ABC 악보. 있으면 멜로디 화면이 이것을 그린다.
  //
  // 「화면에 그릴 결과」보다 먼저 선언해야 한다 — 악보·파형·타브의 코드를
  // 한 벌로 모으는 셈이 이 값을 본다. 아래에 두면 렌더마다 터진다.
  const [abcEntry, setAbcEntry] = useState<AbcEntry | null>(null);

  /* 악보·파형·타브가 서로 다른 코드를 말하지 않게 한 벌로 모은다.
   *
   * 카포로 옮겨 적은 악보(조가 다르다)면 악보 쪽을 음원 코드로 바꿔
   * 적고, 악보가 원곡 그대로면 파형·타브 쪽을 악보 코드로 갈아 끼운다.
   * 어느 쪽이든 오리지날에 가까운 코드로 세 화면이 같아진다.
   */
  const rawBars = useMemo(() => (result ? buildBars(result) : []), [result]);
  /* 파형·타브가 실제로 적는 코드 목록. 어휘 낮추기와 다듬기를 거친
     것이라, 이것으로 견주어야 화면끼리 어긋나지 않는다 — 다듬기 전
     목록으로 견주었더니 몇 자리가 계속 달랐다. */
  const asShown = (rows: Chord[], bpm: number) =>
    tidyChords(
      settings.chordVocab === "all"
        ? rows
        : rows.map((c) => ({
            ...c,
            quality: simplifyQuality(c.quality, "basic"),
          })),
      bpm,
    );
  const unified = useMemo(
    () =>
      result && abcEntry
        ? unifyChords(
            abcEntry.abc,
            rawBars,
            abcEntry.barOffset,
            asShown(result.chords, result.bpm),
          )
        : null,
    // asShown은 어휘 설정만 보므로 그것을 함께 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, abcEntry, rawBars, settings.chordVocab],
  );
  const tuned: AnalysisResult | null = useMemo(
    () =>
      result && unified?.chords
        ? { ...result, chords: unified.chords }
        : result,
    [result, unified],
  );

  // 화면에 그릴 결과.
  // 1) 「기본」 어휘면 확장 화음을 3화음으로 낮춘다.
  // 2) 스치는 오인식·짧은 무음을 걷어내고 같은 코드는 하나로 잇는다.
  //    낮추고 나서 다듬어야 Cmaj7→C가 옆 C와 합쳐진다.
  const shown = useMemo(() => {
    if (!tuned) return tuned;
    /* 악보 코드로 모은 곡은 어휘를 낮추지도, 다듬지도 않는다.
       악보에 Cm6이라 적혀 있는데 파형만 C로 적거나, 반 마디짜리
       코드를 짧다고 걷어내면 또 서로 달라 보인다 — 실제로 한 마디가
       그렇게 어긋났다. 사람이 적어 둔 것은 이미 다듬어진 것이다. */
    if (unified?.source === "score") return tuned;
    const simplified =
      settings.chordVocab === "all"
        ? tuned.chords
        : tuned.chords.map((c) => ({
            ...c,
            quality: simplifyQuality(c.quality, "basic"),
          }));
    return { ...tuned, chords: tidyChords(simplified, tuned.bpm) };
  }, [tuned, unified, settings.chordVocab]);

  const bars = useMemo(
    () => (tuned === result ? rawBars : tuned ? buildBars(tuned) : []),
    [tuned, result, rawBars],
  );
  // 이 곡의 스트로크 자동 추천. 고르기 창이 추천 근거로 보여준다
  const strumRec = useMemo(
    () =>
      suggestStrum(
        bars,
        result?.strums,
        result?.bpm ?? 0,
        result?.time_signature ?? "4/4",
      ),
    [bars, result],
  );
  // 코드악보와 같은 추천을 파형 안내줄에도 쓴다. 두 화면이 다른 패턴을
  // 권하면 어느 쪽을 믿어야 할지 알 수 없다.
  const waveStrum = useMemo(
    () =>
      result
        ? suggestStrum(bars, result.strums, result.bpm, result.time_signature)
        : null,
    [bars, result],
  );
  /* 어느 화면에서든 안내줄에 똑같이 적을 스트로크.
     타브만 보여 주고 다른 화면은 감추면, 조성·박자는 있는데 주법만
     사라져 화면마다 딴말을 한다 — 모든 플레이 화면이 이것을 쓴다.
     직접 고른 패턴이 먼저고, 아르페지오로 치는 곡은 화살표를 걷는다
     (playNotes의 「아르페지오 N」이 대신 말한다). */
  const shownStrum = useMemo(() => {
    if (!result || arp > 0) return null;
    const manual = strumName
      ? PATTERNS.find((p) => p.name === strumName)
      : null;
    if (manual) return { pattern: manual, why: "직접 고른 패턴" };
    return waveStrum;
  }, [result, arp, strumName, waveStrum]);
  // 가사를 문장 단위로 묶는다. 편집할 때는 줄 그대로 본다.
  const lyricGroups = useMemo(
    () => groupBySentence(result?.lyrics ?? []),
    [result?.lyrics],
  );

  // 음높이 +n = 카포 n프렛. 카포가 소리를 n만큼 올려주므로
  // 화면 코드 표기는 반대로 n만큼 내린 모양이어야 원곡 소리가 난다.
  const noteShift = -transpose;

  /**
   * ♭로 적을지 ♯로 적을지.
   *
   * 카포를 끼우면 화면에 적히는 코드는 **옮겨진 조**의 것이다. 원곡
   * 조로 정하면 사장조 자리에 G♭m·D♭7 같은 엉뚱한 이름이 나온다 —
   * 사장조는 ♯을 쓰는 조다. 옮겨진 조를 보고 정한다.
   */
  const flats = useMemo(() => {
    if (!result) return false;
    const [tonic, mode = ""] = result.key.split(" ");
    const moved = transposeRoot(tonic, noteShift);
    return resolveFlats(
      moved ? `${moved} ${mode}`.trim() : result.key,
      settings.notation,
    );
  }, [result, noteShift, settings.notation]);

  // 재생 위치를 매 프레임 읽어 타임라인을 그린다. 상태는 값이 바뀔 때만 갱신.
  useEffect(() => {
    if (!playback || !shown) return;

    let raf = 0;
    let lastTick = -1;
    const frame = () => {
      const t = playback.getTime();
      // 화면에 표시할 때만 보정을 얹는다. 재생·반복은 실제 시각 그대로.
      // 기기 지연(소리가 늦게 나오는 만큼)은 모든 곡에 함께 적용된다.
      const shownT = t + sync - settings.latency;
      // 파형 커서도 같은 시각을 써야 한다. 코드 강조만 보정하면 커서와
      // 강조가 서로 어긋나 어느 쪽이 맞는지 알 수 없다.
      stripRef.current?.draw(shownT);
      // 다듬은 목록 기준으로 세어야 화면에 그린 코드와 인덱스가 맞는다
      setChordIdx(chordIndexAt(shown.chords, shownT));
      setBarIdx(barIndexAt(bars, shownT));

      if (loop && loop.b > loop.a && t >= loop.b) playback.seek(loop.a);

      // 시계와 탐색 바는 초당 4번이면 충분하다
      const tick = Math.floor(t * 4);
      if (tick !== lastTick) {
        lastTick = tick;
        setTime(t);
        setPlaying(playback.isPlaying());
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playback, shown, bars, loop, sync, settings.latency]);

  /**
   * 곡을 화면에 올린다.
   *
   * 그 곡에 저장해 둔 연주설정을 함께 되살린다 — 카포를 맞추고 속도를
   * 낮춰 연습하던 자리에서 그대로 이어 칠 수 있다.
   *
   * 이 기기에서 손댄 적이 없으면 **곡에 딸려 온 기준값**으로 시작한다.
   * 강사님이 악보와 음원을 맞춰 둔 싱크가 거기 들어 있다 — 수강생이
   * 받자마자 맞는 자리에서 시작해야 한다.
   */
  const showSong = (r: AnalysisResult) => {
    const setup = hasSetup(r.id)
      ? loadSetup(r.id)
      : {
          ...DEFAULT_SETUP,
          ...((r.setup ?? {}) as Partial<typeof DEFAULT_SETUP>),
          /*
           * 음높이는 늘 원곡 그대로 시작한다.
           *
           * 카포는 손과 목소리에 따라 저마다 다르다 — 미리 잡아 두면
           * 악보와 코드가 이미 옮겨진 채로 열려, 원곡과 맞춰 보려는
           * 사람이 도로 되돌려야 한다. 필요한 사람이 제 손으로 올린다.
           */
          transpose: 0,
        };
    setResult(r);
    // 다른 곡의 되돌리기가 이 곡에 적용되면 안 된다
    setUndo([]);
    setTranspose(setup.transpose);
    setRate(setup.rate);
    setLoop(setup.loop);
    setSync(setup.sync);
    setLyricSync(setup.lyricSync);
    setArp(setup.arp);
    setStrumName(setup.strum);
    setAutoChords(setup.autoChords);
    addRecent(r.id, r.title || r.id);
  };

  /** 재생기가 준비되면 저장해 둔 배속을 실제 재생에도 먹인다. */
  const attachPlayback = (pb: Playback) => {
    setPlayback(pb);
    if (rate !== 1) pb.setRate(rate);
  };

  const resetPlayback = () => {
    setResult(null);
    setStatus(null);
    setPlayback(null);
    setChordIdx(-1);
    setBarIdx(0);
    setTime(0);
    setTranspose(0);
    setRate(1);
    setLoop(null);
    setSync(0);
    setLyricSync(0);
    setStem("off");
    setVocalError(null);
  };

  /** 음원 분리 고르기: 트랙을 준비시킨 뒤에 바꾼다. */
  const pickStem = async (next: StemChoice) => {
    setVocalError(null);
    if (next === "off" || !result) {
      setStem("off");
      return;
    }
    setVocalBusy(true);
    try {
      // 기기에 받아 둔 트랙이 있으면 그걸로 충분하다 — 서버가 없는
      // 수강생 기기가 이 경우다. 없으면 서버에 만들어 달라고 한다.
      const stored = await getLocalAudio(stemKey(result.id, next)).catch(
        () => null,
      );
      if (!stored) {
        if (!health) {
          throw new Error(
            "이 기기에 트랙이 없습니다. 기타반에서 곡을 다시 받으면 함께 옵니다",
          );
        }
        await (next === "vocals" ? makeVocals : makeInstrumental)(result.id);
      }
      setStem(next);
    } catch (e) {
      setVocalError(`트랙을 준비하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setVocalBusy(false);
    }
  };

  const run = async (start: () => Promise<{ job_id: string }>) => {
    setError(null);
    resetPlayback();
    // 누르자마자 표시한다. 서버에 일을 맡기고 첫 진행 신호가 올 때까지
    // 1~2초가 비는데, 그동안 아무 반응이 없으면 안 눌린 줄 알고 또 누른다.
    setStatus({
      job_id: "",
      stage: "queued",
      progress: 0,
      message: "분석 준비 중",
    } as JobStatus);
    // 탭은 그대로 둔다. 진행률을 보던 자리에서 계속 보고, 끝나면 재생 화면으로 넘어간다.
    try {
      const { job_id } = await start();
      watchJob(job_id, (s) => {
        setStatus(s);
        if (s.stage === "done" && s.result_id) {
          getResult(s.result_id)
            .then((r) => {
              showSong(r);
              setTab("player");
              // 서버(PC)가 꺼져도 열 수 있도록 기기에도 저장해 둔다
              if (settings.autoSave) saveLocal(r).catch(() => {});
              // 악보를 먼저 만들어 두고 음원을 등록한 경우 — 이제야
              // 붙일 곡이 생겼다. 기다리던 악보를 그 곡에 싣는다.
              if (pendingAbc.current) {
                saveAbc(r.id, pendingAbc.current);
                pendingAbc.current = null;
                setAbcEntry(getAbc(r.id));
                setToast(
                  `음원목록에 등록하고 악보를 붙였습니다 — ${r.title || r.id}`,
                );
              }
            })
            .catch((e) => setError(e.message));
        }
        if (s.stage === "failed") setError(s.error ?? "분석에 실패했습니다");
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * 서버 없이 AI로 코드를 만든다.
   *
   * 되는 곡이 드물다 — 실측에서 세 곡 모두 "모른다"고 답했다. 그래서
   * 실패를 조용히 넘기지 않고 왜 안 됐는지 그대로 알려 준다.
   */
  const aiAnalyze = async (url: string) => {
    setError(null);
    const id = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1];
    if (!id) {
      setError("YouTube 주소에서 영상 번호를 찾지 못했습니다");
      return;
    }
    setStatus({
      job_id: "ai",
      stage: "chords",
      progress: 0.5,
      message: "AI에게 코드를 물어보는 중",
    } as JobStatus);
    try {
      const result = await analyzeWithAi(id, url, 0);
      setStatus(null);
      resetPlayback();
      showSong(result);
      setTab("home");
      if (settings.autoSave) saveLocal(result).catch(() => {});
    } catch (e) {
      setStatus(null);
      setError(
        e instanceof NotKnown
          ? `${e.message}. 기타반에서 받거나, 집 서버에 연결해 분석해 주세요.`
          : (e as Error).message,
      );
    }
  };

  /**
   * 한 마디의 코드를 바꾼다.
   *
   * 화면에 보이는 코드는 「기본」 어휘로 낮추고 다듬은 것이지만, 고치는
   * 대상은 원본이어야 한다 — 다듬은 결과에 손대면 다음에 어휘를 「전부」로
   * 바꿨을 때 고친 것이 사라진다.
   *
   * 카포를 올려 둔 상태에서도 화면에 보이는 이름으로 고를 수 있어야 하니,
   * 고른 근음을 원래 조성으로 되돌려 저장한다.
   */
  /**
   * 고친 결과를 서버에도 밀어 넣는다 — 실시간 동기화의 절반.
   *
   * 기기에는 이미 적혔다(기기가 원본). 서버가 살아 있으면 그 자리에서
   * 통째로 보내고, 꺼져 있거나 보내다 실패하면 명단에 적어 두었다가
   * 서버가 돌아오는 순간 밀어 넣는다(아래 flushDirty).
   */
  const pushToServer = (next: AnalysisResult) => {
    if (!health) {
      markDirty(next.id);
      return;
    }
    putResult(next)
      .then(() => clearDirty(next.id))
      .catch(() => markDirty(next.id));
  };

  /**
   * 서버가 돌려준 결과를 받아들인다 — 화면과 **기기 저장을 함께** 고친다.
   *
   * 악보 맞춤·AI 되돌이 읽기·기준값 저장은 서버에서 이루어지고 결과만
   * 돌아온다. 화면만 바꾸고 기기 사본을 안 고치면 두 벌이 어긋나기
   * 시작한다 — 「어느 쪽이 원본인가」 하는 혼란이 여기서 났다.
   * 기기 사본이 원본이다. 서버 것이 오면 즉시 기기에 적는다.
   */
  const adoptResult = (r: AnalysisResult) => {
    setResult(r);
    void saveLocal(r).catch(() => {});
  };

  const applyChordEdit = async (
    barIndex: number,
    change: { root: string; quality: string } | null,
  ) => {
    if (!result) return;
    const bar = bars[barIndex];
    if (!bar) return;

    const chords = change
      ? setChordAt(
          result.chords,
          bar.start,
          bar.end,
          transposeRoot(change.root, -noteShift) ?? change.root,
          change.quality,
        )
      : clearChordAt(result.chords, bar.start, bar.end);

    // 고치기 전 상태를 쌓아 둔다. 20단계면 충분하다
    setUndo((prev) => [...prev, result.chords].slice(-20));

    const next = { ...result, chords };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
  };

  /**
   * 가사 한 줄을 고치거나 지운다.
   *
   * 시각을 바꾸면 순서가 달라질 수 있어 다시 정렬하고, 각 줄의 끝도
   * 다음 줄 시작에 맞춘다 — 이게 어긋나면 악보에 붙일 때 겹친다.
   */
  const applyLyricEdit = async (
    index: number,
    change: { text: string; at: number } | null,
  ) => {
    if (!result?.lyrics) return;
    const rows = result.lyrics
      .map((l, i) =>
        i !== index
          ? l
          : change
            ? { ...l, text: change.text, t: change.at }
            : null,
      )
      .filter((l): l is LyricLine => l !== null)
      .sort((a, b) => a.t - b.t)
      .map((l, i, all) => ({
        ...l,
        end: i + 1 < all.length ? all[i + 1].t : l.end,
      }));

    const next = { ...result, lyrics: rows };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
  };

  /** 편집에서 고르고 있는 가사 줄. 옆에 마디 옮기기 단추가 붙는다 */
  const [pickLyric, setPickLyric] = useState<number | null>(null);
  /** 끌고 있는 가사 줄(집은 자리 → 놓을 자리) */
  const [dragLyric, setDragLyric] = useState<{
    from: number;
    to: number;
  } | null>(null);

  /**
   * 가사 글자만 자리를 바꾼다. 시각은 그대로 둔다.
   *
   * 자막이 한 줄씩 밀려 붙는 일이 흔하다 — 시각 칸은 맞는데 글자가
   * 옆 칸에 들어 있는 것이다. 그럴 때 필요한 것은 시각을 옮기는 일이
   * 아니라 **글자를 옆 칸으로 옮기는** 일이다. 시각을 건드리면 애써
   * 맞춰 둔 격자가 도로 어긋난다.
   */
  const moveLyricText = async (from: number, to: number) => {
    if (!result?.lyrics?.length || from === to) return;
    const texts = result.lyrics.map((l) => l.text);
    const [moved] = texts.splice(from, 1);
    texts.splice(to, 0, moved);
    const rows = result.lyrics.map((l, i) => ({ ...l, text: texts[i] }));

    const next = { ...result, lyrics: rows, lyrics_manual: true };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
  };

  /**
   * 고른 줄 바로 다음에 빈 줄을 넣는다.
   *
   * 자막은 소절을 통째로 빠뜨리기도 한다. 그럴 때 「지금 듣는 자리에
   * 넣기」로는 어림이 어려우니, 어디에 넣을지 눈으로 짚게 한다.
   * 시각은 앞뒤 줄의 가운데다 — 뒤 가사를 밀지 않고 사이에 끼워 넣는다.
   */
  const addLyricAfter = async (index: number) => {
    if (!result) return;
    const list = result.lyrics ?? [];
    const cur = list[index];
    if (!cur) return;
    const after = list[index + 1];
    const bar = bars.find((b) => b.start <= cur.t && cur.t < b.end);
    const span = bar ? bar.end - bar.start : ((60 / (result.bpm || 100)) * 4);
    const at = +(after ? (cur.t + after.t) / 2 : cur.t + span).toFixed(2);

    const rows = [...list, { t: at, end: 0, text: "새 줄" }]
      .sort((a, b) => a.t - b.t)
      .map((l, i, all) => ({
        ...l,
        end: i + 1 < all.length ? all[i + 1].t : l.end,
      }));

    const next = { ...result, lyrics: rows, lyrics_manual: true };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
    // 넣자마자 글자를 적게 창을 연다
    const put = rows.findIndex((l) => l.t === at && l.text === "새 줄");
    setPickLyric(put);
    setEditLyric(put);
  };

  /**
   * 고른 줄에 아랫줄을 붙인다.
   *
   * 자막은 숨 쉬는 자리마다 토막나 한 소절이 두세 줄로 갈린다. 그대로
   * 두면 악보 아래 가사가 잘게 끊겨 어디를 부르는지 알기 어렵다.
   * 붙일 때 시각은 **앞줄 것을 쓴다** — 소절은 앞줄에서 시작한다.
   */
  const mergeLyricDown = async (index: number) => {
    if (!result) return;
    const list = result.lyrics ?? [];
    const cur = list[index];
    const after = list[index + 1];
    if (!cur || !after) return;

    const rows = list
      .map((l, i) =>
        i === index
          ? { ...l, text: `${l.text} ${after.text}`.trim(), end: after.end }
          : l,
      )
      .filter((_, i) => i !== index + 1);

    const next = { ...result, lyrics: rows, lyrics_manual: true };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
  };

  /** 전체 가사를 글자판으로 펼쳐 놓은 것. null이면 창이 닫혀 있다 */
  const [lyricText, setLyricText] = useState<string | null>(null);

  /**
   * 글자판에 적은 가사를 곡에 넣는다.
   *
   * 한 줄에 한 소절. **시각은 있던 것을 그대로 물려준다** — 글자만
   * 고치러 여는 자리라, 애써 맞춘 싱크를 글자 고치다 잃으면 안 된다.
   *
   * 줄 수가 달라지면: 늘어난 줄은 마지막 줄 뒤로 한 마디씩 이어 붙이고,
   * 줄어든 만큼은 뒤에서 덜어 낸다.
   */
  const applyLyricText = async (text: string) => {
    if (!result) return;
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const old = result.lyrics ?? [];
    const span =
      bars.length > 1
        ? bars[1].start - bars[0].start
        : (60 / (result.bpm || 100)) * 4;
    const last = old.length ? old[old.length - 1].t : 0;

    const rows = lines.map((textLine, i) => ({
      t: i < old.length ? old[i].t : +(last + span * (i - old.length + 1)).toFixed(2),
      end: 0,
      text: textLine,
    }));
    for (let i = 0; i < rows.length; i++)
      rows[i].end = i + 1 < rows.length ? rows[i + 1].t : (old[old.length - 1]?.end ?? result.duration);

    const next = { ...result, lyrics: rows, lyrics_manual: true };
    setResult(next);
    setLyricText(null);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
  };

  /** 이 시각이 몇 번째 마디인가(1부터). 가사 앞에 적어 준다 */
  const barOfTime = (t: number): number => {
    let no = 0;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i].start <= t) no = i + 1;
      else break;
    }
    return no;
  };

  /** 손가락이 지나는 자리의 가사 줄 번호. 없으면 null */
  const lyricUnder = (x: number, y: number): number | null => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest("[data-lyric]") as HTMLElement | null;
    const no = el?.dataset.lyric;
    return no === undefined ? null : Number(no);
  };

  /**
   * 고른 줄부터 뒤 가사를 한 마디씩 민다.
   *
   * 자막 가사는 곡 한가운데서 통째로 어긋나는 일이 있다 — 간주를 세지
   * 않았거나 한 소절을 빠뜨린 것이다. 그 줄만 옮기면 뒤가 다 어긋난
   * 채로 남으므로, **고른 줄부터 끝까지 함께** 민다. 앞 줄은 이미 맞아
   * 있으니 건드리지 않는다.
   *
   * 한 마디의 길이는 그 자리의 마디 격자에서 잰다. 곡마다 빠르기가
   * 다르니 정해진 초를 쓸 수 없다.
   */
  const shiftLyricsFrom = async (index: number, dir: 1 | -1) => {
    if (!result?.lyrics?.length) return;
    const at = result.lyrics[index]?.t ?? 0;
    const bar = bars.find((b) => b.start <= at && at < b.end) ?? bars[0];
    const span = bar ? bar.end - bar.start : (60 / (result.bpm || 100)) * 4;
    const delta = dir * span;

    const rows = result.lyrics
      .map((l, i) =>
        i < index ? l : { ...l, t: Math.max(+(l.t + delta).toFixed(2), 0) },
      )
      .sort((a, b) => a.t - b.t)
      .map((l, i, all) => ({
        ...l,
        end: i + 1 < all.length ? all[i + 1].t : l.end,
      }));

    const next = { ...result, lyrics: rows, lyrics_manual: true };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
  };

  /**
   * 지금 듣고 있는 자리에 가사 줄을 새로 넣는다.
   *
   * 자막이 빠뜨린 줄, 라라라 같은 흥얼거림, 아예 가사가 없는 곡 — 손으로
   * 채워야 하는 자리가 있다. 넣자마자 편집창을 열어 바로 적게 한다.
   */
  const addLyricLine = async () => {
    if (!result) return;
    const rows = [
      ...(result.lyrics ?? []),
      { t: +time.toFixed(2), end: 0, text: "새 줄" },
    ]
      .sort((a, b) => a.t - b.t)
      .map((l, i, all) => ({
        ...l,
        end: i + 1 < all.length ? all[i + 1].t : l.end,
      }));

    const next = { ...result, lyrics: rows, lyrics_manual: true };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
    // 방금 넣은 줄을 바로 고치게 연다
    setEditLyric(rows.findIndex((l) => l.t === +time.toFixed(2)));
  };

  /**
   * 가사를 AI로 다듬는다.
   *
   * 자동 자막에서 온 가사는 토막나 있고 글자가 틀린다("바라미 차가워진").
   * 이미 있는 글을 고쳐 쓰는 일이라 AI가 잘한다 — 실측에서 52줄 토막이
   * 25줄 소절로 정리되고 잘못 인식된 낱말들이 바로잡혔다.
   */
  const tidyWithAi = async () => {
    if (!result?.lyrics?.length || !health) return;
    setLyricBusy(true);
    setError(null);
    try {
      const updated = await tidyLyrics(result.id);
      setResult(updated);
      await saveLocal(updated).catch(() => {});
    } catch (e) {
      setError(`가사를 다듬지 못했습니다: ${(e as Error).message}`);
    } finally {
      setLyricBusy(false);
    }
  };

  /** 마지막 고침을 되돌린다. */
  const undoChordEdit = async () => {
    if (!result || undo.length === 0) return;
    const prev = undo[undo.length - 1];
    setUndo((u) => u.slice(0, -1));
    const next = { ...result, chords: prev };
    setResult(next);
    await saveLocal(next).catch(() => {});
    pushToServer(next);
  };

  const openSaved = async (id: string): Promise<boolean> => {
    setError(null);
    resetPlayback();
    // 재생은 언제나 연습실에서 — 홈은 대시보드다
    setTab("player");
    try {
      /* 기기 것을 먼저 연다 — 기기가 원본이다.
         예전에는 서버 것을 먼저 열었다. 그래서 가사를 붙이고 기기에만
         적힌 사이에 곡을 다시 열면, 가사 없는 서버 사본이 그 위에
         열려 「붙였던 가사가 떨어지는」 꼴이 됐다. 고친 것은 어차피
         실시간 동기화가 서버로 밀어 넣는다. */
      const result = (await getLocal(id).catch(() => null))
        ?? (health ? await getResult(id) : null);
      if (!result) throw new Error("결과 없음");
      showSong(result);
      return true;
    } catch {
      setError(
        "이 곡을 열 수 없습니다. 기기에 저장돼 있지 않고 서버에도 연결되지 않았습니다.",
      );
      return false;
    }
  };

  const busy =
    status !== null && status.stage !== "done" && status.stage !== "failed";

  const shownChords = shown?.chords ?? [];
  const current = chordIdx >= 0 ? shownChords[chordIdx] : undefined;
  const next =
    chordIdx + 1 < shownChords.length ? shownChords[chordIdx + 1] : undefined;

  const view = (c: typeof current) =>
    c
      ? {
          root: transposeRoot(c.root, -transpose),
          label: labelFor(transposeRoot(c.root, -transpose), c.quality, flats),
          quality: c.quality,
        }
      : undefined;

  const cur = view(current);
  const nxt = view(next);
  /* 코드가 없는 자리(N.C.)는 잡을 것이 없다는 뜻이다. 이름을 적으면
     코드처럼 읽혀, 연습실에서는 아예 비워 둔다 */
  const playable = (c: typeof cur) => (c && c.label !== "N.C." ? c : undefined);
  const curPlay = playable(cur);
  const nxtPlay = playable(nxt);

  // 바꾼 설정은 곧바로 그 곡에 적어 둔다
  useEffect(() => {
    if (!result) return;
    saveSetup(result.id, {
      transpose,
      rate,
      loop,
      sync,
      lyricSync,
      arp,
      strum: strumName,
      autoChords,
    });
  }, [
    result?.id,
    transpose,
    rate,
    loop,
    sync,
    lyricSync,
    arp,
    strumName,
    autoChords,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // 연주설정에서 기본값과 달라진 것만 모은다. 악보 안내줄에 적어
  // "지금 무슨 설정으로 보고 있는지"를 늘 눈에 두게 한다.
  const playNotes = useMemo(() => {
    const out: string[] = [];
    if (transpose > 0) out.push(`카포 ${transpose}프렛`);
    else if (transpose < 0) out.push(`이조 ${transpose}`);
    if (rate !== 1) out.push(`빠르기 ${rate}×`);
    if (loop) out.push("구간 반복");
    if (settings.chordVocab === "basic") out.push("코드 기본");
    if (sync !== 0) out.push(`코드 ${sync > 0 ? "+" : ""}${sync.toFixed(1)}초`);
    if (lyricSync !== 0)
      out.push(`가사 ${lyricSync > 0 ? "+" : ""}${lyricSync.toFixed(1)}초`);
    if (stem === "inst") out.push("반주만");
    if (stem === "vocals") out.push("보컬만");
    return out;
  }, [transpose, rate, loop, settings.chordVocab, stem, sync, lyricSync]);

  /** 이 곡을 치는 방식. 악보 상자 안내줄 맨 앞에 굵게 적는다 */
  const playStyle = arp > 0 ? `아르페지오 ${arp}` : "스트로크";

  /* 가사 칸. 넓은 화면에서는 오른쪽 기둥에, 파형 화면에서는 파형 아래에
     같은 것이 놓인다 — 두 벌로 적어 두면 한쪽만 고치게 된다 */
  const lyricsPane = result ? (
    <LyricsPane
      result={result}
      time={time + lyricSync - settings.latency}
      online={!!health}
      canEdit={settings.adminMode}
      onLyrics={(lines) =>
        setResult((prev) => (prev ? { ...prev, lyrics: lines } : prev))
      }
      onResult={(r) => {
        adoptResult(r);
        pushToServer(r);
      }}
      onSeek={(t) => {
        playback?.seek(t);
        setTime(t);
      }}
    />
  ) : null;

  /**
   * 폰의 「뒤로」로 앱이 꺼지지 않게 한다.
   *
   * 안드로이드에서 뒤로를 누르면 곧장 앱이 닫혔다 — 악보를 보다 잘못
   * 누르면 처음부터 다시 열어야 했다. 뒤로는 한 걸음씩 물러나는 것이어야
   * 한다: 열린 창을 닫고, 그다음 홈으로, 더 물러날 데가 없을 때에만
   * 「나가시겠습니까?」를 묻는다.
   *
   * 되돌아갈 자리(history)를 한 칸 만들어 두고, 뒤로가 눌리면 그 칸을
   * 도로 채워 넣는 식으로 붙잡는다.
   */
  const [askExit, setAskExit] = useState(false);
  // popstate는 한 번만 붙인다. 지금 상태는 ref로 들여다본다.
  const backState = useRef({ showSheet, showStrums, editBar, tab });
  backState.current = { showSheet, showStrums, editBar, tab };
  const leaving = useRef(false);
  useEffect(() => {
    // 주소 뒤에 #p를 붙여 되돌아갈 자리를 만든다. pushState로 만들면
    // Next 라우터가 화면 이동으로 알아듣고 앱을 통째로 다시 그린다 —
    // 그러면 보고 있던 자리도, 붙잡을 기회도 함께 날아간다. 해시는
    // 라우터가 거들떠보지 않는다.
    const guard = () => {
      if (leaving.current) return;
      if (window.location.hash !== "#p") window.location.hash = "p";
    };
    guard();
    const onPop = () => {
      if (leaving.current) return;
      if (window.location.hash === "#p") return; // 우리가 붙인 자리로 돌아온 것
      const now = backState.current;
      guard(); // 다시 붙잡아 둔다 — 아래에서 한 걸음만 물러난다
      if (now.editBar !== null) {
        setEditBar(null);
        return;
      }
      if (now.showStrums) {
        setShowStrums(false);
        return;
      }
      if (now.showSheet) {
        setShowSheet(false);
        return;
      }
      if (now.tab !== "home") {
        setTab("home");
        return;
      }
      setAskExit(true);
    };
    window.addEventListener("hashchange", onPop);
    return () => window.removeEventListener("hashchange", onPop);
  }, []);

  /** 「나가기」를 골랐을 때. 붙잡아 둔 자리를 놓아 준다. */
  const leaveApp = () => {
    leaving.current = true;
    setAskExit(false);
    // 붙잡아 둔 자리(#p)를 놓아 준다
    window.history.back();
    // 그다음 한 칸을 더 물러나면 앱 밖이다. 설치한 앱은 이때 닫힌다.
    // 한 번에 go(-2)로 하지 않는 것은, 되돌아갈 칸이 하나뿐일 때
    // 브라우저가 통째로 무시해 아무 일도 일어나지 않기 때문이다.
    setTimeout(() => {
      window.close();
      window.history.back();
    }, 150);
  };

  /**
   * 악보를 음원 위에서 한 마디씩 민다(강사님).
   *
   * 악보설정 줄에도 같은 손잡이가 있지만, 싱크 옆에도 있어야 한다 —
   * 어긋난 것이 한 마디인지 반 박인지는 눌러 보며 가리는 일이다.
   */
  const shiftBar = async (delta: number) => {
    const sh = (result?.sheet ?? null) as {
      offset?: number;
      repeats?: number;
    } | null;
    if (!result || !sh) return;
    try {
      setResult(
        await moveSheetImage(
          result.id,
          Math.round(((sh.offset ?? 0) + delta) * 100) / 100,
          sh.repeats ?? 1,
        ),
      );
    } catch {
      // 서버가 없으면 밀 수 없다. 조용히 넘어간다 — 수강생 화면에는
      // 이 손잡이가 아예 나오지 않는다.
    }
  };

  /**
   * 연주기 창에서 고를 수 있는 곡 목록.
   *
   * 기기에 담아 둔 곡이 먼저다 — 수강생에게는 그것이 전부이고, 강사님도
   * 연습할 때는 담아 둔 곡을 친다. 기기가 비었으면 서버 것을 보여 준다.
   */
  const [songList, setSongList] = useState<ResultSummary[]>([]);
  useEffect(() => {
    // 곡을 옮겨 다니는 자리 — 연습실의 이전·다음 곡과 전체보기의 곡 고르기
    if (!showSheet && tab !== "player") return;
    let alive = true;
    (async () => {
      // 기기에 담아 둔 곡이 먼저. 서버가 붙어 있으면(강사님 PC) 서버에만
      // 있는 곡을 뒤에 잇는다 — 기기에 한 곡만 담겨 있다고 목록이 사라지면
      // 곡을 옮겨 다닐 수가 없다.
      const rows = await listLocal().catch(() => [] as ResultSummary[]);
      const seen = new Set(rows.map((r) => r.id));
      if (health) {
        const more = await listResults().catch(() => [] as ResultSummary[]);
        for (const r of more) if (!seen.has(r.id)) rows.push(r);
      }
      if (alive) setSongList(rows);
    })();
    return () => {
      alive = false;
    };
  }, [showSheet, tab, health]);

  /** 목록에서 지금 곡이 몇 번째인가. 없으면 -1 */
  const songAt = result ? songList.findIndex((r) => r.id === result.id) : -1;

  /**
   * 메뉴를 눌렀을 때. 「연주기」는 탭이 아니라 전체보기 창이다.
   *
   * 곡을 보다가 큰 화면으로 펴는 일은 자주 하는데, 여태 곡 화면
   * 안쪽의 작은 「전체보기」를 찾아야 했다. 아래 메뉴에서 바로 연다.
   */
  const goTab = async (next: Tab) => {
    // 전체보기 창이 본문을 덮고 있으면 먼저 닫는다 — 탭만 바꾸면
    // 뒤에서 바뀔 뿐이라 눌러도 아무 일이 없는 것처럼 보인다.
    setShowSheet(false);
    // 악보 만들기 창은 음원등록 뷰 안에 있다 — 다른 메뉴로 가면 접는다
    if (next !== "import") setAbcAttach(false);
    if (next !== "player") {
      setTab(next);
      return;
    }
    // 연습실: 곡이 있으면 그대로, 없으면 마지막에 치던 곡을 열어 준다.
    if (result) {
      setTab("player");
      return;
    }
    const last = listRecent()[0];
    if (last && (await openSaved(last.id))) return;
    setTab("player"); // 곡이 하나도 없으면 안내 화면이 뜬다
  };

  // 태블릿·PC 폭인가. 넓으면 악보를 더 많은 줄 보인다 —
  // 세로도 폭만큼 남으므로 두 줄만 띄우면 화면이 텅 빈다.
  const wide = useWideScreen();
  /* 세워 둔 태블릿까지 「큰 기기」다. 배치는 한 기둥이어도 코드 그림과
     이름은 크게 보여야 한다 — 태블릿은 멀찍이 두고 보는 자리다. */
  const big = useBigScreen();

  // 멜로디는 음원 분리를 쓴 곡에만 있다. 없는 곡에 「멜로디」 칸을 두면
  // 눌러도 빈 오선만 나온다 — 있을 때만 칸을 만든다.
  const hasScore = !!(result as { score?: unknown } | null)?.score;
  // 강사님이 올린 악보 그림. 있으면 우리가 그리지 않고 이것을 띄운다.
  // 인쇄된 악보 그림이 있으면 그것을 띄운다 — 원본과 똑같은 것은
  // 이 길뿐이다. 도돌이표는 편 차례를 그림에도 넘겼으므로, 되돌아가는
  // 자리에서 화면도 함께 되돌아간다.
  //
  // 그린 악보는 전체보기의 「멜로디」 탭에 남는다 — 조옮김이 필요하거나
  // 그림이 없는 곡에 쓴다.
  const sheetImg = (result?.sheet ?? null) as SheetData | null;

  const [abcAttach, setAbcAttach] = useState(false);
  /** 악보 만들기 창(AI 악보생성기 iframe) */
  const abcFrameRef = useRef<HTMLIFrameElement>(null);
  /**
   * 악보 만들기 창을 연다.
   *
   * 창은 음원등록 뷰 안에 산다 — 다른 화면에서 눌렀다면 그 탭으로 함께
   * 데려가야 한다. 안 그러면 눌러도 아무 일이 없는 것처럼 보인다.
   */
  const openAbcStudio = () => {
    setAbcAttach(true);
    setShowSheet(false);
    setTab("import");
  };
  /** 새 음원을 등록하는 동안 들고 있는 악보. 분석이 끝나면 그 곡에 붙인다 */
  const pendingAbc = useRef<string | null>(null);
  /** 저장 결과를 알리는 짧은 안내 */
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  /**
   * 악보 만들기 창과의 대화.
   *
   * 창이 준비됐다고 알려 오면 지금 곡의 악보와 음원 주소를 보내 주고,
   * 「이 곡에 저장」을 누르면 받은 악보를 그 곡에 싣는다.
   */
  useEffect(() => {
    if (!abcAttach) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== abcFrameRef.current?.contentWindow) return;
      const msg = e.data as { type?: string; abc?: string; youtube?: string };
      if (msg?.type === "abc-ready") {
        abcFrameRef.current?.contentWindow?.postMessage(
          {
            type: "abc-init",
            // 설정에 넣어 둔 AI 키를 그대로 넘긴다 — 창에서 다시 묻지 않는다
            apiKey: localLlmKey(),
            model: localLlmModel(),
            // 지금 테마의 색. 창이 이 앱과 같은 옷을 입는다
            theme: (() => {
              const cs = getComputedStyle(document.documentElement);
              return {
                bg: cs.getPropertyValue("--background").trim(),
                ink: cs.getPropertyValue("--foreground").trim(),
                accent: cs.getPropertyValue("--accent").trim(),
                bar: cs.getPropertyValue("--bar-bg").trim(),
                // 글꼴도 같은 것을 쓰게 넘긴다 (본문·고정폭)
                font: getComputedStyle(document.body).fontFamily,
                mono: cs.getPropertyValue("--font-mono").trim(),
              };
            })(),
            abc: result ? (abcEntry?.abc ?? "") : "",
            title: result ? result.title || result.id : "",
            youtube:
              result?.source === "youtube"
                ? `https://youtu.be/${result.id}`
                : "",
          },
          "*",
        );
      } else if (msg?.type === "abc-save" && msg.abc) {
        if (result) {
          // 열어 둔 곡을 고치던 참이다 — 그 곡에 싣는다
          saveAbc(result.id, msg.abc, abcEntry?.barOffset ?? 0);
          setAbcEntry(getAbc(result.id));
          setToast(`「${result.title || result.id}」에 저장했습니다`);
          return;
        }
        // 새 음원으로 만든 악보다. 음원을 먼저 등록해 코드·비트를 딴 뒤,
        // 그렇게 생긴 곡에 이 악보를 붙인다(분석이 끝나면 이어서 저장된다).
        if (msg.youtube) {
          pendingAbc.current = msg.abc;
          setAbcAttach(false);
          setToast("음원을 등록하고 분석합니다 — 끝나면 악보가 함께 붙습니다");
          run(() => analyzeUrl(msg.youtube!, settings.separate));
          return;
        }
        setError(
          "악보를 실을 곡이 없습니다 — 음원 링크를 넣어 등록하거나, 음원목록에서 곡을 먼저 여세요.",
        );
      }
    };
    window.addEventListener("message", onMessage);
    // 이미 떠 있는 창에도 지금 값을 한 번 보낸다 — 테마를 바꾸거나
    // 곡을 옮기면 창이 새로 뜨지 않으므로 여기서 맞춰 준다
    const win = abcFrameRef.current?.contentWindow;
    if (win)
      onMessage({ source: win, data: { type: "abc-ready" } } as MessageEvent);
    return () => window.removeEventListener("message", onMessage);
  }, [abcAttach, result, abcEntry, settings.theme]);

  useEffect(() => {
    const entry = result ? getAbc(result.id) : null;
    setAbcEntry(entry);
    // ABC 악보가 붙은 곡은 연습실을 AI연주기와 같은 화면으로 연다 —
    // 영상 아래 악보가 바로 펼쳐지고 커서가 따라간다
    if (entry) patchSettings({ view: "melody" });
  }, [result?.id]);
  /**
   * 「멜로디」 칸에 보여 줄 악보가 있는가.
   *
   * 강사님이 붙인 악보 파일이나 악보 그림이 있어야 한다. 보컬에서 딴
   * 멜로디는 부른 음의 15~30%밖에 잡히지 않아, 그것을 악보라고 내놓으면
   * 틀린 음을 따라 치게 된다. 없으면 없다고 적는 편이 낫다.
   */
  const hasMelody = hasScore || !!sheetImg;

  // 멜로디가 없어도 칸은 남긴다. 눌렀을 때 「이 음원은 멜로디 악보를
  // 지원하지 않습니다」라고 적어 주는 편이, 칸이 사라져 앱이 고장난 줄
  // 아는 것보다 낫다.
  const boardView = settings.view;

  // 악보 그림 위에 덮어쓸 코드. 자리는 악보에 적힌 그대로 쓴다.
  //
  // 악보는 이미 짚기 쉬운 조로 옮겨 적혀 있다(하얀나비는 사장조이고
  // 카포 2프렛으로 원곡 가장조가 된다). 그러니 화면에 적을 코드는
  //     적힌 코드 + (악보와 원곡의 차이) − 지금 카포
  // 다. 여기서 또 -transpose를 걸면 두 번 옮겨져 엉뚱한 코드가 된다.
  const sheetChordList = useMemo(() => {
    if (transpose === 0) return [];
    const shift =
      ((result?.score_align ?? null) as { shift?: number } | null)?.shift ?? 0;
    return sheetChords(
      (result?.score ?? null) as never,
      shift - transpose,
      flats,
    );
  }, [result?.score, result?.score_align, transpose, flats]);

  /**
   * 악보에 코드가 인쇄돼 있지 않을 때 대신 얹을 코드.
   *
   * 뮤즈스코어에서 받은 악보는 멜로디만 그려진 것이 많다. 그대로 띄우면
   * 기타를 칠 수가 없다 — 코드가 하나도 없으니까. 음원에서 딴 코드를
   * 얹어 준다. 인쇄된 코드가 하나라도 있으면 그쪽이 옳으므로 두지 않는다.
   *
   * 음원 코드는 원곡 조다. 카포를 끼운 만큼 내려 적어야 손가락과 맞는다.
   */
  const autoSheetChords = useMemo(() => {
    // 그림만으로는 인쇄된 코드가 있는지 알 길이 없다. 적혀 있는 악보에
    // 얹으면 글자가 겹쳐 둘 다 못 읽게 되므로, 곡마다 켜 준 때에만 얹는다.
    //
    // 음높이를 바꿨다고 얹지는 않는다. 악보 파일에 코드가 없으면
    // 인쇄된 코드가 무엇인지 알 수 없어 **어림으로 덮어쓰는 셈**이라,
    // 음원에서 잘못 딴 코드가 제대로 적힌 코드를 가려 버린다.
    // (실제로 라라라 대목에서 G♭m·D♭7 같은 엉뚱한 이름이 얹혔다.)
    if (!autoChords || !result?.chords?.length) return undefined;
    return result.chords
      .filter((c) => c.root)
      .map((c) => ({
        start: c.start,
        end: c.end,
        label: labelFor(transposeRoot(c.root, noteShift), c.quality, flats),
      }));
  }, [autoChords, result?.chords, noteShift, flats]);

  // 지금 보고 있는 메뉴의 이름. 넓은 화면에서는 사이드바가 앱 이름을
  // 맡고, 위쪽 띠는 "여기가 어디인지"를 맡는다.
  const TAB_TITLE: Record<Tab, string> = {
    home: result ? result.title || "재생" : "홈",
    // 연주기는 창을 여는 자리라 이 이름이 띠에 오래 남지 않는다
    player: result ? result.title || "연습실" : "연습실",
    library: "음원목록",
    import: "음원등록",
    lesson: "강의실",
    edit: "편집",
    chords: "기타 기초",
    settings: "설정",
  };

  return (
    /* 화면 크기에 따라 두 모습이 된다.
       - 폰: 위에 앱 이름 띠, 아래에 탭 막대 (지금까지의 모습)
       - 태블릿·PC(md 이상): 왼쪽에 주메뉴 기둥(위에 앱 이름), 오른쪽 본문
         위에 지금 메뉴 이름 띠. 본문은 넓은 화면에서 가운데로 모은다 */
    <div className="app-scale flex overflow-x-hidden">
      <SideNav
        tab={showSheet ? "player" : tab}
        onChange={goTab}
        adminMode={settings.adminMode}
      />

      {/* 본문은 화면 폭을 그대로 쓴다. 폰에서만 너무 넓어지지 않게 모은다 */}
      <div className="mx-auto flex h-full min-w-0 w-full max-w-2xl flex-col sm:max-w-none md:mx-0 md:border-l md:border-[var(--panel-line)] md:">
        {/* 어느 탭에 있든 앱 이름은 항상 보인다. 테마 강조색이 물드는 타이틀바. */}
        <header className="shrink-0 bg-[var(--bar-bg)]">
          <div className="flex items-center gap-2.5 px-3 py-2 roomy:gap-3 roomy:px-5 roomy:py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)] roomy:hidden">
              <Image
                src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/guitar.png`}
                alt=""
                width={20}
                height={32}
                className="h-7 w-auto"
                priority
              />
            </span>
            <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight roomy:hidden">
              <span className="text-[var(--accent)]">리천</span> 기타교실
            </h1>
            {/* 넓은 화면: 앱 이름은 사이드바에 있으니 여기는 메뉴 이름.
              앞에 그 메뉴의 아이콘을 세워 어디에 있는지 한눈에 보인다 */}
            <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)] roomy:flex">
              <svg
                viewBox="0 0 24 24"
                className="h-[22px] w-[22px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {NAV_ITEMS.find((i) => i.id === tab)?.icon}
              </svg>
            </span>
            <h1 className="hidden min-w-0 flex-1 truncate text-[22px] font-bold tracking-tight roomy:block">
              {TAB_TITLE[tab]}
            </h1>
            {/* 이 앱을 누가 쓰는지. 수강생이 여러 앱을 오갈 때 여기서 알아본다.
              폭이 좁으면 앱 이름이 먼저 줄고 이 표시는 남는다 */}
            <span className="shrink-0 whitespace-nowrap text-[11px] font-medium leading-tight text-[var(--accent)] opacity-80 roomy:hidden">
              강상주민센터 기타반
              <br />
              조영민 강사님
            </span>
            {/* 도움말 — 지금 보는 메뉴에 맞는 안내가 열린다 */}
            <HelpButton tab={tab} playing={!!result} />
            <FullscreenButton />
          </div>
          {/* 강조색 헤어라인 */}
          <div className="h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--accent)_55%,transparent)] to-transparent" />
        </header>

        {/* 서버 관련 안내는 관리자에게만. 수강생 화면은 서버 개념을 모른다. */}
        {backendDown && settings.adminMode && (
          <p className="shrink-0 bg-amber-50 px-3 py-1.5 text-[11px] leading-snug text-amber-800">
            분석 서버에 연결되지 않았습니다. 새 분석은 안 되지만, 음원목록의
            기기 저장 곡과 기타 기초는 그대로 쓸 수 있습니다. 서버 주소는 설정
            탭에서 지정합니다.
          </p>
        )}

        {/* 전체 가사를 글자판에 펴 놓고 고친다. 시각은 그대로 물려준다 */}
        {lyricText !== null && result && (
          <Popup title="전체 가사 편집" onClose={() => setLyricText(null)}>
            <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              한 줄에 한 소절입니다. <b>시각은 그대로 남습니다</b> — 글자만
              고쳐집니다. 줄을 늘리면 뒤에 한 마디씩 이어 붙고, 줄이면 뒤에서
              덜어 냅니다.
            </p>
            <textarea
              className="h-64 w-full rounded border px-3 py-2 text-sm"
              autoFocus
              value={lyricText}
              onChange={(e) => setLyricText(e.target.value)}
            />
            <div className="mt-1 text-right text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              {lyricText.split(/\r?\n/).filter((l) => l.trim()).length}줄 ·
              지금 {(result.lyrics ?? []).length}줄
            </div>
            <button
              className="mt-2 w-full rounded bg-[var(--accent)] py-3 text-sm font-medium text-white disabled:opacity-40"
              disabled={!lyricText.trim()}
              onClick={() => void applyLyricText(lyricText)}
            >
              이 가사로 바꾸기
            </button>
          </Popup>
        )}

        {/* 나가기 확인. 뒤로를 눌러 앱이 툭 꺼지면 놀란다 — 한 번 묻는다 */}
        {askExit && (
          <Popup
            title="앱을 나가시겠습니까?"
            width="max-w-xs"
            onClose={() => setAskExit(false)}
          >
            <p className="mb-2.5 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              받아 둔 곡과 설정은 그대로 남습니다. 다시 열면 이어서 치실 수
              있습니다.
            </p>
            <div className="space-y-1.5">
              <button
                className="w-full rounded bg-[var(--panel)] py-2.5 text-sm font-medium"
                onClick={() => setAskExit(false)}
              >
                돌아가기
              </button>
              <button
                className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
                onClick={leaveApp}
              >
                나가기
              </button>
            </div>
          </Popup>
        )}

        {/* 새로 올라온 것 알림 — 앱을 열 때 한 번. 띠로 두면 못 보고
          지나친다. 곡과 강좌를 한 창에 모아 두 번 묻지 않는다. */}
        {(newLessons.length > 0 || newSongs.length > 0) && (
          <Popup
            title={
              newSongs.length > 0 && newLessons.length > 0
                ? "새 자료가 올라왔습니다"
                : newSongs.length > 0
                  ? "새 음원이 올라왔습니다"
                  : "새 강좌가 올라왔습니다"
            }
            width="max-w-xs"
            onClose={() => {
              markLessonsSeen(newLessons.flatMap((l) => l.ids));
              markSongsSeen(newSongs.flatMap((s) => s.stamp));
              setNewLessons([]);
              setNewSongs([]);
            }}
          >
            <p className="mb-2.5 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              강사님이 새 자료를 올리거나 고쳤습니다. 받으러 가시겠어요?
            </p>
            <div className="space-y-1.5">
              {newSongs.map((g) => (
                <button
                  key={`song-${g.klass.id}`}
                  className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
                  onClick={() => {
                    setImportCard(g.klass.id);
                    setTab("import");
                    markSongsSeen(newSongs.flatMap((x) => x.stamp));
                    setNewSongs([]);
                  }}
                >
                  {g.klass.name.match(/\(([^)]+)\)/)?.[1] ?? g.klass.name} 음원{" "}
                  {[
                    g.ids.length ? `새 곡 ${g.ids.length}` : "",
                    g.changed.length ? `바뀐 곡 ${g.changed.length}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  받으러 가기
                </button>
              ))}
              {newLessons.map((l) => (
                <button
                  key={`lesson-${l.klass.id}`}
                  className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
                  onClick={() => {
                    setLessonClass(l.klass.id);
                    setTab("lesson");
                    markLessonsSeen(newLessons.flatMap((x) => x.ids));
                    setNewLessons([]);
                  }}
                >
                  {l.klass.name.match(/\(([^)]+)\)/)?.[1] ?? l.klass.name} 강좌{" "}
                  {l.ids.length}개 받으러 가기
                </button>
              ))}
              <button
                className="w-full rounded bg-[var(--panel)] py-2 text-xs"
                onClick={() => {
                  markLessonsSeen(newLessons.flatMap((l) => l.ids));
                  markSongsSeen(newSongs.flatMap((g) => g.stamp));
                  setNewLessons([]);
                  setNewSongs([]);
                }}
              >
                나중에
              </button>
            </div>
          </Popup>
        )}

        {/* 뷰는 화면 폭을 그대로 쓴다. 넓어진 만큼 각 화면의 격자가
          칸을 늘려 채운다(코드표·홈 카드·그리드 악보) */}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {/* 전체보기. 화면 전체가 아니라 본문 칸만 덮는다 — 위의 앱 이름과
          아래 메뉴는 그대로 두어야 어디에 있는지 알고, 다른 자리로도
          바로 갈 수 있다. */}
          {showSheet && result && (
            <div
              className="absolute inset-0 z-40 flex flex-col bg-black/50 p-3"
              onClick={() => setShowSheet(false)}
            >
              <div
                className="mx-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[var(--background)] shadow-xl sm:max-w-none"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--panel-line)] px-3 py-2">
                  <h3 className="min-w-0 flex-1 truncate text-sm font-bold">
                    {result.title || "악보"}
                  </h3>
                  {/* 잘못 고쳤을 때 돌아갈 자리. 고칠 것이 있을 때만 낸다 */}
                  {editMode && undo.length > 0 && (
                    <button
                      className="shrink-0 rounded bg-[var(--panel)] px-2 py-1 text-[11px]"
                      onClick={undoChordEdit}
                    >
                      되돌리기 {undo.length}
                    </button>
                  )}
                  {/* 연주설정 — 악보를 보며 카포·빠르기를 맞추는 자리다.
                  가사·내 악보에는 맞출 것이 없으니 내지 않는다. */}
                  {(sheetTab === "score" ||
                    sheetTab === "melody" ||
                    sheetTab === "grid") && (
                    <PlaySettings
                      duration={result.duration}
                      time={time}
                      transpose={transpose}
                      rate={rate}
                      loop={loop}
                      sync={sync}
                      lyricSync={lyricSync}
                      onSync={setSync}
                      onLyricSync={setLyricSync}
                      onTranspose={setTranspose}
                      onRate={(r) => {
                        setRate(r);
                        playback?.setRate(r);
                      }}
                      onLoop={setLoop}
                      arp={arp}
                      onArp={setArp}
                      autoChords={autoChords}
                      onAutoChords={setAutoChords}
                      timeSignature={result.time_signature}
                      bpm={result.bpm}
                      strumName={strumName}
                      onStrumName={setStrumName}
                      strumRec={strumRec ?? undefined}
                      stem={stem}
                      vocalBusy={vocalBusy}
                      vocalError={vocalError}
                      onStem={pickStem}
                    />
                  )}
                  <button
                    className="rounded px-2 py-1 text-sm text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]"
                    onClick={() => setShowSheet(false)}
                    aria-label="닫기"
                  >
                    ✕
                  </button>
                </div>

                {/* 곡 고르기. 연주기는 창을 닫지 않고 곡을 옮겨 다니는 자리다 —
                한 곡 치고 창을 닫았다 다시 여는 것은 번거롭다. */}
                {songList.length > 1 && (
                  <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--panel-line)] px-2 py-1.5">
                    <button
                      className={SONG_STEP}
                      disabled={songAt <= 0}
                      title="이전 음원"
                      onClick={() => {
                        const prev = songList[songAt - 1];
                        if (prev) openSaved(prev.id);
                      }}
                    >
                      ◀
                    </button>
                    <select
                      className="min-w-0 flex-1 truncate rounded bg-[var(--panel)] px-2 py-1 text-[12px]"
                      value={result.id}
                      onChange={(e) => {
                        if (e.target.value !== result.id)
                          openSaved(e.target.value);
                      }}
                    >
                      {/* 목록에 없는 곡(서버에만 있는 것)도 제 이름은 보여야 한다 */}
                      {songAt < 0 && (
                        <option value={result.id}>
                          {result.title || result.id}
                        </option>
                      )}
                      {songList.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title || r.id}
                        </option>
                      ))}
                    </select>
                    <span className="shrink-0 text-[11px] tabular-nums text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                      {songAt >= 0
                        ? `${songAt + 1}/${songList.length}`
                        : `−/${songList.length}`}
                    </span>
                    <button
                      className={SONG_STEP}
                      disabled={songAt < 0 || songAt >= songList.length - 1}
                      title="다음 음원"
                      onClick={() => {
                        const next = songList[songAt + 1];
                        if (next) openSaved(next.id);
                      }}
                    >
                      ▶
                    </button>
                  </div>
                )}

                {/* 한 화면에 다 담으면 스크롤이 길어진다. 볼 것만 골라 본다.
                재생 단추는 탭 줄에 붙여 둔다 — 이 창이 영상을 가리므로,
                여기 없으면 창을 닫았다 열었다 하며 재생해야 한다. 줄은
                스크롤 밖이라 어느 탭에서든 늘 같은 자리에 있다. */}
                <div className="flex shrink-0 items-center gap-1 border-b border-[var(--panel-line)] px-2 py-1.5">
                  {/* 되감기·재생·정지·끝으로. 창이 영상을 가리므로 여기에 둔다 */}
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      className={TRANSPORT}
                      disabled={!playback}
                      aria-label="처음으로"
                      title="처음으로"
                      onClick={() => {
                        playback?.seek(0);
                        setTime(0);
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3 w-3"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <rect x="5" y="5" width="2.5" height="14" rx="1" />
                        <path d="M20 5.5v13L9.5 12z" />
                      </svg>
                    </button>
                    <button
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white disabled:opacity-40"
                      disabled={!playback}
                      aria-label={playing ? "멈춤" : "재생"}
                      title={playing ? "멈춤" : "재생"}
                      onClick={() => {
                        if (!playback) return;
                        if (playback.isPlaying()) playback.pause();
                        else playback.play();
                      }}
                    >
                      {playing ? (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="6" y="5" width="4" height="14" rx="1" />
                          <rect x="14" y="5" width="4" height="14" rx="1" />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          className="ml-0.5 h-3.5 w-3.5"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M7 4.5v15l13-7.5z" />
                        </svg>
                      )}
                    </button>
                    {/* 정지는 멈추고 처음으로 되돌린다 — 「멈춤」과 다른 점이다 */}
                    <button
                      className={TRANSPORT}
                      disabled={!playback}
                      aria-label="정지"
                      title="정지 — 멈추고 처음으로"
                      onClick={() => {
                        playback?.pause();
                        playback?.seek(0);
                        setTime(0);
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3 w-3"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <rect x="6" y="6" width="12" height="12" rx="1.5" />
                      </svg>
                    </button>
                    <button
                      className={TRANSPORT}
                      disabled={!playback}
                      aria-label="끝으로"
                      title="끝으로"
                      onClick={() => {
                        const end = Math.max((result.duration || 0) - 0.3, 0);
                        playback?.seek(end);
                        setTime(end);
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3 w-3"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M4 5.5v13L14.5 12z" />
                        <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
                      </svg>
                    </button>
                  </span>
                  {[
                    // 이 탭이 그리는 것은 여섯 줄 타브다. 「코드악보」는
                    // 재생 화면에서 쓰는 이름이라 여기서는 본 모습으로 적는다.
                    ["score", "타브"] as const,
                    ["melody", "멜로디"] as const,
                    ["grid", "그리드"] as const,
                    ["lyrics", "가사"] as const,
                    ["mine", "내 악보"] as const,
                  ]
                    // 편집으로 들어왔으면 고치는 데 쓰는 탭만 남긴다
                    .filter(([value]) => !editMode || value !== "mine")
                    .map(([value, label]) => {
                      // 고칠 때는 가사가 없어도 연다 — 없는 가사를 채우는 자리다
                      const disabled =
                        value === "lyrics" &&
                        !editMode &&
                        !(result.lyrics && result.lyrics.length > 0);
                      return (
                        <button
                          key={value}
                          disabled={disabled}
                          onClick={() => setSheetTab(value)}
                          className={[
                            "flex-1 rounded-md py-1 text-[13px] font-medium transition-colors",
                            disabled
                              ? "text-[color-mix(in_srgb,var(--foreground)_35%,transparent)]"
                              : sheetTab === value
                                ? "bg-[var(--chip)] text-black dark:text-white"
                                : "text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      );
                    })}
                </div>

                {/* 고치는 법은 탭 바로 아래에 둔다. 길게 눌러야 열린다는 것을
                모르면 아무것도 못 고친다 */}
                {editMode && (
                  <p className="shrink-0 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-3 py-1.5 text-[11px] leading-snug text-[var(--accent)]">
                    {sheetTab === "lyrics"
                      ? "고칠 줄을 3초 길게 누르세요(마우스는 오른쪽 클릭). 재생하면서 고칠 수 있습니다."
                      : "고칠 마디를 3초 길게 누르세요(마우스는 오른쪽 클릭). 재생하면서 고칠 수 있습니다."}
                  </p>
                )}

                {/* 위쪽 여백을 두지 않는다. 여백이 있으면 스크롤한 악보가
                그 틈으로 지나가, 붙박이 안내줄 위에 반쯤 보인다.
                여백이 필요한 탭은 저마다 pt로 준다. */}
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
                  {sheetTab === "score" && (
                    /* 곡 전체를 줄줄이 — 창을 씌우지 않아 처음부터 끝까지 훑는다 */
                    <ChordScore
                      bars={bars}
                      chords={shownChords}
                      strums={result.strums}
                      sync={sync}
                      onSync={setSync}
                      perLine={settings.chordPerLine}
                      onPerLine={(n) =>
                        setSettings({ ...settings, chordPerLine: n })
                      }
                      arp={arp}
                      strumName={strumName}
                      playNotes={playNotes}
                      playStyle={playStyle}
                      currentBar={barIdx}
                      time={time + sync - settings.latency}
                      getTime={
                        playback
                          ? () => playback.getTime() + sync - settings.latency
                          : undefined
                      }
                      flats={flats}
                      transpose={noteShift}
                      timeSignature={result.time_signature}
                      musicKey={result.key}
                      bpm={result.bpm}
                      onSeek={(t) => {
                        playback?.seek(t);
                        setTime(t);
                      }}
                      onEditBar={setEditBar}
                      follow
                    />
                  )}

                  {/* ABC 악보가 붙어 있으면 어디서 보든 그것이 기준이다 —
                  재생 화면과 전체보기가 다른 악보를 보여주면 헷갈린다 */}
                  {sheetTab === "melody" && abcEntry && (
                    <AbcScore
                      abc={unified?.abc ?? abcEntry.abc}
                      chordNote={unified}
                      bars={bars}
                      time={time + sync - settings.latency}
                      getTime={
                        playback
                          ? () => playback.getTime() + sync - settings.latency
                          : undefined
                      }
                      transpose={noteShift}
                      sync={sync}
                      onSync={setSync}
                      barOffset={abcEntry.barOffset}
                      onShiftBar={(d) => {
                        const v = abcEntry.barOffset + d;
                        setAbcOffset(result.id, v);
                        setAbcEntry({ ...abcEntry, barOffset: v });
                      }}
                      musicKey={result.key}
                      timeSignature={result.time_signature}
                      playNotes={playNotes}
                      strum={shownStrum}
                      onPickStrum={() => setShowStrums(true)}
                      playStyle={playStyle}
                      headerRight={
                        settings.adminMode ? (
                          <button
                            className="shrink-0 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]"
                            onClick={() => openAbcStudio()}
                          >
                            ABC 수정
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                  {sheetTab === "melody" &&
                    !abcEntry &&
                    hasMelody &&
                    sheetImg && (
                      /* 재생 화면과 같은 방식 — 인쇄된 악보 그대로. 다만 줄을
                   끊지 않고 곡 전체를 죽 편다. */
                      <SheetScore
                        resultId={result.id}
                        sheet={sheetImg}
                        time={time + sync - settings.latency}
                        getTime={
                          playback
                            ? () => playback.getTime() + sync - settings.latency
                            : undefined
                        }
                        chords={sheetChordList}
                        autoChords={autoSheetChords}
                        showChords={transpose !== 0}
                        musicKey={result.key}
                        timeSignature={result.time_signature}
                        playNotes={playNotes}
                        strum={shownStrum}
                        onPickStrum={() => setShowStrums(true)}
                        playStyle={playStyle}
                        barsView={settings.sheetZoom}
                        onZoom={(n) =>
                          setSettings({ ...settings, sheetZoom: n })
                        }
                        sync={sync}
                        onSync={setSync}
                        onShiftBar={
                          settings.adminMode && health ? shiftBar : undefined
                        }
                        lines={999}
                        // 악보 붙이기·마디 맞추기. 곡 전체가 보이는 이 자리에서
                        // 해야 한다 — 재생 화면에서는 두 줄만 보인다.
                        topBar={
                          settings.adminMode ? (
                            <div className="pb-1 pt-1.5">
                              <ScoreAttach
                                result={result}
                                onResult={adoptResult}
                                online={!!health}
                              />
                            </div>
                          ) : undefined
                        }
                        onSeek={(t) => {
                          playback?.seek(t);
                          setTime(t);
                        }}
                      />
                    )}

                  {/* 악보 그림이 없는 곡에도 붙이는 자리가 있어야 한다. 그림이
                  있으면 안내줄과 한 상자에 담아 붙박이로 세우지만(topBar),
                  없으면 세울 안내줄이 없으니 여기에 따로 낸다.
                  ABC 악보로 보는 곡에도 세운다 — 박 고르기·기준값 저장이
                  이 줄에만 있는데, ABC가 붙는 순간 줄째 사라졌었다. */}
                  {sheetTab === "melody" &&
                    settings.adminMode &&
                    (abcEntry || !sheetImg) && (
                      <div className="pb-1 pt-1.5">
                        <ScoreAttach
                          result={result}
                          onResult={adoptResult}
                          online={!!health}
                        />
                      </div>
                    )}
                  {sheetTab === "melody" && !abcEntry && !hasMelody && (
                    <div className="flex flex-col gap-2 p-3">
                      <NoMelody admin={settings.adminMode} />
                      {/* 악보가 없어도 노래는 따라가야 한다 */}
                      <section className="h-[45dvh] overflow-hidden rounded-xl border border-[var(--panel-line)]">
                        {lyricsPane}
                      </section>
                    </div>
                  )}
                  {sheetTab === "melody" &&
                    !abcEntry &&
                    hasMelody &&
                    !sheetImg && (
                      /* 악보 그림이 없는 곡. 오선 악보를 곡 전체로 죽 편다. */
                      <MelodyScore
                        bars={bars}
                        chords={shownChords}
                        melody={result.melody ?? []}
                        lyrics={result.lyrics}
                        score={(result.score ?? null) as never}
                        align={(result.score_align ?? null) as never}
                        showChecks={settings.adminMode}
                        autoChords={autoChords}
                        getTime={
                          playback
                            ? () =>
                                playback.getTime() +
                                lyricSync -
                                settings.latency
                            : undefined
                        }
                        solfege={settings.solfege}
                        onSolfege={() =>
                          setSettings({
                            ...settings,
                            solfege: !settings.solfege,
                          })
                        }
                        time={time + lyricSync - settings.latency}
                        playNotes={playNotes}
                        strum={shownStrum}
                        onPickStrum={() => setShowStrums(true)}
                        playStyle={playStyle}
                        currentBar={barIdx}
                        flats={flats}
                        transpose={noteShift}
                        timeSignature={result.time_signature}
                        musicKey={result.key}
                        onSeek={(t) => {
                          playback?.seek(t);
                          setTime(t);
                        }}
                        follow
                      />
                    )}

                  {sheetTab === "grid" && (
                    <ChordSheet
                      bars={bars}
                      chords={shownChords}
                      currentBar={barIdx}
                      currentChord={chordIdx}
                      flats={flats}
                      transpose={noteShift}
                      follow={false}
                      sync={sync}
                      onSync={setSync}
                      perRow={settings.gridPerRow}
                      onPerRow={(n) =>
                        setSettings({ ...settings, gridPerRow: n })
                      }
                      onSeek={(t) => {
                        playback?.seek(t);
                        setTime(t);
                      }}
                      onEditBar={setEditBar}
                    />
                  )}

                  {sheetTab === "lyrics" && (
                    <div className="pt-2 text-[13px] leading-relaxed">
                      {/* 자동 자막에서 온 가사를 다듬는다. 서버가 있어야 한다 */}
                      {health && (result.lyrics ?? []).length > 1 && (
                        <button
                          className="mb-2 w-full rounded bg-[var(--accent)] py-2 text-xs text-white disabled:opacity-40"
                          disabled={lyricBusy}
                          onClick={tidyWithAi}
                        >
                          {lyricBusy ? "다듬는 중…" : "AI로 가사 다듬기"}
                        </button>
                      )}
                      {editMode && (
                        <div className="mb-2 flex gap-1.5">
                          <button
                            className="min-w-0 flex-1 rounded bg-[var(--panel)] py-2 text-xs"
                            onClick={addLyricLine}
                          >
                            + 지금 자리({Math.floor(time / 60)}:
                            {String(Math.floor(time % 60)).padStart(2, "0")})에
                            줄 추가
                          </button>
                          {/* 글자만 고칠 때는 줄마다 창을 여는 것보다 통째로
                            펴 놓고 고치는 편이 빠르다. 다른 데서 받아 온
                            가사를 통째로 갈아 끼우기도 좋다 */}
                          <button
                            className="shrink-0 rounded bg-[var(--panel)] px-3 py-2 text-xs"
                            onClick={() =>
                              setLyricText(
                                (result.lyrics ?? [])
                                  .map((l) => l.text)
                                  .join(String.fromCharCode(10)),
                              )
                            }
                          >
                            전체 가사 편집
                          </button>
                        </div>
                      )}
                      {(result.lyrics ?? []).length === 0 && (
                        <p className="py-4 text-center text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                          가사가 없습니다.
                          {editMode
                            ? " 위 단추로 한 줄씩 넣을 수 있습니다."
                            : ""}
                        </p>
                      )}
                      {/* 문장 단위로 끊는다. 자막 가사는 숨 쉬는 자리마다 토막나
                      그대로 늘어놓으면 소절을 알 수 없다. 고칠 때는 줄 그대로
                      봐야 해서 편집 모드에서는 안 묶는다 */}
                      {editMode
                        ? (result.lyrics ?? []).map((line, i) => (
                            <div
                              key={`${line.t}-${i}`}
                              data-lyric={i}
                              className={
                                dragLyric?.to === i && dragLyric.from !== i
                                  ? "rounded ring-2 ring-[var(--accent)]"
                                  : dragLyric?.from === i
                                    ? "opacity-40"
                                    : ""
                              }
                              onPointerMove={(e) => {
                                if (!dragLyric) return;
                                const over = lyricUnder(e.clientX, e.clientY);
                                if (over !== null && over !== dragLyric.to)
                                  setDragLyric({ ...dragLyric, to: over });
                              }}
                              onPointerUp={() => {
                                if (!dragLyric) return;
                                void moveLyricText(
                                  dragLyric.from,
                                  dragLyric.to,
                                );
                                setDragLyric(null);
                              }}
                              onPointerCancel={() => setDragLyric(null)}
                            >
                              <LyricRow
                                text={line.text}
                                now={
                                  lyricIndexAt(
                                    result.lyrics ?? [],
                                    time +
                                      lyricSync -
                                      settings.latency +
                                      LYRIC_LEAD,
                                  ) === i
                                }
                                onSeek={() => {
                                  playback?.seek(line.t);
                                  setTime(line.t);
                                  setPickLyric(i);
                                }}
                                onEdit={() => setEditLyric(i)}
                                selected={pickLyric === i}
                                bar={barOfTime(line.t)}
                                onBar={(dir) => void shiftLyricsFrom(i, dir)}
                                onAddAfter={() => void addLyricAfter(i)}
                                onMergeDown={
                                  i + 1 < (result.lyrics?.length ?? 0)
                                    ? () => void mergeLyricDown(i)
                                    : undefined
                                }
                                onGrab={(e) => {
                                  e.currentTarget.setPointerCapture?.(
                                    e.pointerId,
                                  );
                                  setDragLyric({ from: i, to: i });
                                }}
                              />
                            </div>
                          ))
                        : lyricGroups.map((g, i) => (
                            <LyricRow
                              key={`${g.start}-${i}`}
                              text={g.text}
                              now={
                                groupIndexAt(
                                  lyricGroups,
                                  time + lyricSync - settings.latency,
                                ) === i
                              }
                              onSeek={() => {
                                playback?.seek(g.start);
                                setTime(g.start);
                              }}
                            />
                          ))}
                    </div>
                  )}

                  {sheetTab === "mine" && (
                    <div className="pt-2">
                      <MySheet resultId={result.id} online={!!health} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* 홈은 대시보드만 — 재생 화면은 연습실 탭이다 */}
          {tab === "home" && (
            <div className="flex h-full flex-col">
              <HomeDashboard
                onOpen={openSaved}
                onImport={() => {
                  setImportCard(undefined);
                  setTab("import");
                }}
                onLibrary={() => setTab("library")}
                onClassSongs={(classId) => {
                  setImportCard(classId);
                  setTab("import");
                }}
                adminMode={settings.adminMode}
                onLesson={(classId) => {
                  setLessonClass(classId);
                  setTab("lesson");
                }}
                onChords={() => setTab("chords")}
              />
              <div className="space-y-2 px-4">
                {status && busy && (
                  <p className="text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                    {STAGE_LABEL[status.stage]} ·{" "}
                    {Math.round(status.progress * 100)}%
                  </p>
                )}
                {error && (
                  <p className="rounded bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 연습실 탭은 항상 붙여 둔다. 다른 탭으로 옮겨도 재생이 끊기지 않게. */}
          <div
            className={
              tab === "player"
                ? "flex h-full flex-col overflow-y-auto md:overflow-hidden"
                : "hidden"
            }
          >
            {result ? (
              !LEGACY_SONG_UI ? (
                /* 연습실 — AI 악보앱과 같은 짜임. 악보 칸만 스크롤한다 */
                <PracticeRoom
                  title={result.title || result.id}
                  video={
                    <PlayerPane
                      result={result}
                      onReady={attachPlayback}
                      stem={stem}
                    />
                  }
                  score={
                    /* 같은 곡을 네 가지 눈으로 본다 — 악보(ABC), 타브,
                     파형, 그리드. 같은 자리에서 갈아 끼워 보던 자리를
                     잃지 않는다. */
                    roomView === "tab" ? (
                      /* 타브 아래에도 가사를 둔다 — 코드를 짚으면서
                       지금 어디를 부르는지 함께 봐야 따라 칠 수 있다 */
                      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-2 py-1">
                        <div className="shrink-0 overflow-y-auto">
                          <ChordScore
                            bars={bars}
                            chords={shownChords}
                            strums={result.strums}
                            /* 싱크·줄당 마디 손잡이는 위 설정줄에 있다.
                           악보 칸에 또 두면 같은 것이 두 벌이 된다 */
                            sync={sync}
                            perLine={settings.chordPerLine}
                            arp={arp}
                            strumName={strumName}
                            playNotes={playNotes}
                            playStyle={playStyle}
                            currentBar={barIdx}
                            time={time + sync - settings.latency}
                            getTime={
                              playback
                                ? () =>
                                    playback.getTime() + sync - settings.latency
                                : undefined
                            }
                            flats={flats}
                            transpose={noteShift}
                            timeSignature={result.time_signature}
                            musicKey={result.key}
                            bpm={result.bpm}
                            onPickStrum={() => setShowStrums(true)}
                            onSeek={(t) => playback?.seek(t)}
                            visibleLines={wide ? 5 : 2}
                            follow
                          />
                        </div>
                        {/* 가사는 재생에 맞춰 지금 줄이 따라 올라온다.
                          넓은 화면에서는 오른쪽 기둥에 이미 있으므로 감춘다 */}
                        <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--panel-line)] md:hidden">
                          {lyricsPane}
                        </section>
                      </div>
                    ) : roomView === "wave" ? (
                      /* 파형 · 지금·다음 코드 · 가사를 위에서 아래로.
                       파형만으로는 지금 무슨 코드를 잡아야 하는지 알 수
                       없고, 노래를 따라가려면 가사가 함께 있어야 한다. */
                      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-2 py-1">
                        {/* 파형에서도 곡의 성격은 같은 자리에 있어야 한다 */}
                        <SongInfoLine
                          musicKey={result.key}
                          timeSignature={result.time_signature}
                          playStyle={playStyle}
                          playNotes={playNotes}
                          strum={shownStrum}
                          onPickStrum={() => setShowStrums(true)}
                        />
                        <div className="shrink-0">
                          <ChordStrip
                            ref={stripRef}
                            result={shown ?? result}
                            flats={flats}
                            transpose={noteShift}
                            pixelsPerSecond={settings.pixelsPerSecond}
                            onSeek={(t) => playback?.seek(t)}
                          />
                        </div>
                        {/* 지금 잡을 코드와 바로 다음 코드.
                          코드가 없는 자리(전주·간주)는 「N.C.」라고 적지
                          않고 비워 둔다 — 잡을 것이 없다는 뜻이라 이름이
                          오히려 코드처럼 읽힌다. */}
                        {/* 폰에서는 한 뼘 안에 파형·코드·가사가 다 들어와야
                          한다. 코드 칸을 더 줄이고, 태블릿·PC에서만
                          원래 크기로 돌린다. */}
                        <section className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] px-2 py-0.5 big:gap-2 big:px-2.5 big:py-1">
                          {curPlay && (
                            <ChordDiagram
                              voicing={voicingFor(
                                curPlay.root,
                                curPlay.quality,
                              )}
                              label={curPlay.label}
                              width={big ? 60 : 38}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base font-bold leading-none big:text-2xl">
                              {curPlay ? (
                                <ChordLabel label={curPlay.label} />
                              ) : (
                                ""
                              )}
                            </div>
                            <div className="text-[10px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] big:mt-0.5 big:text-sm">
                              {nxtPlay ? (
                                <>
                                  다음 <ChordLabel label={nxtPlay.label} />
                                </>
                              ) : (
                                ""
                              )}
                            </div>
                            <div className="truncate text-[9px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] big:text-[11px]">
                              {barIdx + 1}/{bars.length}마디
                            </div>
                          </div>
                          {nxtPlay && (
                            /* 다음 코드는 그림만으로는 무엇인지 바로 읽히지
                             않는다 — 이름을 그림 위에 적어 둔다 */
                            <div className="flex shrink-0 flex-col items-center gap-0.5">
                              <div className="text-[10px] font-bold leading-none text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] big:text-sm">
                                <ChordLabel label={nxtPlay.label} />
                              </div>
                              <ChordDiagram
                                voicing={voicingFor(
                                  nxtPlay.root,
                                  nxtPlay.quality,
                                )}
                                label={nxtPlay.label}
                                width={big ? 48 : 30}
                              />
                            </div>
                          )}
                        </section>
                        {/* 가사는 재생에 맞춰 지금 줄이 따라 올라온다.
                          넓은 화면에서는 오른쪽 기둥에 이미 있으므로 감춘다 */}
                        <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--panel-line)] md:hidden">
                          {lyricsPane}
                        </section>
                      </div>
                    ) : roomView === "grid" ? (
                      /* 몇 줄만 띄우고 그 아래 가사 — 백 마디를 다
                       늘어놓으면 지금 자리를 눈으로 찾아야 한다.
                       폰은 세 줄이다. 다섯 줄을 띄우면 가사가 밀려
                       내려가 화면 밖으로 나간다 */
                      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-2 py-1">
                        {/* 그리드에도 곡의 성격을 같은 자리에 둔다 */}
                        <SongInfoLine
                          musicKey={result.key}
                          timeSignature={result.time_signature}
                          playStyle={playStyle}
                          playNotes={playNotes}
                          strum={shownStrum}
                          onPickStrum={() => setShowStrums(true)}
                        />
                        <div className="shrink-0">
                          <ChordSheet
                            visibleRows={wide ? 5 : 3}
                            bars={bars}
                            chords={shownChords}
                            currentBar={barIdx}
                            currentChord={chordIdx}
                            flats={flats}
                            transpose={noteShift}
                            follow
                            /* 싱크·칸 수 손잡이는 위 설정줄에 있다 — 중복 */
                            sync={sync}
                            perRow={settings.gridPerRow}
                            time={time + sync - settings.latency}
                            getTime={
                              playback
                                ? () =>
                                    playback.getTime() + sync - settings.latency
                                : undefined
                            }
                            onSeek={(t) => {
                              playback?.seek(t);
                              setTime(t);
                            }}
                            onEditBar={setEditBar}
                          />
                        </div>
                        {/* 가사는 재생에 맞춰 지금 줄이 따라 올라온다.
                          넓은 화면에서는 오른쪽 기둥에 이미 있으므로 감춘다 */}
                        <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--panel-line)] md:hidden">
                          {lyricsPane}
                        </section>
                      </div>
                    ) : abcEntry ? (
                      <AbcScore
                        abc={unified?.abc ?? abcEntry.abc}
                        chordNote={unified}
                        bars={bars}
                        time={time + sync - settings.latency}
                        getTime={
                          playback
                            ? () => playback.getTime() + sync - settings.latency
                            : undefined
                        }
                        transpose={noteShift}
                        sync={sync}
                        barOffset={abcEntry.barOffset}
                        musicKey={result.key}
                        timeSignature={result.time_signature}
                        playNotes={playNotes}
                        strum={shownStrum}
                        onPickStrum={() => setShowStrums(true)}
                        playStyle={playStyle}
                        headerRight={
                          settings.adminMode ? (
                            <button
                              className="shrink-0 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]"
                              onClick={() => openAbcStudio()}
                            >
                              ABC 수정
                            </button>
                          ) : undefined
                        }
                      />
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2">
                        <div className="shrink-0">
                          <NoMelody admin={settings.adminMode} />
                          {/* 정밀 채보도 이 안(스튜디오의 「고정밀 채보」)에 있다 —
                          채보로 가는 문을 한 곳으로 모은다 */}
                          {settings.adminMode && (
                            <button
                              className="mt-2 rounded bg-[var(--chip)] px-2 py-1 text-[11px] font-semibold"
                              onClick={() => openAbcStudio()}
                            >
                              + ABC 악보 붙이기
                            </button>
                          )}
                        </div>
                        {/* 악보가 없어도 노래는 따라가야 한다 — 빈 칸 대신
                          가사가 재생을 따라 흐른다. 넓은 화면은 오른쪽
                          기둥에 이미 있으므로 폰에서만 보인다 */}
                        <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--panel-line)] md:hidden">
                          {lyricsPane}
                        </section>
                      </div>
                    )
                  }
                  playSettings={
                    <PlaySettings
                      duration={result.duration}
                      time={time}
                      transpose={transpose}
                      rate={rate}
                      loop={loop}
                      sync={sync}
                      lyricSync={lyricSync}
                      onSync={setSync}
                      onLyricSync={setLyricSync}
                      onTranspose={setTranspose}
                      onRate={(r) => {
                        setRate(r);
                        playback?.setRate(r);
                      }}
                      onLoop={setLoop}
                      arp={arp}
                      onArp={setArp}
                      autoChords={autoChords}
                      onAutoChords={setAutoChords}
                      timeSignature={result.time_signature}
                      bpm={result.bpm}
                      strumName={strumName}
                      onStrumName={setStrumName}
                      strumRec={strumRec ?? undefined}
                      stem={stem}
                      vocalBusy={vocalBusy}
                      vocalError={vocalError}
                      onStem={pickStem}
                    />
                  }
                  lyrics={lyricsPane}
                  playback={playback}
                  time={time}
                  duration={result.duration}
                  onSeek={(t) => {
                    playback?.seek(t);
                    setTime(t);
                  }}
                  stem={stem}
                  onStem={pickStem}
                  vocalBusy={vocalBusy}
                  sync={sync}
                  onSync={setSync}
                  barOffset={abcEntry?.barOffset ?? 0}
                  onBarOffset={
                    abcEntry && settings.adminMode
                      ? (v) => {
                          setAbcOffset(result.id, v);
                          setAbcEntry({ ...abcEntry, barOffset: v });
                        }
                      : undefined
                  }
                  videoCompact={settings.videoCompact}
                  onVideoCompact={(v) =>
                    setSettings({ ...settings, videoCompact: v })
                  }
                  viewTabs={
                    <span className="flex shrink-0 items-center gap-px">
                      {(
                        [
                          ["abc", "악보"],
                          ["tab", "타브"],
                          ["wave", "파형"],
                          ["grid", "그리드"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setRoomView(value)}
                          className={[
                            "rounded px-1.5 py-0.5 text-[11px] font-semibold",
                            roomView === value
                              ? "bg-black text-white dark:bg-white dark:text-black"
                              : "bg-[var(--chip)] text-[var(--foreground)]",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                  }
                  pitch={transpose}
                  onPitch={setTranspose}
                  rate={rate}
                  onRate={(r) => {
                    setRate(r);
                    playback?.setRate(r);
                  }}
                  loopA={loop ? loop.a : null}
                  onPrevSong={
                    songAt > 0
                      ? () => openSaved(songList[songAt - 1].id)
                      : undefined
                  }
                  onNextSong={
                    songAt >= 0 && songAt < songList.length - 1
                      ? () => openSaved(songList[songAt + 1].id)
                      : undefined
                  }
                  songs={songList.map((r) => ({
                    id: r.id,
                    title: r.title || r.id,
                  }))}
                  songId={result.id}
                  onPickSong={(id) => void openSaved(id)}
                />
              ) : (
                // 영역을 카드로 묶어 서로 구별한다: 영상 / 타임라인+탐색 / 현재 코드 / 곡 전체
                <>
                  {/* 넓은 화면에서는 왼쪽에 악보·가사, 오른쪽에 영상을 세운다.
                영상은 참고용이라 자리를 조금만 쓰고, 눈이 오래 머무는
                악보가 넓은 쪽을 갖는다. 폰은 지금처럼 위아래로 쌓인다 */}
                  <div className="flex min-h-0 flex-1 flex-col md:flex-row md:gap-1">
                    {/* 오른쪽 기둥 — 영상과 그 아래 가사. 넓은 화면에서는
                  가사를 늘 펼쳐 둔다(노래를 보며 치는 자리라서) */}
                    <div className="flex flex-col md:order-2 md:min-h-0 md:w-[44%] md:shrink-0 roomy:w-[50%] lg:w-[54%] xl:w-[58%] 2xl:w-[62%]">
                      <section className="mx-2 mt-1.5 shrink-0 overflow-hidden rounded-xl border border-[var(--panel-line)]">
                        {/* 곡 이름. 영상 안에도 적혀 있지만 접으면 사라지고, 유튜브가
                    아닌 곡(업로드)에는 아예 없다. 지금 무슨 곡을 보고 있는지는
                    늘 보여야 한다. */}
                        <div className="flex items-center gap-1.5 border-b border-[var(--panel-line)] px-2.5 py-1.5">
                          {/* 어디서 온 곡인지 아이콘으로. YouTube면 빨간 재생 딱지,
                      올린 곡이면 음표 */}
                          {result.source === "youtube" ? (
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-4 shrink-0"
                              aria-hidden="true"
                            >
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
                          ) : (
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.9}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M9 18V6l10-2v11" />
                              <circle cx="6.5" cy="18" r="2.5" />
                              <circle cx="16.5" cy="15" r="2.5" />
                            </svg>
                          )}
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {result.title || "제목 없음"}
                          </span>
                        </div>
                        <PlayerPane
                          result={result}
                          onReady={attachPlayback}
                          compact={settings.videoCompact}
                          stem={stem}
                        />
                      </section>

                      {/* 넓은 화면 전용 가사 — 영상 아래를 채운다. 폰에서는
                  자리가 없어 「가사」 단추로 악보와 자리를 바꿔 쓴다 */}
                      <section className="mx-2 mb-1.5 mt-1.5 hidden min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] roomy:flex">
                        <LyricsPane
                          result={result}
                          time={time + lyricSync - settings.latency}
                          online={!!health}
                          canEdit={settings.adminMode}
                          onLyrics={(lines) =>
                            setResult((prev) =>
                              prev ? { ...prev, lyrics: lines } : prev,
                            )
                          }
                          onResult={(r) => {
                            adoptResult(r);
                            pushToServer(r);
                          }}
                          onSeek={(t) => {
                            playback?.seek(t);
                            setTime(t);
                          }}
                        />
                      </section>
                    </div>

                    {/* 왼쪽 칸 — 악보/파형, 코드 박스, 가사. 넓은 화면에서는
                  이 칸만 따로 스크롤해 영상은 늘 제자리에 있다 */}
                    <div className="flex min-h-0 flex-1 flex-col md:order-1 md:min-w-0 md:overflow-y-auto">
                      <section className="mx-2 mt-1.5 shrink-0 overflow-hidden rounded-xl border border-[var(--panel-line)] bg-[var(--panel)]">
                        {/* 타브/파형 세그먼트 + 연주설정·영상접기. 글자 크기를 통일한 한 줄.
                  타브를 왼쪽에 둔다 — 주로 보는 화면이라 손이 먼저 간다. */}
                        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--panel-line)] px-2 py-1.5 roomy:gap-2 roomy:px-3 roomy:py-2.5">
                          <div className="flex min-w-0 flex-1 rounded-lg bg-[var(--chip)] p-0.5">
                            {[
                              // 여섯 줄 타브다. 전체보기와 같은 이름을 쓴다 —
                              // 같은 것을 두 이름으로 부르면 헷갈린다.
                              ["sheet", "타브"] as const,
                              ["melody", "멜로디"] as const,
                              ["wave", "파형"] as const,
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                onClick={() =>
                                  setSettings({ ...settings, view: value })
                                }
                                className={[
                                  "min-w-0 flex-1 truncate rounded-md py-1 text-[13px] font-medium transition-colors roomy:py-2.5 roomy:text-[16px]",
                                  boardView === value
                                    ? "bg-white text-black shadow-sm dark:bg-black dark:text-white"
                                    : "text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]",
                                ].join(" ")}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          {/* 음높이·빠르기·반복을 한 팝업에 모은 버튼 */}
                          <PlaySettings
                            duration={result.duration}
                            time={time}
                            transpose={transpose}
                            rate={rate}
                            loop={loop}
                            sync={sync}
                            lyricSync={lyricSync}
                            onSync={setSync}
                            onLyricSync={setLyricSync}
                            onTranspose={setTranspose}
                            onRate={(r) => {
                              setRate(r);
                              playback?.setRate(r);
                            }}
                            onLoop={setLoop}
                            arp={arp}
                            onArp={setArp}
                            autoChords={autoChords}
                            onAutoChords={setAutoChords}
                            timeSignature={result.time_signature}
                            bpm={result.bpm}
                            strumName={strumName}
                            onStrumName={setStrumName}
                            strumRec={strumRec ?? undefined}
                            stem={stem}
                            vocalBusy={vocalBusy}
                            vocalError={vocalError}
                            onStem={pickStem}
                          />
                          {/* 가사 보기 — 코드 박스·곡 전체 코드 자리를 대신 쓴다 */}
                          <button
                            onClick={() => setShowLyrics((v) => !v)}
                            className={[
                              "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium roomy:hidden",
                              showLyrics
                                ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]"
                                : "bg-[var(--chip)] text-[var(--foreground)]",
                            ].join(" ")}
                            title="가사를 음악에 맞춰 보여줍니다"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.9}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M4 6h11M4 11h7M4 16h9" />
                              <circle cx="18.5" cy="16.5" r="2.5" />
                              <path d="M21 16.5V6l-3 1" />
                            </svg>
                            가사
                          </button>
                          <button
                            onClick={() =>
                              setSettings({
                                ...settings,
                                videoCompact: !settings.videoCompact,
                              })
                            }
                            className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--chip)] px-2 py-1.5 text-[13px] font-medium text-[var(--foreground)] roomy:gap-1.5 roomy:px-3 roomy:py-2.5 roomy:text-[16px]"
                            title="영상을 접어 코드에 자리를 넘깁니다"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              {settings.videoCompact ? (
                                <path d="m6 10 6 6 6-6" />
                              ) : (
                                <path d="m6 14 6-6 6 6" />
                              )}
                            </svg>
                            영상
                          </button>
                        </div>

                        {/* 파형·코드악보·멜로디는 같은 자리(영상 바로 아래)를 쓴다 */}
                        {boardView === "wave" ? (
                          <>
                            {/* 파형에서도 곡의 성격은 같은 자리에 있어야 한다 */}
                            <div className="shrink-0 px-2 pb-0.5">
                              <SongInfoLine
                                musicKey={result.key}
                                timeSignature={result.time_signature}
                                strum={waveStrum}
                                playNotes={playNotes}
                                playStyle={playStyle}
                                onPickStrum={() => setShowStrums(true)}
                                right={
                                  <button
                                    className="flex shrink-0 items-center gap-1 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)] roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
                                    onClick={() => {
                                      setEditMode(false);
                                      setShowSheet(true);
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      className="h-3 w-3"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={1.9}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <rect
                                        x="3"
                                        y="4"
                                        width="18"
                                        height="16"
                                        rx="2"
                                      />
                                      <path d="M3 9h18M8 4v16" />
                                    </svg>
                                    전체보기
                                  </button>
                                }
                              >
                                {/* 파형에는 마디를 나눌 것이 없다 — 싱크만 둔다 */}
                                <ViewSteppers sync={sync} onSync={setSync} />
                              </SongInfoLine>
                            </div>
                            <ChordStrip
                              ref={stripRef}
                              result={shown ?? result}
                              flats={flats}
                              transpose={noteShift}
                              pixelsPerSecond={settings.pixelsPerSecond}
                              onSeek={(t) => playback?.seek(t)}
                            />
                          </>
                        ) : boardView === "melody" ? (
                          <div className="shrink-0 px-2 py-1">
                            {settings.adminMode && !abcEntry && (
                              <div className="mb-1 text-right">
                                <button
                                  className="rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]"
                                  onClick={() => openAbcStudio()}
                                >
                                  + ABC 악보 붙이기
                                </button>
                              </div>
                            )}
                            {abcEntry ? (
                              /* 강사님이 붙인 ABC 악보. 음표가 빠짐없이 다 있다.
                       커서는 악보 템포가 아니라 음원 마디 격자를 따른다 */
                              <AbcScore
                                abc={unified?.abc ?? abcEntry.abc}
                                chordNote={unified}
                                bars={bars}
                                time={time + sync - settings.latency}
                                getTime={
                                  playback
                                    ? () =>
                                        playback.getTime() +
                                        sync -
                                        settings.latency
                                    : undefined
                                }
                                transpose={noteShift}
                                sync={sync}
                                onSync={setSync}
                                barOffset={abcEntry.barOffset}
                                onShiftBar={(d) => {
                                  const v = abcEntry.barOffset + d;
                                  setAbcOffset(result.id, v);
                                  setAbcEntry({ ...abcEntry, barOffset: v });
                                }}
                                musicKey={result.key}
                                timeSignature={result.time_signature}
                                playNotes={playNotes}
                                strum={shownStrum}
                                onPickStrum={() => setShowStrums(true)}
                                playStyle={playStyle}
                                headerRight={
                                  <>
                                    {settings.adminMode && (
                                      <button
                                        className="shrink-0 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]"
                                        onClick={() => {
                                          setAbcAttach(true);
                                        }}
                                      >
                                        ABC 수정
                                      </button>
                                    )}
                                    <button
                                      className="shrink-0 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)]"
                                      onClick={() => {
                                        setEditMode(false);
                                        setShowSheet(true);
                                      }}
                                    >
                                      전체보기
                                    </button>
                                  </>
                                }
                              />
                            ) : !hasMelody ? (
                              <NoMelody admin={settings.adminMode} />
                            ) : sheetImg ? (
                              /* 인쇄된 악보 그대로. 마디선만 찾아 그 위로 커서가 간다 */
                              <SheetScore
                                resultId={result.id}
                                sheet={sheetImg}
                                // 악보는 코드와 같은 것을 짚는 도구다. 가사 싱크가
                                // 아니라 코드 싱크(연주설정)로 맞춘다.
                                time={time + sync - settings.latency}
                                getTime={
                                  playback
                                    ? () =>
                                        playback.getTime() +
                                        sync -
                                        settings.latency
                                    : undefined
                                }
                                chords={sheetChordList}
                                autoChords={autoSheetChords}
                                // 음높이를 바꾸면 인쇄된 코드가 어긋난다. 그때만
                                // 우리 코드를 덮어쓴다 — 손대지 않았으면 원본이 옳다.
                                showChords={transpose !== 0}
                                barsView={settings.sheetZoom}
                                onZoom={(n) =>
                                  setSettings({ ...settings, sheetZoom: n })
                                }
                                sync={sync}
                                onSync={setSync}
                                musicKey={result.key}
                                timeSignature={result.time_signature}
                                playNotes={playNotes}
                                strum={shownStrum}
                                onPickStrum={() => setShowStrums(true)}
                                playStyle={playStyle}
                                onSeek={(t) => playback?.seek(t)}
                                lines={wide ? 3 : 2}
                                headerRight={
                                  <button
                                    className="flex shrink-0 items-center gap-1 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)] roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
                                    onClick={() => {
                                      setEditMode(false);
                                      setShowSheet(true);
                                    }}
                                  >
                                    전체보기
                                  </button>
                                }
                              />
                            ) : (
                              /* 오선 위 음표 + 그 아래 가사. 코드악보와 같은 마디 배치라
                     두 화면을 오가도 보던 자리를 잃지 않는다 */
                              <MelodyScore
                                bars={bars}
                                chords={shownChords}
                                melody={result.melody ?? []}
                                lyrics={result.lyrics}
                                score={(result.score ?? null) as never}
                                align={(result.score_align ?? null) as never}
                                showChecks={settings.adminMode}
                                autoChords={autoChords}
                                getTime={
                                  playback
                                    ? () =>
                                        playback.getTime() +
                                        lyricSync -
                                        settings.latency
                                    : undefined
                                }
                                solfege={settings.solfege}
                                onSolfege={() =>
                                  setSettings({
                                    ...settings,
                                    solfege: !settings.solfege,
                                  })
                                }
                                time={time + lyricSync - settings.latency}
                                playNotes={playNotes}
                                strum={shownStrum}
                                onPickStrum={() => setShowStrums(true)}
                                playStyle={playStyle}
                                headerRight={
                                  <button
                                    className="flex shrink-0 items-center gap-1 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)] roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
                                    onClick={() => {
                                      setEditMode(false);
                                      setShowSheet(true);
                                    }}
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      className="h-3 w-3"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={1.9}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <rect
                                        x="3"
                                        y="4"
                                        width="18"
                                        height="16"
                                        rx="2"
                                      />
                                      <path d="M3 9h18M8 4v16" />
                                    </svg>
                                    전체보기
                                  </button>
                                }
                                currentBar={barIdx}
                                flats={flats}
                                transpose={noteShift}
                                timeSignature={result.time_signature}
                                musicKey={result.key}
                                onSeek={(t) => playback?.seek(t)}
                                visibleLines={wide ? 4 : 2}
                                follow
                              />
                            )}
                          </div>
                        ) : (
                          <div className="shrink-0 px-2 py-1">
                            {/* AI가 아는 코드로 만든 초안은 반드시 밝힌다.
                      음원을 들은 결과가 아니라 실제 녹음과 어긋난다 */}
                            {result.meta?.chord_model === "ai-knowledge" && (
                              <p className="mb-1 rounded bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-800">
                                AI가 아는 코드로 만든 초안입니다. 음원을 듣고
                                만든 것이 아니라 전주 길이·반복 횟수가 실제
                                녹음과 어긋납니다.
                              </p>
                            )}
                            {/* 지금 줄과 다음 줄만. 현재 줄이 늘 위에 온다 */}
                            <ChordScore
                              bars={bars}
                              chords={shownChords}
                              strums={result.strums}
                              sync={sync}
                              onSync={setSync}
                              perLine={settings.chordPerLine}
                              onPerLine={(n) =>
                                setSettings({ ...settings, chordPerLine: n })
                              }
                              arp={arp}
                              strumName={strumName}
                              playNotes={playNotes}
                              playStyle={playStyle}
                              headerRight={
                                <button
                                  className="flex shrink-0 items-center gap-1 rounded bg-[var(--chip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--foreground)] roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
                                  onClick={() => {
                                    setEditMode(false);
                                    setShowSheet(true);
                                  }}
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="h-3 w-3"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={1.9}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <rect
                                      x="3"
                                      y="4"
                                      width="18"
                                      height="16"
                                      rx="2"
                                    />
                                    <path d="M3 9h18M8 4v16" />
                                  </svg>
                                  전체보기
                                </button>
                              }
                              currentBar={barIdx}
                              time={time + sync - settings.latency}
                              getTime={
                                playback
                                  ? () =>
                                      playback.getTime() +
                                      sync -
                                      settings.latency
                                  : undefined
                              }
                              flats={flats}
                              transpose={noteShift}
                              timeSignature={result.time_signature}
                              musicKey={result.key}
                              bpm={result.bpm}
                              onPickStrum={() => setShowStrums(true)}
                              onSeek={(t) => playback?.seek(t)}
                              visibleLines={wide ? 5 : 2}
                              follow
                            />
                          </div>
                        )}

                        {/* YouTube 곡은 영상에 자체 재생·탐색 조작이 있다.
                  같은 조작이 두 벌 보이면 어느 쪽을 눌러야 할지 헷갈린다 */}
                        {result.source !== "youtube" && (
                          <SeekBar
                            duration={result.duration}
                            time={time}
                            playing={playing}
                            onSeek={(t) => {
                              playback?.seek(t);
                              setTime(t);
                            }}
                            onToggle={() => {
                              if (!playback) return;
                              if (playback.isPlaying()) playback.pause();
                              else playback.play();
                            }}
                          />
                        )}
                      </section>

                      {/* 가사 보기: 코드 박스와 곡 전체 코드를 감추고 그 자리에 가사를 띄운다.
                  넓은 화면에서는 오른쪽 기둥에 가사가 이미 있으므로 늘 악보 쪽이다 */}
                      {showLyrics && !wide ? (
                        <section className="mx-2 mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--panel-line)] bg-[var(--panel)]">
                          <LyricsPane
                            result={result}
                            time={time + lyricSync - settings.latency}
                            online={!!health}
                            canEdit={settings.adminMode}
                            onLyrics={(lines) =>
                              setResult((prev) =>
                                prev ? { ...prev, lyrics: lines } : prev,
                              )
                            }
                            onResult={(r) => {
                              adoptResult(r);
                              pushToServer(r);
                            }}
                            onSeek={(t) => {
                              playback?.seek(t);
                              setTime(t);
                            }}
                          />
                        </section>
                      ) : (
                        <>
                          <section className="mx-2 mt-1.5 flex shrink-0 items-center gap-3 rounded-xl border border-[var(--panel-line)] bg-[var(--panel)] px-3 py-1.5">
                            <ChordDiagram
                              voicing={
                                cur ? voicingFor(cur.root, cur.quality) : null
                              }
                              label={cur?.label ?? ""}
                              width={86}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-3xl font-bold leading-none">
                                {cur ? <ChordLabel label={cur.label} /> : "—"}
                              </div>
                              <div className="mt-1 text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                                다음{" "}
                                {nxt ? <ChordLabel label={nxt.label} /> : "—"}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                                <ChordLabel label={spellKey(result.key)} /> ·{" "}
                                {Math.round(result.bpm)} BPM ·{" "}
                                {result.time_signature} · {barIdx + 1}/
                                {bars.length}마디
                              </div>
                            </div>
                            {nxt && (
                              <div className="flex shrink-0 flex-col items-center">
                                <div className="text-xs font-semibold leading-none text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                                  <ChordLabel label={nxt.label} />
                                </div>
                                <ChordDiagram
                                  voicing={voicingFor(nxt.root, nxt.quality)}
                                  label={nxt.label}
                                  width={64}
                                  showFingers={false}
                                />
                              </div>
                            )}
                          </section>

                          <div className="min-h-0 flex-1 overflow-y-auto px-3">
                            <Copyright />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )
            ) : (
              /* 아직 고른 곡이 없다 — 연습실은 곡을 받아야 도는 방이다 */
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                  홈이나 음원목록에서 곡을 고르면 여기서 연주됩니다.
                </p>
                <button
                  className="rounded bg-[var(--chip)] px-3 py-1.5 text-xs font-semibold"
                  onClick={() => setTab("home")}
                >
                  홈으로
                </button>
              </div>
            )}
          </div>

          {tab === "import" && (
            <ImportTab
              health={health}
              status={status}
              error={error}
              busy={busy}
              separate={settings.separate}
              adminMode={settings.adminMode}
              autoOpen={importCard}
              onAnalyzeUrl={(u) => run(() => analyzeUrl(u, settings.separate))}
              onAnalyzeWithAi={aiAnalyze}
              onAnalyzeFile={(f) =>
                run(() => analyzeUpload(f, settings.separate))
              }
              abcSong={result?.title || result?.id}
              onAbc={settings.adminMode ? openAbcStudio : undefined}
              /* 악보 만들기 창. 따로 띄우지 않고 이 뷰 안에서 카드 자리를
               대신 차지한다 — 등록하던 자리를 벗어나지 않는다 */
              abcOpen={abcAttach}
              abcStudio={
                <>
                  <div className="flex shrink-0 items-center gap-2 border-b border-[var(--panel-line)] pb-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      악보 만들기
                      {result ? ` · ${result.title || result.id}` : ""}
                    </span>
                    {result && abcEntry && (
                      <button
                        className="shrink-0 rounded bg-[var(--panel)] px-2 py-1 text-[11px] text-red-600"
                        onClick={() => {
                          removeAbc(result.id);
                          setAbcEntry(null);
                          setAbcAttach(false);
                        }}
                      >
                        악보 떼기
                      </button>
                    )}
                    <button
                      className="shrink-0 rounded bg-[var(--chip)] px-2 py-1 text-[11px] font-semibold"
                      onClick={() => setAbcAttach(false)}
                    >
                      ← 등록 화면
                    </button>
                  </div>
                  <iframe
                    ref={abcFrameRef}
                    src="/abc-studio/index.html?embed=1"
                    className="min-h-0 flex-1 border-0"
                    title="AI 악보생성기"
                  />
                </>
              }
            />
          )}

          {tab === "library" && (
            <LibraryTab
              active
              onOpen={openSaved}
              adminMode={settings.adminMode}
              // 서버가 있을 때만. 캐시된 오디오를 쓰므로 다시 받지 않는다.
              analyzing={busy}
              onReanalyze={
                // 다시 분석은 서버가 하는 일이다. 수강생 화면에는 서버 개념이
                // 없으므로 버튼도 내지 않는다
                health && settings.adminMode
                  ? (item, refetch, newUrl) =>
                      run(() =>
                        // 새 주소를 받았으면 그 음원으로 새로 분석한다.
                        // 같은 곡의 다른 영상(음질·삭제 문제)로 갈아탈 때다.
                        newUrl
                          ? analyzeUrl(newUrl, settings.separate)
                          : reanalyze(item.id, settings.separate, refetch, {
                              source: item.source,
                              title: item.title,
                            }),
                      )
                  : undefined
              }
            />
          )}

          {tab === "edit" && (
            <EditTab
              onPick={async (id) => {
                // 고르면 그 곡을 열고 악보를 바로 펼친다. 고치는 자리가
                // 악보라 한 번에 데려다 놓는다. 곡이 올라온 뒤에 펼쳐야
                // 빈 화면이 스치지 않는다.
                const ok = await openSaved(id);
                if (!ok) return;
                setEditMode(true);
                setSheetTab("score");
                setShowSheet(true);
              }}
            />
          )}

          {tab === "lesson" && (
            <LessonTab
              adminMode={settings.adminMode}
              online={!!health}
              openClass={lessonClass}
            />
          )}

          {tab === "chords" && <ChordsTab />}

          {tab === "settings" && (
            <SettingsTab
              settings={settings}
              onChange={setSettings}
              health={health}
            />
          )}
        </div>

        {/* 스트로크 고르기. 추천이 마음에 안 들면 직접 고른다. */}
        {showStrums && result && strumRec && (
          <StrumPickModal
            current={strumName}
            rec={strumRec}
            onPick={(name) => {
              setArp(0);
              setStrumName(name);
            }}
            onClose={() => setShowStrums(false)}
          />
        )}

        {/* 곡 전체 악보. 재생 화면은 좁으므로 볼 때만 크게 펼친다. */}

        {/* 마디 코드 고르기 */}
        {editBar !== null && result && bars[editBar] && (
          <ChordPicker
            barNumber={bars[editBar].number}
            current={(() => {
              const c =
                shownChords[chordIndexAt(shownChords, bars[editBar].start)];
              return c?.root
                ? {
                    root: transposeRoot(c.root, noteShift) ?? c.root,
                    quality: c.quality,
                  }
                : null;
            })()}
            flats={flats}
            onPick={(root, quality) =>
              applyChordEdit(editBar, { root, quality })
            }
            onClear={() => applyChordEdit(editBar, null)}
            onClose={() => setEditBar(null)}
          />
        )}

        {/* 가사 한 줄 고치기 */}
        {editLyric !== null && result?.lyrics?.[editLyric] && (
          <LyricEditor
            index={editLyric}
            text={result.lyrics[editLyric].text}
            at={result.lyrics[editLyric].t}
            now={time}
            onSave={(text, at) => applyLyricEdit(editLyric, { text, at })}
            onDelete={() => applyLyricEdit(editLyric, null)}
            onClose={() => setEditLyric(null)}
          />
        )}

        {/* 몇 초 이상 걸리는 일은 모두 화면 한가운데에 알린다.
          버튼 글자만 바꿔서는 눌렸는지 몰라 또 누르게 된다 */}
        {busy && status && (
          <Working
            label="분석 중"
            note={status.message || STAGE_LABEL[status.stage]}
            progress={status.progress}
          />
        )}
        {vocalBusy && (
          <Working label="반주 만드는 중" note="보컬을 걷어내고 있습니다" />
        )}
        {lyricBusy && (
          <Working
            label="가사 다듬는 중"
            note="AI가 토막난 자막을 소절로 잇습니다"
          />
        )}

        {/* ABC 악보 붙이기/수정 — 악보생성 앱에서 만든 ABC를 곡에 싣는다 */}
        {/* 저장·등록을 알리는 짧은 알림. 메뉴 바로 위에 잠깐 떴다 사라진다 */}
        {toast && (
          <div className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center px-4 roomy:bottom-6">
            <div className="max-w-[92%] rounded-lg bg-[var(--accent)] px-3 py-2 text-center text-[13px] font-medium text-white shadow-lg">
              {toast}
            </div>
          </div>
        )}
        <BottomNav
          tab={showSheet ? "player" : tab}
          onChange={goTab}
          adminMode={settings.adminMode}
        />
      </div>
    </div>
  );
}

/**
 * 전체화면.
 *
 * 폰 브라우저는 위아래로 주소창과 버튼 막대를 두는데, 악보를 볼 때는 그
 * 자리가 아깝다. 전체화면으로 들어가면 한 줄이 더 들어온다.
 *
 * iOS 사파리는 이 기능을 막아 두었다. 그런 기기에서는 단추를 내지 않는다 —
 * 눌러도 아무 일이 없는 단추만큼 헷갈리는 것이 없다.
 */
function FullscreenButton() {
  const [on, setOn] = useState(false);
  // 서버 렌더 때는 document가 없다. 화면이 뜬 뒤 한 번만 본다.
  const can = useSyncExternalStore(
    () => () => {},
    () => !!document.documentElement.requestFullscreen,
    () => false,
  );

  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  if (!can) return null;

  return (
    <button
      className="shrink-0 rounded p-1.5 text-[var(--accent)] opacity-80"
      title={on ? "전체화면 끄기" : "전체화면"}
      aria-label={on ? "전체화면 끄기" : "전체화면"}
      onClick={() => {
        if (document.fullscreenElement)
          document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {on ? (
          // 안으로 모이는 화살표 — 나가기
          <>
            <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
          </>
        ) : (
          // 밖으로 뻗는 화살표 — 들어가기
          <>
            <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
          </>
        )}
      </svg>
    </button>
  );
}

/**
 * 멜로디 악보가 없는 곡에 띄우는 안내.
 *
 * 칸을 아예 없애면 수강생은 자기 앱이 고장난 줄 안다. 없다는 것과
 * 무엇을 하면 되는지를 적어 두는 편이 낫다.
 */
function NoMelody({ admin }: { admin: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--panel-line)] bg-[var(--panel)] px-4 py-6 text-center">
      <div className="text-sm font-semibold text-[var(--foreground)]">
        이 음원은 멜로디 악보를 지원하지 않습니다
      </div>
      {/* 관리자에게는 붙이는 단추들이 바로 위에 있어 설명이 군말이다 —
          수강생에게만 무엇을 하면 되는지 적는다 */}
      {!admin && (
        <p className="mt-1.5 text-[12px] leading-5 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          악보가 붙은 음원을 받으시면 이 자리에 멜로디가 나옵니다. 타브와
          파형은 그대로 쓰실 수 있습니다.
        </p>
      )}
    </div>
  );
}
