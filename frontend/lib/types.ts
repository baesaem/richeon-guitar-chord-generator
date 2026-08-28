// backend/app/schemas.py 와 1:1 대응. 백엔드 스키마를 고치면 이 파일도 같이 고칠 것.

export type SourceKind = "youtube" | "upload";

export type JobStage =
  | "queued"
  | "fetching"
  | "decoding"
  | "separating"
  | "beats"
  | "chords"
  | "postprocess"
  | "done"
  | "failed";

export const STAGE_LABEL: Record<JobStage, string> = {
  queued: "대기 중",
  fetching: "오디오 가져오는 중",
  decoding: "디코딩 중",
  separating: "음원 분리 중",
  beats: "비트 분석 중",
  chords: "코드 인식 중",
  postprocess: "보정 중",
  done: "완료",
  failed: "실패",
};

export interface Beat {
  t: number;
  beat: number;
  bar: number;
}

export interface Chord {
  start: number;
  end: number;
  label: string;
  root: string | null;
  quality: string;
  bass: string | null;
  confidence: number;
  edited: boolean;
}

export interface Section {
  start: number;
  end: number;
  label: string;
}

/** 멜로디 음표 하나. midi 60이 가온다(C4). */
export interface Note {
  t: number;
  end: number;
  midi: number;
}

/** 스트로크 한 번. down이면 쓸어내림(↓), 아니면 쓸어올림(↑) */
export interface Strum {
  t: number;
  down: boolean;
  strength: number;
}

/** 시간이 붙은 가사 한 줄 */
export interface LyricLine {
  t: number;
  end: number;
  text: string;
}

export interface AnalysisMeta {
  pipeline_version: string;
  separated: boolean;
  beat_model: string;
  chord_model: string;
  device: string;
  elapsed_sec: number;
}

export interface AnalysisResult {
  id: string;
  source: SourceKind;
  title: string;
  duration: number;
  bpm: number;
  time_signature: string;
  key: string;
  beats: Beat[];
  chords: Chord[];
  sections: Section[];
  /** 시간 동기화된 가사. 없을 수도 있다 */
  lyrics?: LyricLine[];
  /**
   * 가사 시각이 어림인가.
   *
   * 동기화 가사를 못 찾아 줄을 노래 길이에 고르게 편 경우다. 글자는
   * 맞지만 넘어가는 시점은 맞지 않는다. 화면이 그 사실을 알려 준다.
   */
  lyrics_approx?: boolean;
  /** 사람이 넣거나 고친 가사. 재분석이 지우지 않고 싱크만 다시 맞춘다 */
  lyrics_manual?: boolean;
  /** 보컬에서 딴 멜로디. 음원 분리를 쓴 곡만 채워진다 */
  melody?: Note[];
  /** 스트로크(스트럼) 패턴. 음원 분리를 쓴 곡만 채워진다 */
  strums?: Strum[];
  /**
   * 강사님이 올린 정식 악보와, 그것을 이 음원의 시각에 이어 둔 표.
   *
   * 뽑아낸 melody는 부른 음의 15~30%밖에 잡히지 않는다. 악보가 붙어
   * 있으면 멜로디 화면은 이쪽을 그린다 — 음표가 하나도 빠지지 않는다.
   * 모양은 lib/scoreStaff.ts의 ScoreData·ScoreAlign을 따른다.
   */
  score?: unknown;
  score_align?: unknown;
  /**
   * 강사님이 올린 **악보 그림**의 배치와 마디별 시각.
   * 모양은 components/SheetScore.tsx의 SheetData를 따른다.
   */
  sheet?: unknown;
  /** 타임라인에 그릴 파형 포락선 (0~1) */
  peaks: number[];
  peaks_per_second: number;
  confidence: number;
  meta: AnalysisMeta;
}

/** 음원목록용 요약. 전체 결과는 파형 때문에 무거워 목록에는 쓰지 않는다. */
export interface ResultSummary {
  id: string;
  source: SourceKind;
  title: string;
  duration: number;
  bpm: number;
  key: string;
  chord_count: number;
  pipeline_version: string;
  analyzed_at: number;
}

export interface JobStatus {
  job_id: string;
  stage: JobStage;
  progress: number;
  message: string;
  result_id: string | null;
  error: string | null;
}

export interface Health {
  ok: boolean;
  /** false면 URL 입력창을 감추고 업로드 전용(B안)으로 동작 */
  youtube_enabled: boolean;
  /** ffmpeg/ffprobe가 PATH에 없으면 어떤 분석도 불가능하다 */
  ffmpeg: boolean;
  device: string;
  pipeline_version: string;
}
