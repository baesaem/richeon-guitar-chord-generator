from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from ..config import settings
from ..schemas import JobStage, SourceKind
from .base import AudioSource, FetchedAudio, ProgressFn

ALLOWED_SUFFIXES = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".webm"}


class UploadSource(AudioSource):
    """이미 디스크에 저장된 업로드 파일을 감싼다."""

    def __init__(self, tmp_path: Path, original_name: str) -> None:
        self.tmp_path = tmp_path
        self.original_name = original_name

    async def fetch(self, progress: ProgressFn) -> FetchedAudio:
        await progress(JobStage.FETCHING, 0.5, "업로드 파일 확인 중")

        suffix = Path(self.original_name).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise ValueError(f"지원하지 않는 형식입니다: {suffix}")

        digest = hashlib.sha1(self.tmp_path.read_bytes()).hexdigest()[:16]
        dest = settings.audio_dir / f"{digest}{suffix}"
        if not dest.exists():
            # Path.replace()는 드라이브가 다르면 WinError 17로 실패한다 (C:\Temp → D:\...).
            shutil.move(str(self.tmp_path), str(dest))
        else:
            self.tmp_path.unlink(missing_ok=True)

        await progress(JobStage.FETCHING, 1.0, "업로드 완료")
        return FetchedAudio(
            id=digest,
            kind=SourceKind.UPLOAD,
            path=dest,
            title=Path(self.original_name).stem,
            duration=0.0,
        )
