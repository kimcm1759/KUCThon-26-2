# 사운드 재구성 모듈 (규칙 기반 v1)

물건·도구·사용자 조작에 맞춰 `sounds/catalog.json`의 효과음을 고르고, 레이어·타이밍·재생 파라미터를 정해 Web Audio로 재생한다.
**학습 모델이 아니다.** 메타데이터 점수화와 규칙 기반 믹싱이다.

## 구성

| 파일 | 역할 |
|---|---|
| `src/audio/soundCatalog.js` | 카탈로그 로드·검증. 깨진 JSON이면 빈 카탈로그로 동작(→ 합성 폴백) |
| `src/audio/soundMatcher.js` | 후보 검색·점수화 (0~100) |
| `src/audio/soundComposer.js` | 레이어·delay·gain·재생 속도·필터 결정 (순수 함수) |
| `src/audio/audioPlayer.js` | 재생, 페이드, 지속 루프, 전역 음량, 리미터, 연속 입력 제한 |
| `src/audio/fallbackSynth.js` | 도구별 단순 합성 폴백 |
| `src/audio/soundEngine.js` | 앱 진입점 (`tap` / `begin` / `update` / `end`) |
| `src/audio/soundFeedback.js` | 사람 평가 기록 (동의한 경우에만 저장, localStorage) |
| `src/audio/presets/toolPresets.js` | 도구 5종 타이밍·조합 |
| `src/audio/presets/objectPresets.js` | 책·캔·노트북 재질 조정 |

## 사용

```js
import { SoundEngine } from './src/audio/soundEngine.js';
const engine = await SoundEngine.create({ catalogUrl: 'sounds/catalog.json', debug: true });
await engine.player.resume();           // 사용자 제스처 안에서 호출
engine.preloadAll();

engine.tap({ object_type: 'aluminum_can', tool_code: 'hammer', intensity: 0.82, progress: 0.65 });

// 누르기 / 쓸기
engine.begin({ object_type: 'book', tool_code: 'hydraulic_press', interaction: 'press', intensity: 0.6, progress: 0 });
engine.update({ ...same, progress: 0.4 });            // 100ms마다 정도
engine.update({ ...same, progress: 0.5, swipe_speed: 0.7 }); // 레이저 쓸기
engine.end({ ...same, progress: 0.5 });

engine.setPreferences({ volume: 0.6, sound_enabled: false, effect_strength: 1 });
engine.reset(); // 새 물건
```

각 호출은 설계 문서 8장 형식의 결과(`selected_sounds`, `fallback_used`, `reason`)와 `sustain_updates`, `stop_sustain`, `muted`를 돌려준다. `reason`은 개발 로그용이며 사용자 화면에 띄우지 않는다.

## 확인 방법

- `npm test`: 로직 테스트 (node:test, 13개)
- `npm run validate`: 카탈로그 필드·ID 중복·파일 존재 검사 + 도구×역할 준비 현황
- `npm run demo` → `http://localhost:8000/demo/`: 물건·도구·조작을 바꿔 가며 듣고, 개발 로그에서 선택 이유를 본다

## 설계 문서와 다르게 해석·결정한 점

- **후보 선택 순서 (연결 지침 6장):** 도구·역할이 다른 소리는 먼저 걸러 내고 절대 대체하지 않는다. 남은 후보는 아래 단계 순으로 고르고, 같은 단계 안에서는 점수로 고른다. 결과의 `match` 필드에 단계가 남는다.
  1. `object_match`: `target_objects`에 현재 물건이 있음
  2. `material_match`: 재질 일치 (다른 물건용이거나 범용)
  3. `generic`: `target_objects`가 빈 범용 음원
  4. 도구별 합성 폴백 (`synth:{tool}_{role}`)
  5. 합성 레시피도 없으면 레이어 생략

  다른 물건 전용이면서 재질도 다른 음원은 후보가 아니다.
