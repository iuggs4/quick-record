# Quick Record v0.1

手机收支记账网站，无第三方依赖。默认打开“首页”，数据保存在当前浏览器的 IndexedDB 中。

## 使用与发布

直接双击 index.html 即可在浏览器预览，无需启动服务；请保留同目录下的脚本、样式和图标。文件模式不注册离线缓存，页面资源直接从磁盘加载。离线缓存安装需要 localhost 或 HTTPS。文件模式的存储支持取决于浏览器，且与 HTTP/HTTPS 网站的账单不互通；移动文件后请先确认原账单是否仍可访问。将本目录应用文件发布到 GitHub Pages，在 iPhone Safari 打开并添加到主屏幕。无需构建。当前没有配置仓库或实际发布。

第一次联网打开并显示“离线资源已准备好”后，可离线使用。更新应用时同时修改 sw.js 的 CACHE 版本；新版会在旧页面全部关闭后接管，不修改账单库。

账单顶部有横向日期时间轴，一屏完整显示七天，顶部月份可点击选择目标月份，默认选择今天。左右滑动时使用系统惯性滚动，减速后吸附居中日期，停稳后显示该日账单；电脑可按住鼠标左键拖动，松开后按速度平滑减速并吸附，拖动不会误触日期按钮；点击日期也可定位，通过继续横向滑动跨月查看更早记录，不显示月份箭头；日期上方灰色竖线以居中最高、向两侧逐级变短排列。组头显示黑色粗体日期，每条账单仅显示时间。右上角“…”→“编辑”可进入逐条编辑模式；点击账单旁“编辑”可修改金额、分类、收支类型及年月日。保存保留原ID与原时分秒，按所选日期更新记录，并重新计算统计，取消不改动账单。编辑状态下右上角直接显示“完成编辑”，点击即可退出并恢复“…”按钮。已按要求移除导出与恢复入口；现有本地账单不会删除，清理浏览器网站数据会丢失本地账单。

## 发布到 GitHub Pages

当前项目与 GitHub 上的旧版 `iuggs4/personal-ledger` 独立，使用独立公开仓库 `iuggs4/quick-record` 发布。旧版使用 localStorage，本项目使用 IndexedDB，两版账单不会自动迁移；本地文件预览中的账单也不会自动带到线上地址。

网站无需构建或业务后端。仓库提交程序、图标和文档；`.gitignore` 排除本机 Codex 配置，`.nojekyll` 让 Pages 直接发布静态文件。发布资源必须包含 `index.html`、`style.css`、`app.js`、`model.js`、`storage.js`、`sw.js`、`manifest.webmanifest` 和 `icon.png`。

新建公开仓库并上传后，在仓库 Settings → Pages 选择 Deploy from a branch，分支选择上传代码的主分支，目录选择 `/ (root)` 并保存。发布成功后使用 Pages 显示的 HTTPS 地址，在 iPhone Safari 打开并添加到主屏幕。

当前尚未上传、启用 Pages 或验证线上访问。操作说明参考 [GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。

## 开发接口

model.js：金额及备份校验；storage.js：事务存储；app.js：页面、系统数字键盘输入、分类、外观和账单编辑；sw.js：离线缓存。

`window.Ledger.readBills()` 返回账单副本；`addBill(bill)` 经统一校验写入；`register({id, slot, mount})` 注册随应用发布的模块。slot 为 home-cards、form-extra、bill-actions、more-menu；mount 接收容器和 Ledger 接口。扩展没有安装或远程加载机制。

账单格式：id 字符串、amount 正整数分、category 固定分类、createdAt ISO 时间字符串，type 为 expense 或 income；旧记录无 type 时按支出处理。内部备份结构校验仍识别旧版1和新版2，当前界面不提供导出或恢复操作。点击底栏加号从底部打开 Quick Add 面板，通过 Expend / Income 滑块分别保存支出与收入，日期默认今天且可另选；新增按所选日期及保存时刻记账；切换收支类型或关闭面板会清空未保存金额并显示0.0，分类保留；收入计入首页 Income 和钱包余额，不计入支出柱状图及当天花费概览。

金额与备份最小校验位于 tests/model.test.js，可用 npm test 执行。本次未执行自动测试、浏览器验收或 iPhone 实机验证。

Safari 26 的网页玻璃底栏是模拟效果。仅明确识别为 Apple 移动设备 Safari 26 且支持模糊材质时启用；主屏幕缺少版本标记或识别不明确时采用普通底栏。参考图未存放在当前目录，视觉按 PRD 文字实现。














