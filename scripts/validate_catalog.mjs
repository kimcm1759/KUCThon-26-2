// 카탈로그 검증: JSON 파싱, 필수 필드(tool_code/sound_role/file_path), ID 중복, 파일 실제 존재 여부.
// 실행: node scripts/validate_catalog.mjs   (프로젝트 루트에서). 파일 누락이나 파싱 오류면 종료 코드 1.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateCatalog } from '../src/audio/soundCatalog.js';

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
process.exit(fatal ? 1 : 0);
