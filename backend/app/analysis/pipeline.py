"""분석 파이프라인.

M0에서는 각 단계가 스텁이다. 단계 구분과 진행률 보고 구조를 먼저 확정해 두고,
M2/M4에서 내용물만 실제 구현으로 갈아끼운다.
"""

from __future__ import annotations

import asyncio
import time

from ..config import settings
from ..schemas import (
    AnalysisMeta,
    AnalysisResult,
    Beat,
    Chord,
    JobStage,
)
from ..sources.base import FetchedAudio, ProgressFn, save_sidecar
from .decode import DecodedAudio, decode_to_wav

PIPELINE_VERSION = "0.2.0-decode"


def resolve_device() -> str:
    if settings.device != "auto":
        return settings.device
    try:
        import torch  # M4 이후에만 설치되어 있다

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


async def analyze(
    audio: FetchedAudio, progress: ProgressFn, *, separate: bool = True
) -> AnalysisResult:
    started = time.perf_counter()
    device = resolve_device()

    await progress(JobStage.DECODING, 0.0, "오디오 디코딩 중")
    decoded = await decode_to_wav(audio.path, audio.id)
    # 디코딩된 wav가 길이의 최종 출처다. yt-dlp 메타데이터는 반올림되어 있다.
    audio.duration = decoded.duration
    save_sidecar(audio.id, audio.title, decoded.duration)
    await progress(
        JobStage.DECODING, 1.0, f"{decoded.duration:.1f}초 · {decoded.sample_rate}Hz 모노"
    )

    if separate:
        await progress(JobStage.SEPARATING, 0.0, "음원 분리 중 (보컬·드럼 제거)")
        await asyncio.sleep(0.2)  # TODO(M4): demucs htdemucs

    await progress(JobStage.BEATS, 0.0, "비트·마디 분석 중")
    await asyncio.sleep(0.2)  # TODO(M2): beat_this / madmom 다운비트 추적

    await progress(JobStage.CHORDS, 0.0, "코드 인식 중")
    await asyncio.sleep(0.2)  # TODO(M2): 크로마+템플릿 → (M4) BTC/Chordino

    await progress(JobStage.POSTPROCESS, 0.0, "보정 중")
    await asyncio.sleep(0.1)  # TODO(M2): 비트 스냅 · median 스무딩 · 키 기반 보정

    # 종료(DONE/FAILED) 이벤트는 JobManager가 result_id와 함께 발행한다.
    # 여기서 DONE을 쏘면 클라이언트가 result_id 없는 완료 이벤트를 먼저 받는다.
    return _stub_result(audio, decoded, separate, device, time.perf_counter() - started)


def _stub_result(
    audio: FetchedAudio,
    decoded: DecodedAudio,
    separate: bool,
    device: str,
    elapsed: float,
) -> AnalysisResult:
    """프론트 개발용 가짜 결과: 90 BPM 4/4, G-D-Em-C 한 마디씩 반복."""
    bpm = 90.0
    spb = 60.0 / bpm
    duration = decoded.duration or 32.0

    beats: list[Beat] = []
    chords: list[Chord] = []
    progression = [("G", "G"), ("D", "D"), ("E", "Em"), ("C", "C")]

    i = 0
    t = 0.0
    while t < duration:
        bar = i // 4 + 1
        beats.append(Beat(t=round(t, 3), beat=i % 4 + 1, bar=bar))
        if i % 4 == 0:
            root, label = progression[(bar - 1) % 4]
            chords.append(
                Chord(
                    start=round(t, 3),
                    end=round(min(t + spb * 4, duration), 3),
                    label=label,
                    root=root,  # type: ignore[arg-type]
                    quality="min" if label.endswith("m") else "maj",
                    confidence=0.5,
                )
            )
        i += 1
        t = i * spb

    return AnalysisResult(
        id=audio.id,
        source=audio.kind,
        title=audio.title,
        duration=duration,
        bpm=bpm,
        time_signature="4/4",
        key="G major",
        beats=beats,
        chords=chords,
        confidence=0.0,
        meta=AnalysisMeta(
            pipeline_version=PIPELINE_VERSION,
            separated=separate,
            beat_model="stub",
            chord_model="stub",
            device=device,
            elapsed_sec=round(elapsed, 3),
        ),
    )
