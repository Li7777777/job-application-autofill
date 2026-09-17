# recruit.sinovatio.com（中新赛克招聘官网）适配笔记

实测日期：2026-09-18 ｜ 岗位：大模型算法工程师（positionId `2a5ea221-99ef-d490-56bf-3a0f93223e17`）
表单：`/resume/edit?positionId=<id>`，**单页**、无分步、无重复块（15 个控件：4 file / 7 text / 1 日历 / 3 select）。

## 技术栈（决定了整站打法）
- **Vue 2 + Vuetify 2**（`id="input-NN"`、`v-input__slot`、`LabelText`）。**没有 React fiber 组件 API** → `25_mokahr_fiber.js` 快路径不适用（dump 必然 nFields=0）。
- **但有更强的等价物：Vue 组件实例上的 `formData`**——表单组件（`_data.formData` 里带 `resumeAttachment` 的那个）持有**提交时原样上送的整表数据**，且 `$props.datas` 里就有全部下拉选项（权威，无需开面板探测）。
  ```js
  // 定位表单 vm（任何页面脚本的第一段都先跑这个）
  function root(){ for (const el of document.querySelectorAll('*')) if (el.__vue__) return el.__vue__.$root; return null; }
  let f = null;
  (function walk(vm, d){ if (!vm || d > 16) return;
    if (vm._data && vm._data.formData && 'resumeAttachment' in vm._data.formData) { f = f || vm; return; }
    (vm.$children||[]).forEach(c => walk(c, d+1)); })(root(), 0);
  // 读选项：f.datas.{studentOrigin(34省), degree(14), recruitSource(11), university(1270)}
  // 读规则：f.rules.<field> = [fn]（fn.toString() 里能直接看到「请填写 X」文案与格式正则）
  // 读/回验：f.formData.*
  ```
  注意页面上还有第二个 `formData`（顶部登录框），**必须用 `'resumeAttachment' in formData` 消歧**。
- 手机号会被站点用账号信息预填（拿登录账号的手机号填进去），别覆盖。

## 字段 → 填法（本站实测）

| 字段 | 控件 | 填法 |
|---|---|---|
| 附件简历 | 自研 `FileDrop`（内含 `.filebtn` 原生 input + VFileInput 展示层） | `f.$set(f.formData.resumeAttachment, 'files', [memoryFile])` —— 见下「附件上传」 |
| 姓名 / 本科学院 / 本科专业 / 硕士学院 / 硕士专业 / 作品链接 | `v-text-field` | native setter + `input`+`change` 事件（Vuetify 监听原生事件）。按 `label` 文本定位输入框 |
| 性别（male/female）· 最高学历（Doctor/Master/Regular）· 招聘信息来源 · 是否内推 | `v-radio-group` | 点 `input[type=radio][value="X"]` 所在 `.v-radio` 的 `<label for>`。**页面内 `label.click()` 有效且可回读 model**；CDP 真实鼠标点击只在标签页前台时生效（见踩坑 5） |
| 生源地 | `v-select`，34 省，itemText=displayName / itemValue=name | `vm.selectItem(item)`（item = `datas.studentOrigin` 里 `name==='<省份名>'`）。**零开面板**，选完 `.v-select__selection` 立即显示 |
| 本科院校 / 硕士院校 | `EditableAutoComplete` 包 `v-autocomplete`，1270 校，itemText=displayName / itemValue=name，允许手工输入全称 | 内层 `v-autocomplete.selectItem(item)`。⚠️ **硕士院校/硕士学院/硕士专业只在「最高学历」选完之后才渲染**（本科段一开始就在）→ 先选学历再填教育 |
| 毕业时间 | `v-menu` + **`v-date-picker type="date"`**（日粒度日历，标题可切年/月） | `picker.emitInput('<YYYY-MM-DD>')`（等价于用户点到某天）。合成点击打不开这个菜单：`input` 是 `readonly` + `role=button`，`slot.click()` 无效；把 v-menu 的 `isActive=true` 能让面板进 DOM 但仍是 `display:none` |
| 作品附件 | 第二个 `FileDrop`（选填） | 本次留空 |
| 我已阅读并同意 | 单 checkbox | **不由 agent 勾选**（用户本人的法律声明）；它是「提交简历」按钮 disabled 的唯一条件 |

