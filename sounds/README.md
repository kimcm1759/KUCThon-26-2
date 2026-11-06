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
| `aluminum_bat_main_action_003` | `assets/audio/provided/aluminum_bat_main_action_003.wav` (2.1초, 48kHz 스테레오) | aluminum_bat | main_action | unknown | impact | unknown | 배트소리 — 원본(`provided/source/851452__hashtagsmcgee__bat_hit2.mp3`)을 길고 크게 변형(`scripts/derive_bat_main.py`) |
| `hammer_finish_002` | `assets/audio/provided/hammer_finish_002.wav` (0.3초, 48kHz 24bit 모노) | hammer | finish | unknown | other | unknown | 망치 종료음 — 합성음 `hammer_finish_001` 대체 |
| `paper_tear_001` | `assets/audio/provided/paper_tear_001.wav` (2.2초, 48kHz 스테레오, 앞뒤 무음 제거 · 원본 `provided/source/paper_tear_001.mp3`) | 미정 | 미정 | paper | other | unknown | 종이 찢는소리 |
| `paper_other_001` | `assets/audio/provided/paper_other_001.wav` (2.3초, 48kHz 스테레오, 앞 무음 제거 · 원본 `provided/source/paper_other_001.mp3`) | 미정 | 미정 | paper | other | light | 종이 가볍게 팔랑거리는 소리 |

도구·역할이 미정인 제공 음원은 `needs_review`이며 준비 현황에는 반영하지 않는다.

## 재질 효과음 (실제 재질·동작 라벨)

`catalog.json`의 `material_sounds`. 라벨은 용도(마무리 등)가 아니라 실제로 들리는 재질·동작이다. 엔진(`src/audio/`)은 이 목록의 `ready` 항목을 물건 고유 소리(주 레이어)로 쓴다(`src/audio/presets/materialPresets.js`). 제외 목록은 읽지 않는다.
필드: `label`(재질_대상_동작[_횟수]) · `material_code` · `action` · `secondary_actions` · `repeat_count` · `quantity` · `recorded_source`(실제 녹음 대상) · `derived_from`/`pre_trim_file`/`edits`(잘라내기·음량 조정 내역) · `level_db`/`peak_db`(재생 음량 보정용 측정값).
모든 파일은 `scripts/trim_audio.py`로 앞·뒤 무음과 반복 구간을 잘라 저장했다(한 파일 = 한 번). 반복은 앱 조작(탭할 때마다, 누르는 동안 진행 단계마다)에 맞춰 엔진이 재생한다. 자르기 전 파일은 각 폴더 `source/`에 있다.
태그는 음원 페이지 설명·사용자 설명·음량 측정 기준이며 청취 검수는 하지 않았다.

| 재질 | label | 동작 | 횟수 | 수량 | 파일 | 길이 | 편집 |
|---|---|---|---|---|---|---|---|
| cardboard | `cardboard_box_tap_single` | tap | 1 | single_object | `assets/audio/materials/cardboard/cardboard_box_tap_single_001.wav` | 0.19s | 원본(13회 이상 연속 탭)에서 3.39초 타격 1회만 잘라냄: 3.385~3.900초, 시작 3ms·끝 25ms 페이드. 음량은 바꾸지 않음.; 앞 무음 0 ms·뒤 무음 325 ms 제거 |
| cardboard | `cardboard_box_rub` | rub | - | - | `assets/audio/materials/cardboard/cardboard_box_rub_001.wav` | 0.8s | 앞 무음 260 ms·뒤 무음 773 ms 제거 |
| paper | `paper_sheet_tap_single` | tap | 1 | single_sheet | `assets/audio/materials/paper/paper_sheet_tap_single_001.wav` | 0.145s | 원본(여러 번 탭 + 인위적 공간 잔향)에서 1.12초 탭 1회만 잘라냄: 1.105~1.250초, 시작 3ms·끝 25ms 페이드. 잔향 꼬리는 잘라냈으나(끝 지점이 타격 대비 약 -29dB) 타격 직후 0.13초 안의 초기 잔향은 분리할 수 없어 남아 있음. 음량은 바꾸지 않음. |
| paper | `paper_sheet_rub_single` | rub | 1 | single_sheet | `assets/audio/materials/paper/paper_sheet_rub_single_001.wav` | 1.0s | 음량만 +34.9dB 올림. 소리가 나는 구간의 평균 음량을 판지 문지르기·유리 긁기와 같은 -18dB로 맞춤(최대 음량 -42.6 → -7.7dBFS). 길이·내용은 그대로. 원본 잡음 바닥(약 -62dB)도 같이 커져 약 -27dB가 됨. |
| paper | `paper_tear` | tear | - | - | `assets/audio/provided/paper_tear_001.wav` | 2.165s | 앞 무음 40 ms·뒤 무음 411 ms 제거 |
| paper | `paper_crumple` | crumple | - | single_sheet | `assets/audio/materials/paper/paper_crumple_001.wav` | 1.966s | 앞 무음 45 ms·뒤 무음 178 ms 제거 |
| aluminum | `aluminum_can_tap_single` | tap | 1 | single_object | `assets/audio/materials/aluminum/aluminum_can_tap_single_001.wav` | 0.262s | 맥주 캔 두드림 5회 중 첫 번째만 남김; 앞 무음 5 ms·뒤 무음 0 ms 제거 |
| aluminum | `aluminum_can_crush` | crush+squeeze | - | single_object | `assets/audio/materials/aluminum/aluminum_can_crush_001.wav` | 0.535s | 찌그러짐 뒤 약 0.9초 후 따로 난 작은 소리 제거; 앞 무음 515 ms·뒤 무음 270 ms 제거 |
| plastic | `plastic_keyboard_key_press_single` | key_press | 1 | single_key | `assets/audio/materials/plastic/plastic_key_press_single_001.wav` | 0.566s | 없음 |
| glass | `glass_tap_single` | tap | 1 | - | `assets/audio/materials/glass/glass_tap_single_001.wav` | 0.215s | 앞 무음 50 ms·뒤 무음 37 ms 제거 |
| ceramic | `ceramic_plate_hit_crack` | impact+crack | - | single_object | `assets/audio/materials/ceramic/ceramic_plate_hit_crack_001.wav` | 0.57s | 앞 무음 0 ms·뒤 무음 82 ms 제거 |
| glass | `glass_scrape` | scrape | - | - | `assets/audio/materials/glass/glass_scrape_001.wav` | 0.81s | 긁기 3회 중 첫 번째만 남김; 앞 무음 105 ms·뒤 무음 0 ms 제거 |
| glass | `glass_shatter_fall` | shatter+debris_fall | - | - | `assets/audio/materials/glass/glass_shatter_fall_001.wav` | 3.512s | 앞 무음 0 ms·뒤 무음 180 ms 제거 |

