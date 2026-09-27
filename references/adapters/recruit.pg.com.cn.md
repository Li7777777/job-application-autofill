# Adapter: recruit.pg.com.cn（宝洁大中华区校招，Moka ATS 自建域名）

> 实测：2026-09 宝洁校招两份网申表（IT 岗 = 第一志愿、Research & Development Scientist = 第二志愿）。
> 静态资源全部来自 `static-ats.mokahr.com`，DOM 是 `sd-*` 组件 → **框架识别为 mokahr，
> `25_mokahr_fiber.js` 快路径可用**（`dump` 出 nFields=41/43，解析后 52/54）。
> 本文件只记宝洁这份站点与 app.mokahr.com 的差异。

## 1. 入口与「志愿」的真实机制（先看这条，别在表单里找志愿字段）

| 事项 | 事实 |
|---|---|
| 岗位详情 → 申请 | 点「Apply now」后进 `#/job/<jobId>/apply?applyFormId=<表单id>`；hash 里带 `applyFormId` 是常态 |
| 同一招聘项目里有**两张不同的网申表** | `/api/get_job_apply_form/<org>?jobId=<jobId>&type=NORMAL_PORTAL&orgId=<org>&device=pc` 返回该岗位用哪张表。实测：IT 岗 = `170262 校招网申表（CN）IT`，通用岗（含 R&D Scientist）= `107810 校招网申表（CN）` |
| **没有「第 N 志愿」字段** | 表单设置里 `jobIntention` 区块 `show=false`；带「第一/第二志愿课题」的是另一张 BRM/分析项目表单（`blockId 80364` 未启用）。别去找、也别乱填 |
| 志愿 = 投递的两个岗位 | 岗位说明原文：`Each applicant can only apply to at most TWO positions, please prioritize your 1st choice position` → **先提交的是第一志愿，后提交的是第二志愿**；个人中心 `#/candidateHome/applications` 按「第 N 志愿 <岗位名>」列出 |
| 额度 | 「at most TWO」= 一次性资源，投满两个岗位就没有第三次；开工前先跟用户确认要占哪两个 |

## 2. 表单元数据可以一次拿全（比 probeOptions 快得多）

```
GET /api/get_apply_form/<org>?device=pc&site_id=<siteId>&applyMode=campus&hireMode=2&jobId=<jobId>&applyFormId=<formId>
```
（在页面里用 `fetch(..., {credentials:'include'})` 取，返回**明文 JSON**，不加密。）

* `applyForm[0].setting[blockId]` → `show / isSelected / isRequired / fieldOrder`：**哪些区块、哪些字段真的渲染、是否必填**，一眼看全（不用扫 DOM）。
* `customFields[].detail` → 自定义 `select_info` 的**完整选项数组**。
  ⚠️ 但 `fieldInfo.options` 与 fiber 内层 Select 都读不到这些选项（`dump` 里 opts=[]）→
  **选项闸门直接拿这份 `detail` 在编译期比对**，值必须与选项**原文相等**才写，否则进 todo 问用户。
* 响应里 `type=confirm_info` 且 `statement=["我已阅读并确认上述声明"]` 的字段（实测 `378306`，仅 `107810` 表有）
  = **承诺/授权声明 → 铁律：留给用户本人勾**，交付清单里点名。

## 3. 校招面试站点（`campusSiteId`，必填三级 sd-Cascader）

* 一级 = `Online Site`（远程）或**岗位所在省份**；二级随一级变化：
  `Online Site → 视频面试`；`广东 → 广州`；`北京市 → 北京`（岗位城市决定第二级文案）。
* **只能真实点击**：`_set_()` 写不进去；两级各点一次才会落值（store 里落的是节点 id 数字，如 `105961`）。
* ⚠️ **坑（本次踩到）**：`cdp.mjs revalclick` 会对目标元素 `scrollIntoView({block:'center'})`；
  弹层是 portal、`rect.top` 可能是 `-3877` 这种负值 → scrollIntoView 把整篇文档滚出几千像素，
  随后的点击坐标变成负数、静默点空。**规则：弹层元素一律不 scrollIntoView**，
  改成 ① MCP `act click <输入框ref>` 开面板 → ② CDP 读「列内可见元素的中心坐标」→ ③ MCP `act click_at x,y` 按坐标点。
  用 `document.scrollingElement.scrollTop` 判断滚动位置也别信（本站滚的是文档，值可能不更新）。
* 用户偏好（`profile.preferences.interview_site`）：**优先远程** → 选 `Online Site / 视频面试`。

## 4. 双语按钮 / 双语字段名（本类站通用）

* 区块按钮是「添加 / Add」「删除本条 / Delete item」「预览并提交 / Preview and submit」
  → `25_mokahr_fiber.js` 的 `clickAdd/delLast` 已加 `btnCn()`：去掉尾部 `"/ 英文"` 再比对，
  否则**在本站上永远找不到「添加」按钮**。
