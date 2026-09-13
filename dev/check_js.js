// dev/check_js.js —— 语法自检：把脚本当 evaluate 的函数体解析（不执行）
const fs = require('fs');
const path = require('path');
const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  try {
    // 与 browseros-neo_evaluate 的执行形状一致：async 函数体 + 顶层 return
    // eslint-disable-next-line no-new-func
    new Function('return (async () => { ' + src + ' })');
    console.log('OK   ' + path.basename(f));
  } catch (e) {
    bad++;
    console.log('FAIL ' + path.basename(f) + ' :: ' + e.message);
  }
}
process.exit(bad ? 1 : 0);
