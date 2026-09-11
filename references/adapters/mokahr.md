# Adapter: mokahr（app.mokahr.com 系网申，多家公司共用）

> 实测：2026-09 某公司校招申请页（mokahr ATS）。通用扫描器在这个站点上已经能自动识别
> 42 个控件 / 15 个必填，字段名基本正确；本文件只记「通用规则覆盖不到」的部分。

## 1. 结构与组件

| 层 | 特征 |
|----|------|
| 区块 | `[class*="apply-block-"]`，标题在 `[class*="blockTitle-"]`；教育背景/实习经历是可多条区块（带「添加」按钮） |
| 字段块 | `[class*="apply-field-"]`，字段名在 `[class*="title-"]` 内层 span → 通用扫描器的 `field-title` 正好命中 |
| 必填 | `[class*="required-asterisk"]`（空 span，无文字）→ 通用必填判定靠 `[class*=required]` 命中，置信度 medium |
| 下拉 | `sd-Select-container` + `sd-Dropdown-dropdown` 面板 + `sd-Select-common-item` 选项；值显示在 `sd-Input-display-value-*` |
| 日期 | `date_info`（年/月 两组，`month-range-select`）；`day_info`（只读 input + `sd-picker-addon`，点开是「年 + 月」面板） |
| 文件 | `input[type=file]`（name=resumeKey）默认隐藏，需显形后再 upload |
| 校验提示 | 必填项失焦后出现文字「必填项未填写」→ 可当自检信号 |

## 2. 通用规则覆盖不到的坑

1. **「出生日期 (年龄)」是「年月」粒度**：选完月份即结束，选不到「日」，显示成 `1999-09 (27岁)`。
   → 填 `personal.birth_ym`，并如实告知用户。
2. **复数年月分片控件**（毕业时间、就读时间、起止时间）：一个字段由 2–5 个 select 组成
   ×（年、月、年、月…），通用扫描器会把它拆成 `年/月/裸数字` 之类的碎片 → 编译阶段会当「分片」跳过。
   → 需要日期时按 `40_fill.js` 里的 `date_ranges` 思路单独适配（未在真机验证通过，谨慎使用）。
3. **简历解析会锁字段**：上传简历后 mokahr 自动解析并回填，`毕业时间/最高学历` 等变成 `[disabled]`。
   → **先上传解析、再补空缺**，顺序不能反；被锁的字段写不进去要如实报错。
4. **教育背景会自动增条**：含 2 段学历的简历解析后会直接生成 2 条教育条目，不需要点「添加」。
5. **草稿行为**：表单值会**异步落库**（实测：页面/浏览器关闭后再打开，大部分值还在），
   但**邮箱与简历附件会丢**，且刚填完立刻新开标签页可能是空的。
   → 每步落盘；重进页面后重跑扫描/映射/填充（幂等）补齐。
6. **账号级在线简历**：重新打开申请页时，教育背景区块已经从账号里的在线简历带出内容。
7. **必填误判**：「申请信息」区块里 `意向工作城市` 必填，会让同区块的 `推荐码` 被判成必填（medium）
   → 进 todo 让用户确认即可。

## 3. 该站点可命中的规范字段

（下面的对应关系来自通用字段规范 `assets/canonical-fields.spec.json`；用户在各站点的实际命中与配方记录在 `$JAA_DATA_DIR/memory/`）

`意向工作城市→job.intended_city`、`推荐码→job.referral_code`、`姓名/手机号码/邮箱/性别/出生日期→personal.*`、
`最高学历→personal.highest_degree`、`所在地→personal.location`、`招聘信息获取渠道→job.source_channel`、
`学校名称/专业名称/学历/就读时间→education.*`、`公司名称/职位名称/工作职责→experience.*`；
5 道「是否」题与「您使用微博的频率」属于**站点特有问答**，存在 `dictionary.json → qa`。

## 4. 参考样例（examples/）

- `example.scan.json`：脱敏后的扫描结果样例（清空了个人的已填值，替换了 URL/公司/文件名）
- `example.mapping.json` / `example.todo.md`：编译产物与「必须问用户」清单样例
