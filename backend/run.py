"""개발 서버 실행: uv run python run.py"""

import sys
from pathlib import Path

import uvicorn

# OneDrive 동기화 폴더에서는 .pyc 캐시가 소스 변경을 못 따라가는 경우가 있어
# 개발 중에는 바이트코드 캐시를 쓰지 않는다.
sys.dont_write_bytecode = True

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        # 실행 위치가 어디든 backend/app을 감시하도록 절대 경로로 준다
        reload_dirs=[str(Path(__file__).resolve().parent / "app")],
    )
