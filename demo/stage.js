// 부수기 사운드 화면 (시제품). 엔진이 고른 소리와 플레이어가 실제로 재생한 소리를 그림·타임라인으로 보여 준다.
// 규칙 기반 엔진(src/audio/)을 그대로 쓰며, 이 파일은 화면 표시만 담당한다.
import { SoundEngine } from '../src/audio/soundEngine.js';

const $ = (id) => document.getElementById(id);
const BUST = Date.now(); // 브라우저 캐시 때문에 예전 카탈로그·음원이 재생되지 않게

const OBJECTS = [
  { code: 'book', label: '📕 책' },
  { code: 'aluminum_can', label: '🥫 알루미늄 캔' },
  { code: 'laptop', label: '💻 노트북' },
];
const TOOLS = [
  { code: 'hammer', label: '🔨 망치', sustain: false, main: 90 },
  { code: 'aluminum_bat', label: '🏏 알루미늄 배트', sustain: false, main: 180 },
  { code: 'hydraulic_press', label: '🗜️ 유압 프레스', sustain: true, main: 350 },
  { code: 'laser', label: '🔦 레이저', sustain: true, main: 420 },
  { code: 'bomb', label: '💣 폭탄', sustain: false, main: 1500 },
];
const MODES = [{ code: 'tap', label: '탭' }, { code: 'press', label: '누르고 있기' }];
const ROLE_KO = { activation: '준비', main_action: '핵심', impact_detail: '세부', finish: '종료' };
const LANES = [
  { key: 'obj0', label: '물건 · 주' }, { key: 'obj1', label: '물건 · 보조' },
  { key: 'activation', label: '도구 · 준비' }, { key: 'main_action', label: '도구 · 핵심' },
  { key: 'impact_detail', label: '도구 · 세부' }, { key: 'finish', label: '도구 · 종료' },
];

const ui = { object: 'aluminum_can', tool: 'hammer', mode: 'tap' };
let engine = null;
let progress = 0;
let count = 0;
let hold = null;
const voices = []; // { id, layer, kind, lane, name, when, end, analyser, hist: [[t, db]], skip }
window.__stage = { voices, get engine() { return engine; } }; // 개발 확인용

// ---------- 컨트롤 ----------
function segment(el, items, key, onChange) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    b.setAttribute('aria-pressed', String(ui[key] === it.code));
    b.addEventListener('click', () => { ui[key] = it.code; segment(el, items, key, onChange); onChange?.(); });
    el.append(b);
  }
}
function toolInfo() { return TOOLS.find((t) => t.code === ui.tool); }
function refreshModes() {
  const t = toolInfo();
  if (!t.sustain) ui.mode = 'tap';
  segment($('modes'), t.sustain ? MODES : MODES.slice(0, 1), 'mode', updateHint);
  updateHint();
}
function updateHint() {
  $('hint').textContent = ui.mode === 'tap' ? '여기를 탭하세요 (탭할 때마다 소리가 다시 납니다)' : '여기를 누르고 있으세요 (누르는 동안 진행)';
}
segment($('objects'), OBJECTS, 'object', resetAll);
segment($('tools'), TOOLS, 'tool', () => { refreshModes(); resetAll(); });
refreshModes();
$('intensity').addEventListener('input', () => { $('intVal').textContent = Number($('intensity').value).toFixed(2); });
$('volume').addEventListener('input', () => {
  $('volVal').textContent = Number($('volume').value).toFixed(2);
  engine?.setPreferences({ volume: Number($('volume').value) });
});
$('reset').addEventListener('click', resetAll);
// 오디오 장치가 켜지는 데 시간이 걸려 첫 탭이 늦게 나는 것을 막기 위해, 페이지를 처음 누를 때 미리 준비한다
document.addEventListener('pointerdown', () => { ensureEngine(); }, { once: true, capture: true });

function resetAll() {
  progress = 0; count = 0;
  engine?.reset();
  stopHold();
  setState('대기');
  render();
}

