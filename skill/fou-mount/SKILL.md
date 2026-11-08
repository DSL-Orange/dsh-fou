---
name: fou-mount
description: 把一个 DSH 插件的界面挂进「浮游」（Fou）的开间里——浮游是 DSH 之上的悬浮容器层，能装网页、文件、以及插件交出来的 React 界面。本 skill 给的是**40 行纯新增**的接入模板 + **该不该挂**的形态判据。
whenToUse: 当用户想让自己（或别人的）DSH 插件出现在浮游的开间里；或用户问"这个插件能不能挂到浮游"；或你写了一个**侧栏面板类**插件想接进浮游时。
metadata:
  platform: web
  requires: DSH 0.2.x；插件有 client.js（`window.__ModuleLoader__.load` 形式）；浮游 `@local/dsh-courier` 已安装并启用
  verified: 2026-11-08 on DSH 0.2.2-rc.1 / Windows（速写 · 市场 · 百科 三个插件挂载成功）
---

# fou-mount · 把插件挂进浮游开间

## 一句话

> **浮游给一个**空的 Shadow Root**，你把界面画进去，返回一个 cleanup。**
> **样式自己带（shadow 隔离），别指望浮游帮你排版。**

---

## 一、先判断：**该不该挂**（这一节比代码重要）

**挂错方式的代价**：界面跑到屏幕角落、或者屏幕上出现同一个插件的两份。

| 插件形态 | 特征 | 该怎么接 | 实证 |
|---|---|---|---|
| **侧栏插件** | 面板 / 列表 / 编辑器；只在侧栏或主区出现过；**没有自己的浮窗** | ✅ **硬挂载（本 skill）** | 速写、市场、百科 —— 三发三中 |
| **浮窗插件** | 自己就是浮窗；代码里有 `position:fixed`；有球/胶囊多态 | ❌ **不要挂载**，改用 `run` 做**遥控**（给一个动作） | 地颂：挂载后跑到右下角 + 出现两个实例 |
| **多形态插件** | 同一界面能以 侧栏 / 标签页 / 浮窗 多态打开 | ⏸ **暂不支持**（协议只有两条路，装不下它） | 上下文观测（未接） |
| **第三方打包插件** | 装了但只有 `lib/`（压缩产物），没有源码 | ❌ **改不了**；等它自己支持，或只做"邀请" | dsh-context |

### 一句话判据

> # **浮窗插件 → 遥控（给动作）；侧栏插件 → 挂载（给界面）。**

**判据的实质**：**一个"已经有自己的窗口"的插件，再给它一个容器，就等于给它两个身体。**

---

## 二、三步接入

### 第 1 步 · `package.json` 加一条 peer

```json
"peerDependencies": {
  "@deepseek-ai/dsh-client-ui-layout": "^0.1.5-rc.1 || ^0.2.0-rc.1"
}
```

> 只加 peer 声明即可。**浮游的坞口是 `window.__fouDock`，不需要在 `dsh.client.inject` 里声明任何东西** —— 这就是"软依赖"：浮游不在时，你这段代码一行都不执行。

### 第 2 步 · `client.js` 顶部加一个 require

```js
window.__ModuleLoader__.load({
  id: '<你的插件名>',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ReactDOMClient = require('react-dom/client');   // ← 加这一行
    // …
```

### 第 3 步 · `apply(ctx)` 末尾加这一段（**可整段复制**）

