// 레이어·타이밍·재생 파라미터 구성. 순수 함수라서 브라우저 없이 테스트할 수 있다.
// 원본 파일은 건드리지 않고 재생 시점 파라미터(gain, playback_rate, filter, 길이 제한)만 만든다.
import {
  TOOL_CODES, SOUND_ROLES, CANDIDATE_GAIN_FACTOR,
  normalizeIntensity, intensityValue, clamp,
} from './constants.js';
import { TOOL_PRESETS, PROGRESS_STEPS } from './presets/toolPresets.js';
import { getObjectPreset } from './presets/objectPresets.js';
import { selectSound } from './soundMatcher.js';

const MAX_LAYER_GAIN = 1.0;

/**
 * @typedef {object} ComposeInput
 * @property {string} object_type          book | aluminum_can | laptop
 * @property {string[]} [object_materials] 사용자가 확인한 재질. 없으면 물건 프리셋 기본값
 * @property {string} tool_code
 * @property {'tap'|'press'|'swipe'} [interaction='tap']
 * @property {'start'|'update'|'end'} [phase='start']  누르기·쓸기의 시작/진행/종료
 * @property {number|string} [intensity]   0~1 또는 light|medium|strong
 * @property {number} [progress=0]         파손 진행도 0~1
 * @property {number} [previous_progress=0] 직전 progress (단계 레이어 추가 판정용)
 * @property {number} [swipe_speed=0]      쓸기 속도 0~1
 * @property {boolean} [finish_played=false] 이번 제스처에서 finish를 이미 재생했는지
 * @property {boolean} [sound_enabled=true]
 */

/**
 * @param {ComposeInput} input
 * @param {object[]} playable  validateCatalog().playable
 * @param {{ random?: () => number }} [opts]
 */
export function compose(input, playable, { random = Math.random } = {}) {
  const out = {
    selected_sounds: [],
    sustain_updates: [],
    stop_sustain: null,
    fallback_used: false,
    muted: input.sound_enabled === false,
    reason: '',
  };
  const tool = TOOL_PRESETS[input.tool_code];
  if (!TOOL_CODES.includes(input.tool_code) || !tool) {
    out.reason = `unknown tool_code "${input.tool_code}" — 재생 안 함`;
    return out;
  }

  const obj = getObjectPreset(input.object_type);
  const userMaterials = Array.isArray(input.object_materials)
    ? input.object_materials.filter((m) => m && m !== 'unknown') : [];
  const materials = userMaterials.length ? userMaterials : obj.defaultMaterials;
  const materialSource = userMaterials.length ? 'user_confirmed' : 'object_preset_default';

  const interaction = input.interaction ?? 'tap';
  const phase = input.phase ?? 'start';
  const level = normalizeIntensity(input.intensity);
  const iv = intensityValue(input.intensity);
  const progress = clamp(Number(input.progress) || 0, 0, 1);
  const prev = clamp(Number(input.previous_progress) || 0, 0, 1);
  const swipe = clamp(Number(input.swipe_speed) || 0, 0, 1);
  const sustained = tool.mode === 'sustain' && (interaction === 'press' || interaction === 'swipe');
  const notes = [];

  const ctx = { input, tool, obj, materials, level, progress, random, out, notes, playable };

  // ---- 레이어 계획 ----
  if (phase === 'start') {
    const timing = sustained ? tool.start : tool.tap;
    addLayer(ctx, 'activation', timing.activation, 0.8 + 0.2 * iv);
    const mainScale = timing.main_action?.transient ? 0.6 + 0.4 * iv : 0.75 + 0.25 * iv;
    addLayer(ctx, 'main_action', timing.main_action, sustained ? 1 : mainScale);

    if (!sustained && timing.impact_detail && (level !== 'light' || progress >= PROGRESS_STEPS[0])) {
      addLayer(ctx, 'impact_detail', timing.impact_detail, 0.5 + 0.5 * Math.max(iv, progress));
    }

    // 탭 한 번으로 끝나는 동작의 finish
    const tapFinish = !sustained && (
      tool.finishOn === 'always'
      || (tool.finishOn === 'end')
      || (tool.finishOn === 'complete' && progress >= 1)
    );
    if (tapFinish && !input.finish_played) {
      const m = timing.main_action;
      const delay = tool.finish?.delay_ms ?? (m.delay_ms + (m.max_duration_ms ?? 400) - 100);
      addLayer(ctx, 'finish', { ...tool.finish, delay_ms: delay }, 1);
    }
  }

  // 진행도 단계(0.33/0.66/1.0)를 넘을 때마다 균열·찌그러짐·파편 레이어를 하나씩 추가
  if (phase !== 'end') {
    // 진행도가 한 번에 크게 뛰어도 레이어가 쌓이지 않게 최근 단계만 남긴다
    // (탭은 이미 detail 하나가 있으므로 1개, 그 외 2개까지)
    const tapStart = phase === 'start' && !sustained;
    const crossed = PROGRESS_STEPS.filter((t) => prev < t && progress >= t).slice(tapStart ? -1 : -2);
    const base = tapStart ? (tool.tap.impact_detail?.delay_ms ?? 0) + 80 : 0;
    crossed.forEach((t, i) => {
      addLayer(ctx, 'impact_detail', { ...tool.detail, delay_ms: base + i * 60 }, 0.6 + 0.4 * t);
    });
    if (crossed.length) notes.push(`progress ${prev.toFixed(2)}→${progress.toFixed(2)}: detail ${crossed.length}단계 추가`);
  }

  // 누르기·쓸기 유지 중 지속 레이어 파라미터
  if (sustained && phase === 'update') {
    const g = tool.sustainGain(progress, swipe) * (obj.roleGain.main_action ?? 1);
    const rate = tool.sustainRate(swipe) * (obj.roleRate.main_action ?? 1);
    const hp = obj.mainHighpass(progress);
    out.sustain_updates.push({
      role: 'main_action',
      gain: round(clamp(g, 0, MAX_LAYER_GAIN)),
      playback_rate: round(rate),
      highpass_hz: hp,
      ramp_ms: 120,
    });
  }

  // 종료·완료 처리
  // start(탭)의 완료 finish는 위 tapFinish가 처리한다
  if (phase !== 'start') {
    const completedNow = prev < 1 && progress >= 1;
    const endedSustain = phase === 'end' && sustained;
    const wantFinish = completedNow || (endedSustain && tool.finishOn === 'end');
    if (wantFinish && !input.finish_played) {
      addLayer(ctx, 'finish', { ...tool.finish, delay_ms: 0 }, 1);
      if (completedNow) notes.push('파손 완료 → finish');
    }
    // 완료 또는 입력 종료 시 진행 중 루프를 페이드아웃
    if (sustained && (completedNow || phase === 'end')) {
      out.stop_sustain = { fade_ms: tool.stopFadeMs ?? 200 };
    }
  }

  // 겹치는 레이어 합이 과하면 함께 낮춘다 (최종 클리핑 방지는 플레이어 리미터가 담당)
  const total = out.selected_sounds.reduce((a, s) => a + s.gain, 0);
  if (total > 1.8) {
    const k = 1.8 / total;
    for (const s of out.selected_sounds) s.gain = round(s.gain * k);
    notes.push(`gain 합 ${total.toFixed(2)} → 1.8로 정규화`);
  }

  out.reason = [
    `tool=${input.tool_code} object=${input.object_type ?? 'unknown'} interaction=${interaction} phase=${phase} intensity=${level}`,
    `materials=${materials.join('+')} (${materialSource})`,
    ...out.selected_sounds.map((s) => `${s.role}: ${s.sound_id} ${s.synth ? '(synth fallback)' : `(score ${s.score}, ${s.tier})`}`),
    ...notes,
  ].join('; ');
  return out;
}