## 附件上传（本站最大的坑，务必照做）

`FileDrop` 的真实结构（源码级）：
```html
<div class="dropzone" @drop>
  <button @click="$refs.filebtn.click()">选择文件</button>
  <div class="input-container">…localFiles 逐个显示文件名…</div>
  <v-file-input v-model="localFiles" :rules="rules" />   <!-- 展示 + 校验，input#input-NN -->
  <input ref="filebtn" class="filebtn hidden" type="file" @input="upload">
</div>
```
```js
upload(){ const e=this.filebtn.files||[]; for(...){ this.multiple||this.remove(0,this.localFiles.length);
          …类型校验… this.localFiles.push(e[t]) } this.filebtn.value="" }   // 不 emit
watch: { files(e){ this.localFiles = e; this.$emit('change', e) } }          // files = 父级 v-model 的数组
```
结论与做法：
1. **`watch.files` 把 `localFiles` 指到父级同一个数组对象**（`localFiles === formData.resumeAttachment.files`），所以**换掉父级数组**是正确的注入点，显示 / 校验 / 提交三处会同时正确：
   `f.$set(f.formData.resumeAttachment, 'files', [file])`。
2. **必须用「内存 File」**（提交时 `submit() → uploadFile()` 读的就是这个数组里的 File 对象）：
   ```js
   const bin = atob(b64); const arr = new Uint8Array(bin.length);
   for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
   const file = new File([arr],'<本地简历文件名，原样保留>',{type:'application/pdf'});
   ```
3. **`DOM.setFileInputFiles` 的两种翻车**（实测）：
   - 传**相对路径** → 得到的 File `size=0`、`f.text()` 抛 `NotReadableError`（空的假文件，提交会传空简历）；
   - 传**绝对路径**时 `input.files[0]` 可读（169178B / readLen 160523），但只要组件执行 `filebtn.value=''`，该 File 立刻变成 `NotReadableError` —— 内存 File 不受影响。
   - 所以：真机端到端 `cdp.mjs uploadc` 请**一律给绝对路径**；若要「提交时一定能读到字节」，用上面的内存 File + `$set` 注入（本次采用）。
4. 打开系统文件框的触发按钮是 `.dropzone` 里的「选择文件」`<button>`；`input.filebtn` 监听的是 **`input`** 事件（不是 `change`），`uploadc` 走的 chooser 拦截链路可用（`backendNodeId` 就是 `.filebtn`）。

## 校验 / 提交边界（本站）
- `v-form` 带 `lazy-validation`；`f.validate()` 是**只读**检查（不提交），本次返回 `true`。
- **`提交简历` 按钮 `disabled` 只取决于 `isAgreePrivacyPolicy`**（实测：置 true → 按钮立刻可点；还原 false → 又 disabled）。agent 未勾选、未提交。
- `rules` 里有必填规则但**页面不渲染**的字段（`birthDay / birthplace / nation / marital / email / politicalStatus / registeredResidence / physicalResidence / emergencyContact`）——不要凭空填，也不影响 `validate()`（只校验已注册的输入）。
- `isInternalReferral` 站点默认勾「否」（值 `false`）；选「是」会要求 `internalReferralCode`。

## 踩坑记录
1. **同 URL 两个标签页**：用户自己开着一个（visible），agent 又 `tabs new` 一个（hidden）。开工前用 `window.__jaaMark` 打标 + `cdp.mjs list` 对齐 targetId，**只填自己那一个**。
2. **相对路径上传文件 = 空文件**（见上）。
3. **后台标签页把 CSS transition 冻死** → Vuetify `v-messages` 的「请填写 X」离开动画卡在 `leave-active`，字段已填好、`errorBucket` 全空，页面上却留着十几条旧报错。收尾处理：
   ```js
   // 只隐藏「正在离开」的节点（= Vuetify 已判定不该再显示的），有效报错/提示不受影响
   st.textContent = '.v-messages__message.message-transition-leave, .v-messages__message.message-transition-leave-active{display:none!important}';
   ```
   更彻底：保持标签页前台再填（transitions 正常跑完就不会卡），或重载后在前台重填。
