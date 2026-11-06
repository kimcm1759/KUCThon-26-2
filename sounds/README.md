# 음향 카탈로그

규칙: [`docs/sound-effects-guide.md`](../docs/sound-effects-guide.md) · 데이터: [`catalog.json`](catalog.json) · 합성기: [`scripts/synth_sfx.py`](../scripts/synth_sfx.py)

마지막 갱신: 2026-11-07

## 도구별 준비 현황

| 도구 | activation (준비·시작) | main_action (핵심 동작) | impact_detail (세부) | finish (종료·잔향) |
|---|---|---|---|---|
| 유압 프레스 (`hydraulic_press`) | covered | covered | 사용 안 함 | covered |
| 망치 (`hammer`) | covered | covered | 사용 안 함 | covered |
| 알루미늄 배트 (`aluminum_bat`) | covered | covered | 사용 안 함 | covered |
| 레이저 (`laser`) | covered | 사용 안 함 | covered | covered |
| 폭탄 (`bomb`) | covered | covered | 사용 안 함 | 사용 안 함 |

상태: `covered` · `missing` · `needs_review` · 사용 안 함(`disabled`, 엔진 `toolPresets.js`의 `disabledRoles` — 음원도 합성 폴백도 재생하지 않음)
남은 합성음은 모두 사람 청취 검수 전이다. 들어보고 어색한 항목은 알려주면 `scripts/synth_sfx.py`에서 조정 후 재생성한다.

## 합성 음원 (44.1kHz 모노 16bit WAV, 피크 -1dBFS)

| sound_id | 파일 | 길이 | 동작 | 강도 | 질감 | 설명 |
|---|---|---|---|---|---|---|
| `hydraulic_press_activation_001` | `assets/audio/tools/hydraulic_press/activation_001.wav` | 2.0s | other | medium | low, metallic | 모터·유압 작동, 점점 커지는 저음 모터음 + 상승하는 유압 쉭 |
| `hydraulic_press_main_action_001` | `assets/audio/tools/hydraulic_press/main_action_001.wav` | 1.8s | press | strong | low, dull | 내려오며 누르는 깊은 저음 럼블과 압축음 |
| `hydraulic_press_finish_001` | `assets/audio/tools/hydraulic_press/finish_001.wav` | 1.6s | decay | medium | airy, low | 멈춤 쿵 + 압력 해제 쉭 + 모터 감속 |
| `hammer_activation_001` | `assets/audio/tools/hammer/activation_001.wav` | 0.35s | swing | light | airy | 짧게 휘두르는 휙 |
| `aluminum_bat_activation_001` | `assets/audio/tools/aluminum_bat/activation_001.wav` | 0.5s | swing | medium | airy | 크게 공기를 가르는 휙 |
| `aluminum_bat_finish_001` | `assets/audio/tools/aluminum_bat/finish_001.wav` | 2.6s | decay | light | metallic, resonant | 맥놀이하며 감쇠하는 금속 잔향 |
| `laser_activation_001` | `assets/audio/tools/laser/activation_001.wav` | 1.2s | charge | medium | electronic, bright | 음높이가 올라가는 충전음 |
| `laser_impact_detail_001` | `assets/audio/tools/laser/impact_detail_001.wav` | 1.3s | other | medium | crunchy, bright | 지지는 치이익 + 튀는 소리 |
| `laser_finish_001` | `assets/audio/tools/laser/finish_001.wav` | 0.9s | decay | light | electronic | 음높이가 떨어지는 전원 감쇠 |
| `bomb_activation_001` | `assets/audio/tools/bomb/activation_001.wav` | 2.0s | other | light | crunchy, airy | 퓨즈 치지직 + 불꽃 + 긴장 저음 |
| `bomb_main_action_001` | `assets/audio/tools/bomb/main_action_001.wav` | 2.6s | explosion | strong | low, crunchy | 폭발 어택 + 저음 충격파 + 잔향 |

## 제공 음원

| sound_id | 파일 | 도구 | 역할 | 재질 | 동작 | 강도 | 설명 |
|---|---|---|---|---|---|---|---|
| `hammer_main_action_002` | `assets/audio/provided/hammer_main_action_002.wav` (0.44초, 48kHz 스테레오) | hammer | main_action | unknown | impact | unknown | 망치소리 — 원본(`provided/source/592112__pablodavilla__hammer_1.wav`)의 세 번째 타격만 잘라냄. 합성음 `hammer_main_action_001` 대체 |
| `aluminum_bat_main_action_002` | `assets/audio/provided/aluminum_bat_main_action_002.mp3` (0.7초, 48kHz 스테레오) | aluminum_bat | main_action | unknown | impact | unknown | 배트소리 — 합성음 `aluminum_bat_main_action_001` 대체 |
| `hammer_finish_002` | `assets/audio/provided/hammer_finish_002.wav` (0.3초, 48kHz 24bit 모노) | hammer | finish | unknown | other | unknown | 망치 종료음 — 합성음 `hammer_finish_001` 대체 |
| `paper_tear_001` | `assets/audio/provided/paper_tear_001.mp3` (2.6초, 48kHz 스테레오) | 미정 | 미정 | paper | other | unknown | 종이 찢는소리 |
| `paper_other_001` | `assets/audio/provided/paper_other_001.mp3` (2.4초, 48kHz 스테레오) | 미정 | 미정 | paper | other | light | 종이 가볍게 팔랑거리는 소리 |

도구·역할이 미정인 제공 음원은 `needs_review`이며 준비 현황에는 반영하지 않는다.
