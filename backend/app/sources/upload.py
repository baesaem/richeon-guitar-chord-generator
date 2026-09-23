from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from ..config import settings
from ..schemas import JobStage, SourceKind
from .base import AudioSource, FetchedAudio, ProgressFn, save_sidecar

# 소리 파일과 **동영상**(강사님: 「동영상으로 음원 등록 — 다른 포맷도」). 디코딩은 ffmpeg가
# 영상 스트림을 버리고(-vn) 소리만 뽑으므로 컨테이너는 가리지 않는다
ALLOWED_SUFFIXES = {
    ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".wma", ".webm",
    ".mp4", ".m4v", ".mov", ".mkv", ".avi", ".wmv", ".flv", ".3gp", ".ts", ".mts",
    ".mpg", ".mpeg",
}


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

        title = Path(self.original_name).stem
        save_sidecar(digest, title, 0.0)  # 정확한 길이는 디코딩 단계에서 채운다

        await progress(JobStage.FETCHING, 1.0, "업로드 완료")
        return FetchedAudio(
            id=digest,
            kind=SourceKind.UPLOAD,
            path=dest,
            title=title,
            duration=0.0,
        )
