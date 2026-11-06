// 레이어·타이밍·재생 파라미터 구성. 순수 함수라서 브라우저 없이 테스트할 수 있다.
// 원본 파일은 건드리지 않고 재생 시점 파라미터(gain, playback_rate, filter, 길이 제한)만 만든다.
import {
  TOOL_CODES, SOUND_ROLES, CANDIDATE_GAIN_FACTOR,
  normalizeIntensity, intensityValue, clamp,
} from './constants.js';
import { TOOL_PRESETS, PROGRESS_STEPS } from './presets/toolPresets.js';
import { getObjectPreset } from './presets/objectPresets.js';
import { selectSound } from './soundMatcher.js';
import { OBJECT_SOUND_PROFILES, TOOL_OBJECT_RULES, OBJECT_MIX, OBJECT_SHAPE } from './presets/materialPresets.js';

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
 * @param {{ random?: () => number, materialSounds?: object[] }} [opts]
 *   materialSounds: validateCatalog().materials (재질·동작 라벨 음원).
 *   있으면 물건 고유 소리가 주 레이어, 도구 소리는 보조 레이어(toolDb만큼 낮춤). 비어 있으면 도구 소리만(기존 믹스).
 */
export function compose(input, playable, { random = Math.random, materialSounds = [] } = {}) {
  const out = {
    selected_sounds: [],
    sustain_updates: [],
    stop_sustain: null,
    fallback_used: false,
    muted: input.sound_enabled === false,
    // 물건 고유 소리 상태: ok | missing(부족) | no_profile(물건 규칙 없음) | off(재질 카탈로그 없음)
    object_sound: { status: 'off', layers: [], missing: [], gaps: [] },
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
  // 물건 고유 소리: 물건 프로필 + 도구 이벤트 규칙. 있으면 물건이 주 레이어, 도구는 보조 레이어
  const orule = TOOL_OBJECT_RULES[input.tool_code];
  const profile = OBJECT_SOUND_PROFILES[input.object_type];
  const objectMix = Boolean(orule && materialSounds.length);
  const toolScale = objectMix && profile ? dbToGain(orule.toolDb ?? OBJECT_MIX.tool_db) : 1;
  // 도구 음원 원본 크기 차이 보정: 도구 핵심 소리 level_db → 물건 기준 레벨. 그래야 toolDb가 실제 물건 대비 dB가 된다
  const toolComp = objectMix && profile ? toolLoudnessComp(playable, input.tool_code, tool) : 1;
  const { min: ovMin, max: ovMax } = OBJECT_MIX.intensity;
  const ov = ovMin + (ovMax - ovMin) * iv;
  const mctx = { profile, userMaterials, materialSounds, random, out };
  if (objectMix) {
    out.object_sound.status = profile ? 'ok' : 'no_profile';
    out.object_sound.gaps = profile?.gaps ?? [];
  }
  const mainTiming = (sustained ? tool.start : tool.tap).main_action;
  const mainDelay = Math.round(mainTiming?.delay_ms ?? 0);

  // ---- 레이어 계획 ----
  if (phase === 'start') {
    const timing = sustained ? tool.start : tool.tap;
    addLayer(ctx, 'activation', timing.activation, 0.8 + 0.2 * iv);
    const mainScale = timing.main_action?.transient ? 0.6 + 0.4 * iv : 0.75 + 0.25 * iv;
    addLayer(ctx, 'main_action', timing.main_action, sustained ? 1 : mainScale);

    if (!sustained && timing.impact_detail && (level !== 'light' || progress >= PROGRESS_STEPS[0])) {
      addLayer(ctx, 'impact_detail', timing.impact_detail, 0.5 + 0.5 * Math.max(iv, progress));
    }

    // 물건: 타격·누름 순간 (폭탄은 폭발 순간 파손 소리)
    if (objectMix) {
      if (orule.breakOnMain) addObjectEvent(mctx, 'break', mainDelay + 40, ov);
      else if (sustained && orule.press) addObjectEvent(mctx, 'press', mainDelay + 15, ov);
      else if (!sustained && orule.tap === 'hit') addObjectEvent(mctx, level === 'light' ? 'hit_light' : 'hit_strong', mainDelay + 15 + (orule.objectLagMs ?? 0), ov);
      else if (!sustained && orule.tap === 'press') addObjectEvent(mctx, 'press', mainDelay + 15, ov);
      if (!sustained && progress >= 1 && !orule.breakOnMain && !input.finish_played) {
        addObjectEvent(mctx, 'break', mainDelay + 120, 1);
      }
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
    // 누르기 유지: 진행 단계마다 재질 눌림 소리
    if (objectMix && sustained && orule.press && phase === 'update') {
      const every = orule.stepEvery ?? 0.33;
      const step = Math.floor(progress / every + 1e-9);
      if (progress < 1 && step > Math.floor(prev / every + 1e-9)) {
        // 단계마다 후보를 돌려 쓴다 (책: 구김 → 페이지 마찰 → 표지 마찰 …)
        addObjectEvent(mctx, 'press', 0, ovMin + (ovMax - ovMin) * Math.max(iv, progress), step);
      }
    }
    if (crossed.length) notes.push(`progress ${prev.toFixed(2)}→${progress.toFixed(2)}: detail ${crossed.length}단계 추가`);
  }

  // 누르기·쓸기 유지 중 지속 레이어 파라미터
  if (sustained && phase === 'update' && !isDisabled(tool, 'main_action')) {
    const g = tool.sustainGain(progress, swipe) * (obj.roleGain.main_action ?? 1) * toolScale * toolComp;
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
    if (objectMix && completedNow && !input.finish_played && !orule.breakOnMain) addObjectEvent(mctx, 'break', 0, 1);
    // 완료 또는 입력 종료 시 진행 중 루프를 페이드아웃
    if (sustained && (completedNow || phase === 'end')) {
      out.stop_sustain = { fade_ms: tool.stopFadeMs ?? 200 };
    }
  }

  // 겹치는 레이어 합이 과하면 함께 낮춘다 (최종 클리핑 방지는 플레이어 리미터가 담당)
  // 물건 레이어는 주 레이어라 합 정규화에서 뺀다. 도구 레이어는 보조 음량(toolScale)으로 낮춘다.
  // 물건 소리가 없어도 도구 소리를 대신 키우지 않는다.
  const objLayers = out.selected_sounds.filter((s) => s.material);
  // 피크 제한: 보조 소리(slot ≥ 1)를 먼저 낮추고(최소 1/4), 그래도 넘으면 전부 함께 낮춘다
  const ceiling = dbToGain(OBJECT_MIX.peak_ceiling_db);
  const peak0 = overlappingPeak(objLayers);
  if (peak0 > ceiling) {
    const secondary = objLayers.filter((s) => s.slot > 0);
    const primaryOnly = overlappingPeak(objLayers.filter((s) => !(s.slot > 0)));
    const secPeak = peak0 - primaryOnly;
    if (secondary.length && secPeak > 0) {
      const f = clamp((ceiling - primaryOnly) / secPeak, 0.25, 1);
      for (const s of secondary) s.gain = round(s.gain * f);
    }
    const peak1 = overlappingPeak(objLayers);
    if (peak1 > ceiling) for (const s of objLayers) s.gain = round(s.gain * ceiling / peak1);
    notes.push(`물건 피크 합 ${(20 * Math.log10(peak0)).toFixed(1)} dBFS → ${OBJECT_MIX.peak_ceiling_db} dBFS 제한(보조 소리 먼저)`);
  }
  const toolLayers = out.selected_sounds.filter((s) => !s.material);
  // 겹침 대역 ducking: 타격 핵심음이 울리는 동안 시작하는 물건 레이어를 핵심음 주 대역에서만 잠깐 낮춘다
  const core = toolLayers.find((s) => s.role === 'main_action' && s.priority === 'tool_action' && s.dominant_hz && !s.loop);
  if (core) {
    const coreEnd = core.delay_ms + (core.play_ms ?? 400);
    const { db, q, ms } = OBJECT_MIX.band_duck;
    for (const s of objLayers) {
      if (s.ducking_group === 'object_identity' && s.delay_ms >= core.delay_ms && s.delay_ms < coreEnd) {
        s.band_duck = { hz: core.dominant_hz, q, db, ms };
      }
    }
  }
  if (toolScale !== 1 || toolComp !== 1) {
    // 합성 폴백은 파일 레벨이 없으므로 레벨 보정(toolComp)은 음원 레이어에만
    for (const s of toolLayers) s.gain = round(s.gain * toolScale * (s.synth ? 1 : toolComp));
  }
  // 물건 우선 보장: 도구 핵심 재생 음량이 겹치는 물건 주 소리보다 minObjectLeadDb 이상 작게.
  // 물건 소리가 피크 제한 등으로 작아졌으면 도구 전체(역할 비율 유지)를 그만큼 낮춘다. 도구를 키우지는 않는다.
  const lead = orule?.minObjectLeadDb ?? OBJECT_MIX.min_object_lead_db;
  const coreL = toolLayers.find((s) => s.role === 'main_action' && typeof s.loud_lufs === 'number' && !s.loop);
  const prim = objLayers.filter((s) => s.slot === 0 && typeof s.loud_lufs === 'number');
  if (coreL && prim.length) {
    const objLoud = Math.max(...prim.map(playLoudness));
    const excess = playLoudness(coreL) - (objLoud - lead);
    if (excess > 0.05) {
      const k = dbToGain(-excess);
      for (const s of toolLayers) s.gain = round(s.gain * k);
      notes.push(`도구 ${excess.toFixed(1)} dB 낮춤 (물건 주 소리보다 ${lead} dB 작게)`);
    }
  }
  const total = toolLayers.reduce((a, s) => a + s.gain, 0);
  if (total > 1.8) {
    const k = 1.8 / total;
    for (const s of toolLayers) s.gain = round(s.gain * k);
    notes.push(`gain 합 ${total.toFixed(2)} → 1.8로 정규화`);
  }

  out.reason = [
    `tool=${input.tool_code} object=${input.object_type ?? 'unknown'} interaction=${interaction} phase=${phase} intensity=${level}`,
    `materials=${materials.join('+')} (${materialSource})`,
    objectSummary(out.object_sound, toolScale, toolComp),
    ...out.selected_sounds.map((s) => `${s.role}: ${s.sound_id} ${s.synth ? '(synth fallback)'
      : s.material ? `(${s.material}·${s.action})` : `(${s.match}, score ${s.score}, ${s.tier})`}`),
    ...notes,
  ].join('; ');
  return out;
}

/** 도구 프리셋에서 끈 역할인지 (음원도 합성 폴백도 쓰지 않는다) */
export function isDisabled(tool, role) {
  return Array.isArray(tool?.disabledRoles) && tool.disabledRoles.includes(role);
}

function addLayer(ctx, role, timing, scale) {
  if (!timing || !SOUND_ROLES.includes(role)) return;
  if (isDisabled(ctx.tool, role)) return;
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
    layer.match = match.match; // object_match | material_match | generic
    // 파일 로드에 실패하면 플레이어가 이 합성으로 대신한다 (같은 도구·역할)
    layer.on_load_fail = { tool_code: input.tool_code, role };
    // 겹침 처리용 측정·분류 (catalog mix·spectrum, scripts/measure_levels.py)
    if (match.entry.mix?.priority) layer.priority = match.entry.mix.priority;
    if (typeof match.entry.source_loudness?.playback_max_loudness_100ms_lufs === 'number') {
      layer.loud_lufs = match.entry.source_loudness.playback_max_loudness_100ms_lufs;
    }
    if (match.entry.spectrum?.dominant_octave_hz) layer.dominant_hz = match.entry.spectrum.dominant_octave_hz;
    if (match.entry.duration_seconds) layer.play_ms = Math.round(match.entry.duration_seconds * 1000);
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
  if (shape.offset_ms && !shape.loop) layer.offset_ms = shape.offset_ms;
  // keep_lows: 타격 몸통(저음)이 핵심인 소리는 물건별 하이패스를 걸지 않는다 (망치)
  if (role === 'main_action' && !shape.keep_lows) {
    const hp = obj.mainHighpass(progress);
    if (hp) layer.highpass_hz = hp;
  }
  // 어택 강조: 시작 순간 boost_db만큼 키웠다가 ms 동안 원래 크기로 (뒤따르는 물건 소리에 묻히지 않게)
  if (shape.attack_boost_db && !shape.loop) layer.attack = { boost_db: shape.attack_boost_db, ms: shape.attack_ms ?? 60 };
  out.selected_sounds.push(layer);
}

/**
 * 물건 이벤트(hit_strong·hit_light·press·break)의 슬롯마다 물건 고유 소리 레이어를 하나씩 얹는다.
 * 슬롯 후보 [재질, 동작]을 앞에서부터 찾고, 같은 계획에서 이미 쓴 음원은 건너뛴다.
 * 맞는 음원이 없으면 out.object_sound.missing에 기록하고 생략한다 (도구 소리로 대신하지 않음).
 * @param {number} [rotate=0] press 단계 번호: 첫 슬롯 후보를 이만큼 돌려 쓴다
 */
function addObjectEvent(mctx, event, delay_ms, scale, rotate = 0) {
  const { profile, userMaterials, materialSounds, random, out } = mctx;
  if (!profile) return;
  const slots = profile.events[event];
  if (!slots) return;
  const shapeKey = event.startsWith('hit') ? 'hit' : event;
  slots.forEach((slot, si) => {
    let alts = slot.alts;
    if (si === 0 && rotate && alts.length > 1) {
      const k = rotate % alts.length;
      alts = [...alts.slice(k), ...alts.slice(0, k)];
    }
    // 사용자가 재질을 확인했으면 그 재질 후보만
    if (userMaterials.length) alts = alts.filter(([mat]) => userMaterials.includes(mat));
    const role = `object_${shapeKey}_${si}`;
    if (out.selected_sounds.some((s) => s.role === role)) return;
    for (const [mat, action] of alts) {
      const hits = materialSounds.filter((m) => m.material_code === mat && m.action === action
        && !out.selected_sounds.some((s) => s.sound_id === m.sound_id));
      if (!hits.length) continue;
      const m = hits[Math.floor(random() * hits.length) % hits.length];
      const shape = { ...OBJECT_SHAPE[shapeKey] };
      // 앞부분 무음(onset_ms)은 건너뛰고 재생한다. 길이 제한도 소리 시작점부터 센다.
      const offset = Math.max(0, Number(m.onset_ms) || 0);
      const soundMs = m.duration_seconds ? Math.max(0, m.duration_seconds * 1000 - offset) : null;
      // 여러 번 두드린 녹음(repeat_count>1)은 첫 번째 타격만 쓴다
      if (m.repeat_count > 1 && soundMs) {
        shape.max_duration_ms = Math.min(shape.max_duration_ms, Math.round(soundMs / m.repeat_count));
        shape.fade_out_ms = Math.min(shape.fade_out_ms, 60);
      }
      // 실제로 울리는 길이 (피크 겹침 계산용)
      const playMs = soundMs == null ? shape.max_duration_ms : Math.min(shape.max_duration_ms, soundMs);
      out.selected_sounds.push({
        sound_id: m.sound_id,
        file_path: m.file_path,
        role,
        delay_ms: Math.max(0, Math.round(delay_ms + si * 10)),
        material: m.material_code,
        action: m.action,
        event,
        gain: round(clamp((slot.gain ?? 1) * scale, 0, MAX_LAYER_GAIN)),
        // 녹음마다 다른 원본 음량을 물건 기준 음량에 맞춘다 (플레이어가 gain에 곱함, 원본 파일은 그대로)
        // 측정 기반 mix.base_gain_db가 있으면 그 값, 없으면 level_db로 계산
        loudness_comp: typeof m.mix?.base_gain_db === 'number' ? round(dbToGain(m.mix.base_gain_db)) : loudnessComp(m.level_db),
        ducking_group: m.mix?.ducking_group ?? null,
        loud_lufs: m.source_loudness?.playback_max_loudness_100ms_lufs ?? null,
        // 피크 제한은 측정한 true peak(샘플 사이 피크) 기준, 없으면 샘플 피크
        peak_db: m.source_loudness?.true_peak_dbtp ?? m.peak_db ?? null,
        offset_ms: offset,
        slot: si, // 0 = 주 소리, 1~ = 보조 소리(울림 등)
        play_ms: Math.round(playMs),
        playback_rate: round(0.97 + 0.06 * random()),
        ...shape,
      });
      out.object_sound.layers.push(m.sound_id);
      return;
    }
    // 후보 음원이 카탈로그에 있지만 이번 계획에서 이미 쓰는 중이면 부족이 아니다 (예: 캔 타격과 파손이 같은 찌그러짐)
    const inUse = alts.some(([mat, action]) => materialSounds.some((m) => m.material_code === mat && m.action === action));
    if (inUse) return;
    // 슬롯에 맞는 음원 없음: 부족으로 표시만 한다
    out.object_sound.missing.push({ event, slot: si, wanted: alts.map(([a, b]) => `${a}·${b}`).join('|') || '(확인 재질에 맞는 후보 없음)' });
    if (si === 0) out.object_sound.status = 'missing';
  });
}

/**
 * 물건 레이어 피크의 최악 합. 실제로 시간이 겹치는 레이어끼리만 더한다
 * (예: 캔 울림이 끝난 뒤 찌그러짐이 시작되면 둘을 더하지 않는다).
 */
export function overlappingPeak(layers) {
  const iv = layers.map((s) => ({
    start: s.delay_ms ?? 0,
    end: (s.delay_ms ?? 0) + (s.play_ms ?? s.max_duration_ms ?? 1000),
    peak: s.gain * (s.loudness_comp ?? 1) * dbToGain(s.peak_db ?? 0),
  }));
  let worst = 0;
  for (const a of iv) {
    const sum = iv.filter((b) => b.start <= a.start && b.end > a.start).reduce((x, b) => x + b.peak, 0);
    worst = Math.max(worst, sum);
  }
  return worst;
}

function objectSummary(os, toolScale, toolComp = 1) {
  const miss = os.missing.length ? ` (부족: ${os.missing.map((m) => `${m.event}#${m.slot} ${m.wanted}`).join(', ')})` : '';
  const tool = toolScale !== 1 ? ` tool ${(20 * Math.log10(toolScale)).toFixed(1)}dB` : '';
  const comp = toolComp !== 1 ? ` (도구 레벨 보정 ${(20 * Math.log10(toolComp)).toFixed(1)}dB)` : '';
  return `object_sound=${os.status}${miss}${tool}${comp}`;
}

/** level_db(1024샘플 창 RMS 최댓값) → 물건 기준 레벨에 맞추는 gain 배수. 값이 없으면 1 */
export function loudnessComp(levelDb) {
  if (typeof levelDb !== 'number' || !Number.isFinite(levelDb)) return 1;
  const { object_target_db, max_boost_db, max_cut_db } = OBJECT_MIX;
  return round(dbToGain(clamp(object_target_db - levelDb, -max_cut_db, max_boost_db)));
}

/**
 * 도구 레벨 보정 배수: 도구 핵심(main_action) 음원의 level_db를 물건 기준 레벨에 맞춘다.
 * 핵심을 끈 도구(레이저)는 켜진 역할 중 가장 큰 음원 기준. 한 도구 안의 역할 사이 비율은 바꾸지 않는다.
 * level_db가 없으면 1 (scripts/measure_levels.py로 채운다)
 */
export function toolLoudnessComp(playable, toolCode, tool) {
  // 측정 기반 값(catalog mix.base_gain_db, 한 도구에 같은 값)이 있으면 그대로 쓴다
  const measured = playable.find((e) => e.tool_code === toolCode && typeof e.mix?.base_gain_db === 'number');
  if (measured) return round(dbToGain(measured.mix.base_gain_db));
  const own = playable.filter((e) => e.tool_code === toolCode && !isDisabled(tool, e.sound_role)
    && typeof e.level_db === 'number' && Number.isFinite(e.level_db));
  if (!own.length) return 1;
  const main = own.filter((e) => e.sound_role === 'main_action');
  const ref = Math.max(...(main.length ? main : own).map((e) => e.level_db));
  const { object_target_db, tool_max_boost_db, tool_max_cut_db } = OBJECT_MIX;
  return round(dbToGain(clamp(object_target_db - ref, -tool_max_cut_db, tool_max_boost_db)));
}

/** 레이어 재생 음량 추정(LUFS): 파일 측정값 + gain·보정 */
function playLoudness(s) {
  return s.loud_lufs + 20 * Math.log10(Math.max(1e-6, s.gain * (s.loudness_comp ?? 1)));
}

function dbToGain(db) {
  return 10 ** (db / 20);
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
