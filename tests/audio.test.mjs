// 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog } from '../src/audio/soundCatalog.js';
import { compose } from '../src/audio/soundComposer.js';
import { scoreSound, selectSound } from '../src/audio/soundMatcher.js';

const raw = JSON.parse(readFileSync(new URL('../sounds/catalog.json', import.meta.url), 'utf8'));
const catalog = validateCatalog(raw);
const R = { random: () => 0.5 }; // 재생 속도 흔들림 없이 고정
const roles = (plan) => plan.selected_sounds.map((s) => s.role);
const layer = (plan, role) => plan.selected_sounds.find((s) => s.role === role);

test('카탈로그: 도구·역할 미정 제공 음원은 자동 재생 후보에서 제외', () => {
  assert.equal(catalog.playable.length, 20);
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
  const laserMain = onlyLaser.find((s) => s.sound_role === 'main_action');
  assert.equal(scoreSound(laserMain, { tool_code: 'bomb', sound_role: 'main_action' }).hardMismatch, true);
  assert.equal(selectSound(onlyLaser, { tool_code: 'bomb', sound_role: 'main_action' }), null);
});

test('망치 + 캔 + 강한 탭: activation→main→detail, 점수 80 이상', () => {
  const plan = compose({ object_type: 'aluminum_can', object_materials: ['aluminum'], tool_code: 'hammer',
    interaction: 'tap', intensity: 0.82, progress: 0.2 }, catalog.playable, R);
  assert.deepEqual(roles(plan), ['activation', 'main_action', 'impact_detail']);
  assert.equal(layer(plan, 'main_action').sound_id, 'hammer_main_action_001');
  assert.ok(layer(plan, 'main_action').score >= 80);
  assert.equal(plan.fallback_used, false);
  assert.ok(layer(plan, 'activation').delay_ms < layer(plan, 'main_action').delay_ms);
});

test('강도: 약한 탭은 detail 생략·gain 낮음, 강한 탭은 detail 포함·gain 높음', () => {
  const base = { object_type: 'laptop', tool_code: 'hammer', interaction: 'tap', progress: 0 };
  const light = compose({ ...base, intensity: 0.1 }, catalog.playable, R);
  const strong = compose({ ...base, intensity: 0.95 }, catalog.playable, R);
  assert.ok(!roles(light).includes('impact_detail'));
  assert.ok(roles(strong).includes('impact_detail'));
  assert.ok(layer(strong, 'main_action').gain > layer(light, 'main_action').gain);
});

test('물건에 따라 재생 파라미터가 달라진다', () => {
  const base = { tool_code: 'hydraulic_press', interaction: 'tap', intensity: 'medium', progress: 0.4 };
  const book = compose({ ...base, object_type: 'book' }, catalog.playable, R);
  const can = compose({ ...base, object_type: 'aluminum_can' }, catalog.playable, R);
  const laptop = compose({ ...base, object_type: 'laptop' }, catalog.playable, R);
  assert.ok(layer(book, 'main_action').highpass_hz > layer(can, 'main_action').highpass_hz); // 책: 저음 약하게 시작
  assert.equal(layer(laptop, 'main_action').highpass_hz, undefined);
  assert.ok(layer(can, 'impact_detail').playback_rate > layer(laptop, 'impact_detail').playback_rate); // 캔: 얇은 금속
  assert.match(book.reason, /paper\+cardboard \(object_preset_default\)/);
});

test('유압 프레스 누르기: 지속 루프 → progress 단계 detail → 완료 시 finish + 페이드아웃', () => {
  const base = { object_type: 'book', tool_code: 'hydraulic_press', interaction: 'press', intensity: 0.6 };
  const start = compose({ ...base, phase: 'start', progress: 0 }, catalog.playable, R);
  assert.deepEqual(roles(start), ['activation', 'main_action']);
  assert.equal(layer(start, 'main_action').loop, true);

  const mid = compose({ ...base, phase: 'update', previous_progress: 0.2, progress: 0.7 }, catalog.playable, R);
  assert.equal(mid.selected_sounds.filter((s) => s.role === 'impact_detail').length, 2); // 0.33, 0.66
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

test('레이저 쓸기: 속도가 빔 재생 속도·gain에 반영', () => {
  const base = { object_type: 'laptop', tool_code: 'laser', interaction: 'swipe', phase: 'update', progress: 0.3, previous_progress: 0.3 };
  const slow = compose({ ...base, swipe_speed: 0.1 }, catalog.playable, R);
  const fast = compose({ ...base, swipe_speed: 0.9 }, catalog.playable, R);
  assert.ok(fast.sustain_updates[0].playback_rate > slow.sustain_updates[0].playback_rate);
  assert.ok(fast.sustain_updates[0].gain > slow.sustain_updates[0].gain);
});

test('폭탄 탭: 퓨즈 → 폭발 → 파편 → 잔향 순서', () => {
  const plan = compose({ object_type: 'book', tool_code: 'bomb', interaction: 'tap', intensity: 'strong' }, catalog.playable, R);
  assert.deepEqual(roles(plan), ['activation', 'main_action', 'impact_detail', 'finish']);
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
