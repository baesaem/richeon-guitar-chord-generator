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

# 반주(보컬 빼고 전부). 노래를 지우고 연주만 듣고 싶을 때 쓴다.
INSTRUMENTAL_STEMS = ("drums", "bass", "other")


@dataclass
class SeparatedStems:
    """분리 결과 경로. 모두 원본과 같은 샘플레이트의 wav."""

    harmonic: Path       # other + bass 를 합친 것. 크로마 입력
    bass: Path           # 베이스만. 근음 판단용
    instrumental: Path   # 보컬만 뺀 것. 재생용
    vocals: Path         # 보컬만. 멜로디 채보용
    model: str


def _paths(audio_id: str) -> tuple[Path, Path, Path, Path]:
    return (
        settings.audio_dir / f"{audio_id}.harmonic.wav",
        settings.audio_dir / f"{audio_id}.bass.wav",
        settings.audio_dir / f"{audio_id}.instrumental.wav",
        settings.audio_dir / f"{audio_id}.vocals.wav",
    )


def instrumental_path(audio_id: str) -> Path:
    """반주 트랙 경로. 재생 API가 존재 여부를 확인할 때 쓴다."""
    return _paths(audio_id)[2]


def vocals_path(audio_id: str) -> Path:
    """보컬 트랙 경로. 멜로디 채보가 쓴다."""
    return _paths(audio_id)[3]


def cached(audio_id: str, source: Path) -> SeparatedStems | None:
    """이미 분리해 둔 결과가 있으면 그대로 쓴다."""
    paths = _paths(audio_id)
    if not all(p.exists() for p in paths):
        return None
    # 원본이 더 새로우면 다시 분리한다
    if min(p.stat().st_mtime for p in paths) < source.stat().st_mtime:
        return None
    harmonic, bass, instrumental, vocals = paths
    return SeparatedStems(
        harmonic=harmonic,
        bass=bass,
        instrumental=instrumental,
        vocals=vocals,
        model=MODEL_NAME,
    )


def _mix(stems: dict, names: tuple[str, ...]):
    """스템 몇 개를 합치고 클리핑을 막는다. 합치면 진폭이 1을 넘을 수 있다."""
    out = None
    for name in names:
        stem = stems.get(name)
        if stem is None:
            continue
        out = stem.clone() if out is None else out + stem
    if out is None:
        raise RuntimeError(f"{MODEL_NAME}가 예상한 스템을 내놓지 않았습니다: {list(stems)}")

    peak = float(out.abs().max())
    return out / peak if peak > 1.0 else out


def _separate_blocking(source: Path, audio_id: str, device: str) -> SeparatedStems:
    import torch
    from demucs.api import Separator, save_audio

    separator = Separator(model=MODEL_NAME, device=device, progress=False)
    _, stems = separator.separate_audio_file(source)

    harmonic_path, bass_path, instrumental_path, vocals_path = _paths(audio_id)
    harmonic = _mix(stems, HARMONIC_STEMS)

    save_audio(harmonic, str(harmonic_path), samplerate=separator.samplerate)
    save_audio(
        stems.get("bass", torch.zeros_like(harmonic)),
        str(bass_path),
        samplerate=separator.samplerate,
    )
    # 재생용 반주와 채보용 보컬. 분리는 이미 끝났으니 저장 비용만 든다.
    save_audio(
        _mix(stems, INSTRUMENTAL_STEMS),
        str(instrumental_path),
        samplerate=separator.samplerate,
    )
    save_audio(
        stems.get("vocals", torch.zeros_like(harmonic)),
        str(vocals_path),
        samplerate=separator.samplerate,
    )

    return SeparatedStems(
        harmonic=harmonic_path,
        bass=bass_path,
        instrumental=instrumental_path,
        vocals=vocals_path,
        model=MODEL_NAME,
    )


async def separate(source: Path, audio_id: str, device: str) -> SeparatedStems:
    """보컬·드럼을 걷어낸 화성 트랙과 베이스 트랙을 만든다."""
    existing = cached(audio_id, source)
    if existing is not None:
        return existing

    return await asyncio.to_thread(_separate_blocking, source, audio_id, device)
