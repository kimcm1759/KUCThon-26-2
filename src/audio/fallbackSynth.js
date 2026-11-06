// 카탈로그에 맞는 음원이 없거나 카탈로그 자체를 못 읽었을 때 쓰는 도구별 단순 합성음 (Web Audio).
// 프로젝트 독자 구현이며 참고 페이지의 코드·파형을 쓰지 않는다. 품질보다 "앱이 계속 소리를 낸다"가 목적.

let noiseCache = null;
function noiseBuffer(ac) {
  if (noiseCache && noiseCache.sampleRate === ac.sampleRate) return noiseCache;
  const len = ac.sampleRate * 2;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache = buf;
  return buf;
}

function noise(ac, t, dur) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  src.start(t, Math.random(), dur + 0.05);
  return src;
}

function env(ac, t, peak, attack, decay) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function filt(ac, type, freq, q = 1) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function osc(ac, type, freq, t, dur) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

// 각 레시피는 (ac, out, t) → 길이(초)
const RECIPES = {
  whoosh(ac, out, t, dur = 0.35) {
    const n = noise(ac, t, dur);
    const bp = filt(ac, 'bandpass', 400, 1.2);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + dur * 0.7);
    const g = env(ac, t, 0.6, dur * 0.6, dur * 0.4);
    n.connect(bp).connect(g).connect(out);
    return dur;
  },
  thump(ac, out, t, { body = 90, click = 3000, dur = 0.5 } = {}) {
    const o = osc(ac, 'sine', body * 1.8, t, dur);
    o.frequency.exponentialRampToValueAtTime(body, t + 0.08);
    o.connect(env(ac, t, 0.9, 0.003, dur)).connect(out);
    const n = noise(ac, t, 0.08);
    n.connect(filt(ac, 'highpass', click)).connect(env(ac, t, 0.5, 0.001, 0.06)).connect(out);
    return dur;
  },
  clang(ac, out, t, dur = 1.0) {
    for (const [f, a] of [[620, 0.3], [1490, 0.2], [2710, 0.12]]) {
      osc(ac, 'sine', f, t, dur).connect(env(ac, t, a, 0.002, dur * (700 / f))).connect(out);
    }
    return dur;
  },
  rise(ac, out, t, { from = 80, to = 300, dur = 1.0, type = 'sawtooth', cutoff = 900 } = {}) {
    const o = osc(ac, type, from, t, dur);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(filt(ac, 'lowpass', cutoff)).connect(g).connect(out);
    return dur;
  },
  drone(ac, out, t, { freq = 55, dur = 1.2, type = 'sawtooth', cutoff = 300 } = {}) {
    const o = osc(ac, type, freq, t, dur);
    o.connect(filt(ac, 'lowpass', cutoff)).connect(env(ac, t, 0.5, 0.05, dur)).connect(out);
    return dur;
  },
  crackle(ac, out, t, { dur = 0.6, freq = 2500, density = 18 } = {}) {
    const count = Math.round(dur * density);
    for (let i = 0; i < count; i++) {
      const ti = t + Math.random() * dur;
      noise(ac, ti, 0.02).connect(filt(ac, 'bandpass', freq * (0.6 + Math.random()), 3))
        .connect(env(ac, ti, 0.5 * (1 - (ti - t) / dur) + 0.1, 0.001, 0.02)).connect(out);
    }
    return dur;
  },
  boom(ac, out, t, dur = 2.0) {
    noise(ac, t, dur).connect(filt(ac, 'lowpass', 700)).connect(env(ac, t, 1.0, 0.004, dur)).connect(out);
    const o = osc(ac, 'sine', 70, t, dur);
    o.frequency.exponentialRampToValueAtTime(30, t + dur * 0.6);
    o.connect(env(ac, t, 0.9, 0.005, dur * 0.7)).connect(out);
    return dur;
  },
  fall(ac, out, t, { from = 600, to = 80, dur = 0.7, type = 'square' } = {}) {
    const o = osc(ac, type, from, t, dur);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.connect(filt(ac, 'lowpass', 2000)).connect(env(ac, t, 0.3, 0.005, dur)).connect(out);
    return dur;
  },
  hiss(ac, out, t, dur = 0.8) {
    noise(ac, t, dur).connect(filt(ac, 'highpass', 2500)).connect(env(ac, t, 0.4, 0.01, dur)).connect(out);
    return dur;
  },
};

const TABLE = {
  hydraulic_press: {
    activation: (ac, o, t) => RECIPES.rise(ac, o, t, { from: 45, to: 90, dur: 1.4, cutoff: 400 }),
    main_action: (ac, o, t) => RECIPES.drone(ac, o, t, { freq: 42, dur: 1.4 }),
    impact_detail: (ac, o, t) => RECIPES.crackle(ac, o, t, { dur: 0.7, freq: 1800 }),
    finish: (ac, o, t) => RECIPES.hiss(ac, o, t, 0.9),
  },
  hammer: {
    activation: (ac, o, t) => RECIPES.whoosh(ac, o, t, 0.3),
    main_action: (ac, o, t) => RECIPES.thump(ac, o, t, { body: 110, dur: 0.4 }),
    impact_detail: (ac, o, t) => RECIPES.crackle(ac, o, t, { dur: 0.4, freq: 3200 }),
    finish: (ac, o, t) => RECIPES.crackle(ac, o, t, { dur: 1.2, freq: 2200, density: 10 }),
  },
  aluminum_bat: {
    activation: (ac, o, t) => RECIPES.whoosh(ac, o, t, 0.45),
    main_action: (ac, o, t) => { RECIPES.thump(ac, o, t, { body: 80, dur: 0.3 }); return RECIPES.clang(ac, o, t, 0.9); },
    impact_detail: (ac, o, t) => RECIPES.clang(ac, o, t, 0.5),
    finish: (ac, o, t) => RECIPES.clang(ac, o, t, 1.6),
  },
  laser: {
    activation: (ac, o, t) => RECIPES.rise(ac, o, t, { from: 200, to: 1600, dur: 0.6, type: 'triangle', cutoff: 5000 }),
    main_action: (ac, o, t) => RECIPES.drone(ac, o, t, { freq: 220, dur: 1.0, type: 'square', cutoff: 2500 }),
    impact_detail: (ac, o, t) => RECIPES.hiss(ac, o, t, 0.6),
    finish: (ac, o, t) => RECIPES.fall(ac, o, t, { from: 900, to: 90, dur: 0.6 }),
  },
  bomb: {
    activation: (ac, o, t) => RECIPES.crackle(ac, o, t, { dur: 1.4, freq: 4000, density: 30 }),
    main_action: (ac, o, t) => RECIPES.boom(ac, o, t, 2.0),
    impact_detail: (ac, o, t) => RECIPES.crackle(ac, o, t, { dur: 1.0, freq: 1500, density: 14 }),
    finish: (ac, o, t) => RECIPES.drone(ac, o, t, { freq: 35, dur: 2.0, cutoff: 150 }),
  },
};

/**
 * 합성 폴백 한 레이어를 destination에 예약 재생한다.
 * @returns {number} 대략적인 길이(초). 레시피가 없으면 0
 */
export function playSynthFallback(ac, destination, { tool_code, role }, when) {
  const fn = TABLE[tool_code]?.[role];
  if (!fn) return 0;
  return fn(ac, destination, when);
}
