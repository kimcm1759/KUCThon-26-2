// 물건 고유 소리(object sound) 규칙. catalog.json의 material_sounds(실제 재질·동작 라벨)에서 고른다.
// 규칙 기반이며 학습 모델이 아니다. 값은 초기값이고 사람 청취로 튜닝해야 한다.
//
// 믹싱 우선순위 (사용자 지시 2026-11-07 "물건별 고유 소리 강조"):
//   1. 물건 고유 소리 = 주 레이어 (기준 0 dB)
//   2. 도구 소리 = 보조 레이어 (OBJECT_MIX.tool_db, 도구별 toolDb로 조정)
//   3. 물건 소리가 없으면 도구 소리를 대신 키우지 않고 부족(missing)으로 표시
//
// 물건 프로필
//   parts  : 부위 → 재질 (설명용, 사용자 확인 재질 필터에도 씀)
//   events : 이벤트 → 슬롯 목록. 슬롯 하나 = 레이어 하나. 슬롯은 [재질, 동작] 후보 배열이며 앞쪽 우선.
//            { gain } 을 붙이면 슬롯 음량 배수(보조 울림 등)
//     hit_strong / hit_light : 망치·배트 타격
//     press                  : 유압 프레스 누름 (진행 단계마다 후보를 돌아가며 사용)
//     break                  : 파손 완료·폭발
//   gaps   : 카탈로그에 해당 물건 부위용 녹음이 없어 비워 둔 부분 (부족 표시용)

export const OBJECT_SOUND_PROFILES = {
  book: {
    label: '책',
    parts: { cover: ['cardboard'], pages: ['paper'] },
    events: {
      // 종이 구김이 중심, 표지 판지 두드림을 아래에 깔아 무게감
      hit_strong: [{ alts: [['paper', 'crumple']] }, { alts: [['cardboard', 'tap']], gain: 0.6 }],
      hit_light: [{ alts: [['cardboard', 'tap'], ['paper', 'tap']] }, { alts: [['paper', 'rub']], gain: 0.5 }],
      // 눌릴 때: 종이 구김 ↔ 페이지 마찰 ↔ 표지 마찰
      press: [{ alts: [['paper', 'crumple'], ['paper', 'rub'], ['cardboard', 'rub']] }],
      break: [{ alts: [['paper', 'tear']] }, { alts: [['paper', 'crumple']], gain: 0.7 }],
    },
    gaps: [],
  },

  aluminum_can: {
    label: '알루미늄 캔',
    parts: { can_body: ['aluminum'] },
    events: {
      // 찌그러짐 + 얇은 금속의 빈 울림(두드림 첫 타격)
      hit_strong: [{ alts: [['aluminum', 'crush']] }, { alts: [['aluminum', 'tap']], gain: 0.7 }],
      hit_light: [{ alts: [['aluminum', 'tap']] }],
      press: [{ alts: [['aluminum', 'crush']] }],
      break: [{ alts: [['aluminum', 'crush']] }, { alts: [['aluminum', 'tap']], gain: 0.6 }],
    },
    gaps: [],
  },

  laptop: {
    label: '노트북',
    parts: { screen: ['glass'], keycaps: ['plastic'], exterior: ['aluminum', 'plastic'] },
    events: {
      // 화면 유리의 단단하고 얇은 진동 + 키캡 플라스틱 딸깍임
      hit_strong: [{ alts: [['glass', 'tap']] }, { alts: [['plastic', 'key_press']], gain: 0.8 }],
      hit_light: [{ alts: [['glass', 'tap']] }, { alts: [['plastic', 'key_press']], gain: 0.5 }],
      press: [{ alts: [['glass', 'scrape'], ['plastic', 'key_press']] }],
      break: [{ alts: [['glass', 'shatter']] }, { alts: [['plastic', 'key_press']], gain: 0.6 }],
    },
    // 카탈로그의 알루미늄 음원은 모두 캔 녹음이라 노트북 외장에 쓰지 않는다 (캔과 구별 안 됨)
    gaps: [{ part: 'exterior', materials: ['aluminum', 'plastic'], message: '노트북 외장(알루미늄·플라스틱 케이스) 전용 녹음 없음' }],
  },
};

