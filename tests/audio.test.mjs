// 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog, coverageReport } from '../src/audio/soundCatalog.js';
import { compose, toolLoudnessComp } from '../src/audio/soundComposer.js';
import * as MP from '../src/audio/presets/materialPresets.js';
const { OBJECT_MIX } = MP;
import { TOOL_PRESETS } from '../src/audio/presets/toolPresets.js';
import { scoreSound, selectSound } from '../src/audio/soundMatcher.js';

const raw = JSON.parse(readFileSync(new URL('../sounds/catalog.json', import.meta.url), 'utf8'));
const catalog = validateCatalog(raw);
const R = { random: () => 0.5 }; // 재생 속도 흔들림 없이 고정
const roles = (plan) => plan.selected_sounds.map((s) => s.role);
const layer = (plan, role) => plan.selected_sounds.find((s) => s.role === role);

test('카탈로그: 도구·역할 미정 제공 음원은 자동 재생 후보에서 제외', () => {
  assert.equal(catalog.playable.length, 14);
  const excluded = new Set(catalog.issues.map((i) => i.sound_id));
  assert.ok(excluded.has('paper_tear_001'));
  assert.ok(excluded.has('paper_other_001'));
  assert.ok(catalog.issues.every((i) => ['missing_tool_code', 'missing_sound_role'].includes(i.code)));
});

test('카탈로그가 깨져도 중단하지 않고 합성 폴백', () => {
  const broken = validateCatalog({ nope: true });
  assert.equal(broken.playable.length, 0);
  const plan = compose({ object_type: 'book', tool_code: 'hammer', intensity: 'strong' }, broken.playable, R);
  assert.ok(plan.fallback_used);
  assert.ok(plan.selected_sounds.every((s) => s.synth && s.sound_id.startsWith('synth:hammer_')));
});

test('다른 도구 음원을 대신 쓰지 않는다 (레이저 main_action ≠ 폭탄)', () => {
  const onlyLaser = catalog.playable.filter((s) => s.tool_code === 'laser');
  const plan = compose({ object_type: 'laptop', tool_code: 'bomb', intensity: 'strong' }, onlyLaser, R);
  for (const s of plan.selected_sounds) {
    assert.ok(!s.sound_id.startsWith('laser'), s.sound_id);
    assert.equal(s.synth?.tool_code, 'bomb');
  }
  // 레이저 main_action은 사용 안 함이라 카탈로그에 없으므로 가상 항목으로 확인
  const laserMain = validateCatalog({ sounds: [{ sound_id: 'laser_beam_x', file_path: 'x.wav', tool_code: 'laser',
    sound_role: 'main_action', action: 'beam' }] }).playable[0];
  assert.equal(scoreSound(laserMain, { tool_code: 'bomb', sound_role: 'main_action' }).hardMismatch, true);
  assert.equal(selectSound(onlyLaser, { tool_code: 'bomb', sound_role: 'main_action' }), null);
});

test('망치 + 캔 + 강한 탭: activation→main (detail은 사용 안 함), 점수 80 이상', () => {
  const plan = compose({ object_type: 'aluminum_can', object_materials: ['aluminum'], tool_code: 'hammer',
    interaction: 'tap', intensity: 0.82, progress: 0.2 }, catalog.playable, R);
  assert.deepEqual(roles(plan), ['activation', 'main_action']);
  assert.equal(layer(plan, 'main_action').sound_id, 'hammer_main_action_002');
  assert.ok(layer(plan, 'main_action').score >= 80);
  assert.equal(plan.fallback_used, false);
  assert.ok(layer(plan, 'activation').delay_ms < layer(plan, 'main_action').delay_ms);
});

test('강도: 약한 탭은 detail 생략·gain 낮음, 강한 탭은 detail 포함·gain 높음', () => {
  const base = { object_type: 'laptop', tool_code: 'laser', interaction: 'tap', progress: 0 };
  const light = compose({ ...base, intensity: 0.1 }, catalog.playable, R);
  const strong = compose({ ...base, intensity: 0.95 }, catalog.playable, R);
  assert.ok(!roles(light).includes('impact_detail'));
  assert.ok(roles(strong).includes('impact_detail'));
  assert.ok(layer(strong, 'activation').gain > layer(light, 'activation').gain);
});