function addLayer(ctx, role, timing, scale) {
  if (!timing || !SOUND_ROLES.includes(role)) return;
  const { input, tool, obj, materials, level, progress, random, out, playable } = ctx;

  const match = selectSound(playable, {
    tool_code: input.tool_code,
    sound_role: role,
    object_type: input.object_type,
    materials,
    preferredTextures: obj.preferredTextures,
    expectedActions: tool.expectedActions[role],
    intensity: level,
  }, { random });

  let gain = (timing.gain ?? 0.6) * scale * (obj.roleGain[role] ?? 1);
  let rate = obj.roleRate[role] ?? 1;
  const shape = { ...timing, ...(obj.roleShape[role] ?? {}) };

  const layer = {
    sound_id: null,
    file_path: null,
    role,
    delay_ms: Math.round(timing.delay_ms ?? 0),
  };

  if (match) {
    if (match.tier === 'candidate') gain *= CANDIDATE_GAIN_FACTOR;
    layer.sound_id = match.entry.sound_id;
    layer.file_path = match.entry.file_path;
    layer.score = match.score;
    layer.tier = match.tier;
  } else {
    // 같은 도구·역할 음원이 없음 → 다른 도구 소리를 쓰지 않고 도구별 단순 합성
    layer.sound_id = `synth:${input.tool_code}_${role}`;
    layer.synth = { tool_code: input.tool_code, role };
    out.fallback_used = true;
  }

  // 루프가 아닌 레이어는 재생 속도를 ±3% 흔들어 반복 피로를 줄인다
  if (!shape.loop) rate *= 0.97 + 0.06 * random();

  layer.gain = round(clamp(gain, 0, MAX_LAYER_GAIN));
  layer.playback_rate = round(rate);
  if (shape.loop) layer.loop = true;
  if (shape.fade_in_ms) layer.fade_in_ms = shape.fade_in_ms;
  if (shape.max_duration_ms) layer.max_duration_ms = shape.max_duration_ms;
  if (shape.fade_out_ms) layer.fade_out_ms = shape.fade_out_ms;
  if (role === 'main_action') {
    const hp = obj.mainHighpass(progress);
    if (hp) layer.highpass_hz = hp;
  }
  out.selected_sounds.push(layer);
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