### 제외한 음원 (`material_sounds_excluded`)

파일은 `assets/audio/materials/excluded/`에 보존하고, 카탈로그 사용 후보에서는 뺐다. 편집 전 원본은 `assets/audio/materials/{재질}/source/`에 있다.

| 이전 ID | 설명 | 사유 | 보존 위치 |
|---|---|---|---|
| `cardboard_strong_impact_press_001` | 택배 상자를 발로 밟아 찌그러뜨리는 소리 | 판지 강한 충격·눌림 제거 지시 | `assets/audio/materials/excluded/563736__ravenrio__boxcrunch-01.wav` |
| `cardboard_finish_001` | 책을 덮는 소리 | 판지 마무리 제거 지시 (책 덮는 소리) | `assets/audio/materials/excluded/195795__ondondvo__closing-book.wav` |
| `aluminum_scrape_friction_001` | 캔을 나무 책상 위로 끄는 소리 | 알루미늄 긁힘·마찰 제거 지시 | `assets/audio/materials/excluded/423662__kierankeegan__can-sliding-across-wooden-desk.wav` |
| `aluminum_finish_001` | 캔을 바닥에 던져 구르는 소리 | 알루미늄 마무리 제거 지시 (캔을 던져 구르는 소리) | `assets/audio/materials/excluded/500024__hope-sounds__a-can-is-thrown-to-the-ground.mp3` |
| `aluminum_finish_002` | 캔 고리를 따서 여는 소리 | 알루미늄 마무리 제거 지시 (캔 고리 따는 소리) | `assets/audio/materials/excluded/617630__freddybob951__opening-tab-soda-can.m4a` |
| `plastic_strong_impact_press_001` | 플라스틱 통이 나무 바닥에 부딪히는 소리 | 플라스틱 강한 충격·눌림 제거 지시 | `assets/audio/materials/excluded/525099__jomse__plasticimpacta9.wav` |
| `plastic_strong_impact_press_002` | 작은 빈 플라스틱 용기를 금속 도구로 치는 소리 | 플라스틱 강한 충격·눌림 제거 지시 | `assets/audio/materials/excluded/844254__foxfire__plastic-container-tap.wav` |
| `plastic_scrape_friction_001` | 플라스틱을 문지르는 소리 | 플라스틱 긁힘·마찰 제거 지시 | `assets/audio/materials/excluded/669471__cjspellsfish__plastic-friction-1.wav` |
| `plastic_finish_001` | 플라스틱끼리 딸깍 꺾이는 소리 | 플라스틱 마무리 제거 지시 (평가가 좋지 않아 재사용하지 않음) | `assets/audio/materials/excluded/686167__redpanda69__plastic-snap.mp3` |
| `unclassified_finish_001` | 노트북 덮개를 닫는 소리 | 노트북 덮개 닫는 소리 제거 지시 | `assets/audio/materials/excluded/419952__14fpanskavesecka_karolina__closing-the-lid-of-laptop.wav` |
