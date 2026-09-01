from __future__ import annotations

import asyncio
import json
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from sse_starlette.sse import EventSourceResponse

from .analysis.decode import encode_mp3, ffmpeg_available
from .analysis.pipeline import PIPELINE_VERSION, resolve_device
from .analysis.separate import instrumental_path, separate, vocals_path
from .config import settings
from . import beats_even
from .jobs import load_result, manager, result_path, save_result
from .lyrics import (
    fetch_lyrics_blocking,
    fetch_youtube_captions,
    polish_captions,
    sync_to_song,
)
from . import (
    attachments,
    drive_upload,
    llm,
    score_align,
    score_file,
    sheet_layout,
    sheet_read,
    sheet_score,
    tab_image,
)
from .llm import pick_model, rank_models
from .runtime_config import llm_config, mask, save_llm_config
from .sheets import clean_query, search as search_sheets
from .schemas import (
    AnalysisResult,
    AnalyzeRequest,
    ReanalyzeRequest,
    Beat,
    Chord,
    LlmSettings,
    LyricLine,
    ResultSummary,
    SourceKind,
)
from .shared_drive import download_shared, list_shared
from .sources import UploadSource, YouTubeSource
from .sources.base import AudioSource
from .sources.cached import CachedSource, find_source_audio
from .sources.youtube import YouTubeUnavailable

app = FastAPI(title="리천 기타 코드 자동 생성기 API", version=PIPELINE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PrivateNetwork:
    """https 화면이 이 PC의 서버를 부를 수 있게 한다.

    크롬은 바깥 https 쪽(gita.richeon.kr)에서 집 안 주소(127.0.0.1)를
    부를 때 먼저 「사설망에 물어도 되느냐」고 예비 질문을 보낸다
    (Access-Control-Request-Private-Network). 서버가 「그러라」고
    답하지 않으면 요청 자체를 막는다 — 설치한 앱이 「분석 서버에
    연결되지 않았습니다」라고 한 것이 이것이다.

    스탈렛의 CORS는 이 예비 질문을 모르고 400으로 되받는다. 그래서
    가장 바깥에서 우리가 먼저 받아 답한다. 여는 것은 이 PC의 서버뿐이고,
    무엇을 열지는 아래 CORS가 그대로 가린다.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "OPTIONS":
            await self.app(scope, receive, send)
            return
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        if headers.get("access-control-request-private-network") != "true":
            await self.app(scope, receive, send)
            return

        origin = headers.get("origin", "*")
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    (b"access-control-allow-origin", origin.encode()),
                    (b"access-control-allow-methods", b"*"),
                    (b"access-control-allow-headers", b"*"),
                    (b"access-control-allow-private-network", b"true"),
                    (b"access-control-max-age", b"600"),
                    (b"content-length", b"0"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": b""})


# CORS보다 뒤에 얹어야 바깥에서 먼저 받는다
app.add_middleware(PrivateNetwork)


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


# ---- 구글 드라이브에 바로 올리기 (관리자 PC에서만 쓴다) ----

@app.get("/api/drive/status")
async def drive_status() -> dict:
    """드라이브에 연결돼 있는가. 화면이 「연결」과 「올리기」를 가른다."""
    return {"connected": drive_upload.connected()}


@app.post("/api/drive/connect")
async def drive_connect() -> dict:
    """동의 화면 주소를 만들어 준다. 앱이 이 주소를 열면 된다."""
    try:
        url = await asyncio.to_thread(drive_upload.start_consent)
    except drive_upload.DriveError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"url": url}


@app.post("/api/drive/connect/wait")
async def drive_connect_wait() -> dict:
    """동의가 끝나기를 기다렸다가 토큰을 저장한다."""
    try:
        await asyncio.to_thread(drive_upload.wait_consent)
    except drive_upload.DriveError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"connected": True}


@app.delete("/api/drive/connect")
async def drive_disconnect() -> dict:
    await asyncio.to_thread(drive_upload.disconnect)
    return {"connected": False}


def _part_path(session: str) -> Path:
    """나누어 받는 파일을 모으는 자리."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,64}", session):
        raise HTTPException(400, "올리기 표가 올바르지 않습니다")
    path = settings.result_dir.parent / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path / f"{session}.part"


#: 나누어 받아도 이보다 큰 것은 받지 않는다. 곡 하나가 이만큼 되면
#: 무언가 잘못된 것이다(반주가 wav로 남아 있다든지).
_UPLOAD_MAX_BYTES = 200 * 1024 * 1024


@app.post("/api/drive/upload")
async def drive_put(
    folder: str = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
    session: str = Form(""),
    index: int = Form(0),
    count: int = Form(1),
) -> dict:
    """공유 폴더에 파일을 올린다. 같은 이름이 있으면 갈아 끼운다.

    큰 파일은 토막으로 나뉘어 온다. 개발 서버(:3000)가 백엔드로 넘겨
    주는 길에 10MB를 넘기지 못해서다 — 곡 하나가 15MB쯤 되므로 그냥
    보내면 서버에 닿지도 못하고 끊긴다. 토막을 이어 붙였다가 마지막
    토막이 오면 한 번에 올린다.
    """
    data = await file.read()
    mime = file.content_type or "application/octet-stream"

    if count > 1:
        part = _part_path(session)
        if index == 0:
            part.unlink(missing_ok=True)
        elif not part.exists():
            raise HTTPException(400, "앞 토막이 없습니다. 처음부터 다시 올려 주세요")
        with part.open("ab") as fh:
            fh.write(data)
        if part.stat().st_size > _UPLOAD_MAX_BYTES:
            part.unlink(missing_ok=True)
            raise HTTPException(413, "파일이 너무 큽니다")
        if index < count - 1:
            return {"partial": True, "received": index + 1, "of": count}
        data = part.read_bytes()
        part.unlink(missing_ok=True)

    try:
        return await asyncio.to_thread(
            drive_upload.upload, folder, name, data, mime
        )
    except drive_upload.DriveError as exc:
        raise HTTPException(400, str(exc)) from exc


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