```js
        // ------------------------------------------------- 浮游坞：硬挂载
        // 协议见浮游仓库 docs/协议-挂靠.md
        const FOU_DOCK_GLOBAL = '__fouDock';
        const FOU_DOCK_RETRY_MS = [400, 1200, 3000];
        let fouRegisteredDock = null;
        let fouTimers = [];

        function readFouDock() {
          try {
            const dock = typeof window !== 'undefined' ? window[FOU_DOCK_GLOBAL] : undefined;
            return dock && typeof dock.register === 'function' ? dock : null;
          } catch (error) {
            return null;
          }
        }

        function registerToFou() {
          const dock = readFouDock();
          if (!dock) return false;
          try {
            const accepted = dock.register({
              id: '<你的插件名>.dock',
              label: t('nav') || '<显示名>',
              icon: '📦',
              // container 是一个**空的 Shadow Root**
              mount: (container) => {
                if (!container) return undefined;
                if (!ReactDOMClient || typeof ReactDOMClient.createRoot !== 'function') {
                  throw new Error('react-dom/client 不可用');
                }
                const root = ReactDOMClient.createRoot(container);
                root.render(h(YourPanel, { t }));      // ← 换成你的主面板组件
                return () => {
                  try {
                    root.unmount();
                  } catch (error) {
                    /* 卸载失败不连累浮游 */
                  }
                };
              },
            });
            if (accepted !== false) fouRegisteredDock = dock;
            return accepted !== false;
          } catch (error) {
            return false;
          }
        }

        if (!registerToFou()) {
          fouTimers = FOU_DOCK_RETRY_MS.map((delay) =>
            window.setTimeout(() => {
              registerToFou();
            }, delay),
          );
        }
        // ⚠ 别删这段：宿主（浮游）热重载会换成一个全新的 window.__fouDock，
        //   旧注册随之作废。不重连 = 用户"关一下浮游再开"之后你的插件就消失了。
        const fouWatch = window.setInterval(() => {
          const dock = readFouDock();
          if (!dock) return;
          if (dock === fouRegisteredDock) return;
          registerToFou();
        }, 3000);
        ctx.effect(
          () => () => {
            for (const timer of fouTimers) window.clearTimeout(timer);
            window.clearInterval(fouWatch);
          },
          '<你的插件名>: fou dock registration',
        );
```

---

## 三、五条硬约束（踩过才知道）

| # | 约束 | 违反的后果 |
|---|---|---|
| **1** | **主面板组件只能依赖 `t`（或你自己能拿到的东西）** | 依赖 `ctx` 服务会 `not defined` |
| **2** | **`t` 要用 `apply` 作用域里的那个** | 写在 `factory` 作用域的函数看不到 `t`，会炸 `t is not defined` |
| **3** | **必须返回 cleanup** | 浮游关掉挂载后会残留定时器/监听器 |
| **4** | **样式自己带**（Shadow DOM 隔离，浮游不注入任何 CSS） | 界面会是无样式的裸 DOM |
| **5** | **别用 `position:fixed`** | 界面会脱离容器跑到屏幕角落（浮窗插件就是这么暴露的） |

---

## 四、排查表

| 现象 | 先查什么 | 多半是 |
|---|---|---|
| **挂靠区里没有你的插件** | Console 里 `window.__fouDock` 存不存在 | `apply` 跑在浮游发布坞口之前 —— 重试会兜住，但如果超过 3 秒还没有，检查你那段是否真的在 `apply` 里 |
| **有名字，点了是空白** | 挂载点会显示红字"这个插件没挂上：…" | `mount` 抛异常了（读红字原文） |
| **有名字，点了没反应** | 浮游侧 `console` 有没有报错 | `mount` 没返回 root，或者你的组件内部吞了异常 |
| **用着好好的，浮游重启后就没了** | 你那段 `fouWatch` 删了没 | **删了**。别删 |
| **界面跑到屏幕角落 / 出现两份** | 你的插件是不是浮窗插件 | **挂错形态** —— 改用 `run` 遥控 |
| **样式全是裸的** | 你的样式是怎么注入的 | Shadow DOM 里的 `<style>` 要你自己塞进 `container` |

---

## 五、边界（本 skill 不做）

- **不做"非源码插件"的挂载** —— 只有 `lib/` 压缩产物的插件改不了。
- **不做多形态插件的挂载** —— 协议目前只有"遥控 / 挂载"两条路。
- **不替你写样式** —— 浮游对挂载内容零样式假设。
- **不改浮游本身** —— 本 skill 只动你的插件。

---

## 六、一句话

> **浮游保证「挂得上、隔离好、清得干净」；**
> **界面长什么样，是你的事。**
