# AGENTS.md

本仓库的唯一 UI 事实来源是原型 `src/App.tsx`。生产壳 `src/app/RealApp.tsx` 必须与原型逐屏一致：布局、间距、字号、颜色、层级、状态呈现、交互与动画。原型里已经写好的东西，直接搬，不允许自己另写一套近似实现，也不允许因为"功能没做"就不放那块 UI。

## 文案

只写客观、简短、商业软件级别的界面文案。禁止：

- 教程式、解释式、第二人称的句子（"你可以…"、"接下来要预览了"、"数据只存在这台设备上"）。
- 实现术语出现在界面上："入库"、"写入"、"样本回归"、"回归测试"、"事务"、"三方合并"、"数据库"、"缓存"。
- 解释显而易见的下一步（"确认后才入库"、"解析结果先预览"）。
- 无用的免责/安抚句（"改动会保留，不会被覆盖"、"手动改过的字段不会被覆盖"、"导入不会覆盖手动添加的安排"）。
- 说明"可以怎么用"的句子（"可以挂在某门课上，也可以独立"、"时间与地点在课程详情里逐段调整"）。

页面标题用名词短语；副标题只在真的携带信息（学期、周次、门数、时间范围）时出现，否则不写。

## 交互

- 编辑、新增、导入、规则、冲突、变更一律全屏内页，禁止模态框套模态框。
- 主操作用底部大号实心主题色按钮（`PrimaryButton`），禁止只在角落放一个小号文字"下一步"。
- 导入完成后离开导入流程，回到课表，不停留在规则页。
- 本地解析很快，不做进度条；同一屏不得出现多条进度指示。
- 返回必须回到上一页；系统返回键优先出栈，栈空时回到"今天"，再按才退出应用。
- 长按课程：被按住的卡片抬起并高亮，菜单出现在它下方且不遮住它。
- 日历面板只能上下滚动，从底部滑入滑出，不做左右翻月/翻周；只有握把可下拉关闭。
- "今天"不画圆圈、不画圆点，只用主题色文字区分；首页与周视图日期条用圆角矩形高亮选中项（含日期与星期两行）。
- 内置规则不可编辑，规则行不显示版本号、上次使用等实现信息。

## 动画

统一参数（`src/app/ui.tsx`）：

- 页面推入/退出：`tween`，`cubic-bezier(.25,1,.5,1)`，400ms，水平方向。
- 底栏指示器：`spring`，`bounce 0.2`，`duration 0.6`，共享 `layoutId`。
- 抽屉：`tween`，`cubic-bezier(.32,.72,0,1)`，300ms，仅 Y 轴，从底部起。
- 遮罩：200ms 淡入淡出。
- Tab 切换只做淡入淡出，不做纵向位移/回弹。
- 禁止列表逐条出场（stagger）、禁止弹力带式滚动与上下同时展开的"馅饼"式弹出。

## 数据

生产界面只显示真实 Store 数据（学期、课程、排课规则、单次覆盖、待办、导入批次）。允许从原型硬编码的只有装饰性资源（背景图、头像等静态素材）。禁止把原型的假课程/假待办塞进生产。

## 安全

不做账号密码收集、不做教务系统登录抓取、不收集凭据。导入只处理用户主动粘贴或选择的输入。

---

# 工作方式（给后续 Agent）

以上是 UI 规范，下面是怎么在这个仓库里工作。**每条都不是建议。**

## 开始之前

1. 通读本文件与 `README.md`。
2. 打开 `src/App.tsx`（原型）与要改的生产文件对照着看。原型里有的屏，先找到再动手；原型没有的屏，参照最近似的原型屏搬布局，不自创。
3. 用户可见文案改动前对照上面「文案」一节逐条过一遍。

## 目录速查

