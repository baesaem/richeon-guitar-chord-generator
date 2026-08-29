"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { BottomNav, NAV_ITEMS, type Tab } from "@/components/BottomNav";
import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { ChordStrip, type ChordStripHandle } from "@/components/ChordStrip";
import { ChordScore } from "@/components/ChordScore";
import { MelodyScore } from "@/components/MelodyScore";
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
import { Working } from "@/components/Working";
import { NotKnown, analyzeWithAi } from "@/lib/aiAnalyze";
import { measureOutputLatency } from "@/lib/latency";
import { stemKey, type StemChoice } from "@/lib/sharedFiles";
import { clearChordAt, setChordAt } from "@/lib/editChords";
import { SheetFinder } from "@/components/SheetFinder";
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
  putChords,
  putLyrics,
  tidyLyrics,
  reanalyze,
  getHealth,
  getResult,
  makeInstrumental,
  makeVocals,
  watchJob,
} from "@/lib/api";
import { barIndexAt, buildBars, chordIndexAt } from "@/lib/bars";
import { getLocal, getLocalAudio, saveLocal } from "@/lib/library";
import { LYRIC_LEAD, groupBySentence, groupIndexAt } from "@/lib/lyricGroups";
import { lyricIndexAt } from "@/lib/lrc";
import {
  labelFor,
  resolveFlats,
  simplifyQuality,
  spellKey,
  transposeRoot,
} from "@/lib/notation";
import { findNewLessons, markLessonsSeen, type NewLessons } from "@/lib/lessonShare";
import { loadSetup, saveSetup } from "@/lib/perSong";
import { addRecent } from "@/lib/recent";
import { useSettings } from "@/lib/settings";
import { useWideScreen } from "@/lib/useMedia";
import { suggestStrum } from "@/lib/strumLibrary";
import { tidyChords } from "@/lib/tidy";
import {
  STAGE_LABEL,
  type AnalysisResult,
  type Chord,
  type LyricLine,
  type Health,
  type JobStatus,
} from "@/lib/types";
import { voicingFor } from "@/lib/voicings";

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
  // 가사 보기: 켜면 코드 박스와 곡 전체 코드 자리를 가사가 대신 쓴다
  const [showLyrics, setShowLyrics] = useState(false);
  // 곡 전체 악보 모달
  const [showSheet, setShowSheet] = useState(false);
  // 스트로크 패턴 고르기 팝업
  const [showStrums, setShowStrums] = useState(false);
  // 코드 고치기: 지금 고르고 있는 마디 번호(없으면 null)
  const [editBar, setEditBar] = useState<number | null>(null);
  // 코드수정으로 들어왔는가. 고치는 데 쓰지 않는 탭은 감춘다
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
      if (alive && sec > 0) setSettings({ ...settings, latency: sec });
    });
    return () => {
      alive = false;
    };
    // 한 번만 잰다. 설정이 바뀔 때마다 다시 잴 이유가 없다.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 악보보기 모달에서 무엇을 볼지
  const [sheetTab, setSheetTab] = useState<
    "score" | "melody" | "grid" | "lyrics" | "web" | "mine"
  >("score");
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
    }, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [health]);

  // 설정에서 서버 주소를 바꾸면 다시 확인한다.
  // 기타반 곡은 자동으로 담지 않는다 - 수강생이 음원 가져오기의
  // 기타반 목록에서 필요한 곡만 골라 받는다.
  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setBackendDown(false);
      })
      .catch(() => {
        setHealth(null);
        setBackendDown(true);
      });
  }, [settings.apiBase]);

  // 테마 적용: html에 .dark 클래스를 붙였다 뗀다. system이면 기기 설정을 따라간다.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        settings.theme === "dark" || (settings.theme === "system" && media.matches);
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

  // 화면에 그릴 결과.
  // 1) 「기본」 어휘면 확장 화음을 3화음으로 낮춘다.
  // 2) 스치는 오인식·짧은 무음을 걷어내고 같은 코드는 하나로 잇는다.
  //    낮추고 나서 다듬어야 Cmaj7→C가 옆 C와 합쳐진다.
  const shown = useMemo(() => {
    if (!result) return result;
    const simplified =
      settings.chordVocab === "all"
        ? result.chords
        : result.chords.map((c) => ({
            ...c,
            quality: simplifyQuality(c.quality, "basic"),
          }));
    return { ...result, chords: tidyChords(simplified, result.bpm) };
  }, [result, settings.chordVocab]);

  const bars = useMemo(() => (result ? buildBars(result) : []), [result]);
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
  // 가사를 문장 단위로 묶는다. 편집할 때는 줄 그대로 본다.
  const lyricGroups = useMemo(
    () => groupBySentence(result?.lyrics ?? []),
    [result?.lyrics],
  );
  const flats = useMemo(
    () => (result ? resolveFlats(result.key, settings.notation) : false),
    [result, settings.notation],
  );

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
   */
  const showSong = (r: AnalysisResult) => {
    const setup = loadSetup(r.id);
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
      const stored = await getLocalAudio(stemKey(result.id, next)).catch(() => null);
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
              setTab("home");
              // 서버(PC)가 꺼져도 열 수 있도록 기기에도 저장해 둔다
              if (settings.autoSave) saveLocal(r).catch(() => {});
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
    if (health) await putChords(next.id, next.chords).catch(() => {});
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
        i !== index ? l : change ? { ...l, text: change.text, t: change.at } : null,
      )
      .filter((l): l is LyricLine => l !== null)
      .sort((a, b) => a.t - b.t)
      .map((l, i, all) => ({ ...l, end: i + 1 < all.length ? all[i + 1].t : l.end }));

    const next = { ...result, lyrics: rows };
    setResult(next);
    await saveLocal(next).catch(() => {});
    if (health) await putLyrics(next.id, rows).catch(() => {});
  };

  /**
   * 지금 듣고 있는 자리에 가사 줄을 새로 넣는다.
   *
   * 자막이 빠뜨린 줄, 라라라 같은 흥얼거림, 아예 가사가 없는 곡 — 손으로
   * 채워야 하는 자리가 있다. 넣자마자 편집창을 열어 바로 적게 한다.
   */
  const addLyricLine = async () => {
    if (!result) return;
    const rows = [...(result.lyrics ?? []), { t: +time.toFixed(2), end: 0, text: "새 줄" }]
      .sort((a, b) => a.t - b.t)
      .map((l, i, all) => ({ ...l, end: i + 1 < all.length ? all[i + 1].t : l.end }));

    const next = { ...result, lyrics: rows, lyrics_manual: true };
    setResult(next);
    await saveLocal(next).catch(() => {});
    if (health) await putLyrics(next.id, rows).catch(() => {});
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
    if (health) await putChords(next.id, next.chords).catch(() => {});
  };

  const openSaved = async (id: string): Promise<boolean> => {
    setError(null);
    resetPlayback();
    setTab("home");
    try {
      // 서버가 붙어 있으면 서버 것을 쓴다. 분석을 고치면 서버 결과가 먼저
      // 새로워지는데, 기기 저장분을 우선하면 옛 결과가 계속 열린다.
      // 서버가 없는 수강생 기기에서는 곧바로 기기 저장분으로 간다.
      const result = health
        ? await getResult(id).catch(() => getLocal(id))
        : await getLocal(id);
      if (!result) throw new Error("결과 없음");
      showSong(result);
      return true;
    } catch {
      setError("이 곡을 열 수 없습니다. 기기에 저장돼 있지 않고 서버에도 연결되지 않았습니다.");
      return false;
    }
  };

  const busy = status !== null && status.stage !== "done" && status.stage !== "failed";

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

  // 바꾼 설정은 곧바로 그 곡에 적어 둔다
  useEffect(() => {
    if (!result) return;
    saveSetup(result.id, {
      transpose, rate, loop, sync, lyricSync, arp, strum: strumName,
    });
  }, [result?.id, transpose, rate, loop, sync, lyricSync, arp, strumName]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (lyricSync !== 0) out.push(`가사 ${lyricSync > 0 ? "+" : ""}${lyricSync.toFixed(1)}초`);
    if (stem === "inst") out.push("반주만");
    if (stem === "vocals") out.push("보컬만");
    if (arp > 0) out.push(`아르페지오 ${arp}`);
    return out;
  }, [transpose, rate, loop, settings.chordVocab, stem, sync, lyricSync, arp]);

  // 태블릿·PC 폭인가. 넓으면 악보를 더 많은 줄 보인다 —
  // 세로도 폭만큼 남으므로 두 줄만 띄우면 화면이 텅 빈다.
  const wide = useWideScreen();

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
  const hasMelody = hasScore || !!sheetImg || (result?.melody?.length ?? 0) > 8;


  // 멜로디가 없는 곡을 열었는데 지난 곡에서 고른 「멜로디」가 남아 있으면
  // 코드악보로 되돌린다.
  const boardView = settings.view === "melody" && !hasMelody ? "sheet" : settings.view;

  // 음높이 +n = 카포 n프렛. 카포가 소리를 n만큼 올려주므로
  // 화면 코드 표기는 반대로 n만큼 내린 모양이어야 원곡 소리가 난다.
  const noteShift = -transpose;

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
    return sheetChords((result?.score ?? null) as never, shift - transpose, flats);
  }, [result?.score, result?.score_align, transpose, flats]);


  // 지금 보고 있는 메뉴의 이름. 넓은 화면에서는 사이드바가 앱 이름을
  // 맡고, 위쪽 띠는 "여기가 어디인지"를 맡는다.
  const TAB_TITLE: Record<Tab, string> = {
    home: result ? result.title || "재생" : "홈",
    library: "음원목록",
    import: "음원 가져오기",
    lesson: "공부방",
    edit: "코드수정",
    chords: "기타 기초",
    settings: "설정",
  };

  return (
    /* 화면 크기에 따라 두 모습이 된다.
       - 폰: 위에 앱 이름 띠, 아래에 탭 막대 (지금까지의 모습)
       - 태블릿·PC(md 이상): 왼쪽에 주메뉴 기둥(위에 앱 이름), 오른쪽 본문
         위에 지금 메뉴 이름 띠. 본문은 넓은 화면에서 가운데로 모은다 */
    <div className="app-scale flex overflow-x-hidden">
      <SideNav tab={tab} onChange={setTab} />

      {/* 본문은 화면 폭을 그대로 쓴다. 폰에서만 너무 넓어지지 않게 모은다 */}
      <div className="mx-auto flex h-full min-w-0 w-full max-w-2xl flex-col sm:max-w-none md:mx-0 md:border-l md:border-gray-200 md:dark:border-gray-800">
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

      {/* 새 강좌 알림 — 앱을 열 때 한 번. 띠로 두면 못 보고 지나친다 */}
      {newLessons.length > 0 && (
        <Popup
          title="새 강좌가 올라왔습니다"
          width="max-w-xs"
          onClose={() => {
            markLessonsSeen(newLessons.flatMap((l) => l.ids));
            setNewLessons([]);
          }}
        >
          <p className="mb-2.5 text-[11px] leading-snug text-gray-500">
            강사님이 공부방 강의실에 새 자료를 올렸습니다. 받으러 가시겠어요?
          </p>
          <div className="space-y-1.5">
            {newLessons.map((l) => (
              <button
                key={l.klass.id}
                className="w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
                onClick={() => {
                  setLessonClass(l.klass.id);
                  setTab("lesson");
                  markLessonsSeen(newLessons.flatMap((x) => x.ids));
                  setNewLessons([]);
                }}
              >
                {l.klass.name.match(/\(([^)]+)\)/)?.[1] ?? l.klass.name} {l.ids.length}개
                받으러 가기
              </button>
            ))}
            <button
              className="w-full rounded bg-gray-100 py-2 text-xs dark:bg-gray-800"
              onClick={() => {
                markLessonsSeen(newLessons.flatMap((l) => l.ids));
                setNewLessons([]);
              }}
            >
              나중에
            </button>
          </div>
        </Popup>
      )}

      {/* 뷰는 화면 폭을 그대로 쓴다. 넓어진 만큼 각 화면의 격자가
          칸을 늘려 채운다(코드표·홈 카드·그리드 악보) */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* 홈 탭은 항상 붙여 둔다. 다른 탭으로 옮겨도 재생이 끊기지 않게. */}
        <div
          className={
            tab === "home"
              ? "flex h-full flex-col overflow-y-auto md:overflow-hidden"
              : "hidden"
          }
        >
          {result ? (
            // 영역을 카드로 묶어 서로 구별한다: 영상 / 타임라인+탐색 / 현재 코드 / 곡 전체
            <>
            {/* 넓은 화면에서는 왼쪽에 악보·가사, 오른쪽에 영상을 세운다.
                영상은 참고용이라 자리를 조금만 쓰고, 눈이 오래 머무는
                악보가 넓은 쪽을 갖는다. 폰은 지금처럼 위아래로 쌓인다 */}
            <div className="flex min-h-0 flex-1 flex-col md:flex-row md:gap-1">
              {/* 오른쪽 기둥 — 영상과 그 아래 가사. 넓은 화면에서는
                  가사를 늘 펼쳐 둔다(노래를 보며 치는 자리라서) */}
              <div className="flex flex-col md:order-2 md:min-h-0 md:w-[44%] md:shrink-0 roomy:w-[50%] lg:w-[54%] xl:w-[58%] 2xl:w-[62%]">
              <section className="mx-2 mt-1.5 shrink-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                {/* 곡 이름. 영상 안에도 적혀 있지만 접으면 사라지고, 유튜브가
                    아닌 곡(업로드)에는 아예 없다. 지금 무슨 곡을 보고 있는지는
                    늘 보여야 한다. */}
                <div className="flex items-center gap-1.5 border-b border-gray-200 px-2.5 py-1.5 dark:border-gray-700">
                  {/* 어디서 온 곡인지 아이콘으로. YouTube면 빨간 재생 딱지,
                      올린 곡이면 음표 */}
                  {result.source === "youtube" ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-4 shrink-0" aria-hidden="true">
                      <rect x="1" y="5" width="22" height="14" rx="4" fill="#FF0000" />
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
              <section className="mx-2 mb-1.5 mt-1.5 hidden min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900 roomy:flex">
                <LyricsPane
                  result={result}
                  time={time + lyricSync - settings.latency}
                  online={!!health}
                  canEdit={settings.adminMode}
                  onLyrics={(lines) =>
                    setResult((prev) => (prev ? { ...prev, lyrics: lines } : prev))
                  }
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

              <section className="mx-2 mt-1.5 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
              {/* 코드악보/파형 세그먼트 + 연주설정·영상접기. 글자 크기를 통일한 한 줄.
                  코드악보를 왼쪽에 둔다 — 주로 보는 화면이라 손이 먼저 간다. */}
              <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800 roomy:gap-2 roomy:px-3 roomy:py-2.5">
                <div className="flex min-w-0 flex-1 rounded-lg bg-gray-200/70 p-0.5 dark:bg-gray-800">
                  {(
                    [
                      ["sheet", "코드악보"] as const,
                      ...(hasMelody ? [["melody", "멜로디"] as const] : []),
                      ["wave", "파형"] as const,
                    ]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setSettings({ ...settings, view: value })}
                      className={[
                        "min-w-0 flex-1 truncate rounded-md py-1 text-[13px] font-medium transition-colors roomy:py-2.5 roomy:text-[16px]",
                        boardView === value
                          ? "bg-white text-black shadow-sm dark:bg-black dark:text-white"
                          : "text-gray-500",
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
                      : "bg-gray-200/70 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
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
                    setSettings({ ...settings, videoCompact: !settings.videoCompact })
                  }
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-gray-200/70 px-2 py-1.5 text-[13px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300 roomy:gap-1.5 roomy:px-3 roomy:py-2.5 roomy:text-[16px]"
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
                      onPickStrum={() => setShowStrums(true)}
                      right={
                        <button
                          className="flex shrink-0 items-center gap-1 rounded bg-gray-200/70 px-2 py-0.5 text-[11px] font-semibold text-gray-900 dark:bg-gray-700 dark:text-gray-100 roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
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
                            <rect x="3" y="4" width="18" height="16" rx="2" />
                            <path d="M3 9h18M8 4v16" />
                          </svg>
                          전체보기
                        </button>
                      }
                    />
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
                  {sheetImg ? (
                    /* 인쇄된 악보 그대로. 마디선만 찾아 그 위로 커서가 간다 */
                    <SheetScore
                      resultId={result.id}
                      sheet={sheetImg}
                      // 악보는 코드와 같은 것을 짚는 도구다. 가사 싱크가
                      // 아니라 코드 싱크(연주설정)로 맞춘다.
                      time={time + sync - settings.latency}
                      getTime={
                        playback
                          ? () => playback.getTime() + sync - settings.latency
                          : undefined
                      }
                      chords={sheetChordList}
                      // 음높이를 바꾸면 인쇄된 코드가 어긋난다. 그때만
                      // 우리 코드를 덮어쓴다 — 손대지 않았으면 원본이 옳다.
                      showChords={transpose !== 0}
                      barsView={settings.sheetZoom}
                      onZoom={(n) => setSettings({ ...settings, sheetZoom: n })}
                      musicKey={result.key}
                      timeSignature={result.time_signature}
                      playNotes={playNotes}
                      onSeek={(t) => playback?.seek(t)}
                      lines={wide ? 3 : 2}
                      headerRight={
                        <button
                          className="flex shrink-0 items-center gap-1 rounded bg-gray-200/70 px-2 py-0.5 text-[11px] font-semibold text-gray-900 dark:bg-gray-700 dark:text-gray-100 roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
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
                    getTime={
                      playback
                        ? () => playback.getTime() + lyricSync - settings.latency
                        : undefined
                    }
                    solfege={settings.solfege}
                    onSolfege={() =>
                      setSettings({ ...settings, solfege: !settings.solfege })
                    }
                    time={time + lyricSync - settings.latency}
                    playNotes={playNotes}
                    headerRight={
                      <button
                        className="flex shrink-0 items-center gap-1 rounded bg-gray-200/70 px-2 py-0.5 text-[11px] font-semibold text-gray-900 dark:bg-gray-700 dark:text-gray-100 roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
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
                          <rect x="3" y="4" width="18" height="16" rx="2" />
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
                  {/* 강사님만 보이는 줄. 악보를 붙이면 뽑아낸 멜로디 대신
                      악보를 그린다 — 음표가 하나도 빠지지 않는다. */}
                  {settings.adminMode && (
                    <ScoreAttach
                      result={result}
                      onResult={setResult}
                      online={!!health}
                    />
                  )}
                </div>
              ) : (
                <div className="shrink-0 px-2 py-1">
                  {/* AI가 아는 코드로 만든 초안은 반드시 밝힌다.
                      음원을 들은 결과가 아니라 실제 녹음과 어긋난다 */}
                  {result.meta?.chord_model === "ai-knowledge" && (
                    <p className="mb-1 rounded bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-800">
                      AI가 아는 코드로 만든 초안입니다. 음원을 듣고 만든 것이
                      아니라 전주 길이·반복 횟수가 실제 녹음과 어긋납니다.
                    </p>
                  )}
                  {/* 지금 줄과 다음 줄만. 현재 줄이 늘 위에 온다 */}
                  <ChordScore
                    bars={bars}
                    chords={shownChords}
                    strums={result.strums}
                    arp={arp}
                    strumName={strumName}
                    playNotes={playNotes}
                    headerRight={
                      <button
                        className="flex shrink-0 items-center gap-1 rounded bg-gray-200/70 px-2 py-0.5 text-[11px] font-semibold text-gray-900 dark:bg-gray-700 dark:text-gray-100 roomy:px-3 roomy:py-1.5 roomy:text-[15px]"
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
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <path d="M3 9h18M8 4v16" />
                        </svg>
                        전체보기
                      </button>
                    }
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
                <section className="mx-2 mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                  <LyricsPane
                    result={result}
                    time={time + lyricSync - settings.latency}
                    online={!!health}
                    canEdit={settings.adminMode}
                    onLyrics={(lines) =>
                      setResult((prev) => (prev ? { ...prev, lyrics: lines } : prev))
                    }
                    onSeek={(t) => {
                      playback?.seek(t);
                      setTime(t);
                    }}
                  />
                </section>
              ) : (
              <>
              <section className="mx-2 mt-1.5 flex shrink-0 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900">
                <ChordDiagram
                  voicing={cur ? voicingFor(cur.root, cur.quality) : null}
                  label={cur?.label ?? ""}
                  width={86}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-3xl font-bold leading-none">
                    {cur ? <ChordLabel label={cur.label} /> : "—"}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    다음 {nxt ? <ChordLabel label={nxt.label} /> : "—"}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-gray-400">
                    <ChordLabel label={spellKey(result.key)} /> · {Math.round(result.bpm)} BPM ·{" "}
                    {result.time_signature} · {barIdx + 1}/{bars.length}마디
                  </div>
                </div>
                {nxt && (
                  <div className="flex shrink-0 flex-col items-center">
                    <div className="text-xs font-semibold leading-none text-gray-500">
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
          ) : (
            <div className="flex h-full flex-col">
              <HomeDashboard
                onOpen={openSaved}
                onImport={() => {
                  setImportCard(undefined);
                  setTab("import");
                }}
                onShared={(classId) => {
                  setImportCard(classId);
                  setTab("import");
                }}
                onLibrary={() => setTab("library")}
                onChords={() => setTab("chords")}
              />
              <div className="space-y-2 px-4">
                {status && busy && (
                  <p className="text-xs text-gray-500">
                    {STAGE_LABEL[status.stage]} · {Math.round(status.progress * 100)}%
                  </p>
                )}
                {error && (
                  <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
                )}
                <Copyright />
              </div>
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
            onAnalyzeFile={(f) => run(() => analyzeUpload(f, settings.separate))}
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
                ? (item, refetch) =>
                    run(() =>
                      reanalyze(item.id, settings.separate, refetch, {
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
          <SettingsTab settings={settings} onChange={setSettings} health={health} />
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
      {showSheet && result && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/50 p-3"
          onClick={() => setShowSheet(false)}
        >
          <div
            className="mx-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[var(--background)] shadow-xl sm:max-w-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
              <h3 className="min-w-0 flex-1 truncate text-sm font-bold">
                {result.title || "악보"}
              </h3>
              {/* 잘못 고쳤을 때 돌아갈 자리. 고칠 것이 있을 때만 낸다 */}
              {editMode && undo.length > 0 && (
                <button
                  className="shrink-0 rounded bg-gray-100 px-2 py-1 text-[11px] dark:bg-gray-800"
                  onClick={undoChordEdit}
                >
                  되돌리기 {undo.length}
                </button>
              )}
              <button
                className="rounded px-2 py-1 text-sm text-gray-500"
                onClick={() => setShowSheet(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            {/* 한 화면에 다 담으면 스크롤이 길어진다. 볼 것만 골라 본다. */}
            <div className="flex shrink-0 gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
              {(
                [
                  ["score", "코드악보"] as const,
                  // 오선 악보는 그릴 것이 있을 때만. 없으면 빈 탭이 된다.
                  ...(hasMelody ? [["melody", "멜로디"] as const] : []),
                  ["grid", "그리드"] as const,
                  ["lyrics", "가사"] as const,
                  ["web", "웹 악보"] as const,
                  ["mine", "내 악보"] as const,
                ]
              )
                // 코드수정으로 들어왔으면 고치는 데 쓰는 탭만 남긴다
                .filter(([value]) => !editMode || value !== "web")
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
                        ? "text-gray-300 dark:text-gray-600"
                        : sheetTab === value
                          ? "bg-gray-200/80 text-black dark:bg-gray-700 dark:text-white"
                          : "text-gray-500",
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

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {sheetTab === "score" && (
                /* 곡 전체를 줄줄이 — 창을 씌우지 않아 처음부터 끝까지 훑는다 */
                <ChordScore
                  bars={bars}
                  chords={shownChords}
                  strums={result.strums}
                  arp={arp}
                  strumName={strumName}
                  playNotes={playNotes}
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

              {sheetTab === "melody" && sheetImg && (
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
                  showChords={transpose !== 0}
                  musicKey={result.key}
                  timeSignature={result.time_signature}
                  playNotes={playNotes}
                  barsView={settings.sheetZoom}
                  onZoom={(n) => setSettings({ ...settings, sheetZoom: n })}
                  lines={999}
                  onSeek={(t) => {
                    playback?.seek(t);
                    setTime(t);
                  }}
                />
              )}

              {sheetTab === "melody" && !sheetImg && (
                /* 악보 그림이 없는 곡. 오선 악보를 곡 전체로 죽 편다. */
                <MelodyScore
                  bars={bars}
                  chords={shownChords}
                  melody={result.melody ?? []}
                  lyrics={result.lyrics}
                  score={(result.score ?? null) as never}
                  align={(result.score_align ?? null) as never}
                  showChecks={settings.adminMode}
                  getTime={
                    playback
                      ? () => playback.getTime() + lyricSync - settings.latency
                      : undefined
                  }
                  solfege={settings.solfege}
                  onSolfege={() =>
                    setSettings({ ...settings, solfege: !settings.solfege })
                  }
                  time={time + lyricSync - settings.latency}
                  playNotes={playNotes}
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
                  onSeek={(t) => {
                    playback?.seek(t);
                    setTime(t);
                  }}
                  onEditBar={setEditBar}
                />
              )}

              {sheetTab === "lyrics" && (
                <div className="text-[13px] leading-relaxed">
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
                    <button
                      className="mb-2 w-full rounded bg-gray-100 py-2 text-xs dark:bg-gray-800"
                      onClick={addLyricLine}
                    >
                      + 지금 자리({Math.floor(time / 60)}:
                      {String(Math.floor(time % 60)).padStart(2, "0")})에 줄 추가
                    </button>
                  )}
                  {(result.lyrics ?? []).length === 0 && (
                    <p className="py-4 text-center text-xs text-gray-400">
                      가사가 없습니다.
                      {editMode ? " 위 단추로 한 줄씩 넣을 수 있습니다." : ""}
                    </p>
                  )}
                  {/* 문장 단위로 끊는다. 자막 가사는 숨 쉬는 자리마다 토막나
                      그대로 늘어놓으면 소절을 알 수 없다. 고칠 때는 줄 그대로
                      봐야 해서 편집 모드에서는 안 묶는다 */}
                  {editMode
                    ? (result.lyrics ?? []).map((line, i) => (
                        <LyricRow
                          key={`${line.t}-${i}`}
                          text={line.text}
                          now={
                            lyricIndexAt(
                              result.lyrics ?? [],
                              time + lyricSync - settings.latency + LYRIC_LEAD,
                            ) === i
                          }
                          onSeek={() => {
                            playback?.seek(line.t);
                            setTime(line.t);
                          }}
                          onEdit={() => setEditLyric(i)}
                        />
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

              {sheetTab === "web" && (
                <SheetFinder
                  resultId={result.id}
                  title={result.title}
                  online={!!health}
                />
              )}

              {sheetTab === "mine" && (
                <MySheet resultId={result.id} online={!!health} />
              )}

            </div>
          </div>
        </div>
      )}

      {/* 마디 코드 고르기 */}
      {editBar !== null && result && bars[editBar] && (
        <ChordPicker
          barNumber={bars[editBar].number}
          current={(() => {
            const c = shownChords[chordIndexAt(shownChords, bars[editBar].start)];
            return c?.root
              ? { root: transposeRoot(c.root, noteShift) ?? c.root, quality: c.quality }
              : null;
          })()}
          flats={flats}
          onPick={(root, quality) => applyChordEdit(editBar, { root, quality })}
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
        <Working label="가사 다듬는 중" note="AI가 토막난 자막을 소절로 잇습니다" />
      )}

      <BottomNav tab={tab} onChange={setTab} />
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
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
