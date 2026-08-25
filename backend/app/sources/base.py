"""오디오 입력 추상화.

C안(하이브리드)의 핵심. YouTube와 업로드가 이 인터페이스 뒤에 숨으므로
분석 파이프라인은 오디오가 어디서 왔는지 알 필요가 없다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

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
