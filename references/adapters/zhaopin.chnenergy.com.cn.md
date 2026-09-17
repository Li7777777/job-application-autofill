# 国家能源集团招聘（zhaopin.chnenergy.com.cn）

**技术栈**：服务端渲染的 legacy jQuery + Bootstrap 4 + My97DatePicker + zTree + `dialog-min.js` 弹层。
**无组件 API**（不是 React/Vue 表单）→ `25_mokahr_fiber.js` 的 dump 必为 0，**直接走通用方案**，不要浪费时间试快路径。

**最大优势**：所有控件都有稳定的 `name` 属性（`fullName` / `nation` / `nativPlace1` / `schoolName` / `school` …），
**不需要扫描器打 uid**，直接 `$('[name=x]').val(v).trigger('change')` 即可。填充走 CDP（`cdp.mjs eval`）。

## 页面结构（我的简历 = 11 个子页，每个都是独立 URL，不是懒加载 tab）

| 子页 | URL | 说明 |
|---|---|---|
| 个人信息 | `/resume/editResume?type=1`（**tab 链接写的 `/resume/editBase` 直开会报「数据加载异常」**，用前者） | 校招/社招两个 tab（`resumeType=1/3`） |
| 教育经历 | 列表 `/resume/eduList`，新增 `/resume/editEdu`，编辑 `/resume/editEdu?id=<eduId>` | 保存按钮 `onclick="saveEdu()"` |
| 资格证书 | 列表 `/resume/qualiList`，新增 `/resume/editQuali?category=school` | 文号(`field1`)必填 |
| 工作经历 | 列表 `/resume/workList`，新增 `/resume/editWork` | |
| 家庭成员 | 列表 `/resume/familyList`，新增 `/resume/editFamily` | 保存按钮 `onclick="save()"` |
| 取得成果 | `/resume/eidtAchiev`，textarea `profesAchiev` | 保存 `onclick="save();return false;"` |
| 奖惩情况 | `/resume/eidtReward`，textarea `reward` | 同上 |
| 爱好特长 | `/resume/eidtHobby`，textarea `hobby` + `specialty` | 保存 `onclick="savehobby()"` |
| 自我评价 | `/resume/eidtSelfEvaluate`，textarea `selfEvaluate` | 保存 `onclick="save();return false;"` |
| 电子附件 | `/resume/certList`，11 个同名 `input[name=uploadCertImg]` | 见下 |
| 首选考试城市 | `/resume/editFacePlace`，`select[name=place1/place2]` | 无「远程」选项 |

## 关键机制

1. **必填判定**：控件带属性 `unrequired` = 选填；**没有该属性 = 必填**（扫描器的 `required` 在此站不可信，
   以 `label > span.fc-red/*` 与 `unrequired` 为准）。
2. **省市三级联动**：`select[name=<prefix>1]` 的 `onchange="getCity('<prefix>')"` 会 POST `/resume/getCity`
   （`propId = 省码前两位 + '____'`，如省码 `14xx` → `14____`）后用返回列表重建 `<prefix>2`。**必须先设省、等 ~1s 再设市。**
   市码 = 省码前两位 + 市序号（例：某市 = `140700`）。`select` 选项文本是**简称**（如「A/B」），不是全称（「A省/B市」）——匹配时不要用全称去比。
3. **院校库 / 专业库**：`schoolName`/`extfield1` 是 **readonly 显示框**，真正提交的是隐藏字段
   `school`/`major`（`/resume/ztreeKind?typeId=shool|major&resumeType=1` 返回 zTree JSON，用 `ID`）。
   - 院校 / 专业 / 专业的 ID 由 `ztreeKind` 查表取得（形如院校 `106012`/`102003`、专业 `080736`/`080905`）
   - 设完必须调 `changeSchool()` / `changeMajor()`（切换 readonly、同步 `#oversea` 隐藏值=0）
   - 选「其他院校」= `199001` / 「海外院校」= `198001` 时才放开手输（`saveEdu()` 会校验）
   - 「其他院校/海外院校」ID 是 6 位，`school.length<=5` 会被 saveEdu 判为「请重新选择毕业院校」
4. **学历→学位联动**：`select[name=education]` 的 `change` 会 POST `/resume/getDeg`（`edu=21` 返回硕士学位表、
   `edu=31` 返回学士学位表）重建 `#degree`。**设完学历要等 ~1s 再设学位**。工学硕士学位=`308`，工学学士学位=`408`。
   `saveEdu()` 另有校验：本科「终止 ≥ 起始+1 年」、硕士「终止 > 起始+1 年」。
5. **日期**：`startTime`/`endTime`/`birthday`/`getTime` 都是普通 text input + `onfocus="WdatePicker({...})"`，
   直接写 `yyyy-MM`（教育/工作）或 `yyyy-MM-dd`（生日）字符串即可，无需点日历。
6. **保存 = 原生 form submit**：个人信息 `#baseFrom`（`subForm()`），教育 `#eduFrom`（`saveEdu()`），
   其它页 `save()`/`savehobby()`。提交后整页跳转，返回列表页顶部弹 `提示|保存成功！` 的 `dialog`。
   **每页改完必须保存**，否则不落库。
