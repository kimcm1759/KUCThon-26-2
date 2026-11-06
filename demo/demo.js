import { SoundEngine } from '../src/audio/soundEngine.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');
let engine = null;
let progress = 0;

function log(line) {
  logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 6000);
}

function current() {
  return {
    object_type: $('object').value,
    tool_code: $('tool').value,
    interaction: $('interaction').value,
    intensity: Number($('intensity').value),
    progress,
  };
}

function setProgress(p) {
  progress = Math.min(1, Math.max(0, p));
  $('progressBar').style.width = `${progress * 100}%`;
  $('status').textContent = progress >= 1 ? '파손 완료' : `파손 진행도 ${Math.round(progress * 100)}%`;
}

async function ensureEngine() {
  if (engine) return engine;
  engine = await SoundEngine.create({
    catalogUrl: '../sounds/catalog.json',
    baseUrl: '../',
    debug: true,
    onDecision: ({ input, plan }) => {
      if (!plan.selected_sounds.length && !plan.stop_sustain && !plan.sustain_updates.length) return;
      if (input.phase === 'update' && !plan.selected_sounds.length) return; // 지속 파라미터 갱신은 로그 생략
      const layers = plan.selected_sounds
        .map((s) => `  ${s.role.padEnd(13)} ${s.sound_id}  +${s.delay_ms}ms  gain ${s.gain}  rate ${s.playback_rate}${s.highpass_hz ? `  hp ${s.highpass_hz}Hz` : ''}${s.loop ? '  loop' : ''}`)
        .join('\n');
      log(`[${input.interaction}/${input.phase}] fallback=${plan.fallback_used}${plan.muted ? ' (muted)' : ''}${plan.stop_sustain ? ' stop_sustain' : ''}\n${layers}\n  reason: ${plan.reason}\n`);
    },
  });
  await engine.player.resume();
  engine.setPreferences({ volume: Number($('volume').value), effect_strength: Number($('effect').value), sound_enabled: $('enabled').checked });
  engine.preloadAll();
  return engine;
}

// ---- 입력 처리 ----
const pad = $('pad');
let hold = null; // { timer, lastX, lastY, lastT, speed }

pad.addEventListener('pointerdown', async (e) => {
  pad.setPointerCapture(e.pointerId);
  const eng = await ensureEngine();
  pad.classList.add('active');
  const input = current();
  if (input.interaction === 'tap') {
    setProgress(progress + 0.12 + 0.2 * input.intensity);
    eng.tap({ ...input, progress });
    return;
  }
  eng.begin(input);
  hold = { lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), speed: 0 };
  hold.timer = setInterval(() => {
    const inp = current();
    // 누르기는 유지 시간, 쓸기는 문지르는 속도만큼 진행
    const step = inp.interaction === 'press' ? 0.02 + 0.03 * inp.intensity : 0.04 * hold.speed;
    setProgress(progress + step);
    hold.speed *= 0.8;
    eng.update({ ...inp, progress, swipe_speed: hold.speed });
  }, 100);
});

pad.addEventListener('pointermove', (e) => {
  if (!hold) return;
  const now = performance.now();
  const dist = Math.hypot(e.clientX - hold.lastX, e.clientY - hold.lastY);
  const v = dist / Math.max(1, now - hold.lastT); // px/ms
  hold.speed = Math.min(1, Math.max(hold.speed, v / 2));
  Object.assign(hold, { lastX: e.clientX, lastY: e.clientY, lastT: now });
});

function release() {
  pad.classList.remove('active');
  if (!hold || !engine) return;
  clearInterval(hold.timer);
  hold = null;
  engine.end({ ...current(), progress });
}
pad.addEventListener('pointerup', release);
pad.addEventListener('pointercancel', release);

// ---- 설정 ----
for (const [id, out] of [['intensity', 'intensityVal'], ['volume', 'volumeVal'], ['effect', 'effectVal']]) {
  $(id).addEventListener('input', () => {
    $(out).textContent = Number($(id).value).toFixed(2);
    if (!engine) return;
    if (id === 'volume') engine.setPreferences({ volume: Number($(id).value) });
    if (id === 'effect') engine.setPreferences({ effect_strength: Number($(id).value) });
  });
}
$('enabled').addEventListener('change', () => engine?.setPreferences({ sound_enabled: $('enabled').checked }));
function resetAll() { setProgress(0); engine?.reset(); logEl.textContent = ''; }
$('reset').addEventListener('click', resetAll);
$('object').addEventListener('change', resetAll);
$('tool').addEventListener('change', resetAll);
