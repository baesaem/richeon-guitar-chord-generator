# 리천 기타 코드 자동생성기 — 개발 계획

## 0. 한 줄 요약
YouTube URL을 입력하면 서버가 오디오를 받아 **비트/키/코드**를 분석하고,
웹에서 **YouTube 영상 재생과 동기화된 코드 타임라인 + 기타 코드 다이어그램**을 보여주는 앱.

---

## 1. 운용 모드: **C안(하이브리드) 확정**

YouTube 오디오 추출은 YouTube 약관 위반 소지가 있어, 오디오 입력 경로만 3가지로 나눴던 것.
**분석 파이프라인과 UI는 A/B/C 모두 100% 동일**하며, 차이는 "오디오가 어디서 들어오는가" 뿐.

| | A. 로컬 개인용 | B. 파일 업로드 | C. 하이브리드 **(채택)** |
|---|---|---|---|
| 입력 | YouTube URL 붙여넣기 | mp3/wav 직접 업로드 | 둘 다 |
| 오디오 획득 | 서버가 `yt-dlp`로 추출 | 사용자가 파일 보유 | 환경변수로 URL 경로 on/off |
| 실행 위치 | 내 PC (localhost) 전용 | 공개 배포 가능 | 배포 시 URL 경로 비활성 |
| 사용 편의 | 최상 (URL 하나면 끝) | 번거로움 | 최상 |
| 법적 리스크 | 개인 사적이용 범위 | 없음 | 배포본은 없음 |
| 추가 작업 | - | - | +0.5일 |

### C안 확정에 따른 설계 방침
- **인증/과금/스토리지 제한 없음** → 로그인, 유저 테이블, 용량 제한 전부 미구현
- **Redis/Celery/Docker 미사용** → 단일 사용자이므로 인프로세스 잡 큐(동시 1건) + 파일 캐시로 충분
- **원본 wav를 로컬에 영구 캐시** → 재분석 시 다운로드 생략, 모델 교체·튜닝 반복이 매우 빨라짐 (M4 개발 속도에 직결)
- **CORS/보안 최소화**, `127.0.0.1` 바인딩. 단 **같은 공유기의 폰에서 접속**하려면 `0.0.0.0` 바인딩 + 방화벽 허용
- 오디오 입력부를 `AudioSource` 인터페이스로 추상화하고 `YouTubeSource` / `UploadSource` 두 어댑터를 둔다.
  분석 파이프라인은 오디오 출처를 모른다 → `ENABLE_YOUTUBE=false` 하나로 배포본이 B안이 된다
- **yt-dlp는 자주 깨짐** (YouTube 사양 변경). `pip install -U yt-dlp` 갱신 절차를 README에 명시하고, 추출 실패 시 "업로드로 대체" 폴백 안내

> 재생은 여전히 YouTube IFrame Player 사용. 추출한 오디오는 **분석 전용**.

## 2. 시스템 아키텍처

```
[Next.js 프론트]
   │  POST /api/analyze {youtubeUrl}
   ▼
[FastAPI 게이트웨이] ──► [Redis 큐] ──► [Python 워커]
   │                                        │
   │  GET /api/result/{jobId} (SSE/폴링)     ├─ yt-dlp (오디오 추출)
   ▼                                        ├─ ffmpeg (16kHz mono wav)
[결과 JSON 캐시]                             ├─ Demucs (반주 분리, 선택)
 (SQLite/Postgres, key=videoId)              ├─ 비트/다운비트 추적
                                             ├─ 크로마 추출
                                             └─ 코드 인식 모델
```

**결과 JSON 스키마 (핵심 계약, 먼저 확정할 것)**
```jsonc
{
  "videoId": "xxxx",
  "duration": 214.3,
  "bpm": 92.4,
  "timeSignature": "4/4",
  "key": "G major",
  "beats":     [{"t": 0.51, "beat": 1, "bar": 1}, ...],
  "chords":    [{"start": 0.51, "end": 2.62, "label": "G",  "root": "G", "quality": "maj"}, ...],
  "sections":  [{"start": 0.0, "end": 32.1, "label": "Intro"}],   // 선택
  "confidence": 0.83
}
```

