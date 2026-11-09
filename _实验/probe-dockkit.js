// ============================================================
// 三个 require 探针（probe-dockkit 1/2/3）
// ============================================================
// 归档：2026-11-09（用户："要不要先占掉？代码单独放在，到时要用再拿回来。"）
// 来源：client.js 原 L2965–L3056
// 说明：本文件**不会被加载**（client.js 不 require 它）。要用时整段复制回去。
// 状态：已验证可用，只是从菜单里撤了。
// ------------------------------------------------------------

        // ───────────────────────────── 探测（2026-11-08，临时）
        // 目标：查清「浮游能不能平起平坐」——
        //   · 能不能 require 到 dockkit（官方浮窗/停靠的布局套件）
        //   · ctx.layout / ctx.sidebarRight 这两个服务在不在
        // 只打 console，不改任何行为。查完就删。
        try {
          const report = { require: {}, services: {} };
          for (const name of [
            '@deepseek-ai/dsh-client-ui-dockkit',
            '@deepseek-ai/dsh-client-ui-layout',
            '@deepseek-ai/dsh-client-ui-sidebar-right',
            '@deepseek-ai/dsh-client-ui-renderer',
          ]) {
            try {
              const mod = require(name);
              report.require[name] = mod ? Object.keys(mod).slice(0, 12) : 'empty';
            } catch (error) {
              report.require[name] = 'ERR: ' + String((error && error.message) || error).slice(0, 80);
            }
          }
          for (const svc of ['layout', 'sidebarRight', 'renderer', 'dockkit']) {
            try {
              const got = ctx.get(svc);
              report.services[svc] = got
                ? 'YES (' + Object.keys(got).slice(0, 14).join(',') + ')'
                : 'undefined';
            } catch (error) {
              report.services[svc] = 'ERR: ' + String((error && error.message) || error).slice(0, 80);
            }
          }
          console.info('[fou] probe-dockkit', JSON.stringify(report));
        } catch (error) {
          console.info('[fou] probe-dockkit failed', String((error && error.message) || error));
        }

        // 探针 2（2026-11-08 临时）：把 dockkit 的**状态形状**问出来 —— 状态是这套 API 的钥匙。
        try {
          const dk = require('@deepseek-ai/dsh-client-ui-dockkit');
          const info = {
            exports: Object.keys(dk || {}),
            initial: null,
            initialErr: '',
          };
          try {
            if (typeof dk.createInitialState === 'function') {
              const st = dk.createInitialState();
              info.initial = JSON.stringify(st).slice(0, 900);
            } else {
              info.initialErr = 'no createInitialState';
            }
          } catch (error) {
            info.initialErr = String((error && error.message) || error).slice(0, 160);
          }
          info.components = {};
          for (const n of ['DockLayout', 'DockSurface', 'FloatLayer', 'DockController']) {
            const v = dk[n];
            info.components[n] = typeof v === 'function' ? 'fn/arity=' + v.length : typeof v;
          }
          console.info('[fou] probe-dockkit-2', JSON.stringify(info));
        } catch (error) {
          console.info('[fou] probe-dockkit-2 failed', String((error && error.message) || error));
        }

        // 探针 3（2026-11-08 临时）：createInitialState 到底要什么参数？
        try {
          const dk = require('@deepseek-ai/dsh-client-ui-dockkit');
          const tries = [];
          const attempt = (label, fn) => {
            try {
              const v = fn();
              tries.push(label + ' → OK ' + JSON.stringify(v).slice(0, 500));
            } catch (error) {
              tries.push(label + ' → ERR ' + String((error && error.message) || error).slice(0, 120));
            }
          };
          const minter = typeof dk.createIdMinter === 'function' ? dk.createIdMinter() : undefined;
          attempt('minter', () => dk.createInitialState(minter));
          attempt('minter()', () => dk.createInitialState(typeof dk.createIdMinter === 'function' ? dk.createIdMinter() : undefined));
          attempt('{}', () => dk.createInitialState({}));
          attempt('noarg', () => dk.createInitialState());
          if (minter && typeof minter === 'object') {
            tries.push('minter keys: ' + Object.keys(minter).join(','));
          }
          tries.push('createIdMinter arity=' + (typeof dk.createIdMinter === 'function' ? dk.createIdMinter.length : 'n/a'));
          tries.push('EMPTY_HISTORY=' + JSON.stringify(dk.EMPTY_HISTORY).slice(0, 200));
          tries.push('DOCK_ZONES=' + JSON.stringify(dk.DOCK_ZONES).slice(0, 300));
          tries.push('FLOAT_DEFAULT_SIZE=' + JSON.stringify(dk.FLOAT_DEFAULT_SIZE));
          console.info('[fou] probe-dockkit-3', JSON.stringify(tries));
        } catch (error) {
          console.info('[fou] probe-dockkit-3 failed', String((error && error.message) || error));
        }
        // ───────────────────────────── 探测结束
