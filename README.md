# 기타코드 (ChordGen)

YouTube 주소나 오디오 파일에서 **비트·키·코드**를 자동으로 뽑아, 재생과 동기화된
기타 코드 화면을 보여주는 개인용 웹앱.

전체 설계와 일정은 [PLAN.md](PLAN.md) 참고.

## 현재 상태: M0 완료 (스캐폴딩 + 결과 스키마 확정)

분석 파이프라인은 **스텁**이다. 실제 코드 인식은 M2부터.
지금은 어떤 오디오를 넣어도 90 BPM, G-D-Em-C 고정 결과가 나온다.

## 요구 사항

| | 버전 | 비고 |
|---|---|---|
| Python | 3.12 (uv가 자동 설치) | 시스템의 3.14는 torch/demucs 휠이 없어 사용 불가 |
| Node | 20+ | |
| ffmpeg | 설치됨 | PATH에 있어야 함 |
| GPU | RTX 5070 Ti | Blackwell(sm_120) → **cu128 이상** torch 휠 필요 |

## 실행

```bash
# 백엔드 (http://localhost:8000)
cd backend
uv sync
uv run python run.py

# 프론트엔드 (http://localhost:3000)
cd frontend
npm install
npm run dev
```

### 폰에서 접속
둘 다 `0.0.0.0`으로 바인딩되어 있다. 같은 공유기에서 **http://192.168.1.199:3000** 으로 접속.
프론트는 접속한 호스트명으로 백엔드 주소를 자동 구성하므로 별도 설정이 필요 없다.
최초 1회 Windows 방화벽에서 3000·8000 포트 인바운드 허용이 필요할 수 있다.

## 운용 모드 (C안: 하이브리드)

| 환경변수 | 기본 | 효과 |
|---|---|---|
| `ENABLE_YOUTUBE` | `true` | `false`면 YouTube URL 입력이 403으로 차단되고 업로드 전용(B안)이 된다 |
| `KEEP_AUDIO_CACHE` | `true` | 원본 오디오를 `backend/cache/audio/`에 남겨 재분석 시 다운로드를 건너뛴다 |
| `DEVICE` | `auto` | `cuda` / `cpu` 강제 지정 |

`backend/.env`에 넣거나 실행 시 환경변수로 지정한다.
**외부에 배포할 때는 반드시 `ENABLE_YOUTUBE=false`.**

## 캐시

- `backend/cache/audio/` — 원본 오디오 (videoId 또는 파일 SHA1 앞 16자)
- `backend/cache/results/` — 분석 결과 JSON (같은 키)

같은 곡을 다시 넣으면 분석을 건너뛴다. 재분석하려면 요청에 `force: true`.
`meta.pipeline_version`이 결과가 어느 버전으로 뽑혔는지 알려준다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 백엔드 상태 · `youtube_enabled` · 연산 장치 |
| POST | `/api/analyze` | `{url, separate, force}` → `{job_id}` |
| POST | `/api/analyze/upload` | multipart 파일 업로드 → `{job_id}` |
| GET | `/api/jobs/{id}` | 현재 진행 상태 |
| GET | `/api/jobs/{id}/events` | SSE 진행률 스트림 |
| GET | `/api/results/{id}` | 분석 결과 JSON |
| PUT | `/api/results/{id}/chords` | 수동 코드 보정 저장 |

종료 이벤트(`done`/`failed`)는 **JobManager만** 발행하며 `result_id`를 포함한다.
파이프라인 단계에서는 종료 이벤트를 쏘지 않는다.

## 개발 시 주의점

- **포트 8000이 안 죽는 경우**: uvicorn `reload=True`는 자식 프로세스를 띄운다.
  부모만 종료하면 자식이 포트를 잡고 있어 옛 코드가 계속 응답한다. 포트 기준으로 정리할 것.
  ```powershell
  Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- **yt-dlp는 YouTube 사양 변경으로 주기적으로 깨진다.** 추출이 실패하면 먼저 갱신:
  ```bash
  cd backend && uv pip install -U yt-dlp
  ```
  그래도 안 되면 해당 곡은 파일 업로드로 우회한다.
- OneDrive 동기화 폴더라 `.pyc` 캐시가 소스를 못 따라가는 경우가 있어
  `run.py`에서 바이트코드 캐시를 끈다.

## 다음 단계 (M1)

`analysis/pipeline.py`의 `TODO(M1)` — ffmpeg로 모노 wav 디코드부터.
