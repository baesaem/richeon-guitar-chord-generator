"""Demucs 음원 분리.

보컬과 드럼을 걷어내면 크로마에 화성 성분만 남아 코드 인식이 크게 좋아진다.
베이스 스템은 따로 남겨 근음 판단에 쓴다 — 슬래시 코드와 근음 혼동을 줄이는 근거가 된다.

분리는 이 파이프라인에서 가장 느린 단계라 결과를 반드시 캐시한다.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from ..config import settings

MODEL_NAME = "htdemucs"

# 화성 판단에 쓸 스템. 보컬·드럼은 뺀다.
HARMONIC_STEMS = ("other", "bass")


@dataclass
class SeparatedStems:
    """분리 결과 경로. 둘 다 원본과 같은 샘플레이트의 wav."""

    harmonic: Path   # other + bass 를 합친 것. 크로마 입력
    bass: Path       # 베이스만. 근음 판단용
    model: str


def _paths(audio_id: str) -> tuple[Path, Path]:
    return (
        settings.audio_dir / f"{audio_id}.harmonic.wav",
        settings.audio_dir / f"{audio_id}.bass.wav",
    )


def cached(audio_id: str, source: Path) -> SeparatedStems | None:
    """이미 분리해 둔 결과가 있으면 그대로 쓴다."""
    harmonic, bass = _paths(audio_id)
    if not (harmonic.exists() and bass.exists()):
        return None
    # 원본이 더 새로우면 다시 분리한다
    if min(harmonic.stat().st_mtime, bass.stat().st_mtime) < source.stat().st_mtime:
        return None
    return SeparatedStems(harmonic=harmonic, bass=bass, model=MODEL_NAME)


def _separate_blocking(source: Path, audio_id: str, device: str) -> SeparatedStems:
    import torch
    from demucs.api import Separator, save_audio

    separator = Separator(model=MODEL_NAME, device=device, progress=False)
    _, stems = separator.separate_audio_file(source)

    harmonic_path, bass_path = _paths(audio_id)

    mix = None
    for name in HARMONIC_STEMS:
        stem = stems.get(name)
        if stem is None:
            continue
        mix = stem.clone() if mix is None else mix + stem

    if mix is None:
        raise RuntimeError(f"{MODEL_NAME}가 예상한 스템을 내놓지 않았습니다: {list(stems)}")

    # 합치면 진폭이 1을 넘을 수 있어 클리핑 방지로 정규화한다
    peak = float(mix.abs().max())
    if peak > 1.0:
        mix = mix / peak

    save_audio(mix, str(harmonic_path), samplerate=separator.samplerate)
    save_audio(
        stems.get("bass", torch.zeros_like(mix)),
        str(bass_path),
        samplerate=separator.samplerate,
    )

    return SeparatedStems(harmonic=harmonic_path, bass=bass_path, model=MODEL_NAME)


async def separate(source: Path, audio_id: str, device: str) -> SeparatedStems:
    """보컬·드럼을 걷어낸 화성 트랙과 베이스 트랙을 만든다."""
    existing = cached(audio_id, source)
    if existing is not None:
        return existing

    return await asyncio.to_thread(_separate_blocking, source, audio_id, device)