// ---------- 엔진 ----------
let enginePromise = null;
function ensureEngine() {
  enginePromise ??= createEngine();
  return enginePromise;
}
async function createEngine() {
  engine = await SoundEngine.create({
    catalogUrl: `../sounds/catalog.json?v=${BUST}`,
    resolveUrl: (fp) => `../${fp}?v=${BUST}`,
    meters: true,
    onDecision,
    onLayerEvent,
  });
  await engine.player.resume();
  engine.setPreferences({ volume: Number($('volume').value) });
  await engine.preloadAll();
  return engine;
}
function ctxNow() { return engine ? engine.player.ac.currentTime : 0; }

function laneOf(layer) {
  if (layer.material) return layer.slot > 0 ? 'obj1' : 'obj0';
  return layer.role;
}
function nameOf(layer) {
  if (layer.material) {
    const m = engine.catalog.materials.find((x) => x.sound_id === layer.sound_id);
    return (m?.description ?? layer.sound_id).replace(/ 소리$/, '');
  }
  const t = TOOLS.find((x) => x.code === ui.tool)?.label.replace(/^\S+ /, '') ?? '';
  return `${t} ${ROLE_KO[layer.role] ?? layer.role}${layer.synth ? ' (합성)' : ''}`;
}

function onLayerEvent(ev) {
  const l = ev.layer;
  const v = { id: Math.random(), layer: l, kind: l.material ? 'obj' : 'tool', lane: laneOf(l), name: nameOf(l), hist: [] };
  if (ev.type === 'start') {
    v.when = ev.when;
    v.end = ev.duration == null ? Infinity : ev.when + ev.duration; // 루프는 멈출 때까지
    v.analyser = ev.analyser;
    v.buf = ev.analyser ? new Float32Array(ev.analyser.fftSize) : null;
  } else {
    v.when = ctxNow() + (l.delay_ms ?? 0) / 1000;
    v.end = v.when + 0.25;
    v.skip = ev.reason;
    addLog(`   ⚠ 건너뜀: ${v.name} — ${ev.reason}`);
  }
  voices.push(v);
  if (voices.length > 80) voices.splice(0, voices.length - 80);
}

function onDecision({ input, plan }) {
  if (plan.stop_sustain) {
    const t = ctxNow() + (plan.stop_sustain.fade_ms ?? 200) / 1000;
    for (const v of voices) if (v.end === Infinity) v.end = t;
  }
  if (!plan.selected_sounds.length) return;
  const os = plan.object_sound;
  const badge = $('stObj');
  badge.className = `badge ${os.status === 'ok' ? 'ok' : 'bad'}`;
  badge.textContent = os.status === 'ok' ? '있음' : os.status === 'missing' ? '부족' : os.status;
  const objs = plan.selected_sounds.filter((s) => s.material);
  const tools = plan.selected_sounds.filter((s) => !s.material);
  const fmt = (s) => `${nameOf(s)} +${s.delay_ms}ms`;
  const miss = os.missing.length ? `<div style="color:var(--bad)">부족: ${os.missing.map((m) => m.wanted).join(', ')}</div>` : '';
  const gaps = os.gaps?.length ? `<div class="empty">녹음 없음: ${os.gaps.map((g) => g.message).join(', ')}</div>` : '';
  $('planBox').className = '';
  $('planBox').innerHTML =
    `<div><span class="badge" style="background:var(--obj-soft);color:var(--obj)">물건</span> ${objs.map(fmt).join(' · ') || '<span class="empty">없음</span>'}</div>`
    + `<div style="margin-top:4px"><span class="badge" style="background:var(--tool-soft);color:var(--tool)">도구</span> ${tools.map(fmt).join(' · ') || '<span class="empty">없음</span>'}</div>`
    + miss + gaps;
  const phase = { start: input.interaction === 'tap' ? '탭' : '누르기 시작', update: '누르는 중 진행 단계', end: '손 뗌' }[input.phase];
  addLog(`#${count} ${phase} · ${OBJECTS.find((o) => o.code === input.object_type).label} · ${toolInfo().label} · 진행 ${Math.round(progress * 100)}%\n`
    + `   물건: ${objs.map(fmt).join(', ') || '없음'}${os.missing.length ? ` (부족: ${os.missing.map((m) => m.wanted).join(', ')})` : ''}\n`
    + `   도구: ${tools.map(fmt).join(', ') || '없음'}`);
  // 타격 순간 화면 효과 (물건 소리 시작 시점에 맞춤)
  const hitDelay = (objs[0] ?? tools.find((s) => s.role === 'main_action'))?.delay_ms;
  if (hitDelay != null && input.phase !== 'update') setTimeout(hitFx, hitDelay);
  else if (objs.length) hitFx(true);
}

