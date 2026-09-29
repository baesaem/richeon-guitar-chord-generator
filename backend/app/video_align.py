"""곡에 바꿔 붙일 유튜브 영상을 음원 시각에 맞춘다.

강사님: 「현재 생성된 음원에 유튜브 영상만 교체 — 영상 소리는 끄고 음원 시간과
비슷하게」. 뮤직비디오는 같은 녹음이라도 앞에 장면이 몇 초 더 있거나(인트로),
가사 영상보다 늦게 시작한다. 영상은 음소거로 그림만 쓰고 소리는 곡의 음원이
내므로, **영상의 몇 초가 음원의 몇 초인가**만 알면 된다.

영상의 소리를 받아 곡의 음원과 견준다. 두 소리의 세기 변화(소리가 시작되는
자리들, onset)를 겹쳐 보아 가장 잘 겹치는 어긋남을 찾는다. 앞·뒤 반을 따로
견주어 두 어긋남이 다르면 영상이 조금 빠르거나 느린 것이다(다른 판·라이브) —
그 비율(scale)도 돌려준다.

  영상 시각 = offset + scale × 음원 시각
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from .config import settings
from .sources.youtube import YouTubeUnavailable, extract_video_id

log = logging.getLogger(__name__)

_SR = 11025
_HOP = 256  # 약 23ms
#: 이만큼(초) 넘게 어긋나는 것은 찾지 않는다 — 다른 곡을 붙였을 때 엉뚱한 자리를 잡지 않게
_MAX_LAG = 90.0


def _ref_dir() -> Path:
    d = settings.audio_dir / "video_ref"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _download(url: str) -> tuple[Path, dict]:
    """영상의 소리만 받는다. 받아 둔 것이 있으면 그것을 쓴다.

    알림(meta)에는 길이·제목과 **다른 사이트에서 틀 수 있는가**(playable_in_embed)를
    적는다 — 올린 사람이 막아 둔 영상(영화사 공식 장면 따위)은 앱 안에서 「동영상을
    재생할 수 없음」만 나온다. 받아 두는 알림 파일({id}.json)에 남겨 다시 묻지 않는다
    """
    import json

    vid = extract_video_id(url)
    meta_path = _ref_dir() / f"{vid}.json"
    for p in _ref_dir().glob(f"{vid}.*"):
        if p.name.count(".") == 1 and p.suffix != ".json" and meta_path.exists():
            return p, json.loads(meta_path.read_text("utf-8"))
    import yt_dlp

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(_ref_dir() / "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=True)
    except Exception as exc:
        raise YouTubeUnavailable(f"영상의 소리를 받지 못했습니다({exc})") from exc
    path = Path(info["requested_downloads"][0]["filepath"])
    meta = {
        "duration": float(info.get("duration") or 0.0),
        "title": str(info.get("title") or ""),
        "embeddable": info.get("playable_in_embed") is not False,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), "utf-8")
    return path, meta


def _wav(path: Path) -> Path:
    """유튜브가 주는 webm·m4a는 바로 못 읽는다 — ffmpeg로 모노 wav를 한 번 만들어 둔다."""
    if path.suffix.lower() == ".wav":
        return path
    out = path.with_name(path.stem + f".{_SR}.wav")
    if not out.exists():
        from .analysis.decode import _run_blocking

        code, _, err = _run_blocking(
            ("ffmpeg", "-y", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(_SR), str(out))
        )
        if code != 0:
            raise RuntimeError(f"영상 소리를 풀지 못했습니다: {err.decode('utf-8', 'replace')[:200]}")
    return out


def _envelope(path: Path) -> np.ndarray:
    import librosa

    y, _ = librosa.load(str(_wav(path)), sr=_SR, mono=True)
    env = librosa.onset.onset_strength(y=y, sr=_SR, hop_length=_HOP)
    # 조금 뭉갠다(앞뒤 3칸 중 큰 값) — 빠르기가 조금 다른 영상도 조각 안에서 겹치게
    from scipy.ndimage import maximum_filter1d

    env = maximum_filter1d(env, size=7)
    env = env - env.mean()
    return env / (env.std() + 1e-9)


def _best_lag(
    a: np.ndarray, b: np.ndarray, around: float = 0.0, reach: float = _MAX_LAG
) -> tuple[float, float]:
    """b(영상)가 a(음원)보다 몇 초 늦은가와 그 겹침의 뚜렷함(0~1 남짓).

    around 근처(±reach초)에서만 찾는다
    """
    n = len(a) + len(b)
    size = 1 << (n - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(b, size) * np.conj(np.fft.rfft(a, size)), size)
    # corr[k] = sum b[i+k]·a[i] — k가 양수면 영상이 늦다(음수 k는 끝에서 감긴다)
    fps = _SR / _HOP
    lo = int((around - reach) * fps)
    hi = int((around + reach) * fps)
    lags = np.arange(max(lo, -(len(a) - 1)), min(hi, len(b) - 1) + 1)
    if not len(lags):
        return around, 0.0
    vals = corr[lags % size]
    # 겹치는 자리의 영상 쪽 세기로 나눈다(정규화) — 안 나누면 영상의 시끄러운
    # 자리(박수·효과음)가 어느 조각과도 「잘 겹치는」 자리로 뽑혔다
    csum = np.concatenate([[0.0], np.cumsum(b.astype(np.float64) ** 2)])
    start = np.clip(lags, 0, len(b))
    stop = np.clip(lags + len(a), 0, len(b))
    energy = np.sqrt(np.maximum(csum[stop] - csum[start], 1e-9))
    na = float(np.sqrt(np.sum(a.astype(np.float64) ** 2))) or 1.0
    # 겹치는 길이가 조각의 절반도 안 되는 자리는 치지 않는다
    enough = (stop - start) >= len(a) * 0.5
    score = np.where(enough, vals / (energy * na), -1.0)
    k = int(np.argmax(score))
    return float(lags[k]) / fps, float(score[k])


def align(result_id: str, url: str) -> dict:
    """영상 시각 = offset + scale × 음원 시각. 뚜렷함(confidence)도 함께."""
    song = settings.audio_dir / f"{result_id}.22050.wav"
    if not song.exists():
        from .sources.cached import find_source_audio

        src = find_source_audio(result_id)
        if src is None:
            raise FileNotFoundError("곡의 음원을 찾을 수 없습니다")
        song = src
    ref, meta = _download(url)

    a = _envelope(song)
    b = _envelope(ref)
    fps = _SR / _HOP

    # 12초 조각마다 영상 전체에서 가장 잘 겹치는 자리를 찾고, **가장 많은 조각이
    # 동의하는 직선**(영상 시각 = offset + scale × 음원 시각)을 고른다. 되풀이되는
    # 후렴은 엉뚱한 자리에도 겹치고, 편집한 영상(영화 장면)은 일부만 겹친다 —
    # 그래도 같은 줄에 서는 조각이 가장 많은 쪽이 맞다
    win = int(12 * fps)
    pts: list[tuple[float, float, float]] = []  # (음원 시각, 영상 시각, 뚜렷함)
    for s0 in range(0, max(len(a) - win, 1), win // 2):
        seg = a[s0 : s0 + win]
        if seg.std() < 0.3:  # 거의 조용한 조각(간주 끝·페이드)은 건너뛴다
            continue
        lag, c = _best_lag(seg, b, around=len(b) / fps / 2, reach=len(b) / fps + 30)
        if c > 0.3:
            pts.append((s0 / fps, lag, c))
    offset, scale, conf, share = 0.0, 1.0, 0.0, 0.0
    if pts:
        ts = np.array([p[0] for p in pts])
        vs = np.array([p[1] for p in pts])
        cs = np.array([p[2] for p in pts])
        best = (-1.0, 0.0, 1.0)
        cands = [(v - t, 1.0) for t, v, _ in pts]
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                if ts[j] - ts[i] > 40:
                    sc = (vs[j] - vs[i]) / (ts[j] - ts[i])
                    if 0.92 < sc < 1.08:
                        cands.append((vs[i] - sc * ts[i], sc))
        for off, sc in cands:
            inl = np.abs(vs - (off + sc * ts)) < 0.5
            w = float(cs[inl].sum())
            if w > best[0]:
                best = (w, off, sc)
        _, offset, scale = best
        inl = np.abs(vs - (offset + scale * ts)) < 0.5
        if inl.sum() >= 3:
            sc, off = np.polyfit(ts[inl], vs[inl], 1)
            if 0.92 < sc < 1.08:
                offset, scale = float(off), float(sc)
        if abs(scale - 1.0) < 0.002:
            scale = 1.0
            offset = float(np.median(vs[inl] - ts[inl]))
        conf = float(np.median(cs[inl]))
        # 곡의 얼마만큼이 이 직선에 맞는가(편집한 영상이면 일부)
        share = float(inl.sum()) * (win / 2) / fps / max(len(a) / fps, 1)
    log.info("영상 맞추기 %s ← %s: offset %.2f scale %.4f conf %.2f share %.2f", result_id, url, offset, scale, conf, share)
    return {
        "offset": round(offset, 2),
        "scale": round(scale, 4),
        "confidence": round(conf, 3),
        "share": round(min(share, 1.0), 2),
        "video_duration": meta.get("duration", 0.0),
        "video_title": meta.get("title", ""),
        "embeddable": meta.get("embeddable", True),
    }
