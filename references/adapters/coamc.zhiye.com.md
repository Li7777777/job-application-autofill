# adapter: coamc.zhiye.com（中国东方资产管理 校招 / 北森「门户 2022」+ phoenix）

> 实测 2026-09-17→18（岗位 业务岗(J11389)，jobAdId `423cd5b8-8af7-43c0-a390-c353aba8f91b`，`/form` 全流程 125 个字段项）。
> 与 `cxmt.zhiye.com.md` / `sokon.zhiye.com.md` **同族**（同一套 phoenix 组件 + `.form-item` + `.phoenix-selectList` +
> `.area-data-container` + `.phoenix-calendar`），两者相同的部分不复述。**本文只写本租户的差异与更优解法。**

## 0. 一句话差异表

| 维度 | cxmt / sokon | **coamc（本站）** |
|---|---|---|
| 门户形态 | 纯 SPA | **SPA 外面套一层 jQuery + layui 的门户**（`/custom/*`），详情页的「申请职位」是 layui 弹窗 |
| 写值通道 | 键盘逐字符 / fiber onChange | ⭐ **fiber `onChange({text,value})` 最稳**（本文 §2，已实测 62+5 次全成功、重载存活） |
| 省市区列表 | 点选下钻 | ✅ **直接拿静态资源**：`const.italent.cn/resource/Areas-chs-100414-101378.js`（本文 §4） |
| 专业类别 | 无此字段 | ✅ 有必填「专业类别」，选项走 API `const.italent.cn/api/v2/compatible/value/MajorCategory/101378/chs/414`（120 个专业类，§4） |
| 草稿 | 有的存有的不存 | ✅ **「暂存」落服务端**：个人中心 `/personal/deliveryRecord` 出现「暂存的投递」，可「继续投递」（`/form?fromPage=continueSendResume&jobAdId=…&submissionId=…`），**重载后 125 项字段全在** |
| 附件丢失风险 | 会丢 | 重载后 **简历附件与证件照仍在**（实测） |
| 隐私政策弹窗 | 进表即弹 | ❌ 本站**不弹**；改为详情页「申请职位」的**知悉公告确认框**（§1） |

## 1. 进表链路（没有 apply 直链）

```
岗位详情 /custom/xzxq?jobAdId=…            ← ⚠️ 直开 URL 偶发「查看岗位信息发生错误」，从列表点进来更稳
  └─ 「申请职位」#click_sqzw  → GET /api/Login/GetUserInfo（Cookie: hasUser=<userId>）
        ├─ Code!=200 → 跳 /login?goto=…
        └─ Code==200 → 显示 .tcbox 弹窗：
             “您是否已阅读并知悉我公司2027校招公告内容以及拟报考职位在投递界面所载明的工作职责和任职资格？”
             ├─ #okbtn2「确定」→ $('.tcbox').hide(); $('#apply').click();   ← 真正的入口（**按铁律先问用户**）
             └─ #cancelBtn「取消」→ 关闭
  └─ 到达 /form?fromPage=job&jobAdId=…&userId=…&goto=…
```
- `#apply` 是详情页里一个 `style="display:none"` 的调试锚点（文本「此处是执行申请职位的点击」），它的 handler 在 OSS 脚本
  `dfzc_pc.js` 里，点它会跳到 `/form`。**它只是打开申请表，不是提交**，但弹窗那句是法律意义上的「已阅读并知悉」→ 必须先问用户。
- 登录态：`GET /api/Login/GetUserInfo` → `Data.UserId / Mobile / NickName`（本站为微信登录，`HasPwd=false`）。
- 表单底部按钮：**暂存 / 取消 / 预览并提交**。点「预览并提交」才是提交 → **绝不代点**。
- 额度提示（页面顶部）：`最多可投递 2 个职位，还可投递 2 个`（暂存不占额度）。

## 2. ⭐ 写值通道：按 `.form-item` 反查 fiber 再 `onChange({text,value})`

**不要**用全局 fiber 树遍历（`document.body` 上没有 react key；从某个元素向上 `return` 会遇到 current/alternate 环，
实测 5000 次不收敛、只走到 24 个节点）。**正确做法：以 DOM 的 `.form-item` 为锚**——每个字段一个 `.form-item`，
DOM 顺序 = 视觉顺序 = 多段记录的真实顺序（教育经历 2 条、家庭 2 条都能区分）。