function addLog(text) {
  const el = $('log');
  el.textContent = `${text}\n${el.textContent}`.slice(0, 8000);
}

// ---------- 입력 ----------
const stage = $('stage');
function input() {
  return { object_type: ui.object, tool_code: ui.tool, interaction: ui.mode, intensity: Number($('intensity').value), progress };
}
stage.addEventListener('pointerdown', async (e) => {
  try { stage.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 */ }
  const eng = await ensureEngine();
  count += 1;
  if (ui.mode === 'tap') {
    progress = Math.min(1, progress + 0.12 + 0.2 * Number($('intensity').value));
    eng.tap(input());
    swing();
    setState(progress >= 1 ? '파손 완료' : '탭');
    render();
    return;
  }
  eng.begin(input());
  setState('누르는 중');
  hold = { timer: setInterval(() => {
    progress = Math.min(1, progress + 0.02 + 0.03 * Number($('intensity').value));
    eng.update({ ...input(), swipe_speed: 0.5 });
    setState(progress >= 1 ? '파손 완료' : '누르는 중');
    render();
  }, 100) };
  render();
});
function stopHold() { if (hold) { clearInterval(hold.timer); hold = null; } }
function release() {
  if (!hold) return;
  stopHold();
  engine?.end(input());
  setState(progress >= 1 ? '파손 완료' : '손 뗌');
  render();
}
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);

function setState(s) {
  $('stState').textContent = s;
  $('stProg').textContent = `${Math.round(progress * 100)}%`;
  $('stCount').textContent = `${count}회`;
  $('progressBar').style.width = `${progress * 100}%`;
}

// ---------- 그림 ----------
let toolOffset = 0;
function swing() {
  toolOffset = 1; render();
  setTimeout(() => { toolOffset = 0; render(); }, Math.min(400, toolInfo().main + 120));
}
function hitFx() {
  const f = $('flash');
  const c = ui.object === 'book' ? '255,190,120' : ui.object === 'aluminum_can' ? '200,215,230' : '160,220,255';
  f.style.background = `radial-gradient(circle at 50% 62%, rgba(${c},.75), transparent 55%)`;
  f.style.transition = 'none'; f.style.opacity = '1';
  requestAnimationFrame(() => { f.style.transition = 'opacity .35s'; f.style.opacity = '0'; });
}

function crackLines(cx, cy, n, len, seed) {
  let s = seed, out = '';
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    let x = cx, y = cy, a = (i / Math.max(1, n)) * Math.PI * 2 + r();
    let d = `M${x.toFixed(1)},${y.toFixed(1)}`;
    for (let k = 0; k < 4; k++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * len / 4; y += Math.sin(a) * len / 4; d += ` L${x.toFixed(1)},${y.toFixed(1)}`; }
    out += `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".75"/>`;
  }
  return out;
}

