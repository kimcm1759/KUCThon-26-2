# 쿠씨톤 프로젝트

## 음향 효과

효과음을 만들거나, 음원 파일·소리 설명을 받거나, "필요한 소리 뭐가 남았어?" 같은 요청을 받으면
반드시 `docs/sound-effects-guide.md`를 따른다. (`docs/sound-catalog-rules.superseded.md`는 이전 물건 기준 규칙으로, 더 이상 적용하지 않는다.)

- 분류 기준은 파손 도구 5종(`hydraulic_press`, `hammer`, `aluminum_bat`, `laser`, `bomb`) × 역할 4종(`activation`, `main_action`, `impact_detail`, `finish`).
- 사용 안 함 역할(사용자 결정 2026-11-07): 유압 프레스·망치·배트의 `impact_detail`, 레이저의 `main_action`, 폭탄의 `impact_detail`·`finish`. 엔진 `src/audio/presets/toolPresets.js`의 `disabledRoles`에 있고, 이 칸은 음원을 요청하거나 합성하지 않는다.
- 카탈로그 데이터: `sounds/catalog.json` / 사람이 읽는 표 + 준비 현황: `sounds/README.md`
- 재질 효과음: `assets/audio/materials/{material}/{sound_id}.ext`, 카탈로그는 `catalog.json`의 `material_sounds`. 엔진은 `status: ready` 항목을 물건 고유 소리 = 주 레이어로 쓰고 도구 소리는 보조 레이어로 낮춘다(규칙·믹스: `src/audio/presets/materialPresets.js`, 실측 표: `docs/sound-engine.md`). 물건 소리가 없으면 도구 소리를 키우지 말고 부족으로 표시한다. 원본 음량 측정값(`source_loudness`: LUFS·true peak·peak·RMS, 못 재면 null)과 앱 재생 gain(`mix.base_gain_db`, 규칙 `sounds/mix_settings.json`)은 `catalog.json`에 따로 적는다. 음원을 바꾸거나 도구 음원을 다시 만들면 `python scripts/measure_levels.py --pylib <miniaudio 경로>`를 실행한다. 라벨은 용도(마무리 등)가 아니라 실제 재질·동작(`label`, `action`, `repeat_count`, `quantity`, `recorded_source`)으로 붙인다. 제외 항목은 `material_sounds_excluded` + `materials/excluded/`, 편집 전 원본은 `materials/{material}/source/`에 보존.
- 합성음: `assets/audio/tools/{tool_code}/` / 사용자 제공 음원: `assets/audio/provided/`
- 음원은 앞·뒤 무음과 반복 구간을 잘라 저장한다(`python scripts/trim_audio.py --pylib <miniaudio 경로>`, 한 파일 = 한 번). 반복은 파일에 넣지 않고 사용자 조작(탭·누르기)에 맞춰 엔진이 재생한다. 자르기 전 파일은 각 폴더 `source/`로 옮겨 보존한다.
- 재생 페이지: `sounds/player.html`. 카탈로그를 바꾼 뒤에는 `python scripts/build_player.py`로 다시 생성한다.
- 물건·도구 맞춤 선택·믹싱 모듈: `src/audio/` (설명 `docs/sound-engine.md`). 규칙 기반이며 학습형 AI라고 표현하지 않는다. 수정 후 `npm test`, `npm run validate`.
- 출시용이 아니므로 출처·라이선스는 기록하지도 묻지도 않는다.
- 참고 페이지(SMASH-KU)의 오디오·코드·파형은 추출하거나 복사하지 않는다. 타이밍·역할·느낌만 참고하고 독자적으로 합성한다.
- 원본 음원은 덮어쓰거나 삭제하지 않는다. 모르는 정보는 `unknown`/`null`.
- WAV 메타데이터는 Python 표준 `wave` 모듈로 읽는다. ffprobe·mutagen은 없다. MP3는 scratchpad의 프레임 헤더 파서 방식으로 계산했다.
- 음원을 실제로 청취·파형 분석하지 않았다면 그렇다고 기록한다.
