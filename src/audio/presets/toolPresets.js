// 도구별 레이어 조합 프리셋. 시간 단위는 ms.
// 값은 카탈로그 합성음 길이(scripts/synth_sfx.py)에 맞춘 초기값이며 사람 청취로 튜닝해야 한다.
//
// mode
//   'sustain' : 누르기/쓸기 동안 main_action을 루프로 유지 (유압 프레스, 레이저)
//   'oneshot' : 입력마다 한 번에 재생 (망치, 배트, 폭탄)
// expectedActions: 역할별로 적합한 catalog action 값 (점수화에 사용)
// tap: 탭 한 번에 재생할 레이어 타이밍
// start: 누르기/쓸기 시작 시 레이어 타이밍 (sustain 모드)
// disabledRoles: 이 도구에서 아예 재생하지 않는 역할 (음원도 합성 폴백도 쓰지 않음, 사용자 결정 2026-11-07)
// finishOn: 'end' = 입력 종료마다 finish, 'complete' = 파손 완료(progress>=1) 때만, 'always' = 매 동작마다

export const TOOL_PRESETS = {
  hydraulic_press: {
    disabledRoles: ['impact_detail'],
    mode: 'sustain',
    finishOn: 'end',
    expectedActions: {
      activation: ['charge', 'other'],
      main_action: ['press'],
      impact_detail: ['crack', 'break', 'rattle'],
      finish: ['decay'],
    },
    tap: {
      activation: { delay_ms: 0, gain: 0.45, max_duration_ms: 700, fade_out_ms: 200 },
      main_action: { delay_ms: 350, gain: 0.8, max_duration_ms: 1200, fade_out_ms: 300 },
      impact_detail: { delay_ms: 650, gain: 0.55 },
    },
    start: {
      // activation 길이를 늘려 쓰고, 그 뒤 저음 압력 레이어를 지속
      activation: { delay_ms: 0, gain: 0.5 },
      main_action: { delay_ms: 900, gain: 0.55, loop: true, fade_in_ms: 250 },
    },
    // progress가 오를수록 압축음 크기·밀도 증가
    sustainGain: (progress) => 0.55 + 0.4 * progress,
    sustainRate: () => 1,
    detail: { gain: 0.6 },
    finish: { gain: 0.7 },
    stopFadeMs: 250,
  },

  hammer: {
    disabledRoles: ['impact_detail'],
    mode: 'oneshot',
    finishOn: 'complete',
    expectedActions: {
      activation: ['swing'],
      main_action: ['impact', 'tap'],
      impact_detail: ['crack', 'debris', 'break'],
      finish: ['debris', 'decay'],
    },
    tap: {
      activation: { delay_ms: 0, gain: 0.35 },
      main_action: { delay_ms: 90, gain: 0.8, transient: true },
      impact_detail: { delay_ms: 140, gain: 0.5 },
    },
    detail: { gain: 0.5 },
    finish: { gain: 0.6, delay_ms: 250 },
  },

  aluminum_bat: {
    disabledRoles: ['impact_detail'],
    mode: 'oneshot',
    finishOn: 'complete',
    expectedActions: {
      activation: ['swing'],
      main_action: ['impact'],
      impact_detail: ['rattle', 'debris'],
      finish: ['decay'],
    },
    tap: {
      activation: { delay_ms: 0, gain: 0.45 },
      main_action: { delay_ms: 180, gain: 0.8, transient: true },
      // 금속 공명은 타격 직후 짧게 감쇠
      impact_detail: { delay_ms: 210, gain: 0.45, max_duration_ms: 650, fade_out_ms: 350 },
    },
    detail: { gain: 0.45, max_duration_ms: 650, fade_out_ms: 350 },
    finish: { gain: 0.55, delay_ms: 500 },
  },

  laser: {
    disabledRoles: ['main_action'],
    mode: 'sustain',
    finishOn: 'end',
    expectedActions: {
      activation: ['charge'],
      main_action: ['beam', 'fire'],
      impact_detail: ['other', 'scrape', 'crack'],
      finish: ['decay'],
    },
    tap: {
      activation: { delay_ms: 0, gain: 0.45, max_duration_ms: 500, fade_out_ms: 120 },
      main_action: { delay_ms: 420, gain: 0.7, max_duration_ms: 700, fade_out_ms: 200 },
      impact_detail: { delay_ms: 480, gain: 0.45, max_duration_ms: 600, fade_out_ms: 200 },
    },
    start: {
      // 충전 → 빔 지속 → (지짐은 progress·쓸기와 함께) → 종료
      activation: { delay_ms: 0, gain: 0.5, max_duration_ms: 700, fade_out_ms: 150 },
      main_action: { delay_ms: 550, gain: 0.6, loop: true, fade_in_ms: 80 },
    },
    sustainGain: (progress, swipeSpeed) => 0.5 + 0.2 * progress + 0.2 * swipeSpeed,
    // 쓸기 속도를 빔 재생 속도에 연결 (0.9~1.15)
    sustainRate: (swipeSpeed) => 0.9 + 0.25 * swipeSpeed,
    detail: { gain: 0.5 },
    finish: { gain: 0.65 },
    stopFadeMs: 120,
  },

  bomb: {
    disabledRoles: ['impact_detail', 'finish'],
    mode: 'oneshot',
    finishOn: 'always',
    expectedActions: {
      activation: ['other', 'charge'],
      main_action: ['explosion'],
      impact_detail: ['debris', 'break'],
      finish: ['decay', 'debris'],
    },
    tap: {
      activation: { delay_ms: 0, gain: 0.5 }, // 퓨즈
      main_action: { delay_ms: 1500, gain: 0.9, transient: true },
      impact_detail: { delay_ms: 1580, gain: 0.6 }, // 저음 충격 뒤 파편 겹침
    },
    detail: { gain: 0.55 },
    finish: { gain: 0.6, delay_ms: 2500 }, // 잔향·잔해 감쇠
  },
};

// 파손 진행도 단계: 이 값을 넘을 때마다 impact_detail 레이어를 하나씩 추가
export const PROGRESS_STEPS = [0.33, 0.66, 1.0];
