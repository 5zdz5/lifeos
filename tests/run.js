/* =========================================================================
 * LifeOS 测试入口：npm test
 * 依次运行各单测，任一失败则返回非零退出码。
 * ========================================================================= */
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['logic.test.js', 'grid.test.js', 'backup.test.js', 'build.test.js', 'library.test.js',
  'agent.test.js', 'mindsea.test.js', 'security.test.js', 'ux.test.js', 'storage.test.js', 'w2.test.js', 'w3.test.js',
  'pet.test.js', 'browser.test.js'];
let failed = 0;

suites.forEach((f) => {
  console.log('\n──────── ' + f + ' ────────');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log('❌ ' + f + ' 失败'); }
});

console.log('\n════════════════════════════════');
console.log(failed ? '❌ ' + failed + ' 个测试套件失败' : '✅ 全部 ' + suites.length + ' 个测试套件通过');
process.exit(failed ? 1 : 0);