@app.put("/api/results/{result_id}/title")
async def rename_result(result_id: str, body: dict) -> AnalysisResult:
    """곡 이름을 바꾼다. YouTube 제목은 대괄호·채널명 범벅이라 다듬게 둔다."""
    _guard_id(result_id)

    title = str(body.get("title", "")).strip()
    if not title:
        raise HTTPException(400, "이름이 비어 있습니다")
    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    result.title = title
    save_result(result)
    return result


@app.delete("/api/results/{result_id}")
async def delete_result(result_id: str) -> dict:
    """분석 결과만 지운다. 원본·디코딩 오디오는 남아 재분석이 빠르다."""
    _guard_id(result_id)

    path = result_path(result_id)
    if not path.exists():
        raise HTTPException(404, "분석 결과가 없습니다")
    path.unlink()
    return {"deleted": result_id}


# ---- 설정 (화면에서 바꾸는 값) ----

@app.get("/api/settings/llm")
async def get_llm_settings() -> dict:
    """가사 도우미 설정. 키는 가려서 보낸다."""
    cfg = llm_config()
    return {
        "configured": bool(cfg["api_key"]),
        "masked_key": mask(cfg["api_key"]),
        "base_url": cfg["base_url"],
        "model": cfg["model"],
    }


@app.put("/api/settings/llm")
async def put_llm_settings(body: LlmSettings) -> dict:
    """키·주소·모델을 저장한다. 빈 문자열을 보내면 지운다."""
    save_llm_config(
        api_key=body.api_key, base_url=body.base_url, model=body.model
    )
    return await get_llm_settings()


@app.post("/api/settings/llm/test")
async def test_llm_settings() -> dict:
    """저장된 키로 실제 호출해 본다. 쓸 수 있는 모델 목록도 함께 준다."""
    cfg = llm_config()
    if not cfg["api_key"]:
        raise HTTPException(400, "API 키가 없습니다")

    def probe() -> dict:
        import urllib.request

        req = urllib.request.Request(
            f"{cfg['base_url'].rstrip('/')}/models",
            headers={"Authorization": f"Bearer {cfg['api_key']}"},
        )
        with urllib.request.urlopen(req, timeout=settings.llm_timeout) as res:
            data = json.load(res)
        rows = data.get("data", [])
        return {
            "count": len(rows),
            "models": rank_models(rows),
            "all": [str(m.get("id", "")) for m in rows],
        }

    try:
        found = await asyncio.to_thread(probe)
    except Exception as exc:
        raise HTTPException(502, f"연결하지 못했습니다: {exc}") from exc

    chat = found["models"]
    recommended = pick_model(chat)
    ok = cfg["model"] in found["all"]
    return {
        "ok": True,
        "model_available": ok,
        "message": (
            f"연결됨 · 모델 {found['count']}개"
            + ("" if ok else f" · '{cfg['model']}'는 이 키로 쓸 수 없습니다")
        ),
        "models": chat[:40],
        "recommended": recommended,
    }


# 내가 가진 악보를 곡에 붙여 둔다. 이미지(png·jpg)와 PDF만 받는다.
_SHEET_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
_SHEET_MAX_BYTES = 20 * 1024 * 1024


def _sheet_dir():
    path = settings.result_dir.parent / "sheets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _my_sheet(result_id: str) -> Path | None:
    for path in sorted(_sheet_dir().glob(f"{result_id}.*")):
        return path
    return None


@app.head("/api/sheets/{result_id}/mine")
async def head_my_sheet(result_id: str) -> Response:
    """등록된 악보가 있는지만 확인한다.

    이 경로에 GET만 두었더니 화면의 확인 요청이 405로 튕겼고, 그래서
    악보를 등록해 둔 곡에도 「등록된 악보가 없습니다」가 떴다. 파일을
    통째로 내려받지 않고 있는지만 보는 길이 필요하다.
    """
    _guard_id(result_id)
    path = _my_sheet(result_id)
    if path is None:
        raise HTTPException(404, "등록된 악보가 없습니다")
    kind = "application/pdf" if path.suffix == ".pdf" else f"image/{path.suffix[1:]}"
    return Response(
        status_code=200,
        headers={"content-type": kind, "content-length": str(path.stat().st_size)},
    )


@app.get("/api/sheets/{result_id}/mine")
async def get_my_sheet(result_id: str) -> Response:
    """등록해 둔 악보. 없으면 404."""
    _guard_id(result_id)

    path = _my_sheet(result_id)
    if path is None:
        raise HTTPException(404, "등록된 악보가 없습니다")
    # PDF는 브라우저가 바로 펼쳐 보도록 inline으로 준다
    return FileResponse(path, content_disposition_type="inline")


@app.post("/api/sheets/{result_id}/mine")
async def put_my_sheet(result_id: str, file: UploadFile = File(...)) -> dict:
    """악보 파일을 곡에 붙인다. 한 곡에 하나만 둔다."""
    _guard_id(result_id)

    suffix = _SHEET_TYPES.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(400, "이미지(PNG·JPG·WEBP)나 PDF만 올릴 수 있습니다")

    data = await file.read(_SHEET_MAX_BYTES + 1)
    if len(data) > _SHEET_MAX_BYTES:
        raise HTTPException(413, "파일이 너무 큽니다 (20MB까지)")

    for old in _sheet_dir().glob(f"{result_id}.*"):
        old.unlink(missing_ok=True)
    (_sheet_dir() / f"{result_id}{suffix}").write_bytes(data)
    return {"ok": True, "kind": "pdf" if suffix == ".pdf" else "image"}


