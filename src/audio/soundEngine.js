// 앱이 쓰는 진입점. 카탈로그 로드 → 규칙 기반 선택·조합(compose) → 재생(AudioPlayer).
// "AI"는 메타데이터 점수화 + 규칙 기반 믹싱이며 학습 모델이 아니다.
import { loadCatalog, validateCatalog } from './soundCatalog.js';
import { compose } from './soundComposer.js';
import { AudioPlayer } from './audioPlayer.js';

export class SoundEngine {
  /**
   * @param {object} opts
   * @param {string} [opts.catalogUrl]   catalog.json 경로
   * @param {object} [opts.catalogData]  이미 읽은 카탈로그 객체 (catalogUrl 대신)
   * @param {string} [opts.baseUrl='']   file_path 기준 경로
   * @param {(filePath: string) => string} [opts.resolveUrl] file_path를 플랫폼 asset URL로 바꾸는 함수 (선택)
   * @param {AudioContext} [opts.audioContext]
   * @param {boolean} [opts.debug=false] 개발 로그(선택 음원·이유) 출력
   * @param {(entry: object) => void} [opts.onDecision] 결정마다 호출 (디버그 패널용)
   */
  static async create({ catalogUrl, catalogData, baseUrl = '', resolveUrl, audioContext, debug = false, onDecision } = {}) {
    const log = debug
      ? (level, msg) => (console[level] ?? console.log)(msg)
      : (level, msg) => { if (level === 'error') console.error(msg); };
    const catalog = catalogData ? validateCatalog(catalogData) : await loadCatalog(catalogUrl, { log });
    const player = new AudioPlayer({ audioContext, baseUrl, resolveUrl, log });
    return new SoundEngine(catalog, player, { log, onDecision });
  }

  constructor(catalog, player, { log = () => {}, onDecision } = {}) {
    this.catalog = catalog;
    this.player = player;
    this.log = log;
    this.onDecision = onDecision;
    this.prefs = { volume: 0.8, sound_enabled: true, effect_strength: 1 };
    this.state = { key: null, progress: 0, finishPlayed: false };
  }

  /** 카탈로그의 재생 후보 파일을 미리 디코딩 (첫 탭 지연 감소) */
  preloadAll() {
    return this.player.preload(this.catalog.playable.map((s) => s.file_path));
  }

  /** @param {{ volume?: number, sound_enabled?: boolean, effect_strength?: number }} p */
  setPreferences(p) {
    Object.assign(this.prefs, p);
    if (p.volume != null) this.player.setVolume(p.volume);
    if (p.sound_enabled != null) this.player.setEnabled(p.sound_enabled);
  }

  /** 물건이나 도구가 바뀌거나 새 물건을 시작할 때 진행 상태 초기화 */
  reset() {
    this.player.stopAll(120);
    this.state = { key: null, progress: 0, finishPlayed: false };
  }

  /** 탭 한 번 */
  tap(input) { return this.#run({ ...input, interaction: 'tap', phase: 'start' }); }
  /** 누르기·쓸기 시작 */
  begin(input) { return this.#run({ ...input, phase: 'start' }); }
  /** 누르기 유지 / 쓸기 진행 (progress, swipe_speed 갱신) */
  update(input) { return this.#run({ ...input, phase: 'update' }); }
  /** 손을 뗌 */
  end(input) { return this.#run({ ...input, phase: 'end' }); }

  #run(input) {
    const key = `${input.object_type}|${input.tool_code}`;
    const progress = Number(input.progress) || 0;
    if (this.state.key !== key || progress < this.state.progress) {
      this.state = { key, progress: 0, finishPlayed: false };
    }

    const plan = compose({
      ...input,
      previous_progress: this.state.progress,
      finish_played: this.state.finishPlayed,
      sound_enabled: this.prefs.sound_enabled && input.sound_enabled !== false,
    }, this.catalog.playable);

    const k = this.prefs.effect_strength ?? 1;
    if (k !== 1) for (const s of plan.selected_sounds) s.gain = Math.min(1, s.gain * k);

    this.state.progress = Math.max(this.state.progress, progress);
    if (plan.selected_sounds.some((s) => s.role === 'finish')) this.state.finishPlayed = true;

    // 개발 로그: 선택 음원과 이유. 사용자 화면에는 그대로 노출하지 않는다.
    if (plan.selected_sounds.length || plan.stop_sustain) this.log('debug', `[sound] ${plan.reason}`);
    this.onDecision?.({ input, plan });

    this.player.playPlan(plan).catch((err) => this.log('error', `[sound] 재생 오류: ${err.message}`));
    return plan;
  }
}