- **범용 음원 점수:** 지금 카탈로그는 모든 `target_objects`가 빈 배열이다. 빈 배열을 "범용"으로 보고 물건 항목 20점 중 10점을 준다. 0점으로 두면 모든 소리가 60~79점 구간에 들어가 항상 감쇠 재생되기 때문이다.
- **로드 실패:** 파일을 못 불러오면 같은 도구·역할의 합성음으로 대신하고(`on_load_fail`), 다른 레이어는 그대로 재생한다. 지속 루프 레이어는 대신하지 않고 건너뛴다.
- **asset 경로:** 기본은 `baseUrl + file_path`를 정적 URL로 쓴다. 번들러나 다른 플랫폼에서는 `SoundEngine.create({ resolveUrl: (fp) => ... })`로 실제 asset URL을 넘긴다.
- **준비 현황:** `npm run validate`가 도구 × 역할별 `covered` / `missing` / `needs_review` 상태와 물건 전용 음원 유무를 출력한다.
- **finish 시점:** 프레스·레이저는 손을 뗄 때마다, 망치·배트는 파손 완료(progress ≥ 1) 때만, 폭탄은 매번 재생한다. 망치를 칠 때마다 파편 낙하음이 나면 과하기 때문이다.
- **지속음:** 원본 WAV는 루프용이 아니다(`loopable` 필드 없음 → false). 그래서 프레스·레이저의 지속 레이어는 앞 25%의 어택 구간을 건너뛰고 25~90% 구간을 반복한다. 이음매가 들릴 수 있어 청취 확인이 필요하다.
- **progress 단계:** 0.33 / 0.66 / 1.0을 넘을 때 impact_detail을 하나씩 추가한다. 한 번에 크게 뛰어도 최대 2개(탭은 1개)까지만 추가한다.
- **도구·역할 미정 제공 음원**(`paper_tear_001`, `paper_other_001`)은 자동 재생에서 제외된다. 책용 레이어로 쓰려면 카탈로그에 `tool_code`·`sound_role`(예: `hydraulic_press` / `impact_detail`)과 `target_objects: ["book"]`을 정해 주면 된다.

## 검수 상태

모든 타이밍·gain·필터 값은 합성음 길이를 기준으로 정한 초기값이며 **사람 청취 검수 전**이다. 브라우저 실재생도 아직 확인하지 않았다(작성 시점에 브라우저 자동화가 연결되지 않았다). 로직은 테스트로, 모듈 문법과 import는 Node로, 파일 서빙은 로컬 서버로 확인했다.

## 물건 고유 소리 (material_sounds) — 주 레이어

규칙: `src/audio/presets/materialPresets.js`. 사용자 지시(2026-11-07 "물건별 고유 소리 강조")에 따라 **물건 소리가 주 레이어, 도구 소리는 보조 레이어**다.

- 물건 프로필(`OBJECT_SOUND_PROFILES`): 이벤트(hit_strong·hit_light·press·break)마다 슬롯 = 레이어. 슬롯 후보는 카탈로그의 [재질, 동작] 라벨.
  - 책: 종이 구김 + 표지 판지 두드림 / 누름은 구김↔페이지 마찰↔표지 마찰 / 파손은 종이 찢기 + 구김
  - 캔: 찌그러짐 + 빈 울림(두드림 첫 타격) / 누름은 찌그러짐 / 파손은 찌그러짐 + 울림
  - 노트북: 화면 유리 두드림 + 키캡 딸깍 / 누름은 유리 긁힘↔키 눌림 / 파손은 유리 깨짐 + 키캡
- 노트북 외장(알루미늄·플라스틱 케이스): 카탈로그의 알루미늄 음원은 모두 캔 녹음이라 쓰지 않는다. `object_sound.gaps`로 부족을 표시한다.
- 도구 → 이벤트(`TOOL_OBJECT_RULES`): 망치·배트 = 타격(강도별), 유압 프레스 = 누름(진행 20%마다 후보를 돌아가며), 레이저 = 완료 때 파손, 폭탄 = 폭발 때마다 파손.
- 맞는 물건 음원이 없으면 레이어를 생략하고 `plan.object_sound.status = 'missing'`, `missing`에 원하는 [재질·동작]을 남긴다. 도구 소리를 대신 키우지 않는다.
- 음량: `loudness_comp`로 카탈로그 `level_db`를 `object_target_db`(-10 dBFS)에 맞추고(최대 +24/-12 dB), 물건 레이어 피크 합(`peak_db` 기준)이 `peak_ceiling_db`(+2 dBFS)를 넘으면 함께 낮춘다. 물건 레이어는 도구 gain 합 정규화에서 빠진다. 원본 파일은 바꾸지 않는다.
- 음량 기준(2026-11-07 재측정): 모든 음원의 원본 음량을 `scripts/measure_levels.py`로 재서 `catalog.json`에 **측정값**(`source_loudness`)과 **재생 설정**(`mix`)을 따로 적는다. 원본 파일은 읽기만 한다. 자세한 내용은 아래 "원본 음량 측정과 재생 gain".
- 도구 레이어: 도구 전체에 `mix.base_gain_db`(도구 핵심 음원을 -12 LUFS에 맞추는 값, 한 도구 안 역할 비율 유지)를 적용한 뒤 도구별 `toolDb`(물건 기준 음량 대비: 망치 0, 배트 -7.1, 프레스 -13.5, 레이저 -8, 폭탄 -8.9 dB). 물건 소리 없이(도구 단독) 재생할 때는 둘 다 적용하지 않는다.
- 물건 우선 보장: 같은 계획에서 도구 핵심의 재생 음량(측정 LUFS + gain)이 물건 주 소리보다 `minObjectLeadDb`(망치 1.5, 그 외 6 dB) 이상 작지 않으면 도구 전체를 그만큼 낮춘다(키우지는 않음). 피크가 큰 녹음(책 구김)이 피크 제한으로 작아져도 물건이 주 소리로 남는다.
- 망치 핵심(`main_action`)은 물건별 하이패스를 걸지 않고(`keep_lows`), 시작 순간 +6 dB로 시작해 70 ms 동안 원래 크기로 돌아온다(`attack_boost_db`·`attack_ms`).
- 조작 강도는 물건 레이어를 0.75~1배 안에서만 움직인다. 전역 음량·효과 강도·음소거는 기존대로 모든 레이어에 적용된다.

