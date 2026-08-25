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
    "maj7", "min7", "7", "dim7", "min7b5", "6", "min6", "add9", "N",
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

    # 타임라인에 그릴 파형 포락선. 0~1로 정규화된 값이 초당 peaks_per_second개.
    peaks: list[float] = []
    peaks_per_second: int = 0

    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    meta: AnalysisMeta


# ---- API 요청/응답 ----

class AnalyzeRequest(BaseModel):
    url: str | None = Field(default=None, description="YouTube URL. ENABLE_YOUTUBE=false면 거부")
    separate: bool = Field(default=True, description="Demucs 음원 분리 사용 여부")
    force: bool = Field(default=False, description="캐시 무시하고 재분석")


class JobStatus(BaseModel):
    job_id: str
    stage: JobStage
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    message: str = ""
    result_id: str | None = None
    error: str | None = None