test('물건에 따라 재생 파라미터가 달라진다', () => {
  const base = { tool_code: 'hydraulic_press', interaction: 'tap', intensity: 'medium', progress: 0.4 };
  const book = compose({ ...base, object_type: 'book' }, catalog.playable, R);
  const can = compose({ ...base, object_type: 'aluminum_can' }, catalog.playable, R);
  const laptop = compose({ ...base, object_type: 'laptop' }, catalog.playable, R);
  assert.ok(layer(book, 'main_action').highpass_hz > layer(can, 'main_action').highpass_hz); // 책: 저음 약하게 시작
  assert.equal(layer(laptop, 'main_action').highpass_hz, undefined);
  const laserBase = { tool_code: 'laser', interaction: 'tap', intensity: 'medium', progress: 0.4 };
  const laserCan = compose({ ...laserBase, object_type: 'aluminum_can' }, catalog.playable, R);
  const laserLaptop = compose({ ...laserBase, object_type: 'laptop' }, catalog.playable, R);
  assert.ok(layer(laserCan, 'impact_detail').playback_rate > layer(laserLaptop, 'impact_detail').playback_rate); // 캔: 얇은 금속
  assert.match(book.reason, /paper\+cardboard \(object_preset_default\)/);
});

test('유압 프레스 누르기: 지속 루프 → (detail 사용 안 함) → 완료 시 finish + 페이드아웃', () => {
  const base = { object_type: 'book', tool_code: 'hydraulic_press', interaction: 'press', intensity: 0.6 };
  const start = compose({ ...base, phase: 'start', progress: 0 }, catalog.playable, R);
  assert.deepEqual(roles(start), ['activation', 'main_action']);
  assert.equal(layer(start, 'main_action').loop, true);

  const mid = compose({ ...base, phase: 'update', previous_progress: 0.2, progress: 0.7 }, catalog.playable, R);
  assert.equal(mid.selected_sounds.filter((s) => s.role === 'impact_detail').length, 0); // 진행 단계를 넘어도 detail 없음
  const low = compose({ ...base, phase: 'update', previous_progress: 0.1, progress: 0.2 }, catalog.playable, R);
  assert.ok(mid.sustain_updates[0].gain > low.sustain_updates[0].gain); // 진행될수록 압축음 증폭
  assert.ok(mid.sustain_updates[0].highpass_hz < low.sustain_updates[0].highpass_hz); // 책: 저음이 점점 열림

  const done = compose({ ...base, phase: 'update', previous_progress: 0.9, progress: 1 }, catalog.playable, R);
  assert.ok(roles(done).includes('finish'));
  assert.ok(done.stop_sustain);

  const release = compose({ ...base, phase: 'end', previous_progress: 1, progress: 1, finish_played: true }, catalog.playable, R);
  assert.ok(!roles(release).includes('finish')); // finish 중복 재생 안 함
  assert.ok(release.stop_sustain);
});

test('레이저 쓸기: 빔(main_action)은 사용 안 함 → 루프·지속 갱신 없음', () => {
  const base = { object_type: 'laptop', tool_code: 'laser', interaction: 'swipe' };
  const start = compose({ ...base, phase: 'start', progress: 0 }, catalog.playable, R);
  assert.deepEqual(roles(start), ['activation']);
  const upd = compose({ ...base, phase: 'update', progress: 0.3, previous_progress: 0.3, swipe_speed: 0.9 }, catalog.playable, R);
  assert.equal(upd.sustain_updates.length, 0);
});

test('폭탄 탭: 퓨즈 → 폭발 (파편·잔향은 사용 안 함)', () => {
  const plan = compose({ object_type: 'book', tool_code: 'bomb', interaction: 'tap', intensity: 'strong' }, catalog.playable, R);
  assert.deepEqual(roles(plan), ['activation', 'main_action']);
  const d = plan.selected_sounds.map((s) => s.delay_ms);
  assert.deepEqual([...d].sort((a, b) => a - b), d);
});

