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
  /** 타임라인에 그릴 파형 포락선 (0~1) */
  peaks: number[];
  peaks_per_second: number;
  confidence: number;
  meta: AnalysisMeta;
}

/** 재생목록용 요약. 전체 결과는 파형 때문에 무거워 목록에는 쓰지 않는다. */
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
