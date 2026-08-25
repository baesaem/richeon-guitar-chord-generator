from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse

from .analysis.decode import ffmpeg_available
from .analysis.pipeline import PIPELINE_VERSION, resolve_device
from .config import settings
from .jobs import load_result, manager, result_path, save_result
from .schemas import AnalysisResult, AnalyzeRequest, Chord, ResultSummary
from .sources import UploadSource, YouTubeSource
from .sources.youtube import YouTubeUnavailable

app = FastAPI(title="리천 기타 코드 자동생성기 API", version=PIPELINE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _guard_id(result_id: str) -> None:
    """경로 조작 차단. id는 videoId 또는 파일 해시라 구분자가 들어갈 일이 없다."""
    if "/" in result_id or "\\" in result_id or ".." in result_id:
        raise HTTPException(400, "잘못된 id입니다")


@app.get("/api/health")
async def health() -> dict:
    """프론트가 기동 시 호출. youtube_enabled로 URL 입력창 노출 여부를 결정한다."""
    ffmpeg_ok = ffmpeg_available()
    return {
        "ok": ffmpeg_ok,
        "youtube_enabled": settings.enable_youtube,
        "ffmpeg": ffmpeg_ok,
        "device": resolve_device(),
        "pipeline_version": PIPELINE_VERSION,
    }


@app.post("/api/analyze")
async def analyze_url(req: AnalyzeRequest) -> dict:
    if not req.url:
        raise HTTPException(400, "url이 필요합니다")
    try:
        source = YouTubeSource(req.url)
    except YouTubeUnavailable as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    job_id = manager.submit(source, separate=req.separate, force=req.force)
    return {"job_id": job_id}


@app.post("/api/analyze/upload")
async def analyze_upload(
    file: UploadFile = File(...),
    separate: bool = Form(True),
    force: bool = Form(False),
) -> dict:
    suffix = Path(file.filename or "audio").suffix
    # 캐시 디렉터리 안에 임시파일을 만들어 같은 볼륨에서 rename이 일어나게 한다.
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, dir=settings.audio_dir
    ) as tmp:
        while chunk := await file.read(1 << 20):
            tmp.write(chunk)
        tmp_path = Path(tmp.name)

    source = UploadSource(tmp_path, file.filename or "audio")
    job_id = manager.submit(source, separate=separate, force=force)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
async def job_status(job_id: str) -> dict:
    status = manager.get(job_id)
    if status is None:
        raise HTTPException(404, "잡을 찾을 수 없습니다")
    return status.model_dump()


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str) -> EventSourceResponse:
    if manager.get(job_id) is None:
        raise HTTPException(404, "잡을 찾을 수 없습니다")

    async def gen():
        async for status in manager.stream(job_id):
            yield {"event": "status", "data": json.dumps(status.model_dump())}

    return EventSourceResponse(gen())


@app.get("/api/results")
async def list_results() -> list[ResultSummary]:
    """분석해 둔 곡 목록. 최근 분석 순."""
    summaries: list[ResultSummary] = []
    for path in settings.result_dir.glob("*.json"):
        result = load_result(path.stem)
        if result is None:
            continue  # 스키마·버전이 안 맞는 옛 캐시는 목록에 올리지 않는다
        summaries.append(
            ResultSummary(
                id=result.id,
                source=result.source,
                title=result.title,
                duration=result.duration,
                bpm=result.bpm,
                key=result.key,
                chord_count=len(result.chords),
                pipeline_version=result.meta.pipeline_version,
                analyzed_at=path.stat().st_mtime,
            )
        )

    summaries.sort(key=lambda s: s.analyzed_at, reverse=True)
    return summaries


@app.delete("/api/results/{result_id}")
async def delete_result(result_id: str) -> dict:
    """분석 결과만 지운다. 원본·디코딩 오디오는 남아 재분석이 빠르다."""
    _guard_id(result_id)

    path = result_path(result_id)
    if not path.exists():
        raise HTTPException(404, "분석 결과가 없습니다")
    path.unlink()
    return {"deleted": result_id}


@app.get("/api/audio/{result_id}")
async def get_audio(result_id: str) -> FileResponse:
    """업로드한 곡을 브라우저에서 재생하기 위한 원본 스트리밍.

    YouTube 결과는 IFrame 플레이어로 재생하므로 이 경로를 쓰지 않는다.
    """
    _guard_id(result_id)

    for path in sorted(settings.audio_dir.glob(f"{result_id}.*")):
        rest = path.name[len(result_id) + 1 :]
        if "." in rest:  # 디코딩 산출물(.22050.wav)과 사이드카(.info.json) 제외
            continue
        return FileResponse(path)

    raise HTTPException(404, "오디오를 찾을 수 없습니다")


@app.get("/api/results/{result_id}")
async def get_result(result_id: str) -> AnalysisResult:
    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    return result


@app.put("/api/results/{result_id}/chords")
async def edit_chords(result_id: str, chords: list[Chord]) -> AnalysisResult:
    """수동 코드 보정 저장 (M6). 오인식을 사용자가 직접 고친다."""
    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    result.chords = chords
    save_result(result)
    return result