7. **个人照片**：在 iframe `/resume/photo` 内，SimpleUpload 挂在一个 `input[type=file][name=uploadImg]` 上，
   POST `/resume/uploadImg`（≤200K 的 jpg/jpeg/png/gif）。`cdp.mjs upload` + 它自带的 change 就能触发上传；
   成功标志：`#img` 的 `src` 变成 `/resume/getImg?randomval=...` 且 `naturalWidth>0`。
8. **「验证」按钮**（`checkResumeAllBefore()`）不是提交，是 POST `/resume/checkResumeIntegrity?resumeType=1`，
   返回 `FINISH1`（校招简历完整性）等标志位。**只读，可以放心调用**，用来查还缺什么。
9. **「申请」按钮 = 真正的投递**：`onclick="apply(stationId,projectId,...)"` → 先查 `checkResumeIntegrity`（`isApplyCheckData=1`）
   → `FINISH1!=1` 就弹「简历未通过验证」；通过则弹两次 `applyqueren()` 确认框（“请确认是否应聘…”+“投递后不能再修改”），
   确认后 POST `/apply/firstApply` **落库投递**。**脚本里绝不点它**（`SUBMIT_RE` 之外的手工铁律）。

## 校招简历（resumeType=1）完整性要求（`checkResumeAll` 逐项判）：

`PHOTO`（个人照片）、`BASE1`（个人信息：图片里的 `BASE_INFO1` 会列出缺哪几项）、
`EDU`（起始/终止/院校/专业/学习形式/班级或年级综合排名/学历）、`FAMILY`（姓名/出生日期/关系/工作单位/职务/是否集团职工）、
`HOBBY`、`SELF_EVALUATE`、`CERT`（**身份证、学生证、成绩单 + 国内院校的学籍在线验证报告**；困难家庭另需户口证明）、
`facePlace`（首选考试城市）。

**不要求**：工作经历（校招 `WORK!=1` 时提示串为空）、资格证书、取得成果、奖惩情况、其他说明。

## 电子附件（`/resume/certList`）

文案：`文件格式为2M以内的JPG、JPEG、PNG、GIF格式图片`。带 `*` 的必传：**证件、学生证（或其他学生身份证明）、成绩单**；
其余（就业推荐表、毕业证、学位证、教育部学籍在线验证报告、留服认证、资质证书、户口、其他）不带 `*`，
但**完整性校验 `CERT=1` 实际还要求「教育部学籍在线验证报告」**（提示串里写明），所以校招至少传 4 张。
11 个 `<input type=file name=uploadCertImg>` 同名，需按行索引定位。

## 坑

- **岗位详情页不能直开 URL**：直接导航 `/annc/showgw?id=…` 会报「查看岗位信息发生错误，请重试或者联系管理员」
  （间歇性）；**必须从列表点进去**：`/recTypeSerch?kinds=1&schType=1`（直招，`kinds=1/schType=1`；统招 `schType=2`；内部 `kinds=2`；社会 `kinds=3`）
  用 `#stationform` 的 `station=<岗位名>` 过滤后在结果里**真实点击**链接，详情页才正常渲染出 `#applySQbtn`。
- 「申请」→ `apply()` 的完整链路：`checkResumeIntegrity(isApplyCheckData=1)` →
  `applyqueren("请确认是否应聘…")` → `applyqueren("简历投递后将不能再对简历内容进行修改！")` →
  `showWritePlace()` → `applydialogNoWritePlace()` → **`GET /apply/firstApply`**（`applyResumeKind,stationid,projectid,writeplace:'',faceplaceP,faceplaceC`）。
  注意：活跃分支调 `showWritePlace(stationid, projectid, cnstation, cnorg)` **不传 province/city**，
  所以考试城市完全取自简历里的 `place1/place2`（`checkResumeIntegrity` 会回传给你核对）。
- **服务端 XSS 过滤器会静默删掉子串 `script`（不分大小写）**：写「TypeScript」在预览页会变成「Type」。
  写简历文案时把 TypeScript 写成 `TS`（或 `Type-Script`），否则关键词被吃掉还没告警。
- **工作经历没有「至今」**：`endTime` 是必填、只认 `yyyy-MM`，写「至今」会让 `/resume/saveWork` 返回
  「服务器异常，请重试或联系管理员！」。在进行的实习只能把终止时间写成当前月（如 `2026-09`）。
- **「首选考试城市」没有「远程」选项**，只有国内省市 + 海外（`place1`/`place2`，`/resume/getCity` 联动）。
- 会话超时很短：URL 变成 `/index?tokenMsg=操作时间过长，请重新登录…` 就是登录态没了 → 只能让用户重新登录，
  **别自己处理密码/短信验证码**。每做完一页立刻保存，别攒着。
- 直开 `/resume/editBase` 报「数据加载异常，请重试！」→ 用 `/resume/editResume?type=1`。
- `identType`/`identNum`/`sex` 各有「隐藏 input + 可见控件」两个同名元素，`querySelector('[name=x]')`
  会命中第一个（隐藏的那个）→ 回读时看清是哪一类，别被空值骗了。
- `91`+`education>=41`（大专及以下）时 `#degree` 会被 disable，别去写它。