@app.delete("/api/sheets/{result_id}/mine")
async def delete_my_sheet(result_id: str) -> dict:
    _guard_id(result_id)

    path = _my_sheet(result_id)
    if path is None:
        raise HTTPException(404, "등록된 악보가 없습니다")
    path.unlink(missing_ok=True)
    return {"deleted": result_id}


@app.get("/api/sheets/{result_id}")
async def find_sheets(result_id: str) -> dict:
    """이 곡의 코드 악보가 올라와 있는 페이지들을 찾는다.

    악보 자체를 가져오지 않는다 — 남이 만든 악보를 복제해 보여주면
    저작권에 걸린다. 어디에 있는지만 알려 주고 사용자가 그 사이트에서 본다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    items = await asyncio.to_thread(search_sheets, result.title)
    return {"query": clean_query(result.title), "items": items}


@app.get("/api/shared")
async def shared_list(folder: str = "") -> list[dict]:
    """반별 공유 폴더의 파일 목록. folder를 주지 않으면 초급 폴더."""
    try:
        files = await list_shared(folder)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"공유 폴더를 읽지 못했습니다: {exc}") from exc
    return [{"id": f.id, "name": f.name} for f in files]


@app.get("/api/shared/{file_id}")
async def shared_file(file_id: str) -> Response:
    """공유 폴더의 파일 내용. 프론트가 받아 기기 저장 재생목록에 넣는다."""
    try:
        data = await download_shared(file_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"내려받기 실패: {exc}") from exc
    return Response(content=data, media_type="application/octet-stream")


@app.get("/api/audio/{result_id}")
async def get_audio(result_id: str) -> FileResponse:
    """업로드한 곡을 브라우저에서 재생하기 위한 원본 스트리밍.

    YouTube 결과는 IFrame 플레이어로 재생하므로 이 경로를 쓰지 않는다.
    """
    _guard_id(result_id)

    path = _source_audio(result_id)
    if path is None:
        raise HTTPException(404, "오디오를 찾을 수 없습니다")
    # 파일명(확장자)을 헤더로 알려줘 프론트가 음원 내보내기 이름을 지을 수 있게 한다
    return FileResponse(path, filename=path.name)


def _source_audio(result_id: str) -> Path | None:
    """원본 오디오 파일. 디코딩 산출물·사이드카·분리 스템은 건너뛴다."""
    for path in sorted(settings.audio_dir.glob(f"{result_id}.*")):
        rest = path.name[len(result_id) + 1 :]
        if "." in rest:
            continue
        return path
    return None


# 분리 트랙 서빙. "instrumental"(반주)과 "vocals"(보컬)를 같은 방식으로 낸다.
# wav는 4분 곡이 50MB라 폰으로 스트리밍하기 무거워 mp3로 줄여 둔다.
_STEM_WAVS = {"instrumental": instrumental_path, "vocals": vocals_path}


def _stem_mp3(result_id: str, kind: str) -> Path:
    return settings.audio_dir / f"{result_id}.{kind}.mp3"


async def _serve_stem(result_id: str, kind: str) -> FileResponse:
    """분리 트랙 한 벌. 늘 mp3로 낸다.

    분리가 남기는 wav는 4분 곡이 40MB다. 그대로 내주면 폰으로 받기도
    무겁고, 곡 파일(.rml)에 담으면 세 트랙이 100MB를 넘어 드라이브에
    올리다 막힌다. 그래서 아직 없으면 여기서 줄여 두고 낸다 —
    「만들기」를 따로 누르지 않아도 되게.
    """
    mp3 = _stem_mp3(result_id, kind)
    wav = _STEM_WAVS[kind](result_id)
    if not mp3.exists() and wav.exists():
        try:
            await encode_mp3(wav, mp3, bitrate="128k")
        except Exception:
            pass  # 줄이지 못하면 wav라도 낸다
    for path in (mp3, wav):
        if path.exists():
            return FileResponse(path, filename=path.name)
    raise HTTPException(404, "트랙이 아직 없습니다")


async def _make_stem(result_id: str, kind: str) -> dict:
    """원본을 분리해 트랙을 만든다. 이미 있으면 그대로 쓴다.

    GPU에서 4분 곡이 10초 안쪽이라 요청을 붙잡고 기다리게 둔다.
    """
    mp3 = _stem_mp3(result_id, kind)
    if mp3.exists():
        return {"ready": True, "cached": True}

    wav = _STEM_WAVS[kind](result_id)
    if not wav.exists():
        source = _source_audio(result_id)
        if source is None:
            raise HTTPException(404, "원본 오디오가 없습니다. 곡을 다시 분석해 주세요")
        try:
            await separate(source, result_id, resolve_device())
        except Exception as exc:
            raise HTTPException(500, f"트랙을 만들지 못했습니다: {exc}") from exc
        if not wav.exists():
            raise HTTPException(500, "트랙 생성에 실패했습니다")

    # mp3로 줄여 두고 wav는 남긴다(재분리 없이 다시 인코딩할 수 있게).
    try:
        await encode_mp3(wav, mp3, bitrate="128k")
    except Exception:
        return {"ready": True, "cached": False}  # 인코딩이 안 되면 wav로 서빙된다
    return {"ready": True, "cached": False}


@app.get("/api/audio/{result_id}/instrumental")
async def get_instrumental(result_id: str) -> FileResponse:
    """보컬을 뺀 반주 트랙. 없으면 404 — 프론트가 만들기를 요청한다."""
    _guard_id(result_id)
    return await _serve_stem(result_id, "instrumental")


@app.post("/api/audio/{result_id}/instrumental")
async def make_instrumental(result_id: str) -> dict:
    _guard_id(result_id)
    return await _make_stem(result_id, "instrumental")


@app.get("/api/audio/{result_id}/vocals")
async def get_vocals(result_id: str) -> FileResponse:
    """보컬만 남긴 트랙. 노래 연습용 — 반주를 빼고 목소리만 듣는다."""
    _guard_id(result_id)
    return await _serve_stem(result_id, "vocals")


@app.post("/api/audio/{result_id}/vocals")
async def make_vocals(result_id: str) -> dict:
    _guard_id(result_id)
    return await _make_stem(result_id, "vocals")


@app.get("/api/results/{result_id}")
async def get_result(result_id: str) -> AnalysisResult:
    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    return result


def _purge_derived(result_id: str, *, include_source: bool) -> int:
    """이 곡에서 만들어 둔 파일을 지운다. 몇 개 지웠는지 돌려준다.

    디코딩본(`{id}.22050.wav`)·분리 스템·반주 mp3가 대상이다. 음원을 다시
    받을 때는 이것들이 옛 소리에서 나온 것이라 반드시 같이 지워야 한다.
    """
    removed = 0
    for path in settings.audio_dir.glob(f"{result_id}.*"):
        rest = path.name[len(result_id) + 1 :]
        is_derived = "." in rest
        if is_derived or include_source:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


@app.post("/api/results/{result_id}/reanalyze")
async def reanalyze(result_id: str, req: ReanalyzeRequest) -> dict:
    """이미 등록된 곡을 다시 분석한다.

    파이프라인이 좋아졌거나 결과가 마음에 안 들 때 쓴다. 기본은 받아 둔
    음원을 그대로 쓰므로 빠르다(내려받기 단계가 통째로 빠진다).

    refetch=true면 음원부터 다시 받는다. YouTube가 영상을 바꿔 올렸거나
    받다가 깨진 경우다. 업로드 곡은 다시 받을 곳이 없어 거절한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    # 서버에서 지웠지만 기기에는 남아 있는 곡이 있다. 그럴 때 화면이
    # 알려 준 정보로 되살린다 — YouTube 곡은 id만 알면 다시 받을 수 있다.
    kind = result.source if result else req.source
    title = result.title if result else req.title
    if kind is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    if req.refetch:
        if kind != SourceKind.YOUTUBE:
            raise HTTPException(
                400, "업로드한 곡은 다시 받을 곳이 없습니다. 파일을 새로 올려 주세요"
            )
        if not settings.enable_youtube:
            raise HTTPException(403, "이 서버는 YouTube 입력이 꺼져 있습니다")
        _purge_derived(result_id, include_source=True)
        source: AudioSource = YouTubeSource(f"https://www.youtube.com/watch?v={result_id}")
    else:
        path = find_source_audio(result_id)
        if path is None:
            # 음원도 없다. YouTube 곡이면 받아 오면 되고, 업로드 곡은 방법이 없다
            if kind != SourceKind.YOUTUBE or not settings.enable_youtube:
                raise HTTPException(404, "받아 둔 음원이 없습니다")
            source = YouTubeSource(f"https://www.youtube.com/watch?v={result_id}")
        else:
            # 디코딩본과 분리 스템은 지운다. 남겨 두면 옛 산출물을 그대로 쓴다
            _purge_derived(result_id, include_source=False)
            source = CachedSource(result_id, kind, path, title)

    job_id = manager.submit(source, separate=req.separate, force=True)
    return {"job_id": job_id}


