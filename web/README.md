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

작업 데이터(사진, 마스크, GLB)는 `.data/jobs/<id>/`에 저장돼요 (git 제외).

## 사운드

`public/sounds/<laptop|book|can|_common>/<연장>/<이벤트>.mp3`에 파일을 넣고 `npm run sounds`. 규칙과 이벤트 목록은 [public/sounds/README.md](public/sounds/README.md). 재생은 `src/lib/sound/engine.ts`.

## 개발용 스크립트

```bash
node scripts/bench-fracture.mjs <model.glb> [shatters|cracks] [impact|slice]   # 조각내기·절단 속도
node --env-file=.env.local scripts/try-eraser.mjs <jobId> [bria|finegrain]      # 배경 지우기 모델 바꿔 보기
```