```js
const KEYPRE=['__reactInternalInstance$','__reactFiber$'];
const fiberOf=el=>{ if(!el) return null; const k=Object.keys(el).find(x=>KEYPRE.some(p=>x.startsWith(p))); return k?el[k]:null; };
function fieldFor(sec,label,occ){                 // sec = cmp_name 前缀（见 §3），occ = 同名字段第几次出现
  let seen=0;
  for(const box of document.querySelectorAll('.form-item')){
    const labEl=box.querySelector('.form-item__text');
    const lab=labEl?(labEl.innerText||'').trim():'';
    if(lab!==label) continue;
    let f=fiberOf(box), fc=null;
    for(let i=0;i<60&&f;i++,f=f.return){          // 向上找「字段组件」：memoizedProps 带 cmp_label + onChange
      const p=f.memoizedProps;
      if(p&&p.cmp_label!==undefined&&String(p.cmp_label).trim()===label&&typeof p.onChange==='function'){ fc=p; break; }
    }
    if(!fc) continue;
    if(sec && String(fc.cmp_name||'').indexOf(sec)!==0) continue;
    if(seen===occ) return fc;
    seen++;
  }
  return null;
}
fieldFor('RecruitmentPersonProfile','证件号码',0).onChange({text:'<身份证号>', value:'<身份证号>'});
```
- **必填判定**：`fc.validators.presence` 存在即必填（比 `cmp_data.required` / DOM 星号都准）。
- **选项**：`fc.cmp_data.datasource` = `[{text,value,…}]`（性别/学历/学位/政治面貌/健康状况/民族/学习形式/排名/单位类型/月薪…）。
- **现值**：`fc.value`(code) 与 `fc.text`(显示文本)。
- ⚠️ **回读必须重新取 fiber**：`memoizedProps` 是不可变快照，写完再读同一个 `fc` 永远是旧值（会误判"没写进去"）。
  每批写完后**重新扫一遍 `.form-item`** 才是真回读。
- ⚠️ 用 `fc.onChange` 写进去的值是**真的进 React state**：实测 62 项批量写入 → 「暂存」→ 重载后 125 项全部还在。
- ⚠️ 联动字段：把「英语考试等级」选成 六级后，**会新冒出一个必填的「英语等级成绩」**（domIdx 后移）→ 每轮都重新扫一遍再判必填。

## 3. 字段分组（`cmp_name` 前缀 = 区块）

`RecruitmentPersonProfile`（个人信息 30 项）/ `RecruitmentApplicantEducation`（教育经历，**可 2 段**）/
`RecruitmentApplicantInternship`（实习经历）/ `RecruitmentApplicantWorkExperience`（工作经历）/
`RecruitmentLang`（语言能力 4 项）/ `RecruitmentCertificate`（证书 3 项）/ `RecruitmentFamily`（家庭情况 5 项，**可多段**）/
`RecruitmentAwards`（获奖 3 项）/ `RecruitmentSchoolPractice`（在校实践 4 项）/ `RecruitmentWritings`（论文专著 5 项）/
`RecruitmentApplicantAdditionalInfo`（兴趣爱好/专利成果/特长）/ `RecruitmentResumeFile`（简历附件）。