@app.post("/api/results/{result_id}/lyrics")
async def fetch_lyrics(result_id: str, q: str = "") -> AnalysisResult:
    """이미 분석된 곡에 가사를 붙인다(웹 가사 → YouTube 자막 순).

    분석과 분리해 둔 이유: 가사는 나중에 올라오기도 하고, 옛 결과에도
    가사만 새로 채울 수 있어야 한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    lyrics, approx, source = await asyncio.to_thread(
        fetch_lyrics_blocking,
        result_id if result.source == "youtube" else None,
        result.title,
        result.duration,
        q,
    )
    if not lyrics:
        # 웹에도 자막에도 없으면 노래에서 직접 받아 적는다(Whisper).
        # 분리해 둔 보컬 트랙이 있어야 한다.
        from .analysis.asr import lines_from_words, transcribe_words

        words = await asyncio.to_thread(transcribe_words, result_id)
        lyrics = lines_from_words(words) if words else []
        approx = False
    if not lyrics:
        raise HTTPException(404, "이 곡의 가사를 찾지 못했습니다")

    # 자막이면 소절로 다듬고, 시각은 실제 부른 자리에 맞춘다 —
    # 분석 때와 같은 순서. 어디서 찾았든 결과가 같아야 한다.
    if source == "captions":
        lyrics = await asyncio.to_thread(polish_captions, lyrics)
    result.lyrics = await asyncio.to_thread(sync_to_song, lyrics, result_id)
    result.lyrics_approx = approx
    # 「다시 찾기」는 새로 찾겠다는 뜻이다. 수동 표식을 지운다.
    result.lyrics_manual = False
    save_result(result)
    return result


@app.get("/api/results/{result_id}/phrases")
async def song_phrases(result_id: str, lines: int = 0) -> dict:
    """이 곡에서 노래가 시작하는 자리들.

    시간 표시가 없는 가사를 붙여넣었을 때 어디에 놓을지 정하는 데 쓴다.
    노래 전체에 고르게 펴면 전주·간주까지 가사가 깔려 맞지 않는다.
    """
    _guard_id(result_id)

    from .analysis.lyric_sync import phrase_starts
    from .analysis.separate import vocals_path

    # 놓을 줄 수를 알려 주면 그 개수에 가깝게 골라 준다. 자리가 줄보다
    # 훨씬 많으면 뒤로 갈수록 밀린다.
    starts = await asyncio.to_thread(phrase_starts, vocals_path(result_id), lines)
    return {"starts": [round(t, 2) for t in starts]}


@app.post("/api/results/{result_id}/lyrics/align")
async def align_pasted_lyrics(result_id: str, texts: list[str]) -> AnalysisResult:
    """붙여넣은 가사에 시각을 붙인다.

    이 곡에 이미 시각이 붙은 글(자동 자막)이 있으면 그것을 자로 쓴다.
    글자는 틀려도 언제 부르는지는 맞기 때문이다. 없으면 보컬이 시작하는
    자리에 고르게 놓는다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    rows = [line.strip() for line in texts if line.strip()]
    if not rows:
        raise HTTPException(400, "붙여넣은 가사가 없습니다")

    # 첫째 자: 보컬을 받아 적은 단어 시각(Whisper). 붙여넣은 글을 실제
    # 부른 자리에 문자 단위로 겹쳐 보는 것이라 자막보다 정확하고,
    # AI 키도 자막도 필요 없다.
    from .analysis.asr import align_with_asr, transcribe_words

    words = await asyncio.to_thread(transcribe_words, result_id)
    if words:
        drafts = [LyricLine(t=0.0, end=0.0, text=row) for row in rows]
        placed_lines = await asyncio.to_thread(align_with_asr, drafts, words)
        if placed_lines:
            result.lyrics = placed_lines
            result.lyrics_approx = False
            result.lyrics_manual = True
            save_result(result)
            return result

    if not llm.enabled():
        raise HTTPException(400, "가사 도우미(AI) 키가 없습니다")
    # 자로 쓸 글. 이 곡에 붙어 있는 가사가 먼저고, 없으면 영상 자막을
    # 그 자리에서 받아 온다 — 가사가 비어 있다고 못 맞출 이유가 없다.
    ruler = [{"t": line.t, "text": line.text} for line in result.lyrics]
    if len(ruler) < 2 and result.source == SourceKind.YOUTUBE and settings.enable_youtube:
        caps = await asyncio.to_thread(fetch_youtube_captions, result_id)
        ruler = [{"t": line.t, "text": line.text} for line in caps]
    if len(ruler) < 2:
        raise HTTPException(400, "시각을 참고할 자막이 없습니다")

    placed = await asyncio.to_thread(llm.align_lyrics, ruler, rows)
    if not placed:
        raise HTTPException(502, "시각을 맞추지 못했습니다")

    result.lyrics = [
        LyricLine(
            t=row["t"],
            end=placed[i + 1]["t"] if i + 1 < len(placed) else result.duration,
            text=row["text"],
        )
        for i, row in enumerate(placed)
    ]
    result.lyrics_approx = False
    result.lyrics_manual = True
    save_result(result)
    return result


