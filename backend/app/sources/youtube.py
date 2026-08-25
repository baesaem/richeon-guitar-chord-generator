from __future__ import annotations

import asyncio
import re
from pathlib import Path

from ..config import settings
from ..schemas import JobStage, SourceKind
from .base import AudioSource, FetchedAudio, ProgressFn

_ID_PATTERNS = [
    re.compile(r"(?:v=|/shorts/|/embed/|youtu\.be/)([A-Za-z0-9_-]{11})"),
    re.compile(r"^([A-Za-z0-9_-]{11})$"),
]


class YouTubeUnavailable(RuntimeError):
    """ENABLE_YOUTUBE=false 이거나 yt-dlp 추출이 실패한 경우."""


def extract_video_id(url: str) -> str:
    for pat in _ID_PATTERNS:
        if m := pat.search(url.strip()):
            return m.group(1)
    raise ValueError(f"YouTube 영상 ID를 찾을 수 없습니다: {url}")


class YouTubeSource(AudioSource):
    def __init__(self, url: str) -> None:
        if not settings.enable_youtube:
            raise YouTubeUnavailable(
                "이 서버는 업로드 전용 모드입니다. 오디오 파일을 직접 올려주세요."
            )
        self.url = url
        self.video_id = extract_video_id(url)

    async def fetch(self, progress: ProgressFn) -> FetchedAudio:
        cached = self._find_cached()
        if cached:
            await progress(JobStage.FETCHING, 1.0, "캐시된 오디오 사용")
            return await self._probe(cached)

        await progress(JobStage.FETCHING, 0.0, "YouTube 오디오 추출 중")
        # yt-dlp는 동기 API이므로 워커 스레드에서 돌린다.
        # 진행률 훅이 스레드에서 코루틴을 호출해야 하므로 루프를 미리 잡아 넘긴다.
        loop = asyncio.get_running_loop()
        return await asyncio.to_thread(self._download_blocking, progress, loop)

    def _find_cached(self) -> Path | None:
        for p in settings.audio_dir.glob(f"{self.video_id}.*"):
            if p.suffix != ".json":
                return p
        return None

    def _download_blocking(
        self, progress: ProgressFn, loop: asyncio.AbstractEventLoop
    ) -> FetchedAudio:
        import yt_dlp

        def hook(d: dict) -> None:
            if d.get("status") != "downloading":
                return
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                asyncio.run_coroutine_threadsafe(
                    progress(JobStage.FETCHING, done / total, "YouTube 오디오 추출 중"),
                    loop,
                )

        opts = {
            "format": "bestaudio/best",
            "outtmpl": str(settings.audio_dir / "%(id)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "progress_hooks": [hook],
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(self.url, download=True)
        except Exception as exc:  # yt-dlp는 YouTube 사양 변경으로 종종 깨진다
            raise YouTubeUnavailable(
                f"YouTube 추출 실패({exc}). `uv run pip install -U yt-dlp` 후 재시도하거나, "
                f"오디오 파일을 직접 업로드해 주세요."
            ) from exc

        path = Path(info["requested_downloads"][0]["filepath"])
        return FetchedAudio(
            id=self.video_id,
            kind=SourceKind.YOUTUBE,
            path=path,
            title=info.get("title", ""),
            duration=float(info.get("duration") or 0.0),
        )

    async def _probe(self, path: Path) -> FetchedAudio:
        return FetchedAudio(
            id=self.video_id,
            kind=SourceKind.YOUTUBE,
            path=path,
            title="",
            duration=0.0,
        )
