// 카탈로그 로드·검증. 잘못된 카탈로그여도 앱을 멈추지 않고 빈 카탈로그(→ 합성 폴백)로 동작한다.
import { TOOL_CODES, SOUND_ROLES } from './constants.js';

/**
 * 카탈로그 객체를 검증한다. 자동 재생 후보(playable)와 제외 항목(issues)을 나눈다.
 * @param {unknown} data  JSON.parse 결과
 * @returns {{ sounds: object[], playable: object[], issues: {sound_id: string|null, code: string, message: string}[] }}
 */
export function validateCatalog(data) {
  const issues = [];
  if (!data || typeof data !== 'object' || !Array.isArray(data.sounds)) {
    issues.push({ sound_id: null, code: 'invalid_catalog', message: 'catalog.sounds 배열이 없음' });
    return { sounds: [], playable: [], issues };
  }

  const seen = new Set();
  const playable = [];
  for (const s of data.sounds) {
    const id = s && typeof s.sound_id === 'string' ? s.sound_id : null;
    const problems = [];
    if (!id) problems.push(['missing_sound_id', 'sound_id 없음']);
    else if (seen.has(id)) problems.push(['duplicate_sound_id', `중복 sound_id: ${id}`]);
    if (id) seen.add(id);
    if (!s?.file_path) problems.push(['missing_file_path', 'file_path 없음']);
    if (!s?.tool_code) problems.push(['missing_tool_code', 'tool_code 없음 (도구 미정 → needs_review)']);
    else if (!TOOL_CODES.includes(s.tool_code)) problems.push(['unknown_tool_code', `알 수 없는 tool_code: ${s.tool_code}`]);
    if (!s?.sound_role) problems.push(['missing_sound_role', 'sound_role 없음 (역할 미정 → needs_review)']);
    else if (!SOUND_ROLES.includes(s.sound_role)) problems.push(['unknown_sound_role', `알 수 없는 sound_role: ${s.sound_role}`]);

    if (problems.length) {
      for (const [code, message] of problems) issues.push({ sound_id: id, code, message });
    } else {
      playable.push(normalizeEntry(s));
    }
  }
  return { sounds: data.sounds, playable, issues };
}

/** 빠진 선택 필드에 기본값을 채운다. 원본 객체는 바꾸지 않는다. */
function normalizeEntry(s) {
  return {
    ...s,
    target_objects: Array.isArray(s.target_objects) ? s.target_objects : [],
    material_codes: Array.isArray(s.material_codes) ? s.material_codes : ['unknown'],
    secondary_actions: Array.isArray(s.secondary_actions) ? s.secondary_actions : [],
    texture_tags: Array.isArray(s.texture_tags) ? s.texture_tags : ['unknown'],
    intensity: s.intensity ?? 'unknown',
    action: s.action ?? 'other',
    loopable: s.loopable === true,
  };
}

/**
 * 카탈로그를 불러온다. 네트워크/파싱 실패 시 빈 카탈로그를 돌려준다.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, log?: (level: string, msg: string, extra?: object) => void }} [opts]
 */
export async function loadCatalog(url, { fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = validateCatalog(data);
    for (const issue of result.issues) log('warn', `[catalog] ${issue.code}: ${issue.sound_id ?? '-'} — ${issue.message}`);
    log('info', `[catalog] 자동 재생 후보 ${result.playable.length}개 / 제외 ${result.sounds.length - result.playable.length}개`);
    return result;
  } catch (err) {
    log('error', `[catalog] 로드 실패, 합성 폴백만 사용: ${err.message}`);
    return { sounds: [], playable: [], issues: [{ sound_id: null, code: 'load_failed', message: err.message }] };
  }
}