| 要改什么 | 去哪 |
| --- | --- |
| 路由栈、Tab、导入流程、AI 转换页 | `src/app/RealApp.tsx` |
| 课程详情 / 编辑 / 冲突 / 变更 / 手动添加 / 搜索 | `src/app/pages.tsx` |
| 首次引导 | `src/app/Onboarding.tsx` |
| 公共组件、动效常量（`PAGE`、`SHEET`、`FADE`） | `src/app/ui.tsx` |
| 原生桥（对话框、Toast、返回键、小组件） | `src/app/native.ts`、`src/app/widgets.ts`、`android/.../WidgetBridge.java`、`MainActivity.java` |
| 周次 / 节次 / 冲突算法 | `src/domain/engine.ts`、`weeks.ts`、`dates.ts` |
| 导入解析、诊断、normalize | `src/domain/importer.ts`、`importers/*`、`rules.ts` |
| AI Prompt 文本 | `src/domain/ai-prompt.ts`（唯一来源，不在组件里写长文本） |
| Store、持久化、导入合并 | `src/domain/store.ts`、`persistence/` |
| 桌面小组件 | `android/.../widget/`、`src/domain/widget-data.ts`、`tools/` |

## 环境

- Node 22（`nvm use 22`），`npm ci`。
- JDK 21：`export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`。
- Android SDK：platform 36、build-tools、platform-tools；`android/local.properties` 写 `sdk.dir=...`，**不要提交**。
- Gradle 拉依赖被限流（Maven Central 429）时，在 `~/.gradle/init.gradle` 加镜像：

  ```groovy
  allprojects {
    repositories {
      maven { url 'https://maven.aliyun.com/repository/public' }
      maven { url 'https://maven.aliyun.com/repository/google' }
    }
  }
  ```

## 验证（每次改完，顺序执行，全绿才算完成）

```bash
npx tsc --noEmit
npx vitest run
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

- `npm run build` 必须在 `cap sync` 之前，否则 APK 里是旧的 `dist/`。
- 不改测试来让测试通过。新增解析/算法逻辑要补 `src/domain/__tests__/` 用例。
- 不启动模拟器、不 `adb install`。交付的是 debug APK，说明里写清「未真机验收」。

## 部署与打包

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug -q
cp app/build/outputs/apk/debug/app-debug.apk ../timetable-debug.apk
```

源码包排除：`node_modules dist android/.gradle android/build android/app/build android/capacitor-cordova-android-plugins/build`。

版本号在 `android/app/build.gradle`（`versionCode` / `versionName`）。

## 推送到 GitHub

- 只推 `main`，不建分支、不建 PR。
- 不使用 `gh` CLI（会带入错误的提交人）。用 `scripts/push-github.sh`：REST API 建私有仓库 + `git push`，token 只从环境变量 `GH_TOKEN` 读，不写进任何文件。
- 提交人固定 `shuakami <shuakami@sdjz.wiki>`，脚本已通过 `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 强制。

## 截图

README 用图与验收图统一走浏览器，不用模拟器：

1. `npm run build && npx vite preview --port 4173`
2. 用 Chrome 打开 `http://localhost:4173/`，设备模拟 375×812（或直接用 `public/shots.html` 一次排三屏）。
3. 引导页可用查询参数定格：`?onboardStep=0|1|2&still=1`。
4. 需要多屏拼版时把单屏 375×812 截图按 `docs/screenshots/group*.png` 的方式横向 5 屏一排、`#EDEDEB` 底、圆角 40。
5. 小组件预览：`tools/gen_widget_previews.sh`（headless Chrome，输出到 `drawable-nodpi`）。
6. 图标 / 开屏改动，出「普通图标 + 三种系统取色」的对比图发给用户；monochrome 层内容控制在 68dp 安全区内。

## 交付说明模板

> 新 APK + 源码在附件。本版：1）… 2）… tsc / vitest / build / gradle 全过，未真机验收。

不写「已在 OPPO 上验证」之类没做过的事；原生对话框只能说「使用 `Theme.DeviceDefault`，跟随 ROM 样式」。

## 常见坑

- 原生对话框用 AppCompat 主题会退回 AOSP Material 样式；必须 `Theme.DeviceDefault.(Light.)Dialog.Alert`。
- 对话框要自己吃掉返回键，否则偶发退到桌面。
- 学期默认 10 节；导入的课到 13 节时靠 `timeSlots` 或自动补足扩表，别去改默认值。
- 引导页卸载要在内页退回同一帧，否则退场动画期间会闪一下引导页。
- 颜色选择器是固定宽度横向滚动 + 两端渐变，不要改成撑满一行。
