# job.chinatelecom.com.cn（中国电信校园招聘 · 大易 WinTalent）适配笔记

> 本文件会随 skill 仓库发布：真实取值一律占位符（`<姓名>` `<手机号>` `<YYYY-MM-DD>` `<省>/<市>`
> `<院校>` `<学院>` `<单位>` `<简历文件名>.pdf`）。运行期数据只在 `data/` 里。

实测日期：2026-09-26 ｜ 招聘项目：2027 年度秋季校园招聘（`recruitProject=101101`）
表单：`/wt/TELE/web/index?brandCode=1&bz=1#/er/<token>` —— **单页超长表单**（无分步向导），
18 个区块、约 190 个具名控件、48 个下拉、7 个附件位。

## 技术栈（决定整站打法）

- **AngularJS 1.5.8 + jQuery 3.1.1 + bootstrap-select（`selectpicker`）+ bootstrap-datetimepicker
  + layer.js + ng-file-upload（含 shim）**；页头/个人中心那层是 **Vue**（`data-v-*` 属性），
  表单主体是 Angular（自定义指令 `dy-form` / `dy-form-special`）。
- **没有 React fiber 快路径**：`25_mokahr_fiber.js` 的 `dump` 在这种站上无意义（`window.angular`
  在岗位列表页甚至没暴露为全局）。直接走通用八步。
- **权威取值位置 = DOM 里具名控件本身**（保存时按 `name` 序列化），不是 Angular 模型：
  每个字段的 `ng-model` 都叫 `justForModelVal` / `justForModelVal9` 这类占位名，
  `ng-change="listenValChange(dataInfo, name, …)"` 只是把值同步进 `dataInfo`。
  → **写 DOM + 派发 `input`/`change` 就是正确答案**，`$setViewValue` 只是补一发 ng-change。
- **字段 name 规律：`<区块id>_<条目id>_<行号>`**，例：`11_2_1`=个人基本信息·姓名·第 1 行，
  `14_51_2`=教育经历·学校名称·第 2 行。所以**多段经历天然有稳定句柄**（比 uid 稳），
  加行后新行号就是 `_2`、`_3`…；区块 id 对照：
  `11` 个人基本信息 / `14` 教育经历 / `13` 求职意向 / `123` 实习经历 / `40` 项目经验 /
  `122` 社会实践 / `100101` 专利 / `100102` 论文 / `120` 奖励荣誉 / `45` 技能爱好 /
  `21` 家庭关系 / `12` 自我评价 / `100002·100202·100205·100203·100204·100206` 六个附件区块。
- **必填判定看 class**：`requireInput / requireSelect / requireRadio / requireFile`（红星星是 CSS 画的）。
  通用扫描器 `10_scan_form.js` 会把 `requiredConfidence` 标成 medium，**但会把 48 个下拉全漏掉**
  （bootstrap-select 把原生 `<select>` 藏了）→ 本站请直接用「按 name 枚举 `[name]` 控件」的自研导出
  （`data/runs/ct/dump_ct.js` 那种），别只信通用扫描。
- **⚠️ 只有点「保存」才落库**。未保存的一切（含附件 model）随标签页关闭**全部丢失**——
  实测被用户误关过一次，59 步必填全丢。开工前先跟用户讲清「这个页别关」，并尽量把
  一轮填完、一次校验、立刻让用户保存。

## 字段 → 填法（本站实测）

| 字段 | 控件 | 填法 |
|---|---|---|
| 文本 / textarea | 原生 `input[type=text]` / `textarea` | 去 `readonly` → 赋 `value` → 派发 `input`+`change`（`base64value="true"` 的字段也是**写明文**，加密在保存时做） |
| 下拉（48 个） | 原生 `<select class="selectpicker">` + 隐藏 | `select.value=选项code` + `angular…controller('ngModel').$setViewValue(code)` + `$(sel).selectpicker('val',code)`（刷新显示文字）。option 的 `value` 是 `0/199/201` 这种**层级字典码**，必须按选项原文精确命中，不能凭猜拼码 |
| 单选 是/否、男/女 | `input[type=radio]` 外面套 `div.wt-switch.wt-switch-radio` | `radio.click()` 即可（checked 生效），label 文本取 `nextElementSibling`；选项 code 形如 `0/4500/4501`(是)/`…4502`(否) |
| 日期（全部 `class*=dayType`，`readonly`） | bootstrap-datetimepicker 挂在 input 上 | `$(el).datetimepicker('update','YYYY-MM-DD')` + `('hide')`；拿不到实例就退化为「去 readonly + 赋值 + 派发事件」。日期一律 `YYYY-MM-DD`，站点无「至今」按钮（模板里 `soFar('至今')` 被注释掉了）→ 进行中只能**留空结束时间** |
| **省→市二级联动** | 两个并排 select：`id="firstLevl<子select的name>"`（省，无 name）+ `name=<字段>`（市） | ①给省 select 写 code 并触发 ng-change（`selectValChange(selectVal1,name)`）→ **ajax 拉子级**（实测 1~3s，轮询 `child.options.length>1`）②再按原文命中市。两套字典：带「省/市」后缀的用 `0/4/*`（籍贯、现居住、就读院校、期望工作），不带的用 `0/18/*`（高考生源地、户口所在地） |
| 学校/专业/奖励名称 | `<dy-form-special>`：**隐藏 `input[type=hidden][name=…]` + 一个 `readonly` 展示框**（点开走字典 ajax，`data-canadd=1` 可自由填） | **同时写隐藏框和展示框为同一文本**（这就是站点自己填好后的样子：`学校名称` 隐藏=展示=`<院校>`）。只写隐藏会被后续 digest 冲掉——实测：加行/改别的字段后名字变空，最后单独补写一次才稳住 |
| 附件（`ngf-select`） | `input[type=file][name=<区块>_<条目>_1]`，`position:absolute;opacity:0` | 见下节 |
| 提交区 | `取消 / 暂存并退出 / 保存` 三个按钮 | ⛔ 全部由用户自己点，脚本永不触碰 |

