// scripts/cdp.mjs —— 用浏览器原生 CDP 端口驱动浏览器（绕开 BrowserOS MCP 的两个硬限制）
//
// 为什么需要它（实测结论，详见 references/strategies.md §8）：
//   1) BrowserOS 的 MCP 服务器按「MCP 会话」给标签页发归属凭证。会话一重建（长调用超时、
//      空闲被清扫），旧页立刻变成 "foreign page" → `page N is not owned by this agent`，
//      只能 `tabs new` 重开，于是页越堆越多。
//   2) MCP 的 `Runtime.evaluate` 有 60 秒硬超时（browseros-cdp `request_timeout`），
//      任何几分钟的批量填充必然被掐断。
//   而浏览器本身把**原生 CDP** 开在一个本机端口上（默认 9110，见 config.json 的 ports.cdp），
//   MCP 服务器自己就是走这个端口干活。直连它：**没有归属校验、没有 60 秒上限**。
//
// 依赖：Node 18+（用到全局 fetch），Node 21+（用到全局 WebSocket）。零第三方依赖。
//
// 用法：
//   node cdp.mjs port                       # 从 config.json 读 CDP 端口（也可用 --port 覆盖）
//   node cdp.mjs list                       # 列出所有页面（id / title / url）
//   node cdp.mjs open <url>                 # 新开一个页，打印 targetId
//   node cdp.mjs close <id|url片段>          # 关掉自己开的页（跑完不留垃圾页）
//   node cdp.mjs eval <id|url片段> <脚本文件> [timeoutMs]
//                                            # 在页里跑脚本，返回最后一个表达式的值
//                                            # 脚本按「函数体」执行 → 必须顶层 return
//   node cdp.mjs click <id|url片段> <CSS选择器> [waitMs]
//                                            # 真实鼠标点击（CDP Input 域），能给 hover 才出现的控件用
//   node cdp.mjs revalclick <id|url片段> <表达式文件> [waitMs]
//                                            # 表达式返回一个元素，对它发真实鼠标点击
//                                            # （适合「面板里的日期格子」这类每次渲染都换节点的目标）
//   node cdp.mjs upload <id|url片段> <表达式文件> <本地文件…>
//   node cdp.mjs uploadc <id|url片段> <触发元素表达式文件> <本地文件…>
//                                            # 文件选择器拦截上传（React 受控 file input 唯一可靠路径）
//   node cdp.mjs focus <id|url片段> <表达式文件>
//                                            # scrollIntoView + 聚焦任意元素（含 contenteditable 日期分片），
//                                            # 配合 MCP act type 或本文件 type 命令键入
//   node cdp.mjs clickn <id|url片段> <表达式文件> [waitMs]
//   node cdp.mjs seq <id|url片段> <表达式数组.json> [waitMs]   # 多步真实点击（打开面板→选年→选月→选日）
//   node cdp.mjs type <id|url片段> <表达式文件> <文本文件>      # 真实键盘逐字符输入（进 React state）
//                                            # 表达式返回「元素数组」，逐个真实点击（div 版单选/删除按钮）
//                                            # 给 <input type=file> 选文件（DOM.setFileInputFiles，会触发 change）
//                                            # 表达式文件返回该 file input，例如：(() => document.querySelectorAll('input[type=file]')[0])()
//
// 环境变量：CDP_PORT 覆盖端口；BROWSEROS_CONFIG 覆盖 config.json 路径。
//
// 常用套路：把要跑的 JS 写进文件（可长达几千行、跑几分钟），用 eval 一次跑完：
//   node cdp.mjs eval 127.0.0.1:8787/... fill.js 900000
// 脚本里用 document.querySelector 正常操作即可；要「真实点击」时改用 click/revalclick。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------- 找 CDP 端口 ----------
const CONFIG_CANDIDATES = [
  process.env.BROWSEROS_CONFIG,
  join(process.env.LOCALAPPDATA || '', 'BrowserClaw', 'User Data', '.browseros', 'config.json'),
  join(homedir(), 'Library', 'Application Support', 'BrowserClaw', 'User Data', '.browseros', 'config.json'),
  join(homedir(), '.config', 'BrowserClaw', 'User Data', '.browseros', 'config.json'),
].filter(Boolean);