### 실측 비교 (2026-11-07, 브라우저 실제 플레이어 오프라인 렌더, 청취 아님)

`AudioPlayer`를 OfflineAudioContext로 돌려 물건 레이어만 / 도구 레이어만의 활성 RMS를 비교했다(강도 0.6). 이전 표는 Python 렌더였고 플레이어 버그(아래)를 반영하지 못해 폐기했다.

| 같은 입력 | 물건이 도구보다 (책 / 캔 / 노트북) | 도구 핵심음 → 물건 소리 시작 |
|---|---|---|
| 망치 탭 | +5.0 / +6.7 / +9.5 dB | +90 ms → +145 ms |
| 망치 약한 탭 | +10.5 / -2.7 / +13.6 dB | +90 ms → +145 ms |
| 배트 탭 | +6.1 / +8.0 / +10.6 dB | +180 ms → +235 ms |
| 유압 프레스 누르기 시작 | +4.8 / +7.6 / +8.9 dB | +900 ms → +915 ms |
| 레이저 완료 | +6.0 / +10.5 / +16.2 dB | - → +540 ms |
| 폭탄 | +8.3 / +10.8 / +10.3 dB | +1500 ms → +1540 ms |

위 표는 2026-11-07 음량 재측정 전 값이다(아래 "원본 음량 측정과 재생 gain"의 비교가 최신).

전체 피크는 -0.9 ~ -2.7 dBFS. 망치·배트는 물건 소리를 핵심음보다 40 ms 늦게 시작해(`objectLagMs`) 도구 타격이 먼저 들린다. 캔 약한 탭은 캔 두드림 녹음이 작아 도구가 조금 더 크다.


- 저장 형식: 모든 음원은 `scripts/trim_audio.py`로 앞·뒤 무음(최대 피크 대비 -45 dB 이하)과 반복 구간(캔 두드림 5회 → 1회, 유리 긁기 3회 → 1회, 캔 찌그러짐 뒤 별도 소리)을 잘라 저장했다. 반복은 파일이 아니라 조작에 따라 엔진이 한다: 탭할 때마다 다시 재생, 누르는 동안 진행 20%마다 다시 얹기, 프레스 기계음은 누르는 동안만 루프. 합성음(`scripts/synth_sfx.py`)도 저장 전에 같은 함수로 자른다.
- `onset_ms`: 앞 무음이 남은 파일이 새로 들어와도 그 지점부터 재생하도록 엔진이 지원한다(현재 카탈로그는 모두 0). 캔 찌그러짐은 원본 앞 0.5초가 무음이라 이전에는 타격보다 늦게 나오고 길이 제한의 페이드아웃에 걸려 잘 안 들렸다.
- 피크 제한은 시간이 실제로 겹치는 물건 레이어끼리만 더하고, 넘으면 보조 소리(slot ≥ 1, 예: 캔 울림)를 먼저 최소 1/4까지 낮춘 뒤 그래도 넘을 때만 전체를 낮춘다. 값은 사람 청취로 다시 조정해야 한다.

## 원본 음량 측정과 재생 gain (2026-11-07)

`python scripts/measure_levels.py --pylib <miniaudio 경로>` — 음원을 바꾸거나 도구 음원을 다시 만들면 다시 실행한다. 규칙은 `sounds/mix_settings.json`.