## 附件上传（本站唯一的坑点组合）

1. `input.files` 用 **CDP `DOM.setFileInputFiles`**（`cdp.mjs upload`）或 MCP `upload` 都能写进去；
   **但 CDP 不派发可信 `change`**，光靠它 ng-file-upload 不会把文件交给 model。
2. 本站 `uploadUser(file)` 的实现只有一句 `$scope.fileShow = true`（真正上传发生在点「保存」时，
   ng-file-upload 的 shim 会把 model 里的 File 一起 POST）。
   → 补一刀就稳：`sc.$apply(function(){ sc.file = input.files[0]; sc.uploadUser(sc.file); })`
   —— 传的是**真实 File 对象**（来自 `input.files[0]`），不是伪造状态。
3. 校验：`angular.element(input).scope().file.name` 有值 + `fileShow===true` +
   「未选择任何文件」那个 `.enclosure` 变成 `ng-hide`，即成功。
4. 一个区块多个文件 = 点 `增加更多 <区块名>` 生成 `_2`、`_3` 行，再逐行上传。
5. 上传完把 `style` 还原成 `position:absolute;opacity:0`，别留自制的可见框迷惑用户。

## 加行 / 多段经历

- 加行是 `<a class="sc-c">增加更多 项目经验</a>` 这种链接，`el.click()` 有效（Angular 真实监听）。
- ⚠️ **本站加行 + 逐字段写值极慢**：表单 190+ 控件，每次写值都触发全站 digest，
  113 步的非必填批次实测跑了 **约 8 分钟**，一次 `Runtime.evaluate` 根本等不到返回。
  正确做法：**把长批次「发射后不管」**——在页里 `window.__RUN=(async()=>{…})()` 立刻 `return 'started'`，
  然后用小的只读 eval 轮询进度（数行数/抽查几个 name 的 value），别把整批塞进一次调用。
- 加行本身每次要 `await` ~0.8s 以上才生效，且**偶尔丢点击**（5 次只成 4 次）→ 加完一定要数行数，
  少了一行就补点一次。

## 与画像/选项的对不上了怎么办（本次实测口径）

- 字典选项是**行政名带后缀**：画像 `<市>` → 页面 `<市>市`；「统招」→「全日制统招」；
  「六级（CET-6）」→「大学英语六级(CET6)」；「省市级」→「省部级」；「第二作者」→「前三作者」。
  这些都属于**包含/改写匹配**，按铁律只进 suggestions，本次是用户逐项确认后才填的。
- 画像里没有、站点又要求声明的项（健康状况、紧急联系人、专利类型、发明人排序、获奖颁发单位、
  论文检索级别/影响因子）→ 一律**列进待确认清单问用户**，别自己补。
- 论文区块：画像明确标注**非本人署名的成果不得填写** → 那一律不写。

## 岗位列表 / 投递（第二个页面，打法不同）

- 列表页 `#/postinquiry?data=<base64>`：`data` 解出来是
  `{postName,type,filters:{workCity:[选项码…],postType},recruitProject,recruitProjectName}`；
  **base64 里的 `+` 一定要原样保留**——用带 `%2B` 的 URL 走 MCP `navigate` 会被解码成空格，
  筛选条件直接失效（实测踩到，跑成了全站 3599 条岗位）。
  兜底办法：在页里用 `location.hash = '#/postinquiry?data=' + b64`，`+` 用
  `String.fromCharCode(43)` 拼，绕开工具层的 percent 解码。
- 岗位接口：`POST /wt/TELE/web/mode400/position/list`、`/position/detail`、
  简历相关 `/resume/getUserResumeList?recruitType=1&postId=…`、`/resume/analyzerResume`。
- 「我的志愿&我的简历」是**页头 Vue 悬浮菜单**里的 `<li>`（`data-v-*`），
  合成 click 会走 `window.open` 新开 `#/individualcenter`——在那里能看到
  `我的志愿（N）`、`我的简历（M）`、每份简历的**完整度百分比**。
  站内**没有**「剩余投递指标」这种数字；能核实的只有「已投 N 个志愿」+ 简历完整度，
  真正的上限是投递时服务端才告诉你的。
- 「立即投递」是提交类按钮：⛔ 永远用户自己点。

## 复用建议（下次开站）

1. 直接改 `data/runs/ct/` 那套：`build_ct_plan.py`（必填）+ `build_ct_optional.py`（非必填）
   + `ct_fill_lib.js`（写入原语）+ `dump_ct.js`（状态导出）。它们认的都是 `section_item_row` 这套 name，
   同站/同厂商（大易系：其他央企校招也用）可直接复用。
2. **先读站点记忆里的 `option_catalog`**（`data/memory/sites/job.chinatelecom.com.cn.json`，
   本次已沉淀 35 个下拉的「原文→字典码」全量 + 7 组单选），可跳过 probe 和联动等待，省一大半时间。
3. 顺序建议：必填 → 加行 → 非必填 → 补写 `dy-form-special` 的名字 → 附件 → 一次性交用户保存。
