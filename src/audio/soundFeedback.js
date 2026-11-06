// 사람 평가 기록 (선택). 사용자가 명시적으로 동의한 경우에만 저장한다.
// 카메라 사진·영상과 개인 식별 정보는 저장하지 않는다. 브라우저 localStorage에만 남는다.

const KEY = 'kucithon.soundFeedback.v1';
const CONSENT_KEY = 'kucithon.soundFeedback.consent';

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }

export const soundFeedback = {
  hasConsent() { return safeGet(CONSENT_KEY) === 'yes'; },
  setConsent(on) {
    safeSet(CONSENT_KEY, on ? 'yes' : 'no');
    if (!on) safeSet(KEY, '[]'); // 동의 철회 시 기록 삭제
  },

  /**
   * @param {object} r
   * @param {string} r.object_type
   * @param {string} r.tool_code
   * @param {string} r.interaction
   * @param {string[]} r.sound_ids   재생된 레이어 sound_id
   * @param {number} r.rating        1~5
   * @param {boolean} [r.user_changed_selection]
   * @param {string} [r.version]
   */
  record(r) {
    if (!this.hasConsent()) return false;
    const list = this.all();
    list.push({
      object_type: r.object_type,
      tool_code: r.tool_code,
      interaction: r.interaction,
      sound_ids: r.sound_ids,
      rating: Math.min(5, Math.max(1, Math.round(r.rating))),
      user_changed_selection: !!r.user_changed_selection,
      version: r.version ?? 'rule-based-1.0',
      date: new Date().toISOString().slice(0, 10),
    });
    return safeSet(KEY, JSON.stringify(list));
  },

  all() {
    try { return JSON.parse(safeGet(KEY) ?? '[]'); } catch { return []; }
  },
};