- **解析预填**：上传简历到 `input[type=file][0]`（页顶「上传简历」）→ 自动填 姓名/性别/邮箱/手机/**证件照**/最高学历/
  最高学位/最高学历毕业时间/**两段教育经历**（学校+专业+学历+学位+起止）/工作经历（单位=项目名，需改）/简历附件。
  实测解析把「证书」写成了 ~~四级~~ 一类的错值也要核对（本次解析的英语等级为空，是我按画像填的六级 448）。
- 多段区块只有「添加家庭情况/添加教育经历/添加获奖情况…」这类**div 按钮**（styled-components），
  要 `cdp.mjs revalclick` 真实点击；点完 `occ` 递增，按 §2 的 `fieldFor` 定位新条目。
- ⚠️ **删不掉记录**：全页只有「教育经历 2 条 + 家庭情况 2 条」带「删除」（`phoenix-popover` 里的 `span` 文本「删除」）；
  **实习经历 / 工作经历 / 获奖 / 论文 这些条目没有删除入口**（也没有 hover 才出现的图标）。
  解析把内容放错区块时的可行做法：**把字段全部 `onChange({text:'',value:''})` 清空**（实测有效，清空后重载仍为空）。
- ⚠️ **解析容易把「实习」填进「工作经历」**（本次就是这样）：`RecruitmentApplicantWorkExperience` 的
  `单位名称` 收到的是**项目名**（WearVision）而不是公司名。→ 结束前一定要问用户「这段是实习还是工作」，
  并按用户口径放到 `RecruitmentApplicantInternship` / `WorkExperience`。
- 「实习经历」区块的 8 个字段（单位名称/单位介绍/开始/结束/实习地点/实习内容/证明人/证明人联系方式）
  **全部非必填**（无 `validators.presence`）→ 不知道的（如证明人）留空，不要编。
- 单位全称/地址/岗位名/正式起止日期这类事实，**优先从用户手里的实习协议/Offer 文本抽**（本次从
  `云想万物_Agent_Harness研发工程师实习协议.docx` 的 `word/document.xml` 拿到了甲方全称与地址）。
- 「是否至今」：工作经历 `结束时间` 的 `value` 是 `9999/12`（`text` 为空），别当成没填。

## 4. 两个特殊数据源（不点面板也能填）

**省市区**（`户口所在地`/`生源地`/`籍贯`/`现居住地`/`工作所在地`/`实习地点`，`dsname=NativePlaceFullPath`）：
```js
// 静态资源，格式 ConstAreas([[id,[name],pid,flag,level], …])
await (await fetch('https://const.italent.cn/resource/Areas-chs-100414-101378.js')).text()
// 常用：<省名>=1400 <省会市名>=1401 <市名>=1407 <县名>=140709 ｜ <省名>=2100 <市名>=2102
fieldFor(sec,'户口所在地',0).onChange({text:'<省>,<市>',  value:'<省码>,<市码>'});
fieldFor(sec,'籍贯',0).onChange({text:'<省>,<市>,<县>', value:'<省码>,<市码>,<县码>'});
```
实测 **2 级（省,市）与 3 级（省,市,区）都能被接受**并回读成功。

**专业类别**（必填，`dsname=MajorCategory`，props 里 datasource 为空、开面板才请求）：
```
const.italent.cn/api/v2/compatible/value/MajorCategory/101378/chs/414
→ [{code,name,fullPathCode,fullPathName,children:[…]}]   // 120 个专业类
常用：计算机类=583（叶子） 电子信息类=581（叶子） 电气信息类=58（有子项，如 <某专业>=551）
fieldFor('RecruitmentApplicantEducation','专业类别',0).onChange({text:'计算机类', value:'583'});
```

## 5. 草稿与提交

- **「暂存」会落服务端**（实测）：点完 → 个人中心 `/personal/deliveryRecord` 出现「暂存的投递 (1) 业务岗(J11389) … 暂存」，
  带「放弃投递 / 继续投递」。点「继续投递」→ `/form?fromPage=continueSendResume&jobAdId=…&submissionId=323888552`，
  **125 项字段 + 附件全部完好**（含多段教育/家庭、省市区、专业类别）。
- 因此：**可以先暂存再让用户复核提交**，不会再出现 cxmt 那种「刷新即丢」。
- 提交按钮 = **「预览并提交」**（页面底部），点它才是真正投递 → 按铁律 1 交给用户。
- 公告级约束（2027 校招）：`报名截止 2026-09-18`、`每名应聘者限投 2 个岗位`、`简历一经投递不可修改`、
  `CET6 ≥425`、`国内高校须 2027-01-01~2027-07-31 毕业`。

## 6. 检查清单（本站版）

1. 从列表点进岗位详情（直开 URL 偶发报错）→ 问用户后点「申请职位」→ 弹窗「确定」→ 进 `/form`
2. `cdp.mjs front`（本站的 SPA 也吃后台冻结）
3. `cdp.mjs upload` 传简历到 `input[type=file][0]` → 等 5~15s → 回读解析结果并**逐项核对**（解析会错）
4. 扫 `.form-item` + fiber → 得到 (区块, 字段名, 第几次出现) 三元组 + 必填 + 现值 + 选项
5. 按 §2 写值（写完**重新扫**再回读）→ 留意联动冒出的新必填字段
6. 多段区块用 `revalclick` 点「添加…」再写
7. 省市区/专业类别走 §4 的资源与 API
8. `暂存` → 个人中心复核草稿 → 交给用户点「预览并提交」