---

## 3. 분석 파이프라인 (정확도의 90%가 여기서 결정)

| 단계 | 목적 | 라이브러리 후보 |
|---|---|---|
| 1. 다운로드/디코드 | wav 22.05k or 44.1k mono | `yt-dlp`, `ffmpeg` |
| 2. **음원 분리** (선택) | 보컬/드럼 제거 → 화성 정보만 남김. **정확도 크게 향상** | `demucs` (htdemucs), `spleeter` |
| 3. **비트/다운비트** | 코드 경계를 박자에 스냅 | `madmom` (RNNDownBeat), `beat_this`, `librosa.beat` |
| 4. 크로마 특징 | CQT 기반 12차원 피치 클래스 | `librosa.feature.chroma_cqt`, NNLS Chroma |
| 5. **코드 인식** | 프레임별 코드 라벨 | 아래 3안 참조 |
| 6. 후처리 | 비트 단위 median 스무딩, 최소 지속시간, 키 기반 보정 | 자체 구현 |
| 7. 키/카포 추정 | Krumhansl-Schmuckler 프로파일 | `librosa`, `music21` |

### 코드 인식 3가지 옵션 (단계적으로 올리기)
- **Plan A (1~2일, 베이스라인)**: 크로마 ↔ 24개 코드 템플릿 코사인 유사도 + HMM/Viterbi 스무딩.
  → 정확도 대략 55~65%. 파이프라인 전체를 먼저 뚫는 용도.
- **Plan B (권장 실전)**: 기존 오픈소스 사전학습 모델 적용
  - `autochord` (TF, 간편) / `chord-extractor` + **Chordino(NNLS Chroma)** VAMP 플러그인
  - **BTC-ISMIR19** (Bi-directional Transformer, PyTorch, 라지 보캐뷸러리)
  → 메이저/마이너 기준 75~83% 수준. **여기까지가 현실적 목표.**
- **Plan C (연구)**: Isophonics/Billboard/RWC 라벨로 CRNN 직접 학습 + 7th/sus/add 확장.

> Chord AI 수준(7th, sus, slash 코드까지)은 Plan B의 large-vocabulary 모델 + 음원분리 조합이 필요.

---

## 4. 프론트엔드 기능 목록

**MVP**
- [ ] YouTube URL 입력 → 진행률 표시(다운로드/분리/분석)
- [ ] YouTube IFrame Player 임베드
- [ ] 재생 시간에 동기화된 **코드 타임라인** (현재 코드 하이라이트, 마디 단위 그리드)
- [ ] 현재 코드의 **기타 프렛보드 다이어그램** (`svguitar` 또는 `vexchords`)
- [ ] BPM / 키 표시

**2차**
- [ ] 이조(Transpose) ±12, **카포 위치 추천**
- [ ] 구간 반복(A-B 루프), 재생 속도 0.5~1.5x (`playbackRate`)
- [ ] 코드 수동 편집 + 저장 (오인식 보정)
- [ ] 다이어그램 보이싱 선택(오픈/바레), 왼손잡이 모드
- [ ] 메트로놈/카운트인, 결과 PDF·텍스트 내보내기
- [ ] 즐겨찾기/히스토리, 모바일 반응형

---

## 5. 기술 스택 (확정안)

- **프론트**: Next.js 15 (App Router) + TypeScript + Tailwind + Zustand
  - `react-youtube` (IFrame API), `svguitar` (코드 다이어그램), `wavesurfer.js`(선택)
- **백엔드**: Python **3.11** + FastAPI + Uvicorn
  - ⚠️ 현재 PC는 **Python 3.14** — torch/madmom 휠이 없음. **3.11 venv 별도 생성 필수**
- **워커**: Celery(or RQ) + Redis. 로컬 단독이면 FastAPI BackgroundTasks로 시작 가능
- **DB**: SQLite(개발) → Postgres(배포). 결과 JSON은 videoId 기준 캐시
- **인프라**: 로컬 Docker Compose → (배포 시) GPU 인스턴스 or CPU 전용 모드
- **이미 설치됨**: ffmpeg 9.0 ✅, Node 24 ✅

