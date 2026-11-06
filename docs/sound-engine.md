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

- `npm test`: 로직 테스트 (node:test, 11개)
- `npm run validate`: 카탈로그 필드·ID 중복·파일 존재 검사
- `npm run demo` → `http://localhost:8000/demo/`: 물건·도구·조작을 바꿔 가며 듣고, 개발 로그에서 선택 이유를 본다

## 설계 문서와 다르게 해석·결정한 점

- **물건 일치 점수:** 지금 카탈로그는 모든 `target_objects`가 빈 배열이다. 빈 배열을 "범용"으로 보고 20점 중 10점을 준다. 0점으로 두면 모든 소리가 60~79점 구간에 들어가 항상 감쇠 재생되기 때문이다. 다른 물건 전용으로 표시된 소리는 0점이다.
- **도구·역할은 필수 조건:** 점수와 별개로 먼저 걸러 낸다. 맞는 소리가 없으면 다른 도구 소리를 쓰지 않고 그 도구의 합성 폴백을 쓴다. "재질별 소리로 폴백"은 도구·역할이 정해진 소리 안에서 재질 점수로만 반영한다.
- **finish 시점:** 프레스·레이저는 손을 뗄 때마다, 망치·배트는 파손 완료(progress ≥ 1) 때만, 폭탄은 매번 재생한다. 망치를 칠 때마다 파편 낙하음이 나면 과하기 때문이다.
- **지속음:** 원본 WAV는 루프용이 아니다(`loopable` 필드 없음 → false). 그래서 프레스·레이저의 지속 레이어는 앞 25%의 어택 구간을 건너뛰고 25~90% 구간을 반복한다. 이음매가 들릴 수 있어 청취 확인이 필요하다.
- **progress 단계:** 0.33 / 0.66 / 1.0을 넘을 때 impact_detail을 하나씩 추가한다. 한 번에 크게 뛰어도 최대 2개(탭은 1개)까지만 추가한다.
- **도구·역할 미정 제공 음원**(`paper_tear_001`, `paper_other_001`)은 자동 재생에서 제외된다. 책용 레이어로 쓰려면 카탈로그에 `tool_code`·`sound_role`(예: `hydraulic_press` / `impact_detail`)과 `target_objects: ["book"]`을 정해 주면 된다.

## 검수 상태

모든 타이밍·gain·필터 값은 합성음 길이를 기준으로 정한 초기값이며 **사람 청취 검수 전**이다. 브라우저 실재생도 아직 확인하지 않았다(작성 시점에 브라우저 자동화가 연결되지 않았다). 로직은 테스트로, 모듈 문법과 import는 Node로, 파일 서빙은 로컬 서버로 확인했다.