test('음소거: 선택 결과는 유지, muted 표시', () => {
  const plan = compose({ object_type: 'book', tool_code: 'hammer', intensity: 'strong', sound_enabled: false }, catalog.playable, R);
  assert.equal(plan.muted, true);
  assert.ok(plan.selected_sounds.length > 0);
});

test('레이어 gain은 1을 넘지 않고 합도 제한된다', () => {
  for (const tool_code of ['hydraulic_press', 'hammer', 'aluminum_bat', 'laser', 'bomb']) {
    for (const object_type of ['book', 'aluminum_can', 'laptop']) {
      const plan = compose({ object_type, tool_code, interaction: 'tap', intensity: 1, progress: 1 }, catalog.playable, R);
      assert.ok(plan.selected_sounds.every((s) => s.gain > 0 && s.gain <= 1));
      assert.ok(plan.selected_sounds.reduce((a, s) => a + s.gain, 0) <= 1.8 + 0.01);
      assert.equal(plan.fallback_used, false, `${tool_code}/${object_type}`);
    }
  }
});

test('폴백 우선순위: 물건 일치 → 재질 일치 → 일반음 → 합성 → (그 외) 후보 아님', () => {
  const mk = (id, extra) => ({ sound_id: id, file_path: `x/${id}.wav`, tool_code: 'laser', sound_role: 'impact_detail',
    action: 'crack', intensity: 'medium', material_codes: ['unknown'], target_objects: [], ...extra });
  const A = mk('can_specific', { target_objects: ['aluminum_can'] });
  const B = mk('laptop_aluminum', { target_objects: ['laptop'], material_codes: ['aluminum'] });
  const C = mk('generic', {});
  const D = mk('laptop_plastic', { target_objects: ['laptop'], material_codes: ['plastic'] });
  const E = { ...mk('bomb_can', { target_objects: ['aluminum_can'] }), tool_code: 'bomb' };
  const q = { tool_code: 'laser', sound_role: 'impact_detail', object_type: 'aluminum_can', materials: ['aluminum'], expectedActions: ['crack'], intensity: 'medium' };
  const cat = (...xs) => validateCatalog({ sounds: xs }).playable;

  assert.equal(selectSound(cat(D, C, B, A, E), q, R).entry.sound_id, 'can_specific');
  assert.equal(selectSound(cat(D, C, B, E), q, R).entry.sound_id, 'laptop_aluminum');
  assert.equal(selectSound(cat(D, C, B, E), q, R).match, 'material_match');
  assert.equal(selectSound(cat(D, C, E), q, R).entry.sound_id, 'generic');
  assert.equal(selectSound(cat(D, E), q, R), null); // 다른 물건 전용·재질 불일치, 다른 도구 → 후보 없음

  const plan = compose({ object_type: 'aluminum_can', object_materials: ['aluminum'], tool_code: 'laser', intensity: 'strong' }, cat(D, E), R);
  assert.equal(layer(plan, 'impact_detail').sound_id, 'synth:laser_impact_detail');
});

