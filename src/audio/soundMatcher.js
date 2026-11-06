// 후보 검색·점수화 (규칙 기반). 학습 모델이 아니다.
import { SCORE_WEIGHTS as W, SCORE_THRESHOLDS, INTENSITY_LEVELS } from './constants.js';

/**
 * 카탈로그 항목 하나의 적합도 점수(0~100)와 항목별 내역.
 * 도구·역할 불일치는 hardMismatch로 표시되어 자동 선택되지 않는다.
 *
 * @param {object} entry  검증된 카탈로그 항목
 * @param {object} q
 * @param {string} q.tool_code
 * @param {string} q.sound_role
 * @param {string} [q.object_type]
 * @param {string[]} [q.materials]
 * @param {string[]} [q.preferredTextures]
 * @param {string[]} [q.expectedActions]
 * @param {string} [q.intensity]  light|medium|strong
 */
export function scoreSound(entry, q) {
  const b = {};
  b.tool_code = entry.tool_code === q.tool_code ? W.tool_code : 0;
  b.sound_role = entry.sound_role === q.sound_role ? W.sound_role : 0;

  // 물건: 명시 일치 > 범용(빈 배열) > 다른 물건 전용
  const targets = entry.target_objects ?? [];
  if (q.object_type && targets.includes(q.object_type)) b.target_objects = W.target_objects;
  else if (targets.length === 0) b.target_objects = W.target_objects / 2;
  else b.target_objects = 0;

  // 동작: 주 action 일치 > 보조 action 일치
  const expected = q.expectedActions ?? [];
  if (expected.includes(entry.action)) b.action = W.action;
  else if ((entry.secondary_actions ?? []).some((a) => expected.includes(a))) b.action = W.action / 2;
  else b.action = 0;

  // 강도: 일치 5, 한 단계 차이 2, unknown 1
  const ei = INTENSITY_LEVELS.indexOf(entry.intensity);
  const qi = INTENSITY_LEVELS.indexOf(q.intensity);
  if (ei < 0 || qi < 0) b.intensity = 1;
  else if (ei === qi) b.intensity = W.intensity;
  else if (Math.abs(ei - qi) === 1) b.intensity = 2;
  else b.intensity = 0;

  // 재질 3 + 질감 2 (보조)
  const mats = (q.materials ?? []).filter((m) => m !== 'unknown');
  const matHit = mats.length > 0 && (entry.material_codes ?? []).some((m) => mats.includes(m));
  const texHit = (entry.texture_tags ?? []).some((t) => (q.preferredTextures ?? []).includes(t));
  b.material_texture = (matHit ? 3 : 0) + (texHit ? 2 : 0);

  const score = Object.values(b).reduce((a, x) => a + x, 0);
  const hardMismatch = b.tool_code === 0 || b.sound_role === 0;
  return { score: Math.round(score), breakdown: b, hardMismatch };
}

/**
 * 도구·역할에 맞는 가장 적합한 음원을 고른다.
 * @param {object[]} playable  validateCatalog().playable
 * @param {object} q  scoreSound와 같은 조건
 * @param {{ random?: () => number }} [opts]  동점 변형 선택용 난수 (테스트 시 고정)
 * @returns {{ entry: object, score: number, tier: 'preferred'|'candidate', breakdown: object } | null}
 */
export function selectSound(playable, q, { random = Math.random } = {}) {
  let best = [];
  let bestScore = -1;
  let bestResult = null;
  for (const entry of playable) {
    // 레이저 main_action을 폭탄 main_action 대신 쓰는 일이 없도록 먼저 거른다
    if (entry.tool_code !== q.tool_code || entry.sound_role !== q.sound_role) continue;
    const r = scoreSound(entry, q);
    if (r.hardMismatch || r.score < SCORE_THRESHOLDS.candidate) continue;
    if (r.score > bestScore) {
      bestScore = r.score;
      best = [{ entry, r }];
    } else if (r.score === bestScore) {
      best.push({ entry, r });
    }
  }
  if (best.length === 0) return null;
  // 같은 점수의 변형이 여러 개면 무작위로 골라 반복 피로를 줄인다
  const pick = best[Math.floor(random() * best.length) % best.length];
  bestResult = {
    entry: pick.entry,
    score: pick.r.score,
    tier: pick.r.score >= SCORE_THRESHOLDS.preferred ? 'preferred' : 'candidate',
    breakdown: pick.r.breakdown,
  };
  return bestResult;
}