---

## 6. 마일스톤

| # | 기간 | 산출물 | 완료 기준 |
|---|---|---|---|
| M0 | 0.5일 | 리포 스캐폴딩, 3.11 venv, Docker Compose, 결과 JSON 스키마 확정 | `docker compose up` 동작 |
| M1 | 1일 | yt-dlp+ffmpeg 오디오 파이프라인, 잡 큐, 진행률 SSE | URL 넣으면 wav 생성 |
| M2 | 1~2일 | 비트/다운비트 + 템플릿 코드 인식 (Plan A) | 결과 JSON 생성 |
| M3 | 2일 | Next.js UI: 플레이어 + 코드 타임라인 동기화 + 다이어그램 | **첫 데모 (MVP 완성)** |
| M4 | 2~3일 | Demucs 분리 + 사전학습 모델(Plan B) 교체, 후처리 튜닝 | 정확도 유의미 상승 |
| M5 | 1일 | **정확도 평가 하네스** — Chord AI 결과와 곡 10개 비교 | MIREX 방식 WCSR 수치화 |
| M6 | 2일 | 이조/카포/루프/속도/수동편집 | 2차 기능 완료 |
| M7 | 1~2일 | 캐시·에러처리·모바일 반응형·배포 | 공개(모드 B) 준비 완료 |

**총 11~14일 (1인 기준)**

---

## 7. 검증 계획 (Chord AI 대조)
1. 난이도별 10곡 선정 (통기타 발라드 3 / 밴드 록 3 / 재즈·7th 2 / 전조 있는 곡 2)
2. 각 곡을 Chord AI로 분석한 화면을 캡처 → 코드 시퀀스를 **정답 기준(reference)** 으로 기록
3. 우리 결과와 시간축 정렬 후 **Weighted Chord Symbol Recall** 계산
4. 목표: maj/min 어휘 기준 **≥ 78%**, 비트 F-measure **≥ 0.85**

---

## 8. 주요 리스크

| 리스크 | 완화책 |
|---|---|
| yt-dlp 추출 실패 (YouTube 사양 변경) | 정기 `pip install -U yt-dlp`, 실패 시 파일 업로드 폴백 |
| ~~CPU에서 Demucs 느림~~ | **RTX 5070 Ti(16GB) 확보** → 해소. 단 Blackwell(sm_120)은 cu128 이상 torch 휠 필요 |
| Python 3.14 휠 부재 | uv로 3.12 전용 환경 구성 (완료) |
| 7th/텐션 코드 오인식 | large-vocab 모델 + 수동 편집 UI로 보완 |
| 첫 분석 대기 시간 (2~5분) | SSE 진행률 + 부분 결과 스트리밍 |

---

## 9. 진행 상황

- [x] **M0 완료** — 스캐폴딩, Python 3.12 환경, 결과 JSON 스키마 확정, 업로드→SSE→결과 조회 E2E 동작
- [x] **M1 완료** — yt-dlp 실제 다운로드 + ffmpeg 모노 wav 디코딩 + 3단 캐시(결과/디코딩/원본) + 사이드카 메타데이터
- [x] **M2 완료** — librosa 비트 추적 + 다운비트 위상 추정 + 템플릿24×Viterbi 코드 인식 + KS 조성 추정 (3분30초 곡 CPU 9초)
- [x] **M3 완료** — 폰 세로 기준 재생 동기화 화면(고정 헤더 + 마디 그리드 자동 스크롤), CAGED 운지 다이어그램, 업로드 곡 오디오 재생
- [ ] **M4** — Demucs + 사전학습 코드 모델 (GPU) ← 다음
- [ ] **M5** — Chord AI 대조 평가
- [ ] **M6** — 이조/카포/루프/수동편집
- [ ] **M7** — 캐시·에러처리·모바일 마무리

### 확정된 환경
- GPU: **RTX 5070 Ti 16GB** (Blackwell sm_120 → torch cu128 이상)
- Python 3.12.14 (uv 관리), Node 24, ffmpeg 9.0
- 폰 접속: `http://192.168.1.199:3000` (양쪽 서버 `0.0.0.0` 바인딩)
