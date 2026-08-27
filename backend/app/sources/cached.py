"""이미 받아 둔 오디오를 그대로 다시 쓰는 입력.

재분석에 쓴다. 파이프라인만 다시 돌리면 되는 경우 — 후처리를 고쳤다든지,
파이프라인 판이 올라갔다든지 — 음원을 다시 받을 이유가 없다. YouTube는
받는 데 시간이 걸리고, 업로드 곡은 애초에 다시 받을 곳도 없다.
"""

from __future__ import annotations

from pathlib import Path

from ..config import settings
from ..schemas import JobStage, SourceKind
from .base import AudioSource, FetchedAudio, ProgressFn, load_sidecar, save_sidecar


def find_source_audio(audio_id: str) -> Path | None:
    """받아 둔 원본. 디코딩 산출물(`{id}.22050.wav`)과 사이드카는 건너뛴다."""
    for path in sorted(settings.audio_dir.glob(f"{audio_id}.*")):
        rest = path.name[len(audio_id) + 1 :]
        if "." in rest:  # 점이 더 있으면 파생 파일
            continue
        return path
    return None


class CachedSource(AudioSource):
    """캐시에 있는 음원 파일 하나를 감싼다."""

    def __init__(
        self, audio_id: str, kind: SourceKind, path: Path, title: str = ""
    ) -> None:
        self.audio_id = audio_id
        self.kind = kind
        self.path = path
        # 사이드카가 없거나 비어 있을 때 쓸 제목. 옛 결과에서 받아 온다 —
        # 없으면 제목 자리에 캐시 키가 나와 목록에서 곡을 알아볼 수 없다.
        self.title = title

    async def fetch(self, progress: ProgressFn) -> FetchedAudio:
        await progress(JobStage.FETCHING, 1.0, "받아 둔 음원 사용")
        title, duration = load_sidecar(self.audio_id)
        if not title and self.title:
            # 사이드카에 제목이 없으면 지금 아는 제목을 적어 둔다.
            # 다음 재분석에서 또 잃어버리지 않는다.
            save_sidecar(self.audio_id, self.title, duration)
        return FetchedAudio(
            id=self.audio_id,
            kind=self.kind,
            path=self.path,
            title=title or self.title,
            duration=duration,
        )