// 도구 → 물건 이벤트
//   tap      : 탭 한 번에 쓰는 이벤트 ('hit' = 강도에 따라 hit_strong/hit_light, 'press', null = 없음)
//   press    : 누르기 시작·진행 단계마다 press 이벤트 (stepEvery 간격)
//   breakOnMain: 파손 완료 대신 매번 main_action 순간에 break (폭탄)
//   toolDb   : 물건 믹스일 때 도구 핵심 소리의 재생 음량을 물건 기준 음량보다 이만큼(dB) 낮춘다(+는 높임).
//              음량 기준은 측정값 playback_max_loudness_100ms_lufs(K-weighting, 브라우저가 실제로 내는 스테레오).
//              도구·물건 음원 모두 scripts/measure_levels.py가 catalog의 mix.base_gain_db로 기준 음량(-12 LUFS)에 맞추고
//              (도구는 핵심 음원 기준 한 값이라 휘두름·타격·마무리 비율 유지), 엔진은 그 위에 toolDb를 적용한다.
//              2026-11-07 재측정: 이전 기준(1024샘플 창 RMS)은 주파수 가중이 없어 망치 핵심(중고역)을 실제보다 작게 봤다.
//              망치 외 도구는 재측정 전과 같은 물건 대비 음량이 되도록 환산한 값. 망치는 0 dB(물건 기준과 같은 파일 음량,
//              강도·프리셋 gain까지 넣은 실제 재생은 물건보다 약 2~3 dB 작음)로 올리고 타이밍·대역 ducking을 함께 조정.
//   minObjectLeadDb: 같은 계획에서 도구 핵심 재생 음량이 물건 주 소리보다 최소 이만큼 작게 (넘으면 도구 전체를 낮춤).
//              없으면 OBJECT_MIX.min_object_lead_db. 물건 녹음이 피크가 커서 피크 제한으로 작아진 경우(책 구김)에도 물건이 주 소리로 남게
//   objectLagMs: 타격 도구에서 물건 소리를 도구 핵심음보다 이만큼 늦게 시작 → "딱(도구) → 우지직(물건)" 순서로 도구 타격이 묻히지 않게
export const TOOL_OBJECT_RULES = {
  hammer: { tap: 'hit', toolDb: 0, objectLagMs: 40, minObjectLeadDb: 1.5 },
  aluminum_bat: { tap: 'hit', toolDb: -7.1, objectLagMs: 40 },
  hydraulic_press: { tap: 'press', press: true, stepEvery: 0.2, toolDb: -13.5 },
  laser: { tap: null, toolDb: -8 },
  bomb: { tap: null, breakOnMain: true, toolDb: -8.9 },
};

// 믹스 기준
//   object_target_db: catalog에 mix.base_gain_db가 없는 물건 음원만: 1024샘플 창 RMS 최댓값(level_db)을 이 값(dBFS)에 맞춘다
//                     (있으면 측정 기반 base_gain_db를 그대로 쓴다. 규칙은 sounds/mix_settings.json)
//   tool_db         : 도구 레이어 기본 감쇠 (도구별 toolDb가 없을 때)
//   max_boost_db / max_cut_db: 음량 보정 한계 (작게 녹음된 소리는 잡음도 같이 커진다)
//   intensity       : 조작 강도는 물건 레이어를 이 범위 안에서만 움직인다 (전체 음량 무제한 증가 방지)
export const OBJECT_MIX = {
  object_target_db: -10,
  // 물건 레이어들의 피크 합(측정 true peak × gain × 보정, 전역 음량 전)이 이 값을 넘으면 물건 레이어를 함께 낮춘다
  // (클리핑 방지. 전역 음량 0.8과 리미터 -6 dB까지 더해 출력 true peak 약 -1 dBTP 이하 여유)
  peak_ceiling_db: 0,
  tool_db: -9,
  max_boost_db: 24,
  max_cut_db: 12,
  // 도구 음량 정규화 한계 (catalog에 mix.base_gain_db가 없을 때만: 도구 핵심 소리 level_db → object_target_db)
  tool_max_boost_db: 9,
  tool_max_cut_db: 12,
  // 겹침 대역 ducking: 타격 도구 핵심(priority tool_action)이 울리는 동안 시작하는 물건 레이어(ducking_group object_identity)를
  // 핵심음의 주 대역(측정한 spectrum.dominant_octave_hz)에서만 db만큼 낮췄다가 ms 동안 원래대로. 물건의 다른 대역·어택은 그대로
  band_duck: { db: -4, q: 1.4, ms: 120 },
  min_object_lead_db: 6,
  intensity: { min: 0.75, max: 1 },
};

// 레이어 길이 (긴 찌그러짐·깨짐이 다음 입력을 덮지 않게)
export const OBJECT_SHAPE = {
  hit: { max_duration_ms: 800, fade_out_ms: 250 },
  press: { max_duration_ms: 1800, fade_out_ms: 500 },
  break: { max_duration_ms: 2600, fade_out_ms: 600 },
};
