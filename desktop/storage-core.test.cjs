/**
 * storage-core 单元测试（纯 Node，无需 Electron）
 * 校验 JSON 存储与二进制/目录文件句柄的正确性。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const core = require('./storage-core.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgn-storage-test-'));
let pass = 0;

function ok(name, cond) {
  assert.ok(cond, name);
  pass += 1;
  console.log('  ✓', name);
}

// ---- JSON store ----
const store = core.createJsonStore(tmp);
ok('初始为空', store.length() === 0);

store.set('sgn.settings', '{"apiKey":"sk-test"}');
ok('写入后可读取字符串', store.get('sgn.settings') === '{"apiKey":"sk-test"}');
ok('length 随写入增长', store.length() === 1);

store.set('sgn.products', '[1,2,3]');
ok('多键写入', store.get('sgn.products') === '[1,2,3]');
ok('length=2', store.length() === 2);

store.remove('sgn.products');
ok('删除后读取为 null', store.get('sgn.products') === null);
ok('length=1', store.length() === 1);

ok('key(0) 返回键名', store.key(0) === 'sgn.settings');
ok('不存在键返回 null', store.get('nope') === null);

store.clear();
ok('clear 后清空', store.length() === 0);

// 键名含特殊字符应能安全映射为文件名
store.set('a/b:c?*', 'x');
ok('特殊键名可读写', store.get('a/b:c?*') === 'x');

// ---- fs handle（二进制 + 目录） ----
const fs2 = core.createFsHandle(tmp);
const ab = new Uint8Array([1, 2, 3, 4, 5]).buffer;
fs2.writeBuffer('report/template.bin', ab);
ok('二进制写入后可读取', fs2.readBuffer('report/template.bin') instanceof ArrayBuffer);
ok('二进制内容一致', Buffer.compare(Buffer.from(new Uint8Array(fs2.readBuffer('report/template.bin'))), Buffer.from([1, 2, 3, 4, 5])) === 0);

fs2.writeJson('report/template.meta.json', { name: 'tpl', savedAt: 'now' });
ok('JSON 文件读写', fs2.readJson('report/template.meta.json').name === 'tpl');

fs2.writeBuffer('report/history/123.bin', ab);
ok('子目录二进制', fs2.readBuffer('report/history/123.bin') instanceof ArrayBuffer);
ok('listDir 列出子文件', fs2.listDir('report/history').includes('123.bin'));

fs2.remove('report/history/123.bin');
ok('删除子文件', fs2.readBuffer('report/history/123.bin') === null);

ok('dataDir 指向临时目录', fs2.dataDir === tmp);

// 路径穿越防护：尝试读取/写入外部路径应被阻止（返回 null / 不创建外部文件）
const parentEscape = path.join(tmp, '..', 'escape-outside.txt');
ok('读取穿越路径返回 null（不泄露外部内容）', fs2.readBuffer('../escape.txt') === null);
fs2.writeBuffer('../escape.txt', ab);
ok('写入穿越路径不创建外部文件', !fs.existsSync(parentEscape));

// 清理
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n全部 ${pass} 项断言通过 ✅`);