@app.delete("/api/results/{result_id}/lyrics")
async def delete_lyrics(result_id: str) -> AnalysisResult:
    """붙어 있는 가사를 지운다. 수동 표식도 함께 걷는다.

    잘못 붙여넣은 가사에서 벗어나는 길이다. 표식이 걷히므로 다음
    재분석이나 「다시 찾기」는 다시 자동으로 찾는다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    result.lyrics = []
    result.lyrics_approx = False
    result.lyrics_manual = False
    save_result(result)
    return result


@app.post("/api/results/{result_id}/lyrics/tidy")
async def tidy_lyrics_endpoint(result_id: str) -> AnalysisResult:
    """붙어 있는 가사를 AI로 다듬는다.

    자동 자막에서 온 가사는 토막나 있고 글자가 틀린다. 없는 가사를
    지어내는 것이 아니라 이미 있는 글을 고쳐 쓰는 일이라, 이건 LLM이
    실제로 잘한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    if not result.lyrics:
        raise HTTPException(400, "다듬을 가사가 없습니다")
    if not llm.enabled():
        raise HTTPException(400, "가사 도우미(AI) 키가 없습니다")

    rows = await asyncio.to_thread(
        llm.tidy_lyrics, [{"t": line.t, "text": line.text} for line in result.lyrics]
    )
    if not rows:
        raise HTTPException(502, "다듬지 못했습니다")

    lines = [
        LyricLine(
            t=row["t"],
            end=rows[i + 1]["t"] if i + 1 < len(rows) else result.duration,
            text=row["text"],
        )
        for i, row in enumerate(rows)
    ]
    # 다듬은 시각은 자막의 첫 조각 시각이라 어림이 아니다. 마지막으로
    # 실제 부른 자리에 맞춘다 — 분석 때와 같은 마무리.
    result.lyrics = await asyncio.to_thread(sync_to_song, lines, result_id)
    result.lyrics_approx = False
    save_result(result)
    return result


@app.put("/api/results/{result_id}/lyrics")
async def put_lyrics(result_id: str, lyrics: list[LyricLine]) -> AnalysisResult:
    """가사를 직접 넣는다(사용자가 올린 .lrc/자막 파일)."""
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    result.lyrics = lyrics
    # 사용자가 직접 넣은 가사는 어림이 아니다. 시각이 파일에 들어 있다
    result.lyrics_approx = False
    result.lyrics_manual = True
    save_result(result)
    return result


