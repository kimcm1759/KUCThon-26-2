// 카탈로그 검증: JSON 파싱, 필수 필드(tool_code/sound_role/file_path), ID 중복, 파일 실제 존재 여부.
// 실행: node scripts/validate_catalog.mjs   (프로젝트 루트에서). 파일 누락이나 파싱 오류면 종료 코드 1.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateCatalog, coverageReport } from '../src/audio/soundCatalog.js';
import { OBJECT_TYPES } from '../src/audio/constants.js';
import { OBJECT_SOUND_PROFILES } from '../src/audio/presets/materialPresets.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let data;
try {
  data = JSON.parse(readFileSync(path.join(root, 'sounds/catalog.json'), 'utf8'));
} catch (err) {
  console.error(`catalog.json 파싱 실패: ${err.message}`);
  process.exit(1);
}

const { sounds, playable, issues } = validateCatalog(data);
let fatal = false;

const missingFiles = sounds.filter((s) => s?.file_path && !existsSync(path.join(root, s.file_path)));
for (const s of missingFiles) {
  console.error(`✗ 파일 없음: ${s.sound_id} → ${s.file_path}`);
  fatal = true;
}
for (const i of issues) {
  const severe = i.code === 'duplicate_sound_id' || i.code === 'invalid_catalog' || i.code === 'missing_file_path';
  if (severe) fatal = true;
  console.log(`${severe ? '✗' : '!'} ${i.sound_id ?? '-'}: ${i.message}`);
}
console.log(`전체 ${sounds.length}개 / 자동 재생 후보 ${playable.length}개 / 제외 ${sounds.length - playable.length}개`);

// ---- 준비 현황 ----
const { rows, unassigned } = coverageReport({ sounds, playable }, OBJECT_TYPES);
console.log('\n도구 × 역할 준비 현황 (물건 전용 음원: 있으면 물건 코드, 없으면 범용만)');
for (const r of rows) {
  const obj = r.objects.length ? r.objects.join(',') : '범용만';
  console.log(`  ${r.tool_code.padEnd(16)} ${r.sound_role.padEnd(14)} ${r.status.padEnd(12)} ${r.sound_ids.join(', ') || '-'}  [${obj}]`);
}
if (unassigned.length) console.log(`도구·역할 미정(needs_review, 자동 재생 제외): ${unassigned.join(', ')}`);
// ---- 물건 고유 소리 준비 현황 ----
const mats = (data.material_sounds ?? []).filter((m) => m?.status === 'ready');
for (const m of mats) {
  if (!existsSync(path.join(root, m.file_path))) { console.error(`✗ 재질 파일 없음: ${m.sound_id} → ${m.file_path}`); fatal = true; }
}
console.log(`
물건 고유 소리 (material_sounds ready ${mats.length}개) — 슬롯별로 고른 [재질·동작], 없으면 부족`);
for (const [obj, prof] of Object.entries(OBJECT_SOUND_PROFILES)) {
  for (const [event, slots] of Object.entries(prof.events)) {
    const cells = slots.map((slot) => {
      const hit = slot.alts.find(([mat, act]) => mats.some((m) => m.material_code === mat && m.action === act));
      return hit ? hit.join('·') : `부족(${slot.alts.map((a) => a.join('·')).join('|')})`;
    });
    console.log(`  ${obj.padEnd(13)} ${event.padEnd(11)} ${cells.join(' + ')}`);
  }
  for (const g of prof.gaps ?? []) console.log(`  ${obj.padEnd(13)} 부족: ${g.message}`);
}
process.exit(fatal ? 1 : 0);
