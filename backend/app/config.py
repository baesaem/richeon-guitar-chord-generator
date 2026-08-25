from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- C안 핵심 스위치 ---
    # 로컬(내 PC)에서는 true. 외부에 배포할 경우 false로 두면 업로드 전용(B안)으로 동작한다.
    enable_youtube: bool = True

    # 폰에서 접속하려면 0.0.0.0 유지 + 방화벽에서 8000/3000 허용
    host: str = "0.0.0.0"
    port: int = 8000

    audio_dir: Path = BASE_DIR / "cache" / "audio"
    result_dir: Path = BASE_DIR / "cache" / "results"

    # A안(로컬 전용)의 이점: 원본 wav를 남겨두면 재분석 시 다운로드를 건너뛴다.
    keep_audio_cache: bool = True

    # 분석 파라미터
    sample_rate: int = 22050
    device: str = "auto"  # auto | cuda | cpu

    # 프론트 개발 서버
    cors_origins: list[str] = ["*"]

    def ensure_dirs(self) -> None:
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.result_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