function objectSvg(p) {
  const done = p >= 1;
  if (ui.object === 'aluminum_can') {
    const h = 150 * (1 - 0.68 * p), w = 84 + 26 * p, x = 200 - w / 2, y = 280 - h;
    const dent = 6 + 14 * p;
    // 옆면: 왼쪽 위→아래, 오른쪽 아래→위 (찌그러질수록 옆면이 안쪽으로 접힘)
    const n = 6, pts = [];
    for (let i = 0; i <= n; i++) pts.push([x + (i % 2 ? dent * p : 0), y + (h * i) / n]);
    for (let i = n; i >= 0; i--) pts.push([x + w - (i % 2 ? dent * p : 0), y + (h * i) / n]);
    const body = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ') + ' Z';
    return `<g>
      <path d="${body}" fill="#c9d2dc" stroke="#7d8a97" stroke-width="2"/>
      <ellipse cx="200" cy="${y}" rx="${w / 2}" ry="${8 + 4 * p}" fill="#dfe5eb" stroke="#7d8a97" stroke-width="2"/>
      <rect x="${x + 4}" y="${y + h * 0.35}" width="${w - 8}" height="${Math.max(8, h * 0.28)}" fill="#e8590c" opacity=".85"/>
      ${p > 0.2 ? `<g style="color:#5b6670">${crackLines(200, y + h / 2, Math.round(p * 5), 30 * p + 10, 7)}</g>` : ''}
      ${done ? '<text x="200" y="28" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">파손 완료 · 납작하게 찌그러짐</text>' : ''}
    </g>`;
  }
  if (ui.object === 'book') {
    const tilt = -4 + 10 * p;
    const gap = done ? 26 : 0;
    const half = (dx, rot) => `<g transform="translate(${dx},0) rotate(${rot} 200 210)">
        <rect x="120" y="150" width="160" height="118" rx="4" fill="#9c4f2a" stroke="#5c2b14" stroke-width="2"/>
        <rect x="128" y="158" width="144" height="102" fill="#f6efe2"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="138" y1="${172 + i * 15}" x2="262" y2="${172 + i * 15}" stroke="#cfc6b4"/>`).join('')}
      </g>`;
    if (!done) {
      return `<g transform="rotate(${tilt} 200 210)">${half(0, 0)}
        <g style="color:#5c2b14">${crackLines(200, 205, Math.round(p * 6), 40 * p + 8, 3)}</g></g>`;
    }
    return `<clipPath id="lc"><rect x="0" y="0" width="200" height="330"/></clipPath>
      <clipPath id="rc"><rect x="200" y="0" width="200" height="330"/></clipPath>
      <g clip-path="url(#lc)">${half(-gap, -8)}</g><g clip-path="url(#rc)">${half(gap, 9)}</g>
      <text x="200" y="28" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">파손 완료 · 찢어짐</text>`;
  }
  // laptop
  const open = 1 - 0.25 * p;
  return `<g>
    <path d="M110,272 L290,272 L310,290 L90,290 Z" fill="#aeb6bf" stroke="#66707a" stroke-width="2"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => `<rect x="${118 + c * 18 + r * 3}" y="${276 + r * 4.5}" width="13" height="3" fill="#7c858e"/>`).join('')).join('')}
    <g transform="translate(200,272) scale(1,${open}) translate(-200,-272)">
      <rect x="118" y="150" width="164" height="118" rx="6" fill="#3b4148" stroke="#66707a" stroke-width="2"/>
      <rect x="126" y="158" width="148" height="102" fill="${p > 0 ? '#16324f' : '#1f5c8f'}"/>
      <g style="color:#d7ecff">${crackLines(205, 205, Math.round(p * 8), 70 * p + 10, 11)}</g>
      ${done ? '<path d="M150,262 l10,-8 l8,9 Z M230,264 l12,-10 l6,11 Z M190,266 l6,-7 l7,7 Z" fill="#9cc7ee"/>' : ''}
    </g>
    ${done ? '<text x="200" y="28" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">파손 완료 · 화면이 깨짐</text>' : ''}
  </g>`;
}

function toolSvg(p) {
  const pressing = Boolean(hold);
  switch (ui.tool) {
    case 'hammer':
    case 'aluminum_bat': {
      const icon = ui.tool === 'hammer' ? '🔨' : '🏏';
      const rot = toolOffset ? 10 : -35, ty = toolOffset ? 70 : 0;
      return `<text x="250" y="${95 + ty}" font-size="64" transform="rotate(${rot} 250 ${80 + ty})" style="transition:all .08s">${icon}</text>`;
    }
    case 'hydraulic_press': {
      const top = ui.object === 'aluminum_can' ? 280 - 150 * (1 - 0.68 * p) : 150 + 12 * p;
      const y = pressing || p > 0 ? top - 26 : 40;
      return `<rect x="170" y="0" width="60" height="${y}" fill="#868e96"/><rect x="110" y="${y}" width="180" height="22" rx="3" fill="#495057"/>`;
    }
    case 'laser':
      return `<text x="20" y="70" font-size="40">🔦</text>${pressing ? '<line x1="62" y1="52" x2="205" y2="205" stroke="#ff2d2d" stroke-width="4" opacity=".85"/><circle cx="205" cy="205" r="7" fill="#ffd43b"/>' : ''}`;
    case 'bomb':
      return `<text x="245" y="270" font-size="44">💣</text>`;
    default:
      return '';
  }
}

