// 물건별 음향 조정 프리셋.
// defaultMaterials는 사용자가 재질을 확인하지 않았을 때 쓰는 "기본 가정"이다.
// 사진으로 재질을 확정했다는 뜻이 아니므로 reason에도 preset 기본값임을 표시한다.
//
// roleGain: 역할별 gain 배수
// roleRate: 역할별 재생 속도 배수 (높을수록 얇고 밝게)
// roleShape: 역할별 추가 재생 제한 (max_duration_ms, fade_out_ms)
// mainHighpass(progress): main_action에 거는 하이패스 주파수(Hz). null이면 필터 없음

export const OBJECT_PRESETS = {
  book: {
    label: '책',
    defaultMaterials: ['paper', 'cardboard'],
    preferredTextures: ['crunchy', 'soft', 'dry', 'dull'],
    roleGain: { activation: 1, main_action: 0.85, impact_detail: 1.15, finish: 0.9 },
    roleRate: { impact_detail: 1.05 },
    roleShape: {},
    // 무거운 저음은 약하게 시작하고 진행될수록 저음을 연다
    mainHighpass: (progress) => Math.round(220 - 170 * progress),
  },

  aluminum_can: {
    label: '알루미늄 캔',
    defaultMaterials: ['aluminum'],
    preferredTextures: ['metallic', 'resonant', 'rattly', 'bright', 'crunchy'],
    roleGain: { activation: 1, main_action: 0.95, impact_detail: 1.15, finish: 0.85 },
    // 얇은 속 빈 금속: 세부 레이어를 조금 높고 짧게
    roleRate: { main_action: 1.06, impact_detail: 1.12 },
    roleShape: { impact_detail: { max_duration_ms: 700, fade_out_ms: 300 } },
    mainHighpass: () => 90,
  },

  laptop: {
    label: '노트북',
    // 세부 재질 미확인 시: 일반 전자기기 케이스(플라스틱·금속) 가정
    defaultMaterials: ['plastic', 'aluminum'],
    preferredTextures: ['dull', 'sharp', 'metallic', 'crunchy'],
    roleGain: { activation: 1, main_action: 1, impact_detail: 1, finish: 1 },
    roleRate: {},
    roleShape: {},
    mainHighpass: () => null,
  },
};

/** 알 수 없는 물건이면 중립 프리셋 */
export const GENERIC_OBJECT_PRESET = {
  label: '일반',
  defaultMaterials: ['unknown'],
  preferredTextures: [],
  roleGain: {},
  roleRate: {},
  roleShape: {},
  mainHighpass: () => null,
};

export function getObjectPreset(objectType) {
  return OBJECT_PRESETS[objectType] ?? GENERIC_OBJECT_PRESET;
}
