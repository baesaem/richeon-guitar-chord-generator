"""ffmpeg 디코딩.

yt-dlp가 받아온 m4a/webm, 사용자가 올린 mp3 등을 분석용 모노 wav로 통일한다.
이후 단계(비트·크로마·코드)는 전부 이 wav 하나만 본다.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from ..config import settings


class FFmpegMissing(RuntimeError):
    pass


@dataclass
class DecodedAudio:
    path: Path
    sample_rate: int
    duration: float


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


# uvicorn이 Windows에서 SelectorEventLoop을 쓰면 asyncio.create_subprocess_exec이
# NotImplementedError를 낸다. 워커 스레드에서 동기 subprocess를 돌려 우회한다.
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _run_blocking(args: tuple[str, ...]) -> tuple[int, bytes, bytes]:
    proc = subprocess.run(args, capture_output=True, creationflags=_NO_WINDOW)
    return proc.returncode, proc.stdout, proc.stderr


async def _run(*args: str) -> tuple[int, bytes, bytes]:
    return await asyncio.to_thread(_run_blocking, args)


async def probe_duration(path: Path) -> float:
    code, out, err = await _run(
        "ffprobe",
        "-v", "error",
        "-print_format", "json",
        "-show_entries", "format=duration",
        str(path),
    )
    if code != 0:
        raise RuntimeError(f"ffprobe 실패: {err.decode('utf-8', 'replace')[:300]}")
    try:
        return float(json.loads(out)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return 0.0


def decoded_path(audio_id: str, sample_rate: int) -> Path:
    return settings.audio_dir / f"{audio_id}.{sample_rate}.wav"


async def decode_to_wav(
    src: Path, audio_id: str, *, sample_rate: int | None = None
) -> DecodedAudio:
    """모노 16bit PCM wav로 디코딩. 이미 디코딩된 결과가 있으면 재사용한다."""
    if not ffmpeg_available():
        raise FFmpegMissing("ffmpeg / ffprobe를 PATH에서 찾을 수 없습니다")

    sr = sample_rate or settings.sample_rate
    dest = decoded_path(audio_id, sr)

    if dest.exists() and dest.stat().st_size > 44 and dest.stat().st_mtime >= src.stat().st_mtime:
        return DecodedAudio(dest, sr, await probe_duration(dest))

    tmp = dest.with_suffix(".partial.wav")
    code, _, err = await _run(
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(src),
        "-vn",              # 영상 스트림 제거
        "-ac", "1",         # 모노
        "-ar", str(sr),
        "-acodec", "pcm_s16le",
        str(tmp),
    )
    if code != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg 디코딩 실패: {err.decode('utf-8', 'replace')[:300]}")

    tmp.replace(dest)
    return DecodedAudio(dest, sr, await probe_duration(dest))
