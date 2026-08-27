"""분석 결과 계약(contract).

프론트엔드와 백엔드가 공유하는 유일한 인터페이스.
분석 알고리즘을 M2→M4로 교체해도 이 스키마는 바뀌지 않는 것이 목표.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class SourceKind(StrEnum):
    YOUTUBE = "youtube"
    UPLOAD = "upload"


class JobStage(StrEnum):
    """진행률 표시용 단계. 프론트의 프로그레스 바 라벨과 1:1 대응."""

    QUEUED = "queued"
    FETCHING = "fetching"        # yt-dlp 다운로드 / 업로드 수신
    DECODING = "decoding"        # ffmpeg → wav
    SEPARATING = "separating"    # demucs 음원 분리 (선택)
    BEATS = "beats"              # 비트 / 다운비트 추적
    CHORDS = "chords"            # 코드 인식
    POSTPROCESS = "postprocess"  # 스무딩 · 키 보정
    DONE = "done"
    FAILED = "failed"


# 근음 표기는 샾(#) 기준으로 통일한다. 플랫 표기는 프론트에서 조표에 맞춰 변환.
Root = Literal["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# M2 베이스라인은 maj/min만 채운다. 나머지는 M4의 large-vocabulary 모델용.
Quality = Literal[
    "maj", "min", "dim", "aug", "sus2", "sus4",
    "maj7", "min7", "minmaj7", "7", "dim7", "min7b5", "6", "min6", "add9", "N",
]


class Beat(BaseModel):
    t: float = Field(description="비트 시각(초)")
    beat: int = Field(description="마디 내 박 번호. 1이면 다운비트")
    bar: int = Field(description="1부터 시작하는 마디 번호")


class Chord(BaseModel):
    start: float
    end: float
    label: str = Field(description='화면 표시용 문자열. 예: "G", "Am7", "D/F#"')
    root: Root | None = None
    quality: Quality = "maj"
    bass: Root | None = Field(default=None, description="슬래시 코드의 베이스음")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    edited: bool = Field(default=False, description="사용자가 수동 보정한 코드인지")


class Section(BaseModel):
    start: float
    end: float
    label: str = Field(description='"Intro" / "Verse" / "Chorus" 등')


class Note(BaseModel):
    """멜로디 음표 하나. 보컬에서 따 온 단선율이다."""

    t: float = Field(description="시작 시각(초)")
    end: float = Field(description="끝 시각(초)")
    midi: int = Field(description="MIDI 번호. 60이 가온다(C4)")


class Strum(BaseModel):
    """스트로크 한 번. 언제, 어느 방향으로, 얼마나 세게 쳤는지."""

    t: float = Field(description="치는 시각(초)")
    down: bool = Field(description="True면 쓸어내림(↓), False면 쓸어올림(↑)")
    strength: float = Field(default=1.0, ge=0.0, le=1.0, description="0~1 세기")


class LyricLine(BaseModel):
    """시간이 붙은 가사 한 줄. YouTube 자막이나 사용자가 넣은 LRC에서 온다."""

    t: float = Field(description="줄이 시작하는 시각(초)")
    end: float = Field(default=0.0, description="줄이 끝나는 시각(초). 0이면 미상")
    text: str


class AnalysisMeta(BaseModel):
    """어떤 알고리즘 조합으로 뽑은 결과인지 기록.

    모델을 바꿔가며 튜닝할 때 캐시된 결과가 어느 버전인지 구분하는 용도.
    이 값이 현재 설정과 다르면 재분석을 유도한다.
    """

    pipeline_version: str
    separated: bool = False
    beat_model: str = "none"
    chord_model: str = "none"
    device: str = "cpu"
    elapsed_sec: float = 0.0


class AnalysisResult(BaseModel):
    id: str = Field(description="캐시 키. youtube면 videoId, upload면 파일 해시")
    source: SourceKind
    title: str = ""
    duration: float = 0.0

    bpm: float = 0.0
    time_signature: str = "4/4"
    key: str = Field(default="", description='예: "G major"')

    beats: list[Beat] = []
    chords: list[Chord] = []
    sections: list[Section] = []
    # 시간 동기화된 가사. 없을 수도 있다(자막이 없는 영상·업로드 곡).
    lyrics: list[LyricLine] = []
    # 가사 시각이 어림인가. 동기화 가사를 못 찾아 줄을 고르게 편 경우다.
    # 화면이 "시각은 대략"이라고 알려 줄 수 있게 남긴다.
    lyrics_approx: bool = False
    # 사람이 넣거나 고친 가사인가. 재분석이 이 가사를 지운 채 자동으로
    # 찾은 것으로 덮으면, 공들여 맞춘 가사가 사라진다. 표식이 있으면
    # 재분석은 가사를 그대로 두고 싱크만 다시 맞춘다.
    lyrics_manual: bool = False
    # 보컬에서 딴 멜로디. 음원 분리를 쓴 경우에만 채워진다.
    melody: list[Note] = []
    # 스트로크(스트럼) 패턴. 음원 분리를 쓴 경우에만 채워진다.
    strums: list[Strum] = []

    # 타임라인에 그릴 파형 포락선. 0~1로 정규화된 값이 초당 peaks_per_second개.
    peaks: list[float] = []
    peaks_per_second: int = 0

    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    meta: AnalysisMeta


# ---- API 요청/응답 ----

class ResultSummary(BaseModel):
    """재생목록에 뿌릴 요약. 전체 결과는 peaks 때문에 100KB가 넘어 목록에 부적합하다."""

    id: str
    source: SourceKind
    title: str = ""
    duration: float = 0.0
    bpm: float = 0.0
    key: str = ""
    chord_count: int = 0
    pipeline_version: str = ""
    analyzed_at: float = Field(default=0.0, description="결과 파일 수정 시각(유닉스 초)")


class ReanalyzeRequest(BaseModel):
    """이미 등록된 곡 다시 분석하기."""

    separate: bool = True
    refetch: bool = Field(
        default=False,
        description="음원부터 다시 받는다. 기본은 받아 둔 음원을 그대로 쓴다",
    )
    source: SourceKind | None = Field(
        default=None,
        description="서버에 결과가 없을 때 쓸 힌트. 기기에만 저장해 둔 곡을 위한 것",
    )
    title: str = Field(default="", description="서버에 결과가 없을 때 쓸 제목")


class AnalyzeRequest(BaseModel):
    url: str | None = Field(default=None, description="YouTube URL. ENABLE_YOUTUBE=false면 거부")
    separate: bool = Field(default=True, description="Demucs 음원 분리 사용 여부")
    force: bool = Field(default=False, description="캐시 무시하고 재분석")


class LlmSettings(BaseModel):
    """가사 도우미 설정. None은 "그대로 두기", ""는 "지우기"."""

    api_key: str | None = Field(default=None, description="빈 문자열이면 저장된 키를 지운다")
    base_url: str | None = Field(default=None, description="OpenAI 호환 API 주소")
    model: str | None = None


class JobStatus(BaseModel):
    job_id: str
    stage: JobStage
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    message: str = ""
    result_id: str | None = None
    error: str | None = None