| 필드 | 뜻 |
|---|---|
| `source_loudness.integrated_lufs` | ITU-R BS.1770-4 integrated (K-weighting, 400 ms 블록, -70/-10 게이트). **0.4초보다 짧은 파일은 null**(블록을 만들 수 없음, `unmeasured`에 이유) |
| `source_loudness.max_loudness_100ms_lufs` | K-weighting·BS.1770 채널 가중 후 가장 큰 100 ms 창 |
| `source_loudness.playback_max_loudness_100ms_lufs` | 같은 값을 브라우저가 실제로 내는 스테레오(모노는 양쪽, 5.1은 Web Audio 다운믹스)로 잰 것. **재생 gain 기준** |
| `source_loudness.true_peak_dbtp` | 4배 FFT 보간 최대값(BS.1770 부록 2의 FIR와 방식이 달라 근사) |
| `source_loudness.peak_dbfs` / `rms_dbfs` | 샘플 피크 / 파일 전체 RMS |
| `spectrum.dominant_octave_hz` | 에너지가 가장 많은 옥타브 대역(겹침 ducking 주파수) |
| `mix.base_gain_db` | 앱 재생 gain. 물건 음원은 파일마다 -12 LUFS로, 도구 음원은 도구 핵심 기준 한 값 |
| `mix.priority` / `ducking_group` | 망치·배트 휘두름·핵심 = `tool_action`, 물건 = `object_identity`(겹침 대역 ducking 대상) |

- 측정 결과: 29개 항목(파일 28개) 모두 숫자 측정됨. integrated LUFS만 0.4초보다 짧은 7개(망치 휘두름·망치 마무리·배트 준비·판지 탭·종이 탭·캔 두드림·유리 탭)가 null(`measurement_status: partial`). 디코딩 실패·파일 없음은 없음. 키캡 녹음은 6채널(5.1)이라 재생 기준은 다운믹스로 쟀다.
- 이전 기준(1024샘플 창 RMS, `level_db`)은 주파수 가중이 없어 망치 핵심(중고역 0.7~1.4 kHz)을 실제보다 6 dB가량 작게 봤고, 키캡처럼 크게 들리는 녹음을 +1.7 LUFS까지 키웠다. 새 기준은 물건 음원을 모두 -12 LUFS 근처로 고르게 맞춘다(보정 한계 +24/-12 dB).
- 피크: 물건 레이어 피크 합은 측정 **true peak** 기준, 전역 음량 전 0 dB까지(`peak_ceiling_db`). 96 kHz 캔 녹음은 48 kHz 재생 때 true peak가 0.3 dB 올라가므로 여유를 둔 값.

### 겹침 조정
- 망치 타이밍: 휘두름(준비)은 앞 40 ms(거의 무음으로 커지는 부분)를 건너뛰고 110 ms 재생 후 30 ms로 끝 → 원본에서 가장 큰 부분이 타격 직전에 온다. 이전에는 휘두름 최대(원본 110~150 ms)가 핵심음(90 ms)과 겹쳐 묻혔다. 핵심 90 → 110 ms, 물건 +165 ms, 마무리(파편, 완료 때만) 250 → 380 ms(책 판지 탭 저음과 겹치지 않게).
- 대역 ducking: 망치·배트 핵심음이 울리는 동안 시작하는 물건 레이어는 핵심음 주 대역(망치 1 kHz, 배트 2 kHz)만 -4 dB로 시작해 120 ms 동안 원래대로(피킹 EQ). 물건의 다른 대역과 어택은 그대로.

### 비교 (Python 오프라인 재현, 청취 아님)
엔진이 실제로 만든 계획(gain·지연·필터·ducking·어택)을 Python으로 재현했다(대역 제한 리샘플, 전역 음량 0.8, Chrome 리미터 근사). 브라우저 실제 플레이어로는 다시 재지 않았다. 판정: 각 레이어가 자기 최대에서 20 dB 안쪽인 50 ms 창 중 자기 주 옥타브 대역에서 나머지 레이어 합보다 가장 크게 나오는 순간(glimpse)이 +3 dB 이상이면 OK, 0~3 dB 경계, 0 미만 묻힘. 강도 0.6(망치 강타·완료는 0.9).

망치 탭(강도 0.6) 단독 구간 RMS:

| | 책 | 캔 | 노트북 |
|---|---|---|---|
| 휘두름 단독(40~110 ms) | -31.7 dB | -29.3 dB | -27.3 dB |
| 핵심 단독(110~165 ms), 처음 | -28.7 dB | -27.8 dB | -27.2 dB |
| 핵심 단독, 직전 수정(정규화·어택) | -20.1 dB | -19.2 dB | -18.7 dB |
| 핵심 단독, 이번 | **-19.2 dB** | **-16.0 dB** | **-13.4 dB** |
| 물건 주 소리 최대(20 ms 창) | -18.3 dB | -17.2 dB | -13.8 dB |