@app.post("/api/results/{result_id}/score")
async def put_score(result_id: str, file: UploadFile = File(...)) -> AnalysisResult:
    """정식 악보(뮤즈스코어 .mscz/.mscx)를 이 곡에 붙인다.

    보컬에서 딴 멜로디는 부른 음의 15~30%밖에 잡히지 않는다. 강사님이
    악보를 올려 주시면 그쪽을 그린다 — 음표가 하나도 빠지지 않는다.

    올리는 즉시 음원의 시각에 이어 두고, 가사가 어긋나는 마디를 함께
    돌려준다. 그 마디만 보고 손보면 된다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    data = await file.read()
    if not data:
        raise HTTPException(400, "빈 파일입니다")
    try:
        parsed = score_file.parse(data)
    except Exception as exc:
        raise HTTPException(400, f"악보를 읽지 못했습니다: {exc}") from exc
    if not parsed.bars:
        raise HTTPException(400, "마디가 없는 악보입니다")

    from .analysis.asr import transcribe_words

    words = [
        {"text": w.text, "start": w.start, "end": w.end}
        for w in transcribe_words(result_id)
    ]
    payload = result.model_dump()
    try:
        alignment = score_align.align(parsed, payload, words)
    except Exception as exc:
        raise HTTPException(400, f"악보를 음원에 맞추지 못했습니다: {exc}") from exc

    # 원본을 남긴다 — 재분석하면 마디 시각이 달라지는데, 그때 이 파일을
    # 다시 읽어 새 박자에 맞춘다. 없으면 붙인 악보를 잃는다.
    suffix = Path(file.filename or "").suffix.lower()
    attachments.save_score_file(
        result_id,
        data,
        suffix if suffix in {".mscz", ".mscx", ".musicxml", ".mxl", ".xml"} else ".mscz",
    )

    result.score = score_file.to_dict(parsed)
    result.score_align = alignment
    # 그림이 이미 붙어 있으면 새 정렬로 시각을 다시 준다. 안 그러면
    # 악보는 바뀌었는데 그림 위 커서는 예전 자리를 지나간다.
    if result.sheet:
        result.sheet = attachments.retime(dict(result.sheet), result)
    save_result(result)
    return result


def _sheet_source(result_id: str) -> Path | None:
    """붙여 둔 악보 그림의 원본(PDF·사진). 쪽 그림과 악보 파일은 뺀다."""
    for path in sorted(_sheet_dir().glob(f"{result_id}.*")):
        return path
    return None


def _page_path(result_id: str, index: int) -> Path:
    return _sheet_dir() / f"{result_id}__p{index}.png"


@app.get("/api/sheets/{result_id}/page/{index}")
async def get_sheet_page(result_id: str, index: int) -> Response:
    """악보 그림 한 쪽. PDF는 미리 그림으로 펴 두었다."""
    _guard_id(result_id)
    path = _page_path(result_id, index)
    if not path.exists():
        raise HTTPException(404, "그 쪽이 없습니다")
    return FileResponse(path, media_type="image/png")


@app.post("/api/results/{result_id}/sheet")
async def put_sheet(
    result_id: str,
    file: UploadFile = File(...),
    offset: float = Form(0.0),
    repeats: int = Form(1),
) -> AnalysisResult:
    """악보 그림(PDF·사진)을 곡에 붙인다.

    음표를 읽어내려는 것이 아니다. **마디선만** 찾아 인쇄된 악보 위로
    커서를 지나가게 한다 — 우리가 그린 음표보다 인쇄된 악보가 낫다.

    마디마다 시각은 두 길로 얻는다. 뮤즈스코어 파일이 이미 붙어 있으면
    그 정렬을 그대로 쓰고(가장 정확하다), 없으면 음원의 박 격자에 고르게
    얹는다. 후자는 강사님이 시작 마디를 한 번 짚어 주어야 한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    suffix = _SHEET_TYPES.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(400, "이미지(PNG·JPG·WEBP)나 PDF만 올릴 수 있습니다")
    data = await file.read(_SHEET_MAX_BYTES + 1)
    if len(data) > _SHEET_MAX_BYTES:
        raise HTTPException(413, "파일이 너무 큽니다 (20MB까지)")

    try:
        if suffix == ".pdf":
            pages, images = sheet_layout.from_pdf(data)
        else:
            pages, images = sheet_layout.from_image(data)
    except Exception as exc:
        raise HTTPException(400, f"악보를 읽지 못했습니다: {exc}") from exc

    total = sum(len(s.measures) for p in pages for s in p.systems)
    if total < 2:
        raise HTTPException(
            400,
            "마디선을 찾지 못했습니다. 사진보다 뮤즈스코어에서 뽑은 PDF가 잘 잡힙니다.",
        )

    for old in _sheet_dir().glob(f"{result_id}__p*.png"):
        old.unlink(missing_ok=True)
    for i, png in enumerate(images):
        _page_path(result_id, i).write_bytes(png)
    # 원본도 남긴다 — 「내 악보」에서 그대로 펼쳐 볼 수 있게
    for old in _sheet_dir().glob(f"{result_id}.*"):
        old.unlink(missing_ok=True)
    (_sheet_dir() / f"{result_id}{suffix}").write_bytes(data)

    result.sheet = sheet_score.build(
        pages,
        result.model_dump(),
        result.score_align,
        offset,
        repeats,
        score=result.score,
    )
    save_result(result)
    return result