* 字段 label 也是「中文 / English」，扫描器/映射按 `labelNorm` 走中文部分没问题。
* 必填红字是 `必填项未填写 / Required items are not filled in`（程序写入后常**残留**，以 store 与按钮文案为准）。

## 5. 大表单性能：两个必须关掉的探测（本次实测 20 行 × 长文本）

| 现象 | 真因 | 处理 |
|---|---|---|
| 一批 12 步跑 427s | 收尾 `requiredErrors()` 对**每个** `[class*="apply-field-"]` 读 `innerText` → 全表同步 layout，行数一多就是几分钟 | `CONFIG.skipRequiredErrors:true`，收尾改用一次 `[class*="Input-message"]` 的可见性扫描 + **提交按钮文案**当闸门 |
| 建模型本身就几十秒 | `buildModel()` 对每个 `options` 为空的字段调 `selOptionsOf()`（≤400 后代 × 14 层 fiber） | 纯文本/日期批次用 `CONFIG.skipOptionProbe:true`；⚠️ 但 `bool_info` 的选项只挂在内层 Select 上 → **三个「是否」题必须单独一批 `skipOptionProbe:false` 再写**，否则报「bool 无此选项（不猜）」 |
| 每步仍 ~15s | 标签页 `visibilityState==='hidden'` 时定时器被节流（实测 300ms 的 sleep 要 1s+） | 每批前 `cdp.mjs wake <targetId>`；能让人把浏览器窗口留在前台更快 |

## 6. 顺序（与 app.mokahr.com 一致，另加一条硬规则）

1. **一份草稿只允许一个标签页，任务期间绝不关它**（见 §7 事故）。
2. 先上传简历（`input[name=resumeKey]`，用 MCP `upload` 或 `cdp.mjs upload` + `DOM.setFileInputFiles`）→ 等解析：
   自动带出 姓名/手机/**邮箱**/最高学历/毕业时间/**两段教育（含结束年月）**/2 条项目/1 条经历，
   并**从 PDF 里抠一张 ~2KB 小图当证件照**（要不要换成正片由用户决定）；
   `最高学历`、`毕业时间` 解析后变 `[disabled]`，写不进去是正常。
3. 真实点击选「校招面试站点」。
4. 关「同步更新在线简历」（多岗投递务必 `_set_(false)`，否则两份申请互相覆盖在线简历）。
5. 其余按 `blockId + fid + occ` 走快路径（重复块的 `occ` = 第几行；本表的自定义教育字段
   `当前学校所在国家/地区 / 学科类别 / 院系名称` 的 `blockId` 报的是 `basicInfo`，但 store 落在教育行里，
   所以**按 fid+occ 定位、不要传 blockId**）。
6. 校验：`store` 模式读整表 + 提交按钮文案；**绝不点提交**。

## 7. ⚠️ 事故记录（本次真实踩到，写下来免得再烧一小时）

同一份草稿存在两个标签页（用户的 + agent 的），且 agent 的标签页被会话回收关掉之后，
**服务端草稿被重置成空表**：`resumeKey=""`、教育/项目/实习全部回到一个空行、
个人信息选择题全空，只剩 `姓名/手机号码`（来自账号级在线简历）。已填的 20 行项目全部丢失。

规则：
* 开工前 `tabs list` 确认该岗位**只有一个**标签页；有重复就先请用户关掉多余的；
* 任务期间不 `close` 自己的申请页标签；MCP 会话重建后先 `tabs list` 重新拿 page id，
  并在每次 evaluate 前后核对 URL 里的 `applyFormId`（对不上就是换了岗位/换了草稿）；
* 每完成一批就 `store` 落盘一次（本 skill 的 `data/runs/*.json`），丢了我能立刻看出来；
* 万一被重置：重传简历 → 重跑生成器 → 引擎幂等恢复（实测 100 步/3 分钟，前提是 §5 的两个开关打开）。

## 8. 其他站点侧事实

* 解析器会把实习填进**「工作经历」（`experienceInfo`）**而不是「实习经历」（`practiceInfo`）——同景嘉微那条坑；
  用户口径是「实习只填实习经历、工作经历留空」→ 补填 `practiceInfo`，删掉 `experienceInfo` 那行属破坏性操作，**问用户**。
* 项目的「结束时间」：仓库里没写 `endDate` 的老项目，**取消「至今」勾选后组件会自动落一个当前年月**（实测 `2026-01`，
  等于凭空造了个结束时间）→ 有证据的（获奖/专利/论文日期）用 `daterow` 明确写结束年月，没证据的才留「至今」并在交付清单说明。
* 月份分片面板的叶子文本是**纯数字**（`10`、`12`），不带「月」→ `pickMonthByPanel` 直接命中，实测可用。
* 表单级唯一权威判据 = 提交按钮文案：`预览并提交 / Preview and submit` = 无阻塞错误。