4. `v-select`/`v-autocomplete` 的 `selectItem()` **要取内层带 `items` 的那个实例**（`EditableAutoComplete` 外层同 `label`，无 `items`）。
5. **CDP 真实鼠标点击依赖标签页前台**：`document.visibilityState==='hidden'` 时 `Input.dispatchMouseEvent` 打不到（脚本回读"clicked:男"但 model 不变）。`cdp.mjs front <id>` 之后重试，或改用页面内 `label.click()`（Vue 监听原生事件，可靠）并**以 `formData` 回读为准**。
6. `LabelText`/a11y 树里字段名与 DOM `label` 文本偶有错位；**以 `f.rules`/`f.formData` 键名为准**（本站键：`regularEducation.university` 等）。
7. 选择「最高学历」会**增删 DOM 字段**（硕士/博士段）→ 选完必须重新定位，不能复用之前的元素/坐标。

## 复用顺序（下次同站投递，~2 分钟）
1. `tabs new <url>` → `wait for=text "提交意向"/"附件简历"`；`cdp.mjs front <id>`（保持前台）。
2. 注入简历附件（内存 File + `$set`，见上，脚本模板：本次 `data/runs/sinovatio/_inject_resume5.js`）。
3. 一轮填：性别/最高学历（radio label.click）→ 姓名/学院/专业/作品链接（native setter）→ 硕士段（学历选完才出现）→ 生源地/本科院校/硕士院校（`selectItem`）→ 毕业时间（`picker.emitInput`）。
4. 回读 `f.formData` + `f.validate()===true` + 显示层（`.v-select__selection` / `input.value` / checked radios）。
5. 交用户：勾「我已阅读并同意」→ 点「提交简历」（agent 永不点）。

## ✅ 投后核对（2026-09-18 实测，本岗已在 01:56:58 投递成功）

提交由**用户本人**完成；agent 只读核对，证据链三条：

1. **网络**：`POST /api/app/position/<positionId>/submit-resume`（从 `performance.getEntriesByType('resource')` 就能看到）。
2. **页面**：提交后跳 `https://recruit.sinovatio.com/resume/mine`，正文含
   `<姓名> … 最后更新时间：<t> / <岗位名> / 撤销投递岗位 / <岗位标签（如 城市+学历）> / 投递时间：<t>`
   ——「撤销投递岗位」是已投递的可靠信号（**别点它**）。
3. **接口（最权威，只读就能查）**：
   ```js
   const j = await (await fetch('/api/app/resume/my-resume', { credentials: 'include' })).json();
   j.submitedPositions;   // [{ submitedTime:'2026-09-18T01:56:58.598909', name:'大模型算法工程师',
                          //    id:'<positionId>', workPlace:'<城市>', degree:'Master', recruitCategory:'Student' }]
   j.resumeAttachment.files[0];  // { name:'…pdf', size:169178, server:true, url:'/api/file-management/files//app/wwwroot/files/<key>/<name>' }
   ```
   - `submitedPositions[].submitedTime` = 投递时间；
   - **`server:true` + 正确 size = 附件真的上传到了服务端**（这也是验证「内存 File 注入」是否成功的最强证据：本次 169178B，与本地文件字节数一致）；
   - 同一响应里还能拿到服务端保存的全部简历字段（graduationDate 会带 `T00:00:00`，说明日历选的就是整天）。

存档：`data/runs/<host>/submission-record.json`（含 `/resume/mine` 页面文本 + `my-resume` 接口原文；该目录已被 .gitignore 排除），投递台账一行追加在用户本机的投递台账 jsonl 里。

**注意**：本站投递**不发（或不立刻发）确认邮件** —— 邮箱里没有回执不代表没投上，要以上面第 2/3 条为准。
