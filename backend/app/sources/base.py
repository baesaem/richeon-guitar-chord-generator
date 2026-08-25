"""오디오 입력 추상화.

C안(하이브리드)의 핵심. YouTube와 업로드가 이 인터페이스 뒤에 숨으므로
분석 파이프라인은 오디오가 어디서 왔는지 알 필요가 없다.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

from ..config import settings
from ..schemas import JobStage, SourceKind

ProgressFn = Callable[[JobStage, float, str], Awaitable[None]]


@dataclass
class FetchedAudio:
    """분석 파이프라인이 받는 유일한 입력 형태."""

    id: str          # 캐시 키 (videoId 또는 파일 해시)
    kind: SourceKind
    path: Path       # 디코드 전 원본 (m4a/webm/mp3/wav)
    title: str
    duration: float


class AudioSource(ABC):
    @abstractmethod
    async def fetch(self, progress: ProgressFn) -> FetchedAudio: ...


# --- 사이드카 메타데이터 ---
# 원본 오디오를 캐시하면 다음 요청에서 yt-dlp를 다시 부르지 않는데,
# 그러면 제목·길이를 알 수 없다. 최초 1회만 옆에 작게 적어 둔다.

def sidecar_path(audio_id: str) -> Path:
    return settings.audio_dir / f"{audio_id}.info.json"


def save_sidecar(audio_id: str, title: str, duration: float) -> None:
    sidecar_path(audio_id).write_text(
        json.dumps({"title": title, "duration": duration}, ensure_ascii=False),
        encoding="utf-8",
    )


def load_sidecar(audio_id: str) -> tuple[str, float]:
    path = sidecar_path(audio_id)
    if not path.exists():
        return "", 0.0
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return str(data.get("title", "")), float(data.get("duration", 0.0))
    except (ValueError, OSError):
        return "", 0.0
