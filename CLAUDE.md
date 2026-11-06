# 쿠씨톤 프로젝트

## 음향 효과

효과음을 만들거나, 음원 파일·소리 설명을 받거나, "필요한 소리 뭐가 남았어?" 같은 요청을 받으면
반드시 `docs/sound-effects-guide.md`를 따른다. (`docs/sound-catalog-rules.superseded.md`는 이전 물건 기준 규칙으로, 더 이상 적용하지 않는다.)

- 분류 기준은 파손 도구 5종(`hydraulic_press`, `hammer`, `aluminum_bat`, `laser`, `bomb`) × 역할 4종(`activation`, `main_action`, `impact_detail`, `finish`).
- 사용 안 함 역할(사용자 결정 2026-11-07): 유압 프레스·망치·배트의 `impact_detail`, 레이저의 `main_action`, 폭탄의 `impact_detail`·`finish`. 엔진 `src/audio/presets/toolPresets.js`의 `disabledRoles`에 있고, 이 칸은 음원을 요청하거나 합성하지 않는다.
- 카탈로그 데이터: `sounds/catalog.json` / 사람이 읽는 표 + 준비 현황: `sounds/README.md`
- 합성음: `assets/audio/tools/{tool_code}/` / 사용자 제공 음원: `assets/audio/provided/`
- 재생 페이지: `sounds/player.html`. 카탈로그를 바꾼 뒤에는 `python scripts/build_player.py`로 다시 생성한다.
- 물건·도구 맞춤 선택·믹싱 모듈: `src/audio/` (설명 `docs/sound-engine.md`). 규칙 기반이며 학습형 AI라고 표현하지 않는다. 수정 후 `npm test`, `npm run validate`.
- 출시용이 아니므로 출처·라이선스는 기록하지도 묻지도 않는다.
- 참고 페이지(SMASH-KU)의 오디오·코드·파형은 추출하거나 복사하지 않는다. 타이밍·역할·느낌만 참고하고 독자적으로 합성한다.
- 원본 음원은 덮어쓰거나 삭제하지 않는다. 모르는 정보는 `unknown`/`null`.
- WAV 메타데이터는 Python 표준 `wave` 모듈로 읽는다. ffprobe·mutagen은 없다. MP3는 scratchpad의 프레임 헤더 파서 방식으로 계산했다.
- 음원을 실제로 청취·파형 분석하지 않았다면 그렇다고 기록한다.
