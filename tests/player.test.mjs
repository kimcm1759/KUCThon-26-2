// AudioPlayer 재생 순서 검사 (가짜 AudioContext). Web Audio는 start() 전에 stop()을 부르면 예외가 난다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlayer } from '../src/audio/audioPlayer.js';

function fakeContext(calls) {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = (extra = {}) => ({ connect: (n) => n ?? node(), disconnect() {}, gain: param(), frequency: param(), Q: param(), ...extra });
  return {
    currentTime: 0,
    state: 'running',
    destination: node(),
    createGain: () => node(),
    createBiquadFilter: () => node(),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createBufferSource: () => {
      let started = false;
      return node({
        playbackRate: param(),
        start(when, offset) { started = true; calls.push(['start', when, offset]); },
        stop(when) { if (!started) throw new Error('InvalidStateError: stop before start'); calls.push(['stop', when]); },
      });
    },
  };
}

const buffer = { duration: 0.535 };

test('길이 제한 레이어: start() 다음에 stop(), 파일이 제한보다 길 때만 자른다', async () => {
  const calls = [];
  const p = new AudioPlayer({ audioContext: fakeContext(calls) });
  p.load = async () => buffer;
  await p.playPlan({ selected_sounds: [
    { sound_id: 'long', file_path: 'a.wav', role: 'r1', gain: 0.5, delay_ms: 0, max_duration_ms: 200, fade_out_ms: 50 },
    { sound_id: 'short', file_path: 'b.wav', role: 'r2', gain: 0.5, delay_ms: 0, max_duration_ms: 800, fade_out_ms: 250 },
  ], sustain_updates: [] });
  assert.equal(calls.filter((c) => c[0] === 'start').length, 2); // 두 레이어 모두 재생
  assert.equal(calls.filter((c) => c[0] === 'stop').length, 1); // 0.535초 파일은 0.2초 제한일 때만 자름
  assert.ok(calls.findIndex((c) => c[0] === 'start') < calls.findIndex((c) => c[0] === 'stop'));
});

test('offset_ms만큼 건너뛰고 재생한다', async () => {
  const calls = [];
  const p = new AudioPlayer({ audioContext: fakeContext(calls) });
  p.load = async () => ({ duration: 2 });
  await p.playPlan({ selected_sounds: [{ sound_id: 'x', file_path: 'x.wav', role: 'r', gain: 0.5, offset_ms: 500 }], sustain_updates: [] });
  assert.equal(calls.find((c) => c[0] === 'start')[2], 0.5);
});

test('어택 강조: 시작 순간 boost_db만큼 올렸다가 attack.ms 뒤 원래 gain', async () => {
  const ramps = [];
  const ac = fakeContext([]);
  const mk = ac.createGain;
  ac.createGain = () => {
    const n = mk();
    n.gain.linearRampToValueAtTime = (v, t) => ramps.push([v, t]);
    return n;
  };
  const p = new AudioPlayer({ audioContext: ac });
  p.load = async () => ({ duration: 0.44 });
  await p.playPlan({ selected_sounds: [{ sound_id: 'h', file_path: 'h.wav', role: 'main_action', gain: 0.5,
    attack: { boost_db: 6, ms: 70 } }], sustain_updates: [] });
  assert.equal(ramps.length, 2);
  assert.ok(Math.abs(ramps[0][0] - 0.5 * 10 ** (6 / 20)) < 1e-9);
  assert.equal(ramps[1][0], 0.5);
  assert.ok(Math.abs(ramps[1][1] - ramps[0][1] - 0.07) < 1e-9);
});

test('대역 ducking: 피킹 필터를 끼워 지정 dB에서 0 dB로 되돌린다', async () => {
  const filters = [];
  const ac = fakeContext([]);
  const mk = ac.createBiquadFilter;
  ac.createBiquadFilter = () => { const n = mk(); const ramps = []; n.gain.linearRampToValueAtTime = (v, t) => ramps.push([v, t]);
    n.gain.setValueAtTime = (v, t) => ramps.push(['set', v, t]); filters.push({ n, ramps }); return n; };
  const p = new AudioPlayer({ audioContext: ac });
  p.load = async () => ({ duration: 0.5 });
  await p.playPlan({ selected_sounds: [{ sound_id: 'o', file_path: 'o.wav', role: 'object_hit_0', gain: 0.5,
    band_duck: { hz: 1000, q: 1.4, db: -4, ms: 120 } }], sustain_updates: [] });
  assert.equal(filters.length, 1);
  assert.equal(filters[0].n.type, 'peaking');
  assert.equal(filters[0].n.frequency.value, 1000);
  assert.equal(filters[0].ramps[0][1], -4);
  assert.equal(filters[0].ramps[1][0], 0);
});