test('파일 레이어에는 sound_id·file_path·로드 실패 시 합성 정보가 남는다', () => {
  const plan = compose({ object_type: 'book', tool_code: 'laser', intensity: 'medium' }, catalog.playable, R);
  for (const s of plan.selected_sounds) {
    assert.ok(s.sound_id.startsWith('laser_'));
    assert.match(s.file_path, /^assets\/audio\/tools\/laser\//);
    assert.deepEqual(s.on_load_fail, { tool_code: 'laser', role: s.role });
    assert.ok(['object_match', 'material_match', 'generic'].includes(s.match));
  }
});

test('사용 안 함 역할은 어떤 입력에서도 재생되지 않는다 (합성 폴백 포함)', () => {
  const off = { hydraulic_press: ['impact_detail'], hammer: ['impact_detail'], aluminum_bat: ['impact_detail'],
    laser: ['main_action'], bomb: ['impact_detail', 'finish'] };
  for (const [tool_code, disabled] of Object.entries(off)) {
    for (const interaction of ['tap', 'press', 'swipe']) {
      for (const [phase, prev, prog] of [['start', 0, 0], ['update', 0, 1], ['end', 1, 1]]) {
        const plan = compose({ object_type: 'aluminum_can', tool_code, interaction, phase, intensity: 1,
          previous_progress: prev, progress: prog }, catalog.playable, R);
        for (const s of plan.selected_sounds) assert.ok(!disabled.includes(s.role), `${tool_code} ${interaction} ${phase}: ${s.role}`);
      }
    }
  }
  const { rows } = coverageReport(catalog);
  for (const [tool_code, disabled] of Object.entries(off)) {
    for (const role of disabled) assert.equal(rows.find((r) => r.tool_code === tool_code && r.sound_role === role).status, 'disabled');
  }
});

// ---- 물건 고유 소리 (material_sounds) ----
const M = { ...R, materialSounds: catalog.materials };
const objLayers = (plan) => plan.selected_sounds.filter((s) => s.material);
const OBJECTS = ['book', 'aluminum_can', 'laptop'];
const TOOLS = ['hydraulic_press', 'hammer', 'aluminum_bat', 'laser', 'bomb'];

test('물건 소리: 제외 목록은 읽지 않고 ready 항목만 후보', () => {
  assert.ok(catalog.materials.length > 0);
  const excluded = new Set((raw.material_sounds_excluded ?? []).map((e) => e.file_path));
  assert.ok(catalog.materials.every((m) => m.status === 'ready' && !excluded.has(m.file_path)));
});

test('물건 소리: 물건 부위 재질만 쓰고, 노트북에는 캔 녹음(알루미늄)을 쓰지 않는다', () => {
  const allowed = { book: ['cardboard', 'paper'], aluminum_can: ['aluminum'], laptop: ['glass', 'plastic'] };
  for (const tool_code of TOOLS) {
    for (const object_type of OBJECTS) {
      for (const [interaction, phase, prev, progress] of [['tap', 'start', 0, 1], ['press', 'start', 0, 0], ['press', 'update', 0.15, 0.25]]) {
        const plan = compose({ object_type, tool_code, interaction, phase, intensity: 0.8, previous_progress: prev, progress }, catalog.playable, M);
        for (const s of objLayers(plan)) assert.ok(allowed[object_type].includes(s.material), `${tool_code}/${object_type}: ${s.sound_id}`);
        const ids = objLayers(plan).map((s) => s.sound_id);
        assert.equal(new Set(ids).size, ids.length);
      }
    }
  }
});

// 측정 기반 재생 음량: 파일 측정값(playback_max_loudness_100ms_lufs) + 엔진이 정한 gain(dB)
const loudOf = Object.fromEntries([...catalog.playable, ...catalog.materials]
  .map((e) => [e.sound_id, e.source_loudness?.playback_max_loudness_100ms_lufs]));
const playLufs = (l) => loudOf[l.sound_id] + 20 * Math.log10(l.gain * (l.loudness_comp ?? 1));

test('물건 소리가 주 레이어: 도구 핵심 재생 음량이 물건 주 소리보다 작다 (망치 1 dB 이상, 나머지 6 dB 이상)', () => {
  for (const tool_code of ['hammer', 'aluminum_bat', 'hydraulic_press', 'bomb']) {
    for (const object_type of ['book', 'aluminum_can', 'laptop']) {
      const input = { object_type, tool_code, interaction: 'tap', intensity: 0.8, progress: 0.3 };
      const mixed = compose(input, catalog.playable, M);
      const main = mixed.selected_sounds.find((s) => s.role === 'main_action');
      const obj = objLayers(mixed).find((s) => s.slot === 0);
      assert.ok(obj, `${tool_code}/${object_type}`);
      const gap = playLufs(obj) - playLufs(main);
      assert.ok(gap >= (tool_code === 'hammer' ? 1 : 6) - 0.1, `${tool_code}/${object_type}: 물건이 ${gap.toFixed(1)} dB 큼`);
      assert.equal(mixed.object_sound.status, 'ok');
    }
  }
});

test('같은 도구·동작이면 물건마다 다른 물건 소리', () => {
  const cases = [
    ['hammer', { interaction: 'tap', intensity: 0.8, progress: 0.3 }],
    ['hammer', { interaction: 'tap', intensity: 0.1, progress: 0.3 }],
    ['aluminum_bat', { interaction: 'tap', intensity: 0.8, progress: 0.3 }],
    ['hydraulic_press', { interaction: 'press', phase: 'start', intensity: 0.6, progress: 0 }],
    ['laser', { interaction: 'swipe', phase: 'update', previous_progress: 0.9, progress: 1 }],
    ['bomb', { interaction: 'tap', intensity: 0.6 }],
  ];
  for (const [tool_code, extra] of cases) {
    const sets = OBJECTS.map((object_type) => objLayers(compose({ object_type, tool_code, ...extra }, catalog.playable, M))
      .map((s) => s.sound_id).sort().join('+'));
    assert.equal(new Set(sets).size, 3, `${tool_code}: ${sets.join(' / ')}`);
    assert.ok(sets.every((x) => x), `${tool_code}: 물건 소리 없음`);
  }
});

test('책은 종이·판지, 캔은 찌그러짐+빈 울림, 노트북은 화면 유리+키캡', () => {
  const hit = (object_type) => objLayers(compose({ object_type, tool_code: 'hammer', interaction: 'tap', intensity: 0.9 }, catalog.playable, M));
  assert.deepEqual(hit('book').map((s) => `${s.material}·${s.action}`), ['paper·crumple', 'cardboard·tap']);
  assert.deepEqual(hit('aluminum_can').map((s) => `${s.material}·${s.action}`), ['aluminum·crush', 'aluminum·tap']);
  assert.deepEqual(hit('laptop').map((s) => `${s.material}·${s.action}`), ['glass·tap', 'plastic·key_press']);
  // 캔 울림은 한 번 두드린 파일 (반복은 탭할 때마다 엔진이 재생)
  assert.ok(hit('aluminum_can')[1].play_ms < 300);
  // 작게 녹음된 종이 구김은 보정으로 키운다
  assert.ok(hit('book')[0].loudness_comp > 1);
});

test('유압 프레스: 진행 20%마다 물건 소리를 돌아가며 다시 얹는다', () => {
  const base = { object_type: 'book', tool_code: 'hydraulic_press', interaction: 'press', intensity: 0.6, phase: 'update' };
  const ids = [[0.15, 0.25], [0.35, 0.45], [0.55, 0.65]].map(([previous_progress, progress]) =>
    objLayers(compose({ ...base, previous_progress, progress }, catalog.playable, M)).map((s) => s.sound_id).join());
  assert.ok(ids.every((x) => x));
  assert.ok(new Set(ids).size >= 2, ids.join(' / '));
  assert.equal(objLayers(compose({ ...base, previous_progress: 0.25, progress: 0.3 }, catalog.playable, M)).length, 0);
  const plain = compose({ ...base, previous_progress: 0.25, progress: 0.3 }, catalog.playable, R);
  const mixed = compose({ ...base, previous_progress: 0.25, progress: 0.3 }, catalog.playable, M);
  assert.ok(mixed.sustain_updates[0].gain < plain.sustain_updates[0].gain);
});

test('물건 소리가 없으면 부족으로 표시하고 도구 소리를 키우지 않는다', () => {
  const input = { object_type: 'laptop', object_materials: ['aluminum'], tool_code: 'hammer', interaction: 'tap', intensity: 0.8 };
  const plan = compose(input, catalog.playable, M);
  assert.equal(objLayers(plan).length, 0);
  assert.equal(plan.object_sound.status, 'missing');
  assert.ok(plan.object_sound.missing.length > 0);
  const plain = compose(input, catalog.playable, R);
  const main = (p) => p.selected_sounds.find((s) => s.role === 'main_action').gain;
  assert.ok(main(plan) < main(plain)); // 대신 키우지 않음 (보조 음량 유지)
  // 노트북 외장 녹음 부족은 항상 gaps로 알린다
  const any = compose({ object_type: 'laptop', tool_code: 'hammer', interaction: 'tap' }, catalog.playable, M);
  assert.equal(any.object_sound.gaps[0].part, 'exterior');
});

test('저장된 음원은 앞 무음·반복이 잘려 있고, 피크 제한은 시간이 겹치는 레이어끼리만 더한다', () => {
  // 모든 재질 음원은 자른 뒤 저장되어 소리 시작이 0 ms, 한 파일 = 한 번
  for (const m of catalog.materials) {
    assert.equal(m.onset_ms, 0, m.sound_id);
    assert.ok(!(m.repeat_count > 1), m.sound_id);
  }
  const plan = compose({ object_type: 'aluminum_can', tool_code: 'hammer', interaction: 'tap', intensity: 0.85 }, catalog.playable, M);
  const [crush, ring] = objLayers(plan);
  assert.equal(crush.sound_id, 'aluminum_can_crush_001');
  assert.equal(crush.offset_ms, 0);
  const alone = compose({ object_type: 'aluminum_can', tool_code: 'hammer', interaction: 'tap', intensity: 0.85 }, catalog.playable,
    { ...M, materialSounds: catalog.materials.filter((m) => m.sound_id !== ring.sound_id) });
  const g = (s) => s.gain * s.loudness_comp;
  assert.ok(g(crush) >= g(objLayers(alone)[0]) * 0.5, `${g(crush)} vs ${g(objLayers(alone)[0])}`);
});

test('반복은 조작에 따라: 탭할 때마다 같은 물건 소리를 다시 고르고, 누르기는 진행 단계마다 다시 얹는다', () => {
  const tap = () => objLayers(compose({ object_type: 'aluminum_can', tool_code: 'hammer', interaction: 'tap', intensity: 0.1 }, catalog.playable, M));
  assert.equal(tap()[0].sound_id, 'aluminum_can_tap_single_001');
  assert.equal(tap()[0].sound_id, 'aluminum_can_tap_single_001');
  const base = { object_type: 'aluminum_can', tool_code: 'hydraulic_press', interaction: 'press', intensity: 0.6, phase: 'update' };
  const hits = [0.25, 0.45, 0.65, 0.85].filter((p) => objLayers(compose({ ...base, previous_progress: p - 0.1, progress: p }, catalog.playable, M)).length);
  assert.equal(hits.length, 4);
});

test('측정 기반 재생 gain: 도구는 핵심 음원 기준 한 값(mix.base_gain_db), toolDb는 기준 음량 대비 dB', () => {
  const { TOOL_OBJECT_RULES } = MP;
  for (const tool_code of ['hammer', 'aluminum_bat', 'hydraulic_press', 'bomb']) {
    const plan = compose({ object_type: 'aluminum_can', tool_code, interaction: 'tap', intensity: 1, progress: 0 }, catalog.playable, M);
    const main = plan.selected_sounds.find((s) => s.role === 'main_action');
    const entry = catalog.playable.find((e) => e.sound_id === main.sound_id);
    const presetGain = TOOL_PRESETS[tool_code].tap.main_action.gain * 0.95; // 캔 roleGain
    const actual = loudOf[main.sound_id] + 20 * Math.log10(main.gain / presetGain);
    const expected = loudOf[main.sound_id] + entry.mix.base_gain_db + TOOL_OBJECT_RULES[tool_code].toolDb;
    // 물건 주 소리가 피크 제한으로 작아졌으면 물건 우선 규칙(minObjectLeadDb)이 도구를 더 낮출 수 있다 (키우지는 않음)
    assert.ok(actual <= expected + 0.3, `${tool_code}: ${actual.toFixed(2)} > ${expected.toFixed(2)}`);
    if (actual < expected - 0.3) assert.match(plan.reason, /도구 [0-9.]+ dB 낮춤/, tool_code);
    // 한 도구 안 모든 음원은 같은 base_gain_db (역할 사이 원래 비율 유지)
    const own = catalog.playable.filter((e) => e.tool_code === tool_code);
    assert.equal(new Set(own.map((e) => e.mix.base_gain_db)).size, 1, tool_code);
  }
  // 측정값이 없으면 level_db 규칙, 그것도 없으면 보정 없음
  assert.equal(toolLoudnessComp([{ tool_code: 'hammer', sound_role: 'main_action' }], 'hammer', TOOL_PRESETS.hammer), 1);
  const plain = compose({ object_type: 'book', tool_code: 'hammer', interaction: 'tap', intensity: 1, progress: 0 }, catalog.playable, R);
  assert.doesNotMatch(plain.reason, /도구 레벨 보정/);
});

test('카탈로그: 측정값(source_loudness)과 재생 gain(mix)이 따로 있고, 못 잰 값은 null + 이유', () => {
  for (const e of [...catalog.playable, ...catalog.materials]) {
    const sl = e.source_loudness;
    assert.ok(sl && ['measured', 'partial', 'unknown'].includes(sl.measurement_status), e.sound_id);
    for (const k of ['integrated_lufs', 'true_peak_dbtp', 'peak_dbfs', 'rms_dbfs']) assert.ok(k in sl, `${e.sound_id}.${k}`);
    if (sl.integrated_lufs === null) assert.ok(sl.unmeasured?.some((u) => u.startsWith('integrated_lufs')), e.sound_id);
    assert.ok(e.mix && 'base_gain_db' in e.mix, e.sound_id);
  }
});

test('겹침: 망치 휘두름은 타격 전에 끝나고, 핵심음 동안 시작하는 물건 소리는 핵심 대역만 잠깐 낮춘다', () => {
  for (const object_type of ['book', 'aluminum_can', 'laptop']) {
    const plan = compose({ object_type, tool_code: 'hammer', interaction: 'tap', intensity: 0.6, progress: 0 }, catalog.playable, M);
    const act = plan.selected_sounds.find((s) => s.role === 'activation');
    const main = plan.selected_sounds.find((s) => s.role === 'main_action');
    assert.ok(act.delay_ms + act.max_duration_ms <= main.delay_ms, object_type);
    const objs = objLayers(plan);
    assert.ok(objs.every((s) => s.delay_ms > main.delay_ms), object_type);
    for (const s of objs) assert.deepEqual(s.band_duck, { hz: 1000, q: 1.4, db: -4, ms: 120 }, `${object_type} ${s.sound_id}`);
  }
  // 프레스는 타격 도구가 아니라 대역 ducking 없음
  const press = compose({ object_type: 'book', tool_code: 'hydraulic_press', interaction: 'tap', intensity: 0.6, progress: 0 }, catalog.playable, M);
  assert.ok(objLayers(press).every((s) => !s.band_duck));
});

test('망치 핵심: 물건별 하이패스 없음 + 어택 강조, 다른 도구는 그대로', () => {
  for (const object_type of ['book', 'aluminum_can', 'laptop']) {
    const plan = compose({ object_type, tool_code: 'hammer', interaction: 'tap', intensity: 0.6, progress: 0 }, catalog.playable, M);
    const main = plan.selected_sounds.find((s) => s.role === 'main_action');
    assert.equal(main.highpass_hz, undefined, object_type);
    assert.deepEqual(main.attack, { boost_db: 6, ms: 70 });
  }
  const press = compose({ object_type: 'book', tool_code: 'hydraulic_press', interaction: 'tap', intensity: 0.6, progress: 0 }, catalog.playable, M);
  const pm = press.selected_sounds.find((s) => s.role === 'main_action');
  assert.ok(pm.highpass_hz > 0);
  assert.equal(pm.attack, undefined);
});