18개 조합(6가지 입력 × 3물건) 출력 true peak와 경계 판정(나머지 레이어는 모두 OK, 묻힘 0개):

| 같은 입력 | 책 | 캔 | 노트북 |
|---|---|---|---|
| 망치 탭 | -5.2 dBTP | -4.8 dBTP | -3.3 dBTP |
| 망치 강타·완료 | -7.9 dBTP | -4.8 dBTP | -3.7 dBTP |
| 배트 탭 | -5.2 dBTP | -4.8 dBTP (경계: 물건보조:aluminum·tap +1.7 dB) | -5.6 dBTP |
| 프레스 탭 | -1.8 dBTP | -1.6 dBTP | -6.5 dBTP |
| 레이저 완료 | -4.1 dBTP (경계: 도구세부 +2.0 dB) | -4.7 dBTP | -9.4 dBTP |
| 폭탄 | -3.8 dBTP (경계: 물건보조:paper·crumple +2.0 dB) | -4.6 dBTP | -9.0 dBTP |

경계 3개는 보조 레이어(캔 빈 울림, 종이 구김)와 레이저 두 번째 세부음이다. 주 소리·도구 핵심·휘두름은 모든 조합에서 OK.

## 시각화 화면 `demo/stage.html`

`npm run demo`(캐시를 끄는 `scripts/dev_server.py`) 후 `http://localhost:8000/demo/stage.html`. 물건 그림을 탭하거나 누르고 있으면 소리가 나고, 진행도에 따라 그림이 찌그러지거나 깨진다.
- 이번 입력에서 엔진이 고른 소리(물건/도구, 지연 ms)와 부족 여부
- 지금 실제로 재생 중인 소리와 음량(플레이어 `meters`·`onLayerEvent` 훅, AnalyserNode)
- 타임라인: 최근 3초 + 예정 1.5초, 레인별(물건 주·보조, 도구 준비·핵심·세부·종료) 막대와 실제 음량, 건너뛴 레이어는 빨간 테두리와 이유
- 카탈로그·음원은 `?v=` 쿼리로 캐시를 피한다.

### 망치 핵심 소리가 안 들리던 원인과 수정 (2026-11-07, Python 오프라인 렌더로 실제 계획의 gain·필터·지연 재현, 청취 아님)
- 원인 1: 물건 소리는 녹음마다 -10 dBFS로 보정(책 구김 ×13 등)하는데 도구 소리는 원본 크기 그대로였다. 망치 핵심 파일은 -14.3 dBFS로 작아 "물건 -7 dB" 설정이 실제로는 -10~-14 dB였다.
- 원인 2: 망치 핵심 에너지의 71%가 0.8~3.2 kHz로 노트북 유리 탭·캔 찌그러짐과 같은 대역이고, 피크 없이 0.4초 동안 천천히 줄어드는 소리라 물건 소리가 시작되는 순간(+55 ms) 묻혔다. 책에는 220 Hz 하이패스도 걸려 있었다(영향 작음). 리미터·레이어 건너뜀은 원인이 아니었다(감쇠 0 dB).
- 수정: 위의 도구 레벨 정규화 + 망치 핵심 하이패스 제거·어택 강조. 물건 소리 레이어는 바꾸지 않았다.

| 망치 탭 강도 0.6 | 책 | 캔 | 노트북 |
|---|---|---|---|
| 핵심 단독 구간(90~145 ms) RMS, 수정 전 | -28.7 dB | -27.8 dB | -27.2 dB |
| 같은 구간, 수정 후 | -20.1 dB | -19.2 dB | -18.7 dB |
| 물건 소리 최대(20 ms 창, 변화 없음) | -18.7 dB | -16.1 dB | -14.4 dB |

### 고친 문제 (2026-11-07)
`AudioPlayer`가 길이 제한(`max_duration_ms`)이 있는 레이어에서 `src.stop()`을 `src.start()`보다 먼저 호출해 Web Audio가 InvalidStateError를 냈고, 그 레이어가 재생되지 않았다. 모든 물건 소리와 일부 도구 소리(탭 때 유압 프레스·레이저 준비 등)가 처음부터 실제로는 재생되지 않았다. start → stop 순서로 고치고, 파일이 제한보다 짧으면 자르지 않게 했다. `tests/player.test.mjs`가 가짜 AudioContext로 순서를 검사한다. 이전 실측 표는 Python 오프라인 렌더라 이 문제를 잡지 못했다.
