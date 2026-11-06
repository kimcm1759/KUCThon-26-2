// 사운드 재구성 모듈 공통 어휘. docs/sound-effects-guide.md 6장과 일치시킨다.

export const TOOL_CODES = ['hydraulic_press', 'hammer', 'aluminum_bat', 'laser', 'bomb'];
export const SOUND_ROLES = ['activation', 'main_action', 'impact_detail', 'finish'];
export const OBJECT_TYPES = ['book', 'aluminum_can', 'laptop'];

// 앱 입력 interaction 코드: 탭 / 누르기(유지) / 쓸기
export const INTERACTIONS = ['tap', 'press', 'swipe'];

export const INTENSITY_LEVELS = ['light', 'medium', 'strong'];

// 점수 가중치 (설계 문서 5장 초기값). 합계 100.
export const SCORE_WEIGHTS = {
  tool_code: 35,
  sound_role: 25,
  target_objects: 20,
  action: 10,
  intensity: 5,
  material_texture: 5,
};

export const SCORE_THRESHOLDS = {
  preferred: 80, // 80~100 우선 사용
  candidate: 60, // 60~79 보조 사용(gain 감쇠)
};

// 60~79점 후보를 쓸 때 적용하는 gain 배수
export const CANDIDATE_GAIN_FACTOR = 0.7;

/** 숫자(0~1) 또는 문자열 강도를 light/medium/strong으로 정규화 */
export function normalizeIntensity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const v = Math.min(1, Math.max(0, value));
    if (v < 0.34) return 'light';
    if (v < 0.67) return 'medium';
    return 'strong';
  }
  if (INTENSITY_LEVELS.includes(value)) return value;
  return 'medium';
}

/** 강도를 0~1 수치로 정규화 (gain 계산용) */
export function intensityValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  return { light: 0.25, medium: 0.55, strong: 0.9 }[value] ?? 0.55;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