function render() {
  $('scene').innerHTML = `<g style="color:var(--text)">${objectSvg(progress)}${toolSvg(progress)}</g>`;
}
render();
setState('대기');

// ---------- 재생 중 소리·타임라인 ----------
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function levelDb(v) {
  if (!v.analyser) return -90;
  v.analyser.getFloatTimeDomainData(v.buf);
  let s = 0; for (const x of v.buf) s += x * x;
  return 10 * Math.log10(s / v.buf.length + 1e-12);
}

function frame() {
  const now = ctxNow();
  for (const v of voices) {
    if (!v.skip && now >= v.when && now <= Math.min(v.end, v.when + 6)) v.hist.push([now, levelDb(v)]);
  }
  drawNow(now);
  drawTimeline(now);
  requestAnimationFrame(frame);
}

function drawNow(now) {
  const box = $('now');
  const live = voices.filter((v) => now >= v.when - 0.05 && now <= v.end + 0.4).slice(-8);
  if (!live.length) {
    if (!box.dataset.empty) { box.innerHTML = '<div class="empty">재생 중인 소리 없음</div>'; box.dataset.empty = '1'; }
    return;
  }
  delete box.dataset.empty;
  box.innerHTML = live.map((v) => {
    const db = v.hist.length ? v.hist[v.hist.length - 1][1] : -90;
    const pct = v.skip ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    return `<div class="voice ${v.kind}${v.skip ? ' skip' : ''}"><span class="kind">${v.kind === 'obj' ? '물건' : '도구'}</span>
      <span class="name" title="${v.layer.sound_id}">${v.name}${v.skip ? ` — 건너뜀: ${v.skip}` : ''}</span>
      <span class="meter"><div style="width:${pct.toFixed(0)}%"></div></span></div>`;
  }).join('');
}

function drawTimeline(now) {
  const cv = $('timeline');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const labelW = 86, past = 3, future = 1.5;
  const t0 = now - past, span = past + future;
  const X = (t) => labelW + ((t - t0) / span) * (W - labelW);
  const laneH = H / LANES.length;
  g.font = '12px system-ui, "Malgun Gothic", sans-serif';
  g.textBaseline = 'middle';
  LANES.forEach((ln, i) => {
    g.fillStyle = css('--muted');
    g.fillText(ln.label, 4, i * laneH + laneH / 2);
    g.strokeStyle = css('--line');
    g.beginPath(); g.moveTo(labelW, (i + 1) * laneH - 0.5); g.lineTo(W, (i + 1) * laneH - 0.5); g.stroke();
  });
  for (const v of voices) {
    const li = LANES.findIndex((l) => l.key === v.lane);
    if (li < 0) continue;
    const end = Math.min(v.end, now + future);
    if (end < t0 || v.when > now + future) continue;
    const x0 = Math.max(labelW, X(v.when)), x1 = Math.max(x0 + 3, X(end));
    const y = li * laneH + 4, h = laneH - 8;
    const strong = v.skip ? css('--bad') : v.kind === 'obj' ? css('--obj') : css('--tool');
    const soft = v.skip ? 'transparent' : v.kind === 'obj' ? css('--obj-soft') : css('--tool-soft');
    g.fillStyle = soft; g.fillRect(x0, y, x1 - x0, h);
    g.strokeStyle = strong; g.lineWidth = v.skip ? 2 : 1; g.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, h - 1);
    // 실제 음량 (막대 아래쪽에서 위로 채움, -60~0 dB)
    if (v.hist.length > 1) {
      g.fillStyle = strong; g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(X(v.hist[0][0]), y + h);
      for (const [t, db] of v.hist) {
        if (t < t0) continue;
        g.lineTo(X(t), y + h - Math.max(0, Math.min(1, (db + 60) / 60)) * h);
      }
      g.lineTo(X(v.hist[v.hist.length - 1][0]), y + h); g.closePath(); g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = css('--text');
    g.save(); g.beginPath(); g.rect(x0, y, x1 - x0, h); g.clip();
    g.fillText(v.skip ? `✕ ${v.name} (${v.skip})` : v.name, x0 + 4, y + h / 2);
    g.restore();
  }
  g.strokeStyle = css('--text'); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(X(now), 0); g.lineTo(X(now), H); g.stroke();
}
requestAnimationFrame(frame);
