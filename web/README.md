# 부숴봐 (web)

물건 사진 한 장 → Claude로 검증 → SAM 3로 물체 분리 → 빈 배경(Bria Eraser) + 3D 모델(TRELLIS.2) 생성 → 사진 속 그 자리에서 연장으로 부수기.

## 실행

`web/.env.local`에 키를 넣어요 (git에 올라가지 않아요).

```
ANTHROPIC_API_KEY=...
FAL_KEY=...
# 단계마다 후보 모델 전부 비교하려면 (사진당 약 $1.35)
# CANDIDATES=all
```

```bash
npm install
npm run dev:lan   # 같은 와이파이의 폰에서 http://<PC IP>:3000 으로 접속
```

시연은 `/jobs/<id>/play` 전체화면 부수기 화면에서 해요 (수집 일기에서 완료된 항목을 누르면 바로 열려요). `?fps`를 붙이면 프레임 수, `?sound=laptop|book|can`을 붙이면 소리 세트를 고정해요.

## 화면 (Figma "쿠씨톤" › page)

| 경로 | 화면 |
|---|---|
| `/onboarding` | 게스트 또는 시연용 이메일 로그인. 이메일과 닉네임(조민재)은 분리 저장 |
| `/` | 카메라 탭: 실시간 미리보기, 누르면 `/camera` |
| `/camera` | 전체화면 카메라: 셔터·배율·전환·갤러리. 찍으면 업로드 후 부수기 화면으로 (임시 저장 상태 `draft`: 부수기 화면의 **저장**을 눌러야 내 모음에 들어가요) |
| `/collection` | 내 모음 (내가 찍은 것, 저장한 것만) · 오른쪽 위 도감 아이콘 → `/collection/achievements` 업적 |
| `/collection/achievements` | 업적: 4칸씩 32칸 도감. 숨은 업적(노트북 001·캔 006·마우스 012·책 017)은 그 물건으로 판정된 내 사진을 한 번이라도 부수면 사진이 채워져요 (`src/lib/achievements.ts`) |
| `/network` | 네트워크: 기본 노트북·주황색 머그컵과 내 모음에서 올린 사진. `+`로 사진 선택 |
| `/settings` | 설정 (디자인 전, 같은 스타일로 임시) · `/dev` 파이프라인 결과 목록 |
| `/jobs/<id>/play` | 부수기 (Figma 부수기: 되돌리기·저장 버튼, 내 무기 타일. 만드는 중이면 단계 표시) · `?sync` 소리 맞추기 · `/jobs/<id>` 개발용 상세 |

디자인 값은 `src/app/globals.css`의 `@theme`, 아이콘·이미지는 `public/figma/`. 실시간 카메라는 https(또는 localhost)에서만 돼요 — 폰으로 PC 개발 서버를 볼 땐 `npm run dev:https` (인증서 경고는 "계속"), http면 셔터가 폰 기본 카메라를 열어요.

## 구조

| 경로 | 역할 |
|---|---|
| `src/lib/pipeline.ts` | 검증 → 분리 → 배경 지우기 ‖ 3D 생성 |
| `src/lib/candidates.ts` | fal.ai 모델 후보 (기본: `bria-eraser`, `trellis2`) |
| `src/lib/verify.ts` | Claude 사진 검증 + 재질·부서지는 방식·크기 추정 |
| `src/components/Composite.tsx` | 배경 사진 + 3D 캔버스, 화면 흔들림·섬광·레이저 경로 |
| `src/components/Smashable.tsx` | 손 조작, 연장, 내구도, 조각내기, 물리 |
| `src/components/fx/ToolActors.tsx` | 망치·배트·프레스·레이저·폭탄 모양과 애니메이션 |
| `src/lib/fracture*.ts` | 워커에서 보로노이 조각내기·레이저 절단 |
| `src/lib/breakage.ts` | 재질별 내구도·조각 수·튀는 세기 |

## 작업 데이터 (`.data/`)

사진 한 장 = 작업 하나 = `.data/jobs/<id>/` 폴더 하나. 도감·수집 일기처럼 지금까지 찍은 물건을 보여 주는 기능은 여기를 읽으면 돼요. git에 올라가 있어서 pull만 받으면 같은 데이터가 보여요 (고품질 3D 모델 `model-*-hq.glb`, `model-hunyuan3d.glb`만 용량 때문에 제외).