@app.post("/api/results/{result_id}/tabimage")
async def put_tab_image(
    result_id: str,
    file: UploadFile = File(...),
    bar_offset: int = Form(0),
) -> AnalysisResult:
    """인쇄된 **타브 악보**(PDF)를 읽어 마디별 프렛 숫자로 옮긴다.

    악보 그림 붙이기(/sheet)와 다르다. 저쪽은 그림을 그대로 두고 마디선만
    찾지만, 여기서는 숫자를 실제로 읽어 앱의 타브 화면에 옮겨 그린다 —
    편곡자가 짚으라고 적은 자리가 그대로 나온다.

    AI를 쓰지 않는다. 인쇄된 악보는 잴 수 있다: 여섯 줄은 가로로 긴 줄,
    마디선은 그 줄을 관통하다 맨 아랫줄에서 멈추고(음표 기둥은 빔까지 더
    내려간다), 숫자는 같은 판에서 찍혀 나와 모양이 픽셀까지 같다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    if (file.content_type or "") != "application/pdf":
        raise HTTPException(400, "PDF만 읽을 수 있습니다. 인쇄된 타브 악보를 넣어 주세요.")

    data = await file.read(_SHEET_MAX_BYTES + 1)
    if len(data) > _SHEET_MAX_BYTES:
        raise HTTPException(413, "파일이 너무 큽니다 (20MB까지)")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        read = tab_image.read_tab(path)
    except Exception as exc:
        raise HTTPException(400, f"타브를 읽지 못했습니다: {exc}") from exc
    finally:
        Path(path).unlink(missing_ok=True)

    measures = read.get("measures", [])
    if len(measures) < 2:
        raise HTTPException(
            400,
            "여섯 줄 타브를 찾지 못했습니다. 사진보다 인쇄된 PDF가 잘 읽힙니다.",
        )
    unread = sum(1 for m in measures if m.get("kind") == "pick"
                 and not any(c for c in m.get("cols", [])))
    result.picked_tab = {"bar_offset": bar_offset,
                         "measures": measures,
                         "unread": unread}
    save_result(result)
    return result


@app.put("/api/results/{result_id}")
async def put_result(result_id: str, body: AnalysisResult) -> dict:
    """기기 사본을 통째로 받아 적는다 — 기기가 원본이다.

    서버가 꺼진 사이에 고친 코드·가사·싱크는 기기에만 남는다. 앱이
    서버를 다시 만나면 이 길로 밀어 넣어 두 벌을 같게 만든다.
    항목별 길(putLyrics 따위)로는 빠지는 항목이 생겨 통째로 받는다.
    """
    _guard_id(result_id)
    if body.id != result_id:
        raise HTTPException(400, "곡 번호가 다릅니다")
    save_result(body)
    return {"ok": True}


@app.put("/api/results/{result_id}/setup")
async def put_setup(result_id: str, body: dict) -> AnalysisResult:
    """강사님이 맞춰 둔 연주설정을 이 곡의 기준값으로 적어 둔다.

    싱크는 기기 사정이 아니라 악보와 음원이 얼마나 어긋났나다. 강사님이
    한 번 맞추면 수강생 모두에게 같은 값이 옳으므로, 기기에만 두지 않고
    곡에 적는다 — 곡 파일에 실려 함께 가고 재분석해도 남는다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    # 아는 항목만 받는다. 모르는 열쇠를 그대로 담아 두면 나중에 무엇이
    # 무엇인지 알 수 없다.
    keep = ("transpose", "rate", "sync", "lyricSync", "arp", "strum", "autoChords")
    setup = {k: body[k] for k in keep if k in body}
    result.setup = setup or None
    save_result(result)
    return result


@app.post("/api/results/{result_id}/beats")
async def fix_beats(result_id: str, body: dict) -> AnalysisResult:
    """박을 고르게 하거나, 빠르기를 절반·두 배로 다시 본다.

    박 찾기가 곡 한가운데서 잣대를 바꾸면 마디 길이가 들쭉날쭉해진다 —
    「그건 너」는 열여덟째 마디까지 1.4초, 열아홉째부터 2.9초였다. mode가
    "even"이면 그런 자리를 메우거나 덜어 고르게 한다.

    "half"·"double"은 빠르기를 어떻게 볼 것인가다. 8분음표를 박으로 세면
    마디가 절반이 되어 악보와 어긋난다. 어느 쪽이 옳은지는 악보를 보아야
    아는 일이라 사람이 정한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    mode = str(body.get("mode") or "even")
    rows = [b.model_dump() for b in result.beats]
    if mode == "even":
        rows, fixed = beats_even.even(rows)
        # 이미 고른 박이면 그대로 돌려준다 — 틀림이 아니라 「고칠 것이
        # 없음」이다. 기기 사본이 뒤처져 있을 때 이 응답이 그것을 맞춘다.
        if not fixed:
            return result
    elif mode in ("half", "double"):
        rows = beats_even.scale(rows, 0.5 if mode == "half" else 2)
    else:
        raise HTTPException(400, "모르는 방식입니다")

    result.beats = [Beat(**r) for r in rows]
    result.bpm = beats_even.bpm_of(rows) or result.bpm
    _retime_sheet(result)
    save_result(result)
    return result


def _retime_sheet(result: AnalysisResult) -> None:
    """박이 달라졌으니 악보 마디의 시각도 다시 잰다."""
    if not result.sheet:
        return
    sheet = dict(result.sheet)
    count = len(sheet.get("bars") or [])
    if not count:
        return
    order = sheet.get("order") or None
    repeats = int(sheet.get("repeats", 1) or 1) if not order else 1
    sheet["passes"] = sheet_score.times_from_grid(
        result.model_dump(),
        count,
        float(sheet.get("offset", 0.0) or 0.0),
        repeats,
        order,
    )
    result.sheet = sheet


@app.post("/api/results/{result_id}/sheet/fit")
async def fit_sheet(result_id: str) -> AnalysisResult:
    """코드가 바뀌는 자리를 마디선에 맞춰 시작 마디를 다듬는다.

    한 마디 통째로 옮기는 일은 하지 않는다 — 그것은 가사를 봐야 알 수
    있고 사람이 ◀ ▶로 정하는 몫이다. 여기서는 한 마디 안에서만 다듬는다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None or not result.sheet:
        raise HTTPException(404, "붙여 둔 악보가 없습니다")

    sheet = dict(result.sheet)
    count = len(sheet.get("bars") or [])
    order = sheet.get("order") or sheet_score._order_of(result.score, count)
    payload = result.model_dump()
    offset = sheet_score.fit_offset(
        payload, sheet, order, float(sheet.get("offset", 0.0) or 0.0)
    )
    repeats = int(sheet.get("repeats", 1) or 1) if not order else 1
    sheet["passes"] = sheet_score.times_from_grid(
        payload, count, offset, repeats, order
    )
    sheet["offset"] = offset
    was = str(sheet.get("source") or "")
    sheet["source"] = was if (order and was in ("read", "repeat")) else ("repeat" if order else "grid")
    result.sheet = sheet
    save_result(result)
    return result


