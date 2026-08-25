"""분석 파이프라인.

오디오 → 디코딩 → (음원분리) → 비트/다운비트 → 크로마 → 코드 → 후처리.
무거운 numpy 연산은 전부 워커 스레드로 보내 이벤트 루프를 막지 않는다.
"""

from __future__ import annotations

import asyncio
import time

import numpy as np

from ..config import settings
from ..schemas import (
    AnalysisMeta,
    AnalysisResult,
    Beat,
    Chord,
    JobStage,
)
from ..sources.base import FetchedAudio, ProgressFn, save_sidecar
from . import chords as chord_rec
from .beats import BEAT_MODEL, estimate_downbeat_phase, track_beats
from .decode import DecodedAudio, decode_to_wav
from .separate import separate as separate_stems
from .features import (
    beat_boundaries,
    chroma,
    envelope,
    load_audio,
    onset_envelope,
    sync_to_beats,
)
from .key import estimate_key

PIPELINE_VERSION = "0.5.0-demucs"

BEATS_PER_BAR = 4
PEAKS_PER_SECOND = 25


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

    # --- 음원 분리 ---
    # 크로마는 보컬·드럼을 걷어낸 트랙에서 뽑고, 비트는 원본에서 잡는다.
    # 드럼을 지운 트랙으로 비트를 잡으면 오히려 박이 흐려진다.
    harmonic_path = decoded.path
    separated = False
    if separate:
        await progress(JobStage.SEPARATING, 0.0, "음원 분리 중 (보컬·드럼 제거)")
        try:
            stems = await separate_stems(audio.path, audio.id, device)
            harmonic = await decode_to_wav(stems.harmonic, f"{audio.id}.harmonic")
            harmonic_path = harmonic.path
            separated = True
            await progress(JobStage.SEPARATING, 1.0, f"{stems.model} 분리 완료")
        except Exception as exc:
            # 분리는 있으면 좋은 단계다. 실패해도 원본으로 계속 간다.
            await progress(JobStage.SEPARATING, 1.0, f"분리 건너뜀 ({exc})")

    # --- 비트 ---
    await progress(JobStage.BEATS, 0.0, "비트·마디 분석 중")
    buffer = await asyncio.to_thread(load_audio, decoded.path)
    onset_env = await asyncio.to_thread(onset_envelope, buffer)
    grid = await asyncio.to_thread(track_beats, buffer, onset_env)
    await progress(JobStage.BEATS, 0.5, f"{grid.bpm:.1f} BPM · 비트 {len(grid.times)}개")

    # --- 크로마 ---
    # 이미 드럼을 걷어냈으면 HPSS를 한 번 더 걸 필요가 없다
    chroma_buffer = (
        buffer if harmonic_path == decoded.path
        else await asyncio.to_thread(load_audio, harmonic_path)
    )
    frame_chroma = await asyncio.to_thread(chroma, chroma_buffer, hpss=not separated)
    beat_chroma = sync_to_beats(frame_chroma, grid.frames)
    # 0번 열은 첫 비트 이전 구간이라 마디 위상 추정에서 제외한다.
    grid.downbeat_phase = estimate_downbeat_phase(
        beat_chroma[:, 1:], onset_env, grid.frames, BEATS_PER_BAR
    )
    await progress(JobStage.BEATS, 1.0, f"다운비트 위상 {grid.downbeat_phase}")

    # --- 코드 ---
    await progress(JobStage.CHORDS, 0.0, "코드 인식 중")
    segments = await asyncio.to_thread(
        chord_rec.recognize, beat_chroma, beat_boundaries(grid.times), decoded.duration
    )
    await progress(JobStage.CHORDS, 1.0, f"코드 구간 {len(segments)}개")

    # --- 후처리 ---
    await progress(JobStage.POSTPROCESS, 0.0, "보정 중")
    beat_period = 60.0 / grid.bpm if grid.bpm > 0 else 0.5
    segments = chord_rec.merge_short_segments(segments, min_duration=beat_period * 0.9)
    key_name, _ = estimate_key(frame_chroma)
    peaks = await asyncio.to_thread(envelope, buffer, PEAKS_PER_SECOND)
    await progress(JobStage.POSTPROCESS, 1.0, f"{key_name or '조성 미상'} · 코드 {len(segments)}개")

    # 종료(DONE/FAILED) 이벤트는 JobManager가 result_id와 함께 발행한다.
    # 여기서 DONE을 쏘면 클라이언트가 result_id 없는 완료 이벤트를 먼저 받는다.
    return _build_result(
        audio=audio,
        decoded=decoded,
        grid=grid,
        segments=segments,
        key_name=key_name,
        peaks=peaks,
        separated=separated,
        device=device,
        elapsed=time.perf_counter() - started,
    )


def _build_result(
    *,
    audio: FetchedAudio,
    decoded: DecodedAudio,
    grid,
    segments: list[chord_rec.ChordSegment],
    key_name: str,
    peaks: list[float],
    separated: bool,
    device: str,
    elapsed: float,
) -> AnalysisResult:
    beats = [
        Beat(t=round(float(t), 3), beat=position, bar=bar)
        for t, (bar, position) in zip(grid.times, grid.positions())
    ]

    chord_list = [
        Chord(
            start=round(s.start, 3),
            end=round(s.end, 3),
            label=s.label,
            root=s.root,  # type: ignore[arg-type]
            quality=s.quality,  # type: ignore[arg-type]
            confidence=round(min(max(s.confidence, 0.0), 1.0), 3),
        )
        for s in segments
    ]

    # 전체 신뢰도는 길이로 가중한 평균. 짧은 파편이 점수를 좌우하지 않게 한다.
    if chord_list:
        weights = np.array([c.end - c.start for c in chord_list])
        scores = np.array([c.confidence for c in chord_list])
        overall = float(np.sum(weights * scores) / max(float(np.sum(weights)), 1e-9))
    else:
        overall = 0.0

    return AnalysisResult(
        id=audio.id,
        source=audio.kind,
        title=audio.title,
        duration=decoded.duration,
        bpm=round(float(grid.bpm), 2),
        time_signature=f"{BEATS_PER_BAR}/4",
        key=key_name,
        beats=beats,
        chords=chord_list,
        peaks=peaks,
        peaks_per_second=PEAKS_PER_SECOND,
        confidence=round(min(max(overall, 0.0), 1.0), 3),
        meta=AnalysisMeta(
            pipeline_version=PIPELINE_VERSION,
            separated=separated,
            beat_model=BEAT_MODEL,
            chord_model=chord_rec.CHORD_MODEL,
            device=device,
            elapsed_sec=round(elapsed, 3),
        ),
    )
