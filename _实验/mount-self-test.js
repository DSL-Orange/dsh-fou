// ============================================================
// 硬挂载自检（fou.mount-self-test）
// ============================================================
// 归档：2026-11-09（用户："要不要先占掉？代码单独放在，到时要用再拿回来。"）
// 来源：client.js 原 L1334–L1367
// 说明：本文件**不会被加载**（client.js 不 require 它）。要用时整段复制回去。
// 状态：已验证可用，只是从菜单里撤了。
// ------------------------------------------------------------

        // 硬挂载自检（2026-11-08）：浮游自己挂一次，证明"给盒子→画进去→收干净"这条链路。
        // 用纯 DOM 画，不依赖 react-dom —— 顺带说明"挂载点对插件是完全中立的"。
        registerDock({
          id: 'fou.mount-self-test',
          label: t('dockMountSelfTest'),
          icon: '⬚',
          mount: (container) => {
            const wrap = document.createElement('div');
            wrap.style.cssText =
              'height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
              'gap:8px;font:13px/1.7 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1f2328;' +
              'background:#fff;padding:24px;text-align:center';
            const title = document.createElement('div');
            title.textContent = t('dockMountSelfTest');
            title.style.cssText = 'font-size:16px;font-weight:600';
            const note = document.createElement('div');
            note.textContent = t('dockMountSelfTestHint');
            note.style.cssText = 'color:#6b7280;font-size:12px;max-width:420px';
            const stamp = document.createElement('div');
            stamp.textContent = 'shadow DOM · ' + new Date().toLocaleTimeString();
            stamp.style.cssText = 'color:#9ca3af;font-size:11px';
            wrap.appendChild(title);
            wrap.appendChild(note);
            wrap.appendChild(stamp);
            container.appendChild(wrap);
            return () => {
              try {
                wrap.remove();
              } catch (error) {
                /* 清理失败无所谓 */
              }
            };
          },
        });
