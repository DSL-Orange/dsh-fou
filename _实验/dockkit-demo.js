// ============================================================
// dockkit 试验（mountDockkitDemo）
// ============================================================
// 归档：2026-11-09（用户："要不要先占掉？代码单独放在，到时要用再拿回来。"）
// 来源：client.js 原 L979–L1107
// 说明：本文件**不会被加载**（client.js 不 require 它）。要用时整段复制回去。
// 状态：已验证可用，只是从菜单里撤了。
// ------------------------------------------------------------

    // ------------------------------------------------------- dockkit 试验（2026-11-08，临时）
    //
    // 目标：用官方 `dsh-client-ui-dockkit` 渲染一棵最小的树，验证"浮游能不能同架"。
    // 它是**纯状态机 + 纯组件**：createInitialState 出树，DockLayout 画树。
    // 这份代码是探路用的，验证完就删。
    function mountDockkitDemo(container) {
      if (!container) return undefined;
      const dk = require('@deepseek-ai/dsh-client-ui-dockkit');
      const ReactDOMClient2 = require('react-dom/client');
      const root = ReactDOMClient2.createRoot(container);
      const box = document.createElement('div');
      box.style.cssText = 'height:100%;overflow:auto;background:#fff;padding:12px;' +
        'font:13px/1.7 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1f2328';
      container.appendChild(box);

      const lines = [];
      const say = (label, value) => {
        const p = document.createElement('div');
        p.style.cssText = 'margin:3px 0';
        p.textContent = label + '：' + value;
        box.appendChild(p);
        lines.push(label + '：' + value);
      };

      let state = null;
      try {
        // makeInitialTab 是「给我一个 id，还我一个 tab 对象」的回调。
        // 第一次没传它 → tabs 为空 → 树是空的（这就是上次看到的"空树"）。
        state = dk.createInitialState(dk.createIdMinter(), (tabId) => ({
          id: tabId,
          kind: 'demo',
          title: '试验 tab',
        }));
        say('初始状态（带 tab）', JSON.stringify(state).slice(0, 400));
        say('tabs 数量', String(Object.keys(state.tabs || {}).length));
        say('root 节点 tabs', JSON.stringify((state.nodes[state.rootId] || {}).tabs));
      } catch (error) {
        say('createInitialState 失败', String((error && error.message) || error));
      }

      // 用 DockController 建一个真正的控制器（它管 state + undo/redo + 通知）
      let ctrl = null;
      try {
        ctrl = new dk.DockController({
          makeInitialTab: (tabId) => ({ id: tabId, kind: 'demo', title: '控制器造的 tab' }),
          mode: 'push',
        });
        const snap = ctrl.getSnapshot();
        say('DockController 快照键', Object.keys(snap || {}).join(','));
        say('controller.state 的 tabs', JSON.stringify(Object.keys((snap && snap.state && snap.state.tabs) || {})));
      } catch (error) {
        say('DockController 构造失败', String((error && error.message) || error));
      }

      // planAddTab 的第 4 参也是函数（带字符串 zone 就报 "i is not a function"），
      // 继续猜下去成本太高。改走短路：用 DockController 上**只用 boolean** 的方法，
      // 先证明"控制器能真的改树"，plan* 的签名以后再挖。
      if (ctrl) {
        try {
          const before = ctrl.getSnapshot().state.expanded;
          ctrl.setExpanded(true);
          const after = ctrl.getSnapshot().state.expanded;
          say('setExpanded 前/后', String(before) + ' → ' + String(after) + (after === true ? '  ✅ 树被改动了' : '  ❌ 没变'));
          if (Array.isArray(ctrl.ops) || typeof ctrl.ops !== 'undefined') {
            say('控制器 ops 数量', String((ctrl.ops && ctrl.ops.length) || 0));
          }
          ctrl.setExpanded(false);
          say('再收回', String(ctrl.getSnapshot().state.expanded));
        } catch (error) {
          say('setExpanded 失败', String((error && error.message) || error).slice(0, 160));
        }
      }

      // planAddTab 签名（上一轮推定）：第2参=造tab函数，第3参=节点id，第4参=函数。
      // 第4参猜成 zone 解析器：给一个 rect/点，还一个 zone。
      if (state) {
        const paneId = state.rootId;
        const makeTab = (id) => ({ id: id || 'tabX', kind: 'demo', title: '新 tab' });
        const zoneOf = (arg) => 'center';
        const attempts = [
          ['(state, makeTab, paneId, zoneOf)', () => dk.planAddTab(state, makeTab, paneId, zoneOf)],
          ['(state, makeTab, paneId, ()=>null)', () => dk.planAddTab(state, makeTab, paneId, () => null)],
          ['(state, makeTab, paneId, ()=>zoneAt)', () => dk.planAddTab(state, makeTab, paneId, () => dk.zoneAt)],
        ];
        for (const [label, fn] of attempts) {
          try {
            const ops = fn();
            const n = Array.isArray(ops) ? ops.length : -1;
            say('planAddTab ' + label, 'len=' + n + ' → ' + JSON.stringify(ops).slice(0, 280));
            if (n > 0) {
              let next = state;
              for (const op of ops) next = dk.applyOp(next, op);
              say('  → 执行完 root.kind', String((next.nodes[next.rootId] || {}).kind));
              say('  → 执行完 tabs', JSON.stringify(Object.keys(next.tabs || {})));
            }
          } catch (error) {
            say('planAddTab ' + label + ' 抛错', String((error && error.message) || error).slice(0, 130));
          }
        }
      }

      // 真的渲染一次 DockLayout —— React 会把缺的 props 说出来
      const tryRender = (props, label) => {
        try {
          root.render(h(dk.DockLayout, props));
          say('DockLayout 渲染尝试', label + '（如果页面被替换成布局就说明成了）');
          return true;
        } catch (error) {
          say('DockLayout 渲染失败 ' + label, String((error && error.message) || error));
          return false;
        }
      };
      if (!tryRender({ state, controller: null }, 'state+controller')) {
        tryRender({ state }, 'state only');
      }

      return () => {
        try {
          root.unmount();
        } catch (error) {
          /* 试错用的，卸载失败无所谓 */
        }
        try {
          box.remove();
        } catch (error) {
          /* 同上 */
        }
      };
    }