| 파일 | 내용 |
|---|---|
| `job.json` | 작업 전체 상태 (타입은 `src/lib/types.ts`의 `Job`) |
| `photo.jpg` | 원본 사진 (긴 변 1536px) |
| `cutout.png` | 물체만 오려 낸 투명 배경 정사각형 1024px — 도감 썸네일로 쓰기 좋아요 |
| `mask.png` | 물체 마스크 (흰색 = 물체) |
| `bg-<후보>.png` | 물체를 지운 빈 배경 |
| `model-<후보>.glb` | 3D 모델 |

`job.json`에서 자주 쓰는 값:

- `verify.result.label_ko` 이름, `material` 재질, `fragility` 부서지는 방식, `est_size_cm` 크기 추정, `ok` 검증 통과 여부
- `status`: `running | done | rejected | error`, `createdAt`: 찍은 시각
- `selection.background` / `selection.model`: 고른 후보 id, `backgrounds` / `models`의 `url`로 파일 경로를 얻어요
- `alignment`: 사진 속 위치 맞춤 값, `note`: 메모

API: `GET /api/jobs` (전체 목록, 최신순), `GET /api/jobs/<id>`, 파일은 `/api/files/<id>/<파일명>`. 직접 파일을 읽을 땐 `src/lib/store.ts`의 함수를 쓰세요 (`listJobs`, `getJob`, `updateJob` — 동시에 쓰는 걸 막아 줘요).

네트워크는 `GET /api/network`, `POST /api/network` (`{ jobId }`), `DELETE /api/network/<게시물 ID>`로 연결돼요. 작성자와 삭제 권한은 서버 세션의 계정 ID로 확인하고, 게스트 게시물은 게스트 세션끼리 관리해요. 삭제는 공유 기록만 지우므로 원본은 내 모음에 남아요. 로컬 공유 기록은 `.data/network-posts.json`에 저장되며 git에서는 제외돼요. 읽기 전용 배포에서는 기본 게시물만 표시하고 공유·삭제 요청은 403으로 응답해요.

시연용 로그인은 `POST /api/session`, 로그아웃은 `DELETE /api/session`이며 DB 없이 서버 메모리 세션과 HttpOnly 쿠키를 사용해요. 서버를 재시작하면 다시 로그인해야 해요. 일반 로그인은 `KUCthon@korea.ac.kr / 12345678`, 닉네임은 `조민재`예요.

## 고품질 3D

작업 화면의 "고품질 3D 4종 더 만들기" 버튼 (~$2.4, 3~6분): TRELLIS.2 고품질, Rodin HighPack, Tripo detailed, Hunyuan3D v3를 저장된 cutout으로 다시 만들어 3D 목록에 추가해요. 파일이 14~60MB라 배포 전에 줄여야 해요.

## 배포 (Vercel)

https://kucthon-26-2.vercel.app — 읽기 전용 시연판이에요. 서버에 디스크가 없어서 사진 업로드는 막혀 있고, 앱에 포함된 샘플만 보여요 (`VERCEL` 환경에서 자동, 로컬은 `READ_ONLY=1`).

```bash
node scripts/export-sample.mjs <jobId>   # 완성된 작업을 샘플로 포함 (public/samples/, src/lib/samples.json)
vercel deploy --prod                     # web/에서. Git 연동은 안 돼 있어서 push로는 배포되지 않아요
```

## 사운드

`public/sounds/<laptop|book|can|_common>/<연장>/<이벤트>.mp3`에 파일을 넣고 `npm run sounds`. 규칙과 이벤트 목록은 [public/sounds/README.md](public/sounds/README.md). 재생은 `src/lib/sound/engine.ts`.

## 개발용 스크립트

```bash
node scripts/bench-fracture.mjs <model.glb> [shatters|cracks] [impact|slice]   # 조각내기·절단 속도
node --env-file=.env.local scripts/try-eraser.mjs <jobId> [bria|finegrain]      # 배경 지우기 모델 바꿔 보기
```
