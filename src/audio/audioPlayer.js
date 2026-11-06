// Web Audio 재생기: 타이밍 예약, 페이드, 지속 루프, 전역 음량·리미터, 빠른 연속 입력 제한.
// 파일 원본은 읽기만 하며 재생 시점 파라미터로만 소리를 바꾼다.
import { playSynthFallback } from './fallbackSynth.js';

const MIN_RAMP = 0.006; // 갑작스러운 음량 상승·클릭 방지용 최소 램프(초)

export class AudioPlayer {
  /**
   * @param {object} opts
   * @param {AudioContext} [opts.audioContext]
   * @param {string} [opts.baseUrl='']  file_path 앞에 붙일 경로 (예: '../')
   * @param {(filePath: string) => string} [opts.resolveUrl]  file_path → 실제 URL (번들러 asset URL 등). 기본은 baseUrl + file_path
   * @param {(level: string, msg: string) => void} [opts.log]
   * @param {number} [opts.maxVoicesPerRole=3]   역할별 동시 재생 수 제한
   * @param {number} [opts.minRetriggerMs=45]    같은 역할 재트리거 최소 간격
   * @param {(ev: object) => void} [opts.onLayerEvent] 개발용: 레이어 재생 시작·건너뜀을 알린다 (시각화 화면용)
   *   { type: 'start', layer, when, duration, analyser } / { type: 'skip', layer, reason }
   * @param {boolean} [opts.meters=false] 개발용: 레이어마다 AnalyserNode를 끼워 실제 음량을 볼 수 있게 한다
   */
  constructor({ audioContext, baseUrl = '', resolveUrl, log = () => {}, maxVoicesPerRole = 3, minRetriggerMs = 45,
    onLayerEvent, meters = false } = {}) {
    this.onLayerEvent = onLayerEvent;
    this.meters = meters;
    this.ac = audioContext ?? new AudioContext();
    this.resolveUrl = resolveUrl ?? ((fp) => baseUrl + fp);
    this.log = log;
    this.maxVoicesPerRole = maxVoicesPerRole;
    this.minRetriggerMs = minRetriggerMs;
    this.buffers = new Map(); // file_path -> Promise<AudioBuffer|null>
    this.voices = new Map(); // role -> [{ stop, startedAt }]
    this.lastTrigger = new Map();
    this.sustain = null;
    this.enabled = true;
    this.volume = 0.8;

    // master gain(전역 음량) → limiter → 출력
    this.master = this.ac.createGain();
    this.master.gain.value = this.volume;
    this.limiter = this.ac.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter).connect(this.ac.destination);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    this.master.gain.setTargetAtTime(this.volume, this.ac.currentTime, 0.03);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.stopAll(80);
  }

  async resume() {
    if (this.ac.state === 'suspended') await this.ac.resume();
  }

  /** 버퍼를 미리 불러온다. 실패한 경로는 null로 캐시되어 다시 시도하지 않는다. */
  load(filePath) {
    if (!this.buffers.has(filePath)) {
      const p = fetch(this.resolveUrl(filePath))
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((ab) => this.ac.decodeAudioData(ab))
        .catch((err) => { this.log('warn', `[player] 로드 실패 ${filePath}: ${err.message} — 레이어 건너뜀`); return null; });
      this.buffers.set(filePath, p);
    }
    return this.buffers.get(filePath);
  }

  preload(paths) {
    return Promise.all([...new Set(paths)].map((p) => this.load(p)));
  }

  /** soundComposer.compose() 결과를 재생한다. */
  async playPlan(plan) {
    if (plan.muted || !this.enabled) { // 음소거: 선택 결과는 유지하되 재생하지 않음
      for (const layer of plan.selected_sounds) this.onLayerEvent?.({ type: 'skip', layer, reason: '음소거' });
      return;
    }
    if (plan.stop_sustain) this.stopSustain(plan.stop_sustain.fade_ms);
    for (const u of plan.sustain_updates ?? []) this.updateSustain(u);

    const t0 = this.ac.currentTime + 0.01;
    await Promise.all(plan.selected_sounds.map((layer) => this.#playLayer(layer, t0)));
  }

  async #playLayer(layer, t0) {
    const now = performance.now();
    // 빠른 연속 입력: 같은 역할이 너무 촘촘하면 새 레이어를 건너뛴다 (지속 루프 제외)
    if (!layer.loop) {
      const last = this.lastTrigger.get(layer.role) ?? -Infinity;
      if (now - last < this.minRetriggerMs) {
        this.onLayerEvent?.({ type: 'skip', layer, reason: `같은 역할 ${this.minRetriggerMs}ms 안 재입력` });
        return;
      }
      this.lastTrigger.set(layer.role, now);
    }

    const out = this.ac.createGain();
    out.gain.value = 0;
    let head = out;
    let hp = null;
    if (layer.highpass_hz) {
      hp = this.ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = layer.highpass_hz;
      hp.connect(out);
      head = hp;
    }
    // 겹침 대역 ducking: 지정 대역만 잠깐 낮췄다가 원래대로 (피킹 EQ, 다른 대역은 그대로)
    let duck = null;
    if (layer.band_duck) {
      duck = this.ac.createBiquadFilter();
      duck.type = 'peaking';
      duck.frequency.value = layer.band_duck.hz;
      duck.Q.value = layer.band_duck.q ?? 1.4;
      duck.gain.value = 0;
      duck.connect(head);
      head = duck;
    }
    let analyser = null;
    if (this.meters) {
      analyser = this.ac.createAnalyser();
      analyser.fftSize = 512;
      out.connect(analyser);
      analyser.connect(this.master);
    } else {
      out.connect(this.master);
    }

    let when = t0 + (layer.delay_ms ?? 0) / 1000;

    const playSynth = (spec) => {
      when = Math.max(when, this.ac.currentTime + 0.005);
      out.gain.setValueAtTime(layer.gain, when);
      const dur = playSynthFallback(this.ac, head, spec, when);
      if (!dur) { // 합성 레시피도 없으면 레이어 생략
        out.disconnect();
        this.onLayerEvent?.({ type: 'skip', layer, reason: '합성 레시피 없음' });
        return;
      }
      this.onLayerEvent?.({ type: 'start', layer, when, duration: dur, analyser, synth: true });
      this.#register(layer.role, { stop: (f) => fadeStop(this.ac, out, null, f) });
      setTimeout(() => out.disconnect(), (when - this.ac.currentTime + dur + 0.5) * 1000);
    };

    if (layer.synth) { playSynth(layer.synth); return; }

    const buffer = await this.load(layer.file_path);
    if (!this.enabled) { out.disconnect(); return; }
    if (!buffer) {
      // 로드 실패: 같은 도구·역할의 합성 폴백 → 없으면 이 레이어만 생략. 다른 레이어는 계속 재생
      if (layer.on_load_fail && !layer.loop) {
        this.log('warn', `[player] ${layer.sound_id} 대신 합성 폴백 synth:${layer.on_load_fail.tool_code}_${layer.role}`);
        this.onLayerEvent?.({ type: 'skip', layer, reason: '파일 로드 실패 → 합성 폴백' });
        playSynth(layer.on_load_fail);
      } else {
        out.disconnect();
      }
      return;
    }

    // 디코딩이 늦어 예약 시각을 넘겼으면 바로 재생
    when = Math.max(when, this.ac.currentTime + 0.005);
    const src = this.ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = layer.playback_rate ?? 1;
    src.connect(head);

    const fadeIn = Math.max(MIN_RAMP, (layer.fade_in_ms ?? 0) / 1000);
    // 재질 음원은 녹음마다 원본 음량이 달라 loudness_comp를 곱한다 (최종 클리핑은 리미터)
    const g = layer.gain * (layer.loudness_comp ?? 1);
    if (duck) {
      duck.gain.setValueAtTime(layer.band_duck.db, when);
      duck.gain.linearRampToValueAtTime(0, when + (layer.band_duck.ms ?? 120) / 1000);
    }
    out.gain.setValueAtTime(0, when);
    if (layer.attack?.boost_db && !layer.loop) {
      // 어택 강조: 시작 순간만 키웠다가 attack.ms 동안 원래 크기로 돌아온다 (파일은 그대로)
      out.gain.linearRampToValueAtTime(g * 10 ** (layer.attack.boost_db / 20), when + fadeIn);
      out.gain.linearRampToValueAtTime(g, when + fadeIn + (layer.attack.ms ?? 60) / 1000);
    } else {
      out.gain.linearRampToValueAtTime(g, when + fadeIn);
    }

    // 앞부분 무음(offset_ms)은 건너뛰고 재생한다. 원본 파일은 그대로, 재생 시작 위치만 옮긴다.
    const offset = layer.loop ? 0
      : Math.min(Math.max(0, (layer.offset_ms ?? 0) / 1000), Math.max(0, buffer.duration - 0.01));

    if (layer.loop) {
      // 비루프 원본을 지속시키기 위해 어택 이후 구간만 반복
      src.loop = true;
      src.loopStart = buffer.duration * 0.25;
      src.loopEnd = buffer.duration * 0.9;
      this.stopSustain(60);
      this.sustain = { src, out, hp };
    }

    // start()를 반드시 stop()보다 먼저 호출한다 (반대 순서면 InvalidStateError로 레이어 전체가 재생되지 않음)
    src.start(when, offset);

    if (!layer.loop && layer.max_duration_ms) {
      // 길이 제한은 소리 시작점(offset_ms 이후)부터 센다. 파일이 제한보다 짧으면 자연스럽게 끝나게 둔다.
      const remaining = (buffer.duration - offset) / (layer.playback_rate || 1);
      const limit = layer.max_duration_ms / 1000;
      if (limit < remaining) {
        const fade = Math.min((layer.fade_out_ms ?? 150) / 1000, limit / 2);
        const end = when + limit;
        out.gain.setValueAtTime(g, Math.max(when + fadeIn, end - fade));
        out.gain.linearRampToValueAtTime(0, end);
        src.stop(end + 0.02);
      }
    }
    if (this.onLayerEvent) {
      const remaining = (buffer.duration - offset) / (layer.playback_rate || 1);
      const duration = layer.loop ? null : Math.min(remaining, (layer.max_duration_ms ?? Infinity) / 1000);
      this.onLayerEvent({ type: 'start', layer, when, duration, analyser });
    }
    src.onended = () => { out.disconnect(); analyser?.disconnect(); };
    if (!layer.loop) this.#register(layer.role, { stop: (f) => fadeStop(this.ac, out, src, f) });
  }

  #register(role, voice) {
    const list = this.voices.get(role) ?? [];
    list.push(voice);
    // 역할별 동시 재생 수를 넘으면 오래된 소리부터 짧게 페이드아웃
    while (list.length > this.maxVoicesPerRole) list.shift().stop(40);
    this.voices.set(role, list);
  }

  updateSustain({ gain, playback_rate, highpass_hz, ramp_ms = 120 }) {
    if (!this.sustain) return;
    const t = this.ac.currentTime;
    const tau = ramp_ms / 1000 / 3;
    if (gain != null) this.sustain.out.gain.setTargetAtTime(gain, t, tau);
    if (playback_rate != null) this.sustain.src.playbackRate.setTargetAtTime(playback_rate, t, tau);
    if (highpass_hz != null && this.sustain.hp) this.sustain.hp.frequency.setTargetAtTime(highpass_hz, t, tau);
  }

  stopSustain(fadeMs = 200) {
    if (!this.sustain) return;
    fadeStop(this.ac, this.sustain.out, this.sustain.src, fadeMs);
    this.sustain = null;
  }

  stopAll(fadeMs = 100) {
    this.stopSustain(fadeMs);
    for (const list of this.voices.values()) for (const v of list) v.stop(fadeMs);
    this.voices.clear();
  }
}

function fadeStop(ac, gainNode, src, fadeMs) {
  const t = ac.currentTime;
  const f = Math.max(MIN_RAMP, fadeMs / 1000);
  try {
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(gainNode.gain.value, t);
    gainNode.gain.linearRampToValueAtTime(0, t + f);
    src?.stop(t + f + 0.02);
  } catch { /* 이미 정지된 소스 */ }
}