function detectPort() {
  if (process.env.CDP_PORT) return Number(process.env.CDP_PORT);
  for (const p of CONFIG_CANDIDATES) {
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      if (cfg?.ports?.cdp) return Number(cfg.ports.cdp);
    } catch { /* next */ }
  }
  return 9110; // BrowserOS 默认
}

const PORT = detectPort();
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- CDP 基础 ----------
const httpJson = async (path, init) => {
  const res = await fetch(BASE + path, init);
  return res.json();
};

const pages = async () => {
  const all = await httpJson('/json/list');
  return all.filter(t => t.type === 'page');
};

const connect = url =>
  new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    sock.onopen = () => resolve(sock);
    sock.onerror = e => reject(new Error(`websocket error: ${e?.message || e?.type || 'unknown'}`));
  });

async function bringToFront(sock) {
  // CDP 的 Input.* 事件会送给浏览器当前激活的标签页；目标页不在前台时键/鼠标会打到别的页上。
  // 所以凡是发真实输入的命令，先把目标页激活。
  try { await rpc(sock, 'Page.bringToFront', {}); } catch { /* 忽略：某些目标不支持 */ }
}

function rpc(sock, method, params = {}, timeoutMs = 600000) {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.removeEventListener('message', onMsg);
      reject(new Error(`rpc timeout after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    function onMsg(ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== id) return;
      clearTimeout(timer);
      sock.removeEventListener('message', onMsg);
      msg.error ? reject(new Error(`${method} -> ${JSON.stringify(msg.error)}`)) : resolve(msg.result);
    }
    sock.addEventListener('message', onMsg);
    sock.send(JSON.stringify({ id, method, params }));
  });
}

async function findPage(sel) {
  const all = await pages();
  const hit = all.find(p => p.id === sel) || all.find(p => (p.url || '').includes(sel));
  if (!hit) {
    console.error(`no page matching "${sel}". Open pages:`);
    for (const p of all) console.error(`  ${p.id}  ${(p.url || '').slice(0, 110)}`);
    process.exit(2);
  }
  return hit;
}

// 真实鼠标点击：交给 CDP Input 域，浏览器认为这是「用户点击」
async function realClick(sock, x, y, waitMs = 800) {
  const pt = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
  await rpc(sock, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', clickCount: 0 });
  await new Promise(r => setTimeout(r, 200));           // 给 hover 菜单/删除按钮冒出来的时间
  await rpc(sock, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...pt, buttons: 1 });
  await new Promise(r => setTimeout(r, 60));
  await rpc(sock, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...pt, buttons: 0 });
  await new Promise(r => setTimeout(r, waitMs));
  return pt;
}

// ---------- 子命令 ----------
const [cmd, ...args] = process.argv.slice(2);
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

if (cmd === 'port') {
  console.log(PORT);
  process.exit(0);
}

if (cmd === 'list') {
  for (const p of await pages()) {
    console.log(`${p.id} | ${(p.title || '').slice(0, 40)} | ${(p.url || '').slice(0, 110)}`);
  }
  process.exit(0);
}

if (cmd === 'open') {
  const url = args[0];
  if (!url) { console.error('usage: open <url>'); process.exit(1); }
  let out;
  try {
    out = await httpJson(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  } catch {
    // 老版本 Chromium 没有 PUT /json/new，退回 Target.createTarget
    const version = await httpJson('/json/version');
    const sock = await connect(version.webSocketDebuggerUrl);
    out = { id: (await rpc(sock, 'Target.createTarget', { url })).targetId };
  }
  console.log(out.id);
  process.exit(0);
}

if (cmd === 'close') {
  // 关掉自己开的页（解决“标签页越开越多且关不掉”：结束后不留垃圾页）
  const sel = args[0];
  if (!sel) { console.error('usage: close <id|url片段>'); process.exit(1); }
  const hit = await findPage(sel);
  const version = await httpJson('/json/version');
  const sock = await connect(version.webSocketDebuggerUrl);
  await rpc(sock, 'Target.closeTarget', { targetId: hit.id });
  console.log(`closed ${hit.id}`);
    // ⚠️ 关目标后立刻 process.exit 会在 Windows 上撞 libuv 断言
  //（Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src/win/async.c）→
  // 退出码非 0，会把 `cdp.mjs close && ...` 这类脚本链打断。先干净收尾再退。
  try { if (typeof sock.close === 'function') sock.close(); } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
process.exit(0);
}

if (cmd === 'wake') {
  // 让被遮挡/后台的标签页「活过来」：bringToFront + 强制 active 生命周期 + 焦点模拟。
  // 为什么需要：Chrome 对不可见标签页会**挂起 requestAnimationFrame** 并节流 setTimeout
  //（intensive throttling ≈ 1 个定时器/分钟）→ ① antd/Element 的下拉、日历面板根本不渲染；
  // ② 页内 `await sleep()` 变成分钟级（20_fill.js 会「rpc 超时但页内还在跑」）。
  // 实测：只 bringToFront 不够（窗口被遮挡/最小化时 document.visibilityState 仍是 hidden）。
  const sel = args[0];
  if (!sel) { console.error('usage: wake <id|url片段>'); process.exit(1); }
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  const out = {};
  for (const [name, method, params] of [
    ['front', 'Page.bringToFront', {}],
    ['lifecycle', 'Page.setWebLifecycleState', { state: 'active' }],
    ['focus', 'Emulation.setFocusEmulationEnabled', { enabled: true }],
  ]) {
    try { await rpc(sock, method, params); out[name] = 'ok'; } catch (e) { out[name] = String((e && e.message) || e); }
  }
  try {
    const v = await rpc(sock, 'Runtime.evaluate', {
      expression: 'JSON.stringify({visibility:document.visibilityState,hidden:document.hidden,hasFocus:document.hasFocus()})',
      returnByValue: true,
    });
    out.state = JSON.parse((v && v.result && v.result.value) || '{}');
  } catch (e) { out.state = String((e && e.message) || e); }
  console.log(JSON.stringify(Object.assign({ ok: true, target: page.id }, out)));
  process.exit(0);
}

if (cmd === 'front') {
  // 把目标页提到前台（Page.bringToFront）。
  // 为什么需要：**后台标签页里 rAF/定时器被节流**，很多组件库的下拉/日历面板根本不会渲染 →
  // 不报错、但「点开后读不到任何选项」。长批量填表前先 front 一下最稳。
  const sel = args[0];
  if (!sel) { console.error('usage: front <id|url片段>'); process.exit(1); }
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  console.log(JSON.stringify({ ok: true, fronted: page.id, title: (page.title || '').slice(0, 40) }));
  process.exit(0);
}

if (cmd === 'shot') {
  // 截图存档：`node cdp.mjs shot <id|url片段> <输出png> [fullPage]`
  // 为什么需要：驱动真浏览器做几小时填表，却没有任何"看一眼页面"的手段 ——
  // 脚本回读与人的观察不一致时（例如"你说没填，我说填了"），截图是唯一能对齐的事实来源。
  const [sel, outPath, full] = args;
  if (!sel || !outPath) { console.error('usage: shot <id|url片段> <输出png> [fullPage]'); process.exit(1); }
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const params = { format: 'png' };
  if (full === 'fullPage') params.captureBeyondViewport = true;
  const res = await rpc(sock, 'Page.captureScreenshot', params, 60000);
  const data = res && res.data;
  if (!data) { console.log(JSON.stringify({ ok: false, why: 'no screenshot data' })); process.exit(0); }
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(JSON.stringify({ ok: true, out: outPath, bytes: Buffer.from(data, 'base64').length }));
  process.exit(0);
}

if (cmd === 'eval') {
  const [sel, file, tmo] = args;
  if (!sel || !file) { console.error('usage: eval <id|url片段> <脚本文件> [timeoutMs]'); process.exit(1); }
  const raw = readFileSync(file, 'utf8');
  // skill 里的页面脚本（10_scan_form.js / 15_dump_state.js / 20_fill.js …）是按「函数体」写的（顶层 return），
  // 直接当表达式会语法错误 → 不以 '(' 开头就自动包一层 async IIFE；本身已是表达式（(() => …)()）则原样执行。
  const code = raw.trimStart().startsWith('(') ? raw : `(async () => {
${raw}
})()`;
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  const res = await rpc(sock, 'Runtime.evaluate', {
    expression: code,
    awaitPromise: true,      // 允许脚本里 await（顶层 async IIFE 也能跑）
    returnByValue: true,
    userGesture: true,       // 让脚本里的 click() 带用户手势语义
  }, num(tmo, 600000));
  if (res.exceptionDetails) {
    console.log(JSON.stringify({
      ok: false,
      exception: res.exceptionDetails.exception?.description || res.exceptionDetails.text,
    }));
  } else {
    const v = res.result?.value;
    console.log(typeof v === 'string' ? v : JSON.stringify(v));
  }
  process.exit(0);
}

if (cmd === 'click') {
  const [sel, css, wait] = args;
  if (!sel || !css) { console.error('usage: click <id|url片段> <CSS选择器> [waitMs]'); process.exit(1); }
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const probe = `(() => { const el = document.querySelector(${JSON.stringify(css)});
    if (!el) return null; el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height}); })()`;
  const got = (await rpc(sock, 'Runtime.evaluate', { expression: probe, returnByValue: true })).result?.value;
  if (!got) { console.log(JSON.stringify({ ok: false, why: 'selector not found: ' + css })); process.exit(0); }
  const box = JSON.parse(got);
  if (!box.w || !box.h) console.log(JSON.stringify({ ok: false, why: 'element has zero size (hidden?)' }));
  const pt = await realClick(sock, box.x, box.y, num(wait, 800));
  console.log(JSON.stringify({ ok: true, clicked: pt }));
  process.exit(0);
}

if (cmd === 'revalclick') {
  const [sel, file, wait] = args;
  if (!sel || !file) { console.error('usage: revalclick <id|url片段> <表达式文件> [waitMs]'); process.exit(1); }
  const expr = readFileSync(file, 'utf8');
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const wrapped = `(() => { const el = (${expr});
    if (!el) return null; el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height}); })()`;
  const got = (await rpc(sock, 'Runtime.evaluate', { expression: wrapped, returnByValue: true })).result?.value;
  if (!got) { console.log(JSON.stringify({ ok: false, why: 'expression returned no element' })); process.exit(0); }
  const box = JSON.parse(got);
  if (!box.w || !box.h) console.log(JSON.stringify({ ok: false, why: 'element has zero size (hidden?)' }));
  const pt = await realClick(sock, box.x, box.y, num(wait, 800));
  console.log(JSON.stringify({ ok: true, clicked: pt }));
  process.exit(0);
}

if (cmd === 'uploadc') {
  // 文件选择器拦截上传（React 受控 <input type=file> 的唯一可靠路径）。
  // 背景（2026-09-14 汇川实测）：DOM.setFileInputFiles 直接对 input 设置文件**不触发 change**，
  // 且 React 会在下一帧重置 input —— 文件静默丢失。拦截模式才是真实用户链路：
  //   Page.setInterceptFileChooserDialog(true) → 真实点击上传触发元素 → 等 Page.fileChooserOpened
  //   → DOM.setFileInputFiles({backendNodeId}) → 浏览器走原生 change → React onChange 收到。
  // 用法: node cdp.mjs uploadc <id|url片段> <触发元素表达式文件> <本地文件…>
  //       触发元素表达式返回「点击上传」那个 span/button（会自动 scrollIntoView）。
  const [sel, exprFile, ...files] = args;
  if (!sel || !exprFile || !files.length) { console.error('usage: uploadc <id|url片段> <触发元素表达式文件> <本地文件…>'); process.exit(1); }
  const expr = readFileSync(exprFile, 'utf8');
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const evs = [];
  sock.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method) evs.push(m.method); });
  const chooserP = new Promise(res => sock.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.fileChooserOpened') res(m.params);
  }, { once: true }));
  await rpc(sock, 'Page.enable', {});
  await rpc(sock, 'Page.setInterceptFileChooserDialog', { enabled: true });
  // 定位触发元素并真实点击
  const loc = await rpc(sock, 'Runtime.evaluate', {
    expression: `(() => { const el = (${expr}); if (!el) return JSON.stringify({err:'trigger-not-found'});
      el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect();
      return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)}); })()`,
    returnByValue: true,
  });
  const locVal = loc.result?.value;
  if (!locVal) { console.log(JSON.stringify({ ok: false, why: 'locate failed', detail: loc.exceptionDetails?.exception?.description?.slice(0, 200) })); process.exit(0); }
  const p = JSON.parse(locVal);
  if (p.err) { console.log(JSON.stringify({ ok: false, why: p.err })); process.exit(0); }
  await rpc(sock, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 });
  await rpc(sock, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 0 });
  const chooser = await Promise.race([chooserP, new Promise(res => setTimeout(() => res(null), 6000))]);
  if (!chooser || !chooser.backendNodeId) { console.log(JSON.stringify({ ok: false, why: 'no fileChooserOpened (触发元素没有弹系统文件框？)', recentEvents: evs.slice(-6) })); process.exit(0); }
  await rpc(sock, 'DOM.setFileInputFiles', { files, backendNodeId: chooser.backendNodeId });
  await rpc(sock, 'Page.setInterceptFileChooserDialog', { enabled: false });
  await new Promise(r => setTimeout(r, 1500));
  console.log(JSON.stringify({ ok: true, mode: chooser.mode, uploaded: files }));
  process.exit(0);
}

if (cmd === 'upload') {
  // 给 <input type=file> 设置本地文件（DOM.setFileInputFiles）。
  // ⚠️ 仅对「非 React 受控」的 file input 可靠；React 站点请用 uploadc（拦截模式）——
  // setFileInputFiles 不派发 change，且 React 受控组件会在下一帧重置 input，文件静默丢失。
  // 用法: node cdp.mjs upload <id|url片段> <表达式文件> <本地文件…>
  const [sel, exprFile, ...files] = args;
  if (!sel || !exprFile || !files.length) { console.error('usage: upload <id|url片段> <表达式文件> <本地文件…>'); process.exit(1); }
  const expr = readFileSync(exprFile, 'utf8');
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  const res = await rpc(sock, 'Runtime.evaluate', { expression: `(${expr})`, returnByValue: false, userGesture: true });
  const objectId = res.result && res.result.objectId;
  if (!objectId) { console.log(JSON.stringify({ ok: false, why: 'expression did not return an element' })); process.exit(0); }
  await rpc(sock, 'DOM.setFileInputFiles', { files, objectId });
  await new Promise(r => setTimeout(r, 600));
  console.log(JSON.stringify({ ok: true, uploaded: files }));
  process.exit(0);
}

if (cmd === 'focus') {
  // 定位并聚焦任意元素（含 contenteditable 日期分片），配合 MCP act type 或本文件 type 命令键入。
  // 用法: node cdp.mjs focus <id|url片段> <表达式文件>
  const [sel, exprFile] = args;
  if (!sel || !exprFile) { console.error('usage: focus <id|url片段> <表达式文件>'); process.exit(1); }
  const expr = readFileSync(exprFile, 'utf8');
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const res = await rpc(sock, 'Runtime.evaluate', {
    expression: `(() => { const el = (${expr}); if (!el) return JSON.stringify({err:'not-found'});
      el.scrollIntoView({block:'center'}); el.focus();
      const a = document.activeElement; const r = a.getBoundingClientRect();
      return JSON.stringify({focused: a === el, tag: a.tagName, contenteditable: a.isContentEditable, dtype: a.getAttribute && a.getAttribute('data-type'), rect: {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)}}); })()`,
    returnByValue: true,
  });
  if (res.exceptionDetails) { console.log(JSON.stringify({ ok: false, why: 'exception', detail: res.exceptionDetails.exception?.description?.slice(0, 200) })); process.exit(0); }
  console.log(res.result?.value || JSON.stringify({ ok: false, why: 'no value' }));
  process.exit(0);
}

if (cmd === 'clickn') {
  // 批量真实点击：表达式返回「元素数组」，对每个元素 scrollIntoView → 取新坐标 → 发真实鼠标点击。
  // 用途：div 版自定义单选/复选/删除按钮（合成 click() 不触发 React 代理事件）。
  // 用法: node cdp.mjs clickn <id|url片段> <表达式文件> [每次点击后等待ms]
  const [sel, exprFile, waitMs] = args;
  if (!sel || !exprFile) { console.error('usage: clickn <id|url片段> <表达式文件> [waitMs]'); process.exit(1); }
  const expr = readFileSync(exprFile, 'utf8');
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const arrRes = await rpc(sock, 'Runtime.evaluate', { expression: `(${expr})`, returnByValue: false, userGesture: true });
  if (arrRes.exceptionDetails) { console.log(JSON.stringify({ ok: false, why: 'expression threw', detail: arrRes.exceptionDetails.exception?.description?.slice(0, 200) })); process.exit(0); }
  const arrId = arrRes.result && arrRes.result.objectId;
  if (!arrId) { console.log(JSON.stringify({ ok: false, why: 'expression did not return an array (got ' + (arrRes.result ? arrRes.result.type : 'nothing') + ') — clickn 需要表达式返回 [元素] 数组' })); process.exit(0); }
  const props = await rpc(sock, 'Runtime.getProperties', { objectId: arrId, ownProperties: true });
  const ids = props.result.filter(x => /^\d+$/.test(x.name) && x.value && x.value.objectId).map(x => x.value.objectId);
  const clicked = [];
  for (const id of ids) {
    const r = await rpc(sock, 'Runtime.callFunctionOn', {
      objectId: id,
      functionDeclaration: `function(){ this.scrollIntoView({block:'center'}); const r=this.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,t:(this.innerText||'').replace(/\s+/g,' ').trim().slice(0,14)}); }`,
      returnByValue: true,
    });
    if (!r.result || !r.result.value) { clicked.push('(no-rect)'); continue; }
    const box = JSON.parse(r.result.value);
    await realClick(sock, box.x, box.y, Number(waitMs || 400));
    clicked.push(box.t);
  }
  console.log(JSON.stringify({ ok: true, count: ids.length, clicked, ...(ids.length === 0 ? { hint: 'count=0：表达式应返回 [元素] 数组（不是单元素）；且元素必须存在且可见（data-jaa-uid 可能已随重渲染丢失，重新扫描或改用 aria 定位）' } : {}) }));
  process.exit(0);
}

if (cmd === 'seq') {
  // 多步真实点击：文件是 JSON 数组，每项是一个「返回元素的 JS 表达式」字符串。
  // 逐项：求值 → scrollIntoView → 重新取坐标 → 发真实鼠标点击 → 等待。
  // 适合「打开面板 → 选年 → 选月 → 选日」这类每步目标元素都不同的流程。
  // 用法: node cdp.mjs seq <id|url片段> <表达式数组.json> [每步等待ms]
  const [sel, file, waitMs] = args;
  if (!sel || !file) { console.error('usage: seq <id|url片段> <表达式数组.json> [waitMs]'); process.exit(1); }
  const steps = JSON.parse(readFileSync(file, 'utf8'));
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const log = [];
  for (let i = 0; i < steps.length; i++) {
    let objId = null;
    try {
      const r = await rpc(sock, 'Runtime.evaluate', { expression: steps[i], returnByValue: false, userGesture: true });
      objId = r.result && r.result.objectId;
    } catch (e) { log.push(i + ':eval-err ' + (e && e.message)); continue; }
    if (!objId) { log.push(i + ':no-element'); await new Promise(r => setTimeout(r, 200)); continue; }
    const rr = await rpc(sock, 'Runtime.callFunctionOn', {
      objectId: objId,
      functionDeclaration: `function(){ this.scrollIntoView({block:'center'}); const r=this.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,t:(this.innerText||'').replace(/\s+/g,' ').trim().slice(0,14)}); }`,
      returnByValue: true,
    });
    if (!rr.result || !rr.result.value) { log.push(i + ':no-rect'); continue; }
    const bx = JSON.parse(rr.result.value);
    if (!bx.w || !bx.h) { log.push(i + ':zero-size'); continue; }
    await realClick(sock, bx.x, bx.y, Number(waitMs || 500));
    log.push(i + ':' + bx.t);
  }
  console.log(JSON.stringify({ ok: true, steps: steps.length, log }));
  process.exit(0);
}

if (cmd === 'type') {
  // 真实键盘输入（安全版）：真实鼠标点击聚焦 → 校验聚焦元素 rect 与目标一致 → Ctrl+A → 逐字符输入 → 回读
  // 用法: node cdp.mjs type <id|url片段> <表达式文件> <文本文件>
  // 为什么这么麻烦：JS 的 el.focus() 会被 React 重渲染打断（节点被替换），
  // 此时按键会打到「上一次聚焦的框」把内容串到别的字段（本人在 cxmt 上把 2700 字符串进了一个名称框）。
  const [sel, exprFile, textFile] = args;
  if (!sel || !exprFile || !textFile) { console.error('usage: type <id|url片段> <表达式文件> <文本文件>'); process.exit(1); }
  const expr = readFileSync(exprFile, 'utf8');
  const text = readFileSync(textFile, 'utf8');
  const page = await findPage(sel);
  const sock = await connect(page.webSocketDebuggerUrl);
  await bringToFront(sock);
  const rectOf = async (e) => {
    const r = await rpc(sock, 'Runtime.evaluate', { expression: `(() => { const el = (${e}); if(!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}); })()`, returnByValue: true });
    const v = r.result && r.result.value;
    return v ? JSON.parse(v) : null;
  };
  const target = await rectOf(expr);
  if (!target || !target.w) { console.log(JSON.stringify({ ok: false, why: 'target not found or zero-size' })); process.exit(0); }
  const near = (a, b) => Math.abs(a - b) <= 3;
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    await realClick(sock, target.x, target.y, 250);
    // 聚焦校验放行 INPUT/TEXTAREA/contenteditable（react-aria 日期分片是 contenteditable span）
    const act = await rpc(sock, 'Runtime.evaluate', { expression: `(() => { const a = document.activeElement; if(!a || !(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable)) return 'not-focusable:' + (a?a.tagName:'null'); const r = a.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,tag:a.tagName}); })()`, returnByValue: true });
    const av = act.result && act.result.value;
    if (av && av.startsWith('{')) {
      const a = JSON.parse(av);
      ok = near(a.x, target.x) && near(a.y, target.y);
      if (!ok) console.log(JSON.stringify({ attempt, note: 'focus landed elsewhere, retrying', active: a }));
    } else {
      console.log(JSON.stringify({ attempt, note: 'focus check: ' + av }));
    }
    if (!ok) await new Promise(res => setTimeout(res, 400));
  }
  if (!ok) { console.log(JSON.stringify({ ok: false, why: 'could not focus the target reliably - refusing to type (would corrupt another field)' })); process.exit(0); }
  // 全选清空（contenteditable 分片不吃 Ctrl+A，无副作用；逐字符键入会自动覆盖占位段）
  await rpc(sock, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await rpc(sock, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await new Promise(res => setTimeout(res, 150));
  for (const ch of text) {
    if (ch === '\n') {   // 换行：必须用 keyDown + text:'\r'（rawKeyDown 不插入字符，实测无效）
      await rpc(sock, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await rpc(sock, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else {
      await rpc(sock, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
      await rpc(sock, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
    await new Promise(res => setTimeout(res, 10));
  }
  await new Promise(res => setTimeout(res, 500));
  const chk = await rpc(sock, 'Runtime.evaluate', { expression: `(() => { const el = (${expr}); return el ? (el.value || '') : '__gone__'; })()`, returnByValue: true });
  const got = (chk.result && chk.result.value) || '';
  console.log(JSON.stringify({ ok: got === text, expectLen: text.length, gotLen: got.length }));
  process.exit(0);
}

console.error(`usage:
  node cdp.mjs port
  node cdp.mjs list
  node cdp.mjs open <url>
  node cdp.mjs close <id|url片段>
  node cdp.mjs eval <id|url片段> <脚本文件> [timeoutMs]
  node cdp.mjs click <id|url片段> <CSS选择器> [waitMs]
  node cdp.mjs revalclick <id|url片段> <表达式文件> [waitMs]
  node cdp.mjs upload <id|url片段> <表达式文件> <本地文件…>
  node cdp.mjs clickn <id|url片段> <表达式文件> [waitMs]
  node cdp.mjs seq <id|url片段> <表达式数组.json> [waitMs]
  node cdp.mjs wake <id|url片段>          # front + setWebLifecycleState(active) + 焦点模拟；后台标签页面板不渲染 / 定时器被节流时先跑它
  node cdp.mjs type <id|url片段> <表达式文件> <文本文件>

env: CDP_PORT=<port>   BROWSEROS_CONFIG=<path to .browseros/config.json>`);
process.exit(1);