#: AI가 악보를 읽는 일의 진행 상태. 곡 하나에 하나씩.
_reads: dict[str, dict] = {}


async def _run_read(result_id: str) -> None:
    """AI에게 되돌이 표시를 읽히고 부르는 차례를 적어 둔다(뒤에서)."""
    try:
        result = load_result(result_id)
        src = _sheet_source(result_id)
        if result is None or not result.sheet or src is None:
            raise ValueError("붙여 둔 악보가 없습니다")

        data = src.read_bytes()
        if src.suffix.lower() == ".pdf":
            pages, images = await asyncio.to_thread(sheet_layout.from_pdf, data)
        else:
            pages, images = await asyncio.to_thread(sheet_layout.from_image, data)

        got = await asyncio.to_thread(sheet_read.read, pages, images)

        sheet = dict(result.sheet)
        result.sheet = sheet_score.build(
            pages,
            result.model_dump(),
            result.score_align,
            float(sheet.get("offset", 0.0) or 0.0),
            1,
            order=got["order"],
            score=result.score,
        )
        result.sheet["read"] = got["found"]
        save_result(result)
        _reads[result_id] = {"state": "done"}
    except Exception as exc:
        _reads[result_id] = {"state": "failed", "detail": str(exc)}


@app.post("/api/results/{result_id}/sheet/read")
async def read_sheet(result_id: str) -> dict:
    """악보 그림에서 되돌이 표시를 AI로 읽는다 — 시작만 하고 곧 돌려준다.

    그림 몇 장을 AI에게 보이는 일이라 30초를 넘긴다. 그동안 붙잡고
    있으면 중간의 개발 서버가 먼저 끊어 버려 500이 된다. 시작만 시키고
    상태는 따로 물어보게 한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    if not result.sheet:
        raise HTTPException(400, "먼저 악보 그림을 붙여 주세요")
    if _sheet_source(result_id) is None:
        raise HTTPException(400, "악보 원본이 없습니다. 그림을 다시 붙여 주세요")

    if _reads.get(result_id, {}).get("state") == "running":
        return {"state": "running"}
    _reads[result_id] = {"state": "running"}
    asyncio.create_task(_run_read(result_id))
    return {"state": "running"}


@app.get("/api/results/{result_id}/sheet/read")
async def read_state(result_id: str) -> dict:
    """AI 읽기가 끝났는지 물어본다."""
    _guard_id(result_id)
    return _reads.get(result_id) or {"state": "idle"}


@app.put("/api/results/{result_id}/sheet")
async def move_sheet(result_id: str, body: dict) -> AnalysisResult:
    """악보 그림을 음원 위에서 앞뒤로 민다(시작 마디·되풀이 횟수)."""
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None or not result.sheet:
        raise HTTPException(404, "붙여 둔 악보가 없습니다")

    sheet = dict(result.sheet)
    count = len(sheet.get("bars") or [])
    offset = float(body.get("offset", sheet.get("offset", 0.0)))
    repeats = int(body.get("repeats", sheet.get("repeats", 1)))
    # 밀기만 하는 것이지 되돌이를 잊는 것이 아니다. AI가 읽어 둔 차례나
    # 악보 파일의 차례가 있으면 그대로 지킨다 — 여기서 잃으면 밀 때마다
    # 도돌이가 통째로 날아간다.
    order = sheet.get("order") or sheet_score._order_of(result.score, count)
    sheet["passes"] = sheet_score.times_from_grid(
        result.model_dump(), count, offset, repeats, order
    )
    # 차례를 어디서 얻었는지는 그대로 둔다 — 미는 일과 상관이 없다
    was = str(sheet.get("source") or "")
    sheet["source"] = was if (order and was in ("read", "repeat")) else ("repeat" if order else "grid")
    sheet["offset"] = offset
    sheet["repeats"] = repeats
    result.sheet = sheet
    save_result(result)
    return result


@app.delete("/api/results/{result_id}/sheet")
async def drop_sheet(result_id: str) -> AnalysisResult:
    """붙여 둔 악보 그림을 뗀다."""
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    for old in _sheet_dir().glob(f"{result_id}__p*.png"):
        old.unlink(missing_ok=True)
    result.sheet = None
    save_result(result)
    return result


@app.delete("/api/results/{result_id}/score")
async def drop_score(result_id: str) -> AnalysisResult:
    """붙여 둔 악보를 뗀다. 화면은 다시 뽑아낸 멜로디로 돌아간다."""
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    attachments.drop_score_file(result_id)
    result.score = None
    result.score_align = None
    save_result(result)
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
