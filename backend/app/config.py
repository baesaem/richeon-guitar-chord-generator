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

    # OneDrive 동기화 폴더에서는 watchfiles가 변경을 놓쳐 옛 코드가 계속 돈다.
    # 기본은 꺼두고, 필요할 때만 RELOAD=true로 켠다.
    reload: bool = False

    audio_dir: Path = BASE_DIR / "cache" / "audio"
    result_dir: Path = BASE_DIR / "cache" / "results"

    # A안(로컬 전용)의 이점: 원본 wav를 남겨두면 재분석 시 다운로드를 건너뛴다.
    keep_audio_cache: bool = True

    # 분석 파라미터
    sample_rate: int = 22050
    device: str = "auto"  # auto | cuda | cpu

    # 프론트 개발 서버
    cors_origins: list[str] = ["*"]

    # 강상기타반 공유 재생목록(구글드라이브 공개 폴더).
    # 여기 올려 둔 .rml 파일을 앱에서 바로 내려받아 기기에 저장한다.
    shared_folder_id: str = "1hEKM-s_pNLuw7W2e2YsPNveE6qoQq-Nd"

    # --- LLM (선택) ---
    # 영상 제목에서 가수·곡명을 가려내고 로마자 표기를 만드는 데만 쓴다.
    # 오디오 분석에는 쓰지 않는다(재 봤더니 조성·템포를 틀리게 답했다).
    # 키를 비워 두면 이 기능만 조용히 꺼지고 나머지는 그대로 돈다.
    # OpenAI 외에 호환 API(로컬 모델 포함)도 base_url만 바꾸면 된다.
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-5.4-mini"
    llm_timeout: float = 20.0

    def ensure_dirs(self) -> None:
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.result_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
