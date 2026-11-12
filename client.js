/**
 * Client half of 浮游 (Courier) — v0.1.0, send-only.
 *
 * One registration: a bar (or a collapsed bubble) in the root-scoped
 * `shell.overlay` list. The overlay layer is `position:absolute; inset:0;
 * pointer-events:none` and re-enables pointer events on its direct children, so
 * the bar only occupies its own 320px block; every other pixel of the window
 * stays clickable.
 *
 * Sending (verified against dsh-client-ui-conversation and
 * dsh-api-session-controller):
 *   retain(id, {source}) -> await ref.ready -> scope(id).conversation.send(text)
 * A root context has no session scope, so `ctx.conversation.send` would throw;
 * the scope must be addressed through `sessions.scope(id)`. The reference is
 * released in `finally`, and an unmount releases anything still in flight.
 *
 * The current session is whichever row still carries a `mainView` retention —
 * the same rule the frame title uses. Opening the plugins or market page does
 * not release it, which is exactly what makes this bar useful there.
 */
window.__ModuleLoader__.load({
  id: 'dsh-fou',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'courier';
    // 链接右键 → "在浮游中打开"：右键处理器活在这里（factory 作用域），
    // 而真正的打开动作（setSheet）活在 React 里。用一个模块级回调把两边接起来。
    // 用户在 2026-11-06 指出：要的是"直接打开"，不是"挂到列表里等我自己点"。
    let requestOpenInFou = null;
    let pendingOpenInFou = null;

    // ------------------------------------------------------- 最近打开（2026-11-07）
    //
    // 用户定名：**「最近打开」**，不叫"历史记录" ——
    // "历史"是浏览器的活（要管理、要保留多久）；"最近"只回答"我刚才看了什么"。
    // 判据（见 通用技术/阅读界面-五点手感.md + 立项-浮游开间）：**为以后的东西不进开间**，
    // 所以这里只留一个很小的入口，不弹列表、不开抽屉。
    const RECENT_KEY = 'fou.recent.v1';
    const RECENT_LIMIT = 12;
    const readRecent = () => {
      try {
        const raw = window.localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((e) => e && e.openUrl).slice(0, RECENT_LIMIT) : [];
      } catch (error) {
        return [];
      }
    };
    const writeRecent = (list) => {
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
      } catch (error) {
        /* 存不下就算了，不影响打开 */
      }
    };
    /** 记一笔：同一个 openUrl 只留最新的一条（不堆）。`mode` 决定它归哪一页的"最近"。 */
    const pushRecent = (entry) => {
      if (!entry || !entry.openUrl) return;
      const rest = readRecent().filter((old) => old.openUrl !== entry.openUrl);
      writeRecent([{ ...entry, at: Date.now() }].concat(rest));
    };

    /** 删掉一条（失效链接得能扔）。 */
    const removeRecent = (openUrl) => {
      if (!openUrl) return;
      writeRecent(readRecent().filter((old) => old.openUrl !== openUrl));
    };

    /** 从当前开间装的是什么，反推它是哪个模式（不存状态，省一次同步）。 */
    const modeOfUrl = (url) => {
      const u = String(url || '');
      if (u.indexOf('/dsh-fou/editor') === 0) return 'edit';
      if (u.indexOf('/dsh-fou/panels') === 0) return 'form';
      if (u.indexOf('/dsh-fou/view') === 0) return 'browse';
      return 'browse'; // 外站地址也算浏览
    };

    /** 按模式筛"最近"：河水不犯井水（用户 2026-11-08 定）。 */
    const readRecentFor = (mode) => {
      const want = mode || 'browse';
      return readRecent().filter((entry) => (entry.mode || 'browse') === want);
    };

    const openInFouNow = (url, title, meta) => {
      if (meta && meta.target) {
        pushRecent({ openUrl: url, title: title || url, kind: meta.kind || 'url', target: meta.target });
      }
      if (typeof requestOpenInFou === 'function') {
        try {
          requestOpenInFou(url, title);
          return true;
        } catch (error) {
          return false;
        }
      }
      // 坞还没渲染出来 → 记着，等它挂上再开
      pendingOpenInFou = { url, title };
      return false;
    };
    const SOURCE = 'courier';
    const COLLAPSE_KEY = 'dsh.courier.v1.collapsed';
    const QUEUED_MS = 2000;
    const DETAIL_LIMIT = 220;

    // ------------------------------------------------------------ dictionaries
    const zh = {
      brand: '浮游',
      me: '我',
      fou: '浮游',
      pickHint: '点击选择会话',
      follow: '跟随当前会话',
      menuPick: '选择会话…',
      menuReset: '复位位置',
      menuCollapse: '收起',
      menuDodgeOn: '躲鼠标：开（右键关菜单会跳一下）',
      menuBrowse: '浏览',
      menuBrowseHint: '回到最近打开的那一页（要看全部，用开间标题栏的 🕘）',
      menuDockOn: '挂靠',
      menuDockEmpty: '（还没有插件挂靠 —— 去插件页看看）',
      menuSetting: '设置',
      fouName: '浮游',
      fouOn: 'on（一靠近就跑）',
      fouOff: 'off',
      recentEmptyShort: '（还没浏览过东西）',
      menuDodgeOff: '躲鼠标：关',
      mockDsweTitle: 'DSWE · 试验会话',
      mockHint: '效果图：这是另一台机器上的会话，只用来展示"同框 + 颜色区分"长什么样（不可点）',
      dockHop: '跳一下（坞自检）',
      dockMountSelfTest: '硬挂载自检',
      dockMountSelfTestHint:
        '这个页面是「插件」自己画进浮游给的空盒子里的 —— 浮游只提供盒子与隔离（shadow DOM），里面长什么样归插件。',
      jumpHint: '跳转至当前会话',
      crashTitle: '浮游坏了',
      crashHint: '点 ⟳ 重新挂载；不影响会话本身',
      crashReload: '重新挂载',
      stepDown: '缩小一档',
      modeName: '形态',
      mode_orb: '圆球',
      mode_pill: '胶囊',
      mode_bar: '单条输入',
      mode_panel: '全窗',
      logName: '对话区',
      logShown: '显示',
      logHidden: '隐藏',
      park: '待飞',
      parkHint: '待飞：不发出去，停到记事本的待飞区（Ctrl+Enter）。会话名会自动附上，正文只写内容',
      parked: '已停到待飞区 ✓',
      parking: '停到待飞区…',
      parkFailed: '停飞失败',
      sheetAccept: '验收表',
      sheetPanels: '挂板',
      sheetEditor: '编辑器',
      resizeHint: '缩放角：拖它改大小（双击回出厂尺寸）',
      sheetClose: '关闭',
      sheetOpenTab: '在新标签页打开',
      sheetFill: '铺满（一键到最大）',
      recentOpen: '最近打开',
      recentRemove: '从最近里删掉',
      recentBrowse: '最近浏览',
      recentEdit: '最近编辑',
      recentForm: '最近挂表',
      modeBrowse: '浏览（纯读）',
      modeEdit: '编辑（纯写）',
      modeForm: '挂表（交互）',
      recentEmpty: '还没有最近打开的东西。右键一个链接或文件 →「在浮游打开」就会出现。',
      notified: '已通知会话 ✓',
      notifyFailed: '通知失败',
      recentJumps: '最近穿越',
      jumpGo: '直接跳到这个会话（并让浮游跟随）',
      pin: '置顶',
      unpin: '取消置顶',
      send: '发送',
      sendingShort: '送入中',
      sending: '正在送入当前会话…',
      sent: '已入队 ✓',
      hint: 'Enter 发送 · Esc 收起 · 右键更多',
      placeholder: '给当前会话发一条消息…',
      // 胶囊输入态：胶囊最小时只显示这一行，所以**发给谁必须在这儿看得见**。
      // 判据（2026-11-09）：悬浮提示是"要看才有"，占位文字是"不看也在"。
      pillInputPh: '发给「{n}」…',
      // 胶囊穿越态 / 会话列表模式（2026-11-09）
      pillCrossHint: '点一下进入会话列表（滚轮切会话）',
      pillListHint: '展开会话列表（直接选）',
      pillSlotHint: '切换应用（点一下换下一个）',
      firstRunHint: '滚轮切功能 · Shift+滚轮切应用 · 右键开间 · 对会话说「给我一份 checklist」',
      deskTitle: '桌布',
      settingsTitle: '设置',
      addNoSession: '先开一个会话，我才好替你说话',
      noSession: '没有活动会话',
      noSessionHint: '打开一个会话后，就能从这里发消息',
      noScope: '会话作用域不可用',
      noConversation: '会话服务不可用',
      failed: '发送失败',
      collapse: '收起浮游',
      expand: '展开浮游',
    };

    const en = {
      brand: 'Courier',
      me: 'You',
      fou: 'Fou',
      pickHint: 'Pick a session',
      follow: 'Follow current session',
      menuPick: 'Choose session…',
      menuReset: 'Reset position',
      menuCollapse: 'Collapse',
      menuDodgeOn: 'Dodge the mouse: on (hops when the menu closes)',
      menuBrowseHint: 'Reopen the most recent page (use 🕘 in the sheet header for all)',
      menuBrowse: 'Browse',
      menuDockOn: 'Dock',
      menuDockEmpty: '(no plugin docked yet — see the plugins page)',
      menuSetting: 'Settings',
      fouName: 'Fou',
      fouOn: 'on (runs away)',
      fouOff: 'off',
      recentEmptyShort: '(nothing browsed yet)',
      menuDodgeOff: 'Dodge the mouse: off',
      dockHop: 'Hop (dock self-test)',
      dockMountSelfTest: 'Hard mount self-test',
      dockMountSelfTestHint:
        'This page is drawn by the plugin into an empty box provided by Fou. Fou owns the box and the isolation (shadow DOM); the plugin owns what goes inside.',
      jumpHint: 'Jump to this session',
      crashTitle: 'Fou crashed',
      crashHint: 'Press ⟳ to remount; the session itself is unaffected',
      crashReload: 'Remount',
      stepDown: 'One step smaller',
      modeName: 'Size',
      mode_orb: 'Orb',
      mode_pill: 'Pill',
      mode_bar: 'Single bar',
      mode_panel: 'Panel',
      logName: 'Transcript',
      logShown: 'shown',
      logHidden: 'hidden',
      park: 'Hold',
      parkHint: 'Hold: park it in the notepad hold area (Ctrl+Enter). The session name is attached automatically — write only the body',
      parked: 'Parked ✓',
      parking: 'Parking…',
      parkFailed: 'Park failed',
      sheetAccept: 'Acceptance form',
      sheetPanels: 'Board',
      sheetEditor: 'Editor',
      resizeHint: 'Resize corner: drag to resize (double-click to reset)',
      sheetClose: 'Close',
      sheetOpenTab: 'Open in a new tab',
      sheetFill: 'Fill the window',
      recentOpen: 'Recently opened',
      recentRemove: 'Remove from recent',
      recentBrowse: 'Recent browsed',
      recentEdit: 'Recent edited',
      recentForm: 'Recent forms',
      modeBrowse: 'Browse (read only)',
      modeEdit: 'Edit (write only)',
      modeForm: 'Forms (interactive)',
      recentEmpty: 'Nothing opened yet. Right-click a link or file → "Open in Fou".',
      notified: 'Session notified ✓',
      notifyFailed: 'Notify failed',
      recentJumps: 'Recent jumps',
      jumpGo: 'Jump straight to this session (and follow it)',
      pin: 'Pin to top',
      unpin: 'Unpin',
      send: 'Send',
      sendingShort: 'Sending',
      sending: 'Sending to the current session…',
      sent: 'Queued ✓',
      hint: 'Enter to send · Esc to collapse · right-click for more',
      placeholder: 'Message the current session…',
      pillInputPh: 'To "{n}"…',
      pillCrossHint: 'Click to scrub sessions (wheel to switch)',
      pillListHint: 'Open session list (pick directly)',
      pillSlotHint: 'Switch app (click to cycle)',
      firstRunHint: 'Scroll to switch pane · Shift+scroll to switch app · Right-click for the pane · Say "give me a checklist"',
      deskTitle: 'Tablecloth',
      settingsTitle: 'Settings',
      addNoSession: 'Open a session first, then I can speak for you',
      noSession: 'No active session',
      noSessionHint: 'Open a session and you can message it from here',
      noScope: 'Session scope unavailable',
      noConversation: 'Conversation service unavailable',
      failed: 'Send failed',
      collapse: 'Collapse Courier',
      expand: 'Expand Courier',
    };

    // --------------------------------------------------------------------- CSS
    const CSS = `
.cur-dock{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:1;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary)}
.cur-dock.is-free{left:0;top:0;bottom:auto;transform:none}
.cur-head{cursor:grab;touch-action:none;user-select:none}
.cur-head:active{cursor:grabbing}
.cur-panel{position:relative;box-sizing:border-box;width:min(var(--cur-panel-w,320px),calc(100vw - 16px));height:var(--cur-panel-h,auto);overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:8px 10px 7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:color-mix(in srgb,var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff)) 88%,transparent);backdrop-filter:blur(14px);box-shadow:0 8px 24px #00000026;font-size:12px;line-height:18px}
/* 宽面板用 iframe 自己的高度，不被上面那条 height 影响 */
.cur-wide{height:auto;overflow:visible}
.cur-head{display:flex;align-items:center;gap:6px;min-width:0}
.cur-brand{flex:none;padding:0;border:0;border-radius:4px;background:0 0;color:inherit;font:inherit;font-weight:600;line-height:inherit;letter-spacing:.02em;cursor:pointer}
.cur-brand:hover{text-decoration:underline;text-underline-offset:2px}
.cur-target{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}
.cur-fold,.cur-jump{flex:none;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;display:grid;place-items:center}
.cur-fold:hover,.cur-jump:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cur-mode.on{background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
/* 最近打开：一个很轻的下拉，不是抽屉、不是左栏（2026-11-07） */
.cur-recent{position:absolute;top:32px;right:6px;z-index:6;min-width:240px;max-width:min(420px,86%);max-height:min(320px,60vh);overflow:auto;padding:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:0 10px 28px rgba(0,0,0,.14)}
.cur-recent-item{display:flex;flex-direction:column;gap:1px;width:100%;padding:6px 9px;border:0;border-radius:7px;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.cur-recent-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cur-recent-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:1.4}
.cur-recent-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:1.35}
.cur-recent-tip{padding:9px 10px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
.cur-recent-row{display:flex;align-items:stretch;gap:2px}
.cur-recent-row .cur-recent-item{flex:1 1 auto;min-width:0}
.cur-recent-del{flex:none;width:22px;padding:0;border:0;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer;opacity:0}
.cur-recent-row:hover .cur-recent-del{opacity:.75}
.cur-recent-del:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);opacity:1}
.cur-row{display:flex;align-items:center;gap:6px;min-width:0}
.cur-input{box-sizing:border-box;flex:1 1 auto;min-width:0;height:28px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:0 0;color:inherit;font:inherit;font-size:12px;outline:none}
.cur-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.cur-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.cur-input:disabled{opacity:.55;cursor:not-allowed}
.cur-send{flex:none;height:28px;padding:0 11px;border:0;border-radius:8px;background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.cur-send:disabled{opacity:.4;cursor:default}
.cur-park{flex:none;height:28px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.cur-park:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.cur-park:disabled{opacity:.35;cursor:default}
.cur-note{min-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.cur-log{max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;margin:0 0 8px 0;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.035));font-size:12px;line-height:1.5}
/* 面板被设了高度之后，对话区要撑满剩下的空间 —— 否则下面一大片空白（"下巴"，用户 2026-11-05 图一） */
.cur-dock[data-sized='1'] .cur-log{max-height:none;flex:1 1 auto;min-height:0}
/* 拖窄时藏掉次要信息，别挤成一团（用户 2026-11-05 图五） */
.cur-dock[data-narrow='1'] .cur-time{display:none}
.cur-dock[data-narrow='1'] .cur-go{width:24px}
.cur-line{display:flex;gap:6px;min-width:0}
.cur-who{flex:none;opacity:.6;font-weight:600}
.cur-line[data-who=me] .cur-who{color:var(--dsw-alias-label-secondary,#666)}
.cur-target{background:none;border:0;padding:0 4px;cursor:pointer;font:inherit;color:inherit;opacity:.72;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cur-target:hover{opacity:1}
.cur-picker{max-height:min(52vh,440px);overflow-y:auto;margin:0 0 8px 0;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));background:var(--dsw-alias-bg-layer-1,#fff)}
.cur-group{margin-bottom:2px}
.cur-pick{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;border-radius:6px;background:none;text-align:left;font:inherit;font-size:12px;color:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cur-pick:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.cur-pick.is-on{background:var(--dsw-alias-state-business-tertiary,rgba(0,0,0,.07));font-weight:600}
.cur-pick-row{display:flex;align-items:center;gap:2px}
.cur-pick-row .cur-pick{flex:1;min-width:0}
.cur-pin{flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:none;color:inherit;font-size:11px;line-height:1;cursor:pointer;opacity:.35;display:grid;place-items:center}
.cur-pin:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.cur-pin.is-on{opacity:1}
.cur-go{flex:none;width:30px;text-align:right;font-size:10px;line-height:1;font-variant-numeric:tabular-nums;opacity:.4;display:inline-flex;align-items:center;justify-content:flex-end;gap:1px}
.cur-go.is-live{width:30px;height:22px;padding:0;border:0;border-radius:6px;background:none;color:inherit;font-family:inherit;cursor:pointer;opacity:.55}
.cur-go.is-live:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.cur-go.is-hot{opacity:.95;color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}
.cur-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#bbb);opacity:.55}
.cur-dot[data-status=run]{background:var(--dsw-alias-state-success-primary,#0d9458);opacity:1;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary,#0d9458) 22%,transparent)}
.cur-dot[data-status=wait]{background:var(--dsw-alias-state-warning-primary,#d99a00);opacity:1}
.cur-dot[data-status=done]{background:var(--dsw-alias-label-tertiary,#aaa);opacity:.7}
.cur-dot[data-status=idle]{opacity:.3}
.cur-pick-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 效果图：另一来源的行（2026-11-08）—— 蓝，不可点，明显是样本 */
.cur-pick-row[data-mock='1'] .cur-pick{color:#1d4ed8;cursor:default;background:rgba(29,78,216,.06);border:.5px solid rgba(29,78,216,.25)}
.cur-pick-row[data-mock='1'] .cur-pick:hover{background:rgba(29,78,216,.1)}
.cur-pick-row[data-mock='1'] .cur-dot{background:#1d4ed8;box-shadow:0 0 0 2px rgba(29,78,216,.18)}
.cur-pick-row[data-mock='1'] .cur-pick-title::after{content:' · 效果图';font-size:10.5px;opacity:.65}
.cur-time{flex:none;font-size:10px;opacity:.5;font-variant-numeric:tabular-nums;margin-left:6px}
.cur-tunnel{display:flex;flex-wrap:nowrap;overflow-x:auto;align-items:center;gap:4px;padding:6px 6px 8px;margin-bottom:4px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));scrollbar-width:none}
.cur-tunnel::-webkit-scrollbar{display:none}
.cur-tunnel-label{font-size:10px;opacity:.5;margin-right:2px;white-space:nowrap;flex:none}
.cur-chip{max-width:88px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:0 0;color:inherit;font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.cur-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.cur-run{flex:none;font-size:9px;color:var(--dsw-alias-state-success-primary,#0d9458)}
.cur-follow{opacity:.75;font-style:italic}
.cur-layer{position:fixed;inset:0;z-index:2}
.cur-backdrop{position:absolute;inset:0;background:transparent}
.cur-menu{position:fixed;min-width:152px;padding:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 10px 28px #0000002e;z-index:3}
.cur-menu-item{display:block;width:100%;padding:6px 10px;border:0;border-radius:6px;background:none;text-align:left;font:inherit;font-size:12px;color:inherit;cursor:pointer;white-space:nowrap}
.cur-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.cur-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.08))}
/* 三分区（2026-11-08）：功能 / 挂靠 / 设置 —— 分区标签很轻，只用字号与透明度区分 */
.cur-menu-sec{padding:5px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;letter-spacing:.06em}
.cur-menu-item.is-sub{padding-left:20px;font-size:12px}
.cur-menu-item.is-empty{padding-left:20px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;cursor:default}
.cur-menu-item.is-empty:hover{background:0 0}
.cur-text{flex:1;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cur-note[data-kind=ok]{color:var(--dsw-alias-state-success-primary,#0d9458)}
.cur-note[data-kind=error]{color:var(--dsw-alias-state-error-primary,#d54941);white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.cur-bubble{width:40px;height:40px;padding:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:50%;background:color-mix(in srgb,var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff)) 88%,transparent);backdrop-filter:blur(14px);box-shadow:0 8px 24px #00000026;color:var(--dsw-alias-label-primary);font:inherit;font-size:17px;line-height:1;cursor:pointer;display:grid;place-items:center}
.cur-bubble:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
.cur-bubble.is-crashed{border-color:var(--dsw-alias-state-error-primary,#d54941);color:var(--dsw-alias-state-error-primary,#d54941);font-weight:700}
.cur-pill-wrap{position:relative;display:inline-flex}
.cur-pill-wrap .cur-grip{cursor:ew-resize}
.cur-pill{position:relative;box-sizing:border-box;display:flex;align-items:center;gap:8px;height:44px;min-height:44px;max-height:44px;max-width:none;width:min(var(--cur-pill-w,320px),calc(100vw - 16px));padding:0 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:22px;background:color-mix(in srgb,var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff)) 88%,transparent);backdrop-filter:blur(14px);box-shadow:0 8px 24px #00000026;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.cur-pill:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
.cur-pill-icon{flex:none;font-size:15px;opacity:.75}
/* 左栏 = 应用槽位（2026-11-09 第一步：接单形态地颂）。可点，不加边框 —— 它是一栏，不是一个按钮。 */
.cur-pill-slot{border:0;background:transparent;padding:0 2px;border-radius:8px;font:inherit;font-size:15px;line-height:1;color:inherit;cursor:pointer;opacity:.85}
.cur-pill-slot:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover));opacity:1}
.cur-pill-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}
/* 横滚（2026-11-09 用户：电视新闻底部小字那种）。
   只有放不下时才加这个类；复制一份 + translateX(-50%) = 无缝循环。 */
.cur-pill-marquee{display:inline-block;white-space:nowrap;will-change:transform;animation:cur-marquee 16s linear infinite}
@keyframes cur-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
/* 尊重"减少动态"偏好 —— 那是无障碍，不是叛逆。 */
@media (prefers-reduced-motion: reduce){.cur-pill-marquee{animation:none}}
/* 胶囊三态（2026-11-09）：零阶 = 就地。高度与 .cur-pill 一致，切态不跳。 */
.cur-pill-edit{cursor:default;padding-right:6px;gap:6px}
.cur-pill-edit:hover{background:color-mix(in srgb,var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff)) 88%,transparent)}
.cur-pill-input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;padding:0}
.cur-pill-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.cur-pill-input:disabled{opacity:.6}
.cur-pill-send{flex:none;height:30px;min-width:30px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:15px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.cur-pill-send:disabled{opacity:.45;cursor:default}
.cur-pill-send:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
.cur-pill-go{flex:none;height:22px;min-width:22px;padding:0 4px;border:0;border-radius:11px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.cur-pill-go:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
/* 会话列表模式（2026-11-09）：滚轮被"接管"了 —— 必须看得出来。
   判据：滚轮的含义由「当前模式」决定，所以模式必须**可见**。 */
/* 会话名那块「框」（2026-11-09 用户图二）：框 = "这一块可以滚"的可操作信号。 */
.cur-pill-box{flex:1;min-width:0;display:flex;align-items:center;gap:2px;height:28px;padding:0 2px 0 8px;border:1px solid var(--dsw-alias-state-business-primary,rgba(29,78,216,.45));border-radius:14px;cursor:pointer}
.cur-pill-box:hover{background:var(--dsw-alias-state-business-tertiary,rgba(29,78,216,.08))}
.cur-pill-box .cur-pill-text{opacity:1}
.cur-pill-caret{flex:none;height:22px;min-width:20px;padding:0;border:0;border-radius:11px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;cursor:pointer}
.cur-pill-caret:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
/* 下拉直达：浮层，不撑胶囊 —— 破坏的是页面，不是胶囊。 */
.cur-pill-list{position:absolute;top:calc(100% + 6px);left:0;z-index:20;box-sizing:border-box;min-width:100%;max-width:min(420px,calc(100vw - 32px));max-height:260px;overflow-y:auto;padding:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 12px 32px #00000029}
.cur-pill-list-item{display:block;width:100%;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.4;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.cur-pill-list-item:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
.cur-pill-list-item.is-on{background:var(--dsw-alias-state-business-tertiary,rgba(29,78,216,.1));font-weight:600}
.cur-pill-list-empty{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.cur-compact .cur-log{display:none}
.cur-wide{width:min(var(--cur-wide-w,760px),calc(100vw - 16px))}
.cur-frame{width:100%;height:min(var(--cur-wide-h,560px),var(--cur-wide-maxh,520px));border:0;border-radius:10px;background:#fff}
/* 硬挂载点：浮游只给一个空盒子；里面长什么样是插件的事（2026-11-08） */
.cur-mount{position:relative;flex:1 1 auto;min-height:0;height:min(var(--cur-wide-h,560px),var(--cur-wide-maxh,520px));background:#fff;border-radius:10px;overflow:auto}
.cur-mount-host{display:block;height:100%}
.cur-mount-err{padding:14px 16px;color:#b91c1c;font-size:12px}
/* 边框拖拽：右下角把手。绝对定位在自己的面板里 —— 不进 DSH 的层叠，也不碰主链路。 */
.cur-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;touch-action:none;z-index:3}
.cur-grip::after{content:'';position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid var(--dsw-alias-label-tertiary,#b0b6be);border-bottom:2px solid var(--dsw-alias-label-tertiary,#b0b6be);opacity:.5;border-bottom-right-radius:2px}
.cur-grip:hover::after{opacity:.95}
@media (prefers-reduced-motion:no-preference){.cur-panel,.cur-bubble{transition:background-color .15s ease}}
`;

    // ----------------------------------------------------------------- helpers
    const MODE_KEY = 'fou.bar.mode.v1';
    // 三档（苹果式，用户 2026-11-03 定）：球 / 胶囊 / 全窗。
    // 「单条」不是第四档 —— 它是全窗里"显不显示对话区"的开关。
    const MODES = ['orb', 'pill', 'panel'];

    // ─────────────────────────────────────────────────────────────
    // 映射表（2026-11-09）：产品结构 → 技术结构
    //
    // ⚠ 这是**纯声明**：现在**不驱动任何代码**，只是把"五个名字各自怎么画"
    //    从脑子里搬到代码里。行为与以前完全一致，零风险。
    //
    // 为什么要有它：
    //   以前代码里有三个开关（mode / sheet / logHidden）→ 组合出 12 种状态，
    //   其中只有 5 种有意义。每次加功能都要猜"我现在在哪一格"。
    //   这张表是"12 格压成 5 个名字"的第一步 —— 但**只是第一步**：
    //   让它驱动渲染，是另一次重构（判据：等它挡住你，见
    //   DSH知识库/产品调研/2026-11-09-映射表-技术结构与产品结构.md §四）。
    //
    // 字段：
    //   dom     —— 用哪个盒子（对应 CSS 类）
    //   mods    —— 在盒子上再加哪些修饰类
    //   content —— 里面装什么：none / pillPanes（会话三态）/ session（对话区）/ sheet（开间）
    //   product —— 它在产品结构图里叫什么（方便对照那张纸）
    // ─────────────────────────────────────────────────────────────
    const SURFACES = {
      orb: {
        dom: 'cur-bubble',
        mods: [],
        content: 'none',
        product: '球',
      },
      pill: {
        dom: 'cur-pill-wrap',
        mods: [],
        content: 'pillPanes',
        product: '胶囊',
      },
      pager: {
        dom: 'cur-panel',
        mods: ['cur-compact'],
        content: 'session',
        product: '呼机',
      },
      window: {
        dom: 'cur-panel',
        mods: [],
        content: 'session',
        product: '全窗',
      },
      pane: {
        dom: 'cur-panel',
        mods: ['cur-wide'],
        content: 'sheet',
        product: '开间',
      },
    };

    /** 待飞区落在记事本的哪个文件（记事本用真实 .md 存笔记）。 */
    const PARK_FILE = '待飞区.md';

    function readMode() {
      try {
        const raw = window.localStorage.getItem(MODE_KEY);
        if (MODES.indexOf(raw) >= 0) return raw;
        // Migrate the old boolean so an existing collapsed state still collapses.
        return window.localStorage.getItem(COLLAPSE_KEY) === '1' ? 'orb' : 'panel';
      } catch (error) {
        return 'panel';
      }
    }

    function saveMode(mode) {
      try {
        window.localStorage.setItem(MODE_KEY, mode);
        window.localStorage.setItem(COLLAPSE_KEY, mode === 'orb' ? '1' : '0');
      } catch (error) {
        /* storage unavailable */
      }
    }

    const LOG_KEY = 'fou.bar.loghidden.v1';

    // 胶囊三态（2026-11-09）：中键滚轮切换。
    //   message = 最近一条消息（现状）
    //   cross   = 会话名 ▾ ↗（呼机上半的缩微）
    //   input   = 输入框 + 发送（呼机下半的缩微）
    const PILL_PANES = ['message', 'cross', 'input'];
    const PILL_PANE_KEY = 'fou.pill.pane.v1';

    function readPillPane() {
      try {
        const raw = window.localStorage.getItem(PILL_PANE_KEY);
        return PILL_PANES.indexOf(raw) >= 0 ? raw : 'message';
      } catch (error) {
        return 'message';
      }
    }

    function savePillPane(pane) {
      try {
        window.localStorage.setItem(PILL_PANE_KEY, pane);
      } catch (error) {
        /* storage unavailable */
      }
    }

    function readLogHidden() {
      try {
        return window.localStorage.getItem(LOG_KEY) === '1';
      } catch (error) {
        return false;
      }
    }

    function saveLogHidden(value) {
      try {
        window.localStorage.setItem(LOG_KEY, value ? '1' : '0');
      } catch (error) {
        /* storage unavailable */
      }
    }

    function readCollapsed() {
      try {
        return window.localStorage.getItem(COLLAPSE_KEY) === '1';
      } catch (error) {
        return false;
      }
    }

    function saveCollapsed(value) {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
      } catch (error) {
        /* private mode / blocked storage: collapse still works for this mount */
      }
    }

    /** The row the frame title calls "current": the one retained by the main view. */
    function findActive(sessions) {
      if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== 'function') return null;
      let state;
      try {
        state = sessions.list.getSnapshot();
      } catch (error) {
        return null;
      }
      const byId = state && state.byId ? state.byId : {};
      for (const row of Object.values(byId)) {
        if (((row && row.retainedBy && row.retainedBy.mainView) || 0) > 0) return row;
      }
      return null;
    }

    function titleOf(row) {
      if (!row) return '';
      return row.displayTitle || row.title || row.id || '';
    }

    function describeError(error, t) {
      const raw = error && error.message ? String(error.message) : String(error || '');
      const detail = raw.trim() || String(error || '');
      const clipped = detail.length > DETAIL_LIMIT ? detail.slice(0, DETAIL_LIMIT) + '…' : detail;
      return t('failed') + '：' + clipped;
    }

    const PICK_LIMIT = 40;

    /** 穿越次数达到这个数，就提到"常用"组（自动排序的阈值）。 */
    const FREQ_BOOST = 3;

    const PIN_KEY = 'fou.bar.pins.v1';

    // 会话列表的排序方式（2026-11-12 用户从使用中提的第一条真实需求）：
    //   time   = 最近有活动（updatedAt 降序）
    //   freq   = 穿越次数（freq 降序）—— 2011-11-04 起一直是这个
    //   weight = 频次 × 时间衰减（常用且最近的最上）
    //
    // ⚠ 三种都只改 ③④ 两层 —— ① 置顶 / ② 当前会话 永远在最前。
    //   因为前两层是"人的决定"和"我在哪"，不是排序策略能动的。
    const SORT_KEY = 'fou.bar.sort.v1';
    const SORT_MODES = ['time', 'freq', 'weight'];
    // 权重的时间常数：24 小时。意思是"一天没碰，权重打对折"。
    const WEIGHT_TAU_HOURS = 24;

    function readSort() {
      try {
        const raw = window.localStorage.getItem(SORT_KEY);
        return SORT_MODES.indexOf(raw) >= 0 ? raw : 'freq';
      } catch (error) {
        return 'freq';
      }
    }

    function saveSort(value) {
      try {
        window.localStorage.setItem(SORT_KEY, value);
      } catch (error) {
        /* storage unavailable */
      }
    }

    function readPins() {
      try {
        const raw = window.localStorage.getItem(PIN_KEY);
        const value = raw ? JSON.parse(raw) : [];
        return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
      } catch (error) {
        return [];
      }
    }

    function savePins(pins) {
      try {
        window.localStorage.setItem(PIN_KEY, JSON.stringify(pins));
      } catch (error) {
        /* storage unavailable */
      }
    }

    const JUMP_KEY = 'fou.bar.jumps.v3';
    const JUMP_LIMIT = 60;

    /**
     * 穿越记账 v3：**记边，不记点**（`[{ from, to, at }]`）。
     *
     * 为什么改：用户 2026-11-04 指出 —— "跳过去之后你就在那儿了，连跳同一个目标
     * 必须先往返"。所以真实发生的是 A→B→A 这样的一条条**边**；按"节点被访问次数"
     * 统计永远上不去。这和 `n×n` 邻接矩阵是同一个对象。
     *
     * `from` 允许为空（主视图不在任何会话时，比如停在插件页）。
     */
    function readJumps() {
      try {
        const value = JSON.parse(window.localStorage.getItem(JUMP_KEY) || '[]');
        if (!Array.isArray(value)) return [];
        return value
          .filter((item) => item && typeof item.to === 'string')
          .map((item) => ({
            from: typeof item.from === 'string' ? item.from : '',
            to: item.to,
            at: typeof item.at === 'number' ? item.at : 0,
          }));
      } catch (error) {
        return [];
      }
    }

    function saveJumps(list) {
      try {
        window.localStorage.setItem(JUMP_KEY, JSON.stringify(list));
      } catch (error) {
        /* storage unavailable */
      }
    }

    // ---- 面板尺寸（出厂尺寸即默认：普通 320 宽 / 宽面板 760×560） ----
    const PANEL_W_KEY = 'fou.bar.panelw.v1';
    const WIDE_SIZE_KEY = 'fou.bar.widesize.v1';
    const PANEL_W_DEFAULT = 320;
    const WIDE_W_DEFAULT = 760;
    const WIDE_H_DEFAULT = 560;

    function readPanelWidth() {
      try {
        const n = Number(window.localStorage.getItem(PANEL_W_KEY));
        return Number.isFinite(n) && n >= 240 ? Math.round(n) : PANEL_W_DEFAULT;
      } catch (error) {
        return PANEL_W_DEFAULT;
      }
    }

    function savePanelWidth(w) {
      try {
        window.localStorage.setItem(PANEL_W_KEY, String(w));
      } catch (error) {
        /* storage unavailable */
      }
    }

    function readWideSize() {
      try {
        const raw = JSON.parse(window.localStorage.getItem(WIDE_SIZE_KEY) || 'null');
        const w = raw && Number.isFinite(raw.w) && raw.w >= 320 ? Math.round(raw.w) : WIDE_W_DEFAULT;
        const h = raw && Number.isFinite(raw.h) && raw.h >= 220 ? Math.round(raw.h) : WIDE_H_DEFAULT;
        return { w, h };
      } catch (error) {
        return { w: WIDE_W_DEFAULT, h: WIDE_H_DEFAULT };
      }
    }

    function saveWideSize(size) {
      try {
        window.localStorage.setItem(WIDE_SIZE_KEY, JSON.stringify(size));
      } catch (error) {
        /* storage unavailable */
      }
    }

    // 全窗还能纵向拖（null = 内容自适应，出厂状态）；胶囊只横不纵。
    const PANEL_H_KEY = 'fou.bar.panelh.v1';
    const PILL_W_KEY = 'fou.bar.pillw.v1';
    const PILL_W_DEFAULT = 320;

    function readPanelHeight() {
      try {
        const n = Number(window.localStorage.getItem(PANEL_H_KEY));
        if (!Number.isFinite(n) || n < 200) return null;
        // 存的值可能比当前视口还高（换屏幕/缩放后）—— 读的时候就夹一次，
        // 否则一打开就把面板底部顶到任务栏后面、拖不回来（用户 2026-11-05 图四的隐患）。
        const cap = Math.max(140, Math.round(window.innerHeight - TOP_SAFE - 8));
        return Math.min(Math.round(n), cap);
      } catch (error) {
        return null;
      }
    }

    function savePanelHeight(h) {
      try {
        if (h === null) window.localStorage.removeItem(PANEL_H_KEY);
        else window.localStorage.setItem(PANEL_H_KEY, String(h));
      } catch (error) {
        /* storage unavailable */
      }
    }

    function readPillWidth() {
      try {
        const n = Number(window.localStorage.getItem(PILL_W_KEY));
        return Number.isFinite(n) && n >= 180 ? Math.round(n) : PILL_W_DEFAULT;
      } catch (error) {
        return PILL_W_DEFAULT;
      }
    }

    function savePillWidth(w) {
      try {
        window.localStorage.setItem(PILL_W_KEY, String(w));
      } catch (error) {
        /* storage unavailable */
      }
    }

    /**
     * 会话简称（用于待飞区里的"写给谁"）：
     * `DSH 扩展/知识库_扩展` → `_扩展`；`DeepSong Player` → `DeepSong`。
     */
    function shortName(title) {
      const raw = String(title || '').trim();
      if (raw === '') return '';
      const underscore = raw.lastIndexOf('_');
      if (underscore >= 0) {
        const tail = raw.slice(underscore).replace(/[\s/]+$/, '');
        if (tail.length > 1) return tail;
      }
      const first = raw.split(/[\s/·—-]+/).filter(Boolean)[0];
      return first || raw;
    }

    /**
     * 分层时间戳（用户 2026-11-03 定）：
     * 当天 → 时钟；昨天/前天 → 词；一周内 → 星期；同年 → 月-日；跨年 → 年-月-日。
     */
    function relTime(ms, nowMs) {
      if (!ms) return '';
      const t = new Date(ms);
      const n = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
      const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((dayOf(n) - dayOf(t)) / 86400000);
      const pad = (x) => (x < 10 ? '0' + x : String(x));
      if (diffDays <= 0) return pad(t.getHours()) + ':' + pad(t.getMinutes());
      if (diffDays === 1) return '昨天';
      if (diffDays === 2) return '前天';
      if (diffDays < 7) return '周' + '日一二三四五六'[t.getDay()];
      if (t.getFullYear() === n.getFullYear()) return t.getMonth() + 1 + '-' + t.getDate();
      return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
    }

    /** 取一个会话投影的值（行里可能是 {val} 或裸值，两种都兼容）。 */
    function projectionVal(row, name) {
      const bag = row && row.projectionValues;
      if (!bag) return null;
      const entry = bag[name];
      if (!entry) return null;
      return entry.val !== undefined ? entry.val : entry;
    }

    /**
     * 状态点（照抄调度总台的口径，数据来自 `notify` 投影，用户 2026-11-03）：
     * `pending` 非空 → 待授权；正在跑或 `open` 存在 → 运行中；有 `last` → 已完成；否则未动。
     */
    function statusOf(row) {
      const notify = projectionVal(row, 'notify');
      const pending = notify && Array.isArray(notify.pending) ? notify.pending : [];
      if (pending.length > 0) return 'wait';
      if (row && row.running) return 'run';
      if (notify && notify.open) return 'run';
      if (notify && notify.last) return 'done';
      return 'idle';
    }

    /** 最后活动时间：优先用 notify.updatedAt，退回行里的 updatedAt。 */
    function lastAt(row) {
      const notify = projectionVal(row, 'notify');
      return (notify && notify.updatedAt) || (row && row.updatedAt) || 0;
    }

    const STATUS_TEXT = { run: '运行中', wait: '待授权', done: '已完成', idle: '未动' };

    /**
     * Sessions for the picker — 微信式（用户 2026-11-03 定）：一个平铺列表，
     * 按最后活动时间倒序，置顶的排最前；**不按工作区分组**（要按工作区找，
     * 去左侧栏）。子会话不出现在这里 —— 那不是跟人说话的地方。
     */
    function pickerRows(sessions, pins, activeId, freq, sortMode) {
      let snapshot;
      try {
        snapshot = sessions.list.getSnapshot();
      } catch (error) {
        return [];
      }
      const pinned = new Set(Array.isArray(pins) ? pins : []);
      const counts = freq || {};
      const byId = (snapshot && snapshot.byId) || {};
      return Object.keys(byId)
        .map((key) => byId[key])
        .filter((row) => row && row.id && row.blank !== true && row.origin !== 'subagent')
        .map((row) => ({
          id: row.id,
          title: titleOf(row),
          status: statusOf(row),
          pinned: pinned.has(row.id),
          // 四层权重，显式排序（用户 2026-11-04 定：按频率优先）：
          //   ① 优先级 = 手动置顶（人的决定，永远最上）
          //   ② 关注   = 本会话
          //   ③ 频率   = 被穿越进来的次数，多的在上（不设阈值）
          //   ④ 时间   = 同频次时按最后活动倒序
          // ① 必须在 ②③ 之前 —— 否则"我在 A 却钉着 B"时，A 会顶掉 B。
          active: Boolean(activeId) && row.id === activeId,
          freq: counts[row.id] || 0,
          updatedAt: lastAt(row),
        }))
        .sort((a, b) => {
          // ①② 永远最先 —— 它们是"人的决定"和"我在哪"，任何排序策略都不该动。
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (a.active !== b.active) return a.active ? -1 : 1;
          // ③④ 由排序方式决定（2026-11-12 用户要求可切换）。
          const mode = SORT_MODES.indexOf(sortMode) >= 0 ? sortMode : 'freq';
          if (mode === 'time') {
            // 时间：谁最近有活动谁在前。
            if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
            return b.freq - a.freq;
          }
          if (mode === 'weight') {
            // 权重：频次 ÷ (1 + 小时数/24) —— 常用且最近的最高；久没碰的会掉下去，
            // 但不会归零（因为有 +1），所以"旧爱"不会彻底消失。
            const now = Date.now();
            const wa = a.freq / (1 + Math.max(0, now - a.updatedAt) / 3600000 / WEIGHT_TAU_HOURS);
            const wb = b.freq / (1 + Math.max(0, now - b.updatedAt) / 3600000 / WEIGHT_TAU_HOURS);
            if (wb !== wa) return wb - wa;
            return b.updatedAt - a.updatedAt;
          }
          // freq（默认）：穿越次数优先，时间只在同频次时决定先后。
          if (a.freq !== b.freq) return b.freq - a.freq;
          return b.updatedAt - a.updatedAt;
        })
        .slice(0, PICK_LIMIT);
    }

    // ------------------------------------------------- 效果图：多来源同框（2026-11-08）
    //
    // 用户 2026-11-08：「DSH会话 与 DSWE 会话同框，以 黑/蓝 色系 做视觉区分。」
    // 这是**效果图**（mock），不是真接入：一条假数据，只为看清"同框"长什么样。
    // 开关：localStorage['fou.mock.multiagent.v1'] === '1'
    // 铁律：**这条永远不可点、不可穿越、不进任何账** —— 它只是一张脸。
    const MOCK_KEY = 'fou.mock.multiagent.v1';
    const mockOn = () => {
      try {
        return window.localStorage.getItem(MOCK_KEY) === '1';
      } catch (error) {
        return false;
      }
    };
    const mockRows = (t) => {
      const tt = typeof t === 'function' ? t : (key) => key;
      return mockOn()
        ? [
            {
              id: 'mock.dswe',
              title: tt('mockDsweTitle'),
              status: 'idle',
              pinned: false,
              active: false,
              freq: 0,
              updatedAt: 0,
              mock: true,
              source: 'dswe',
            },
          ]
        : [];
    };

    // ------------------------------------------------------------------- view
    const TAIL_LIMIT = 6;

    /** Join the `type:'text'` parts of a message content array. */
    function textOf(content) {
      if (!Array.isArray(content)) return '';
      const parts = [];
      for (const part of content) {
        if (!part || part.type !== 'text') continue;
        if (typeof part.text === 'string' && part.text.trim() !== '') parts.push(part.text.trim());
      }
      return parts.join('\n');
    }

    /**
     * 挑「简讯」—— 内容协议 L0（2026-11-09）。
     *
     * 为什么不是 `slice(0, 60)`：那取的是**最先出现的 60 字**，
     * 而人说话常常先寒暄（"好的""让我看看"），真正的结论在后面。
     * 所以要挑**最有信息量的那一句**，不是截最前面那一截。
     *
     * 判据（用户 2026-11-09）：**「提取」是无发言权时的做法** ——
     * 浮游对 DSH 的消息没有发言权，所以只能启发式挑，不能要求 agent 写摘要。
     */
    const BRIEF_MAX = 44;
    const BRIEF_FILLER = /^(好的|好|嗯|哦|收到|明白|了解了|没问题|让我|我看|我来|稍等|等等|稍等片刻|可以|行|对|是的|没错)/;

    function pickBrief(text) {
      const flat = previewOf(text).replace(/\s+/g, ' ').trim();
      if (flat === '') return '';
      // 按句末标点切；切不开就整段当一句。
      const parts = flat
        .split(/[。！？；\n]+/)
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (parts.length === 0) return flat.slice(0, BRIEF_MAX);
      if (parts.length === 1) {
        return flat.length > BRIEF_MAX ? flat.slice(0, BRIEF_MAX) + '…' : flat;
      }
      let best = parts[0];
      let bestScore = -Infinity;
      for (const part of parts) {
        // 太短没信息量（"好""可以"），太长一句读不完（横滚也只该滚一句）。
        let score = Math.min(part.length, 36);
        if (part.length < 6) score -= 24;
        if (BRIEF_FILLER.test(part)) score -= 30;
        if (/[0-9]/.test(part)) score += 4; // 有数字更具体
        if (score > bestScore) {
          bestScore = score;
          best = part;
        }
      }
      return best.length > BRIEF_MAX ? best.slice(0, BRIEF_MAX) + '…' : best;
    }

    /**
     * Flatten a message into readable preview text: drop the loudest markdown
     * (this log is a preview, not a renderer) and collapse blank runs.
     */
    function previewOf(text) {
      return String(text || '')
        .replace(/```[\s\S]*?```/g, '〔代码〕')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '〔图〕')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
    }

    /**
     * Last N human/assistant lines out of an event-window snapshot.
     *
     * Only `surfaceOp === 'append'` (surface.js `isAppendSurfaceEvent`) — replace
     * ops are edits, not new lines. And for `user/message` only `source.kind ===
     * 'user'` is a person typing; the rest is harness injection (time context,
     * AGENTS instructions, skill catalog, subagent receipts…).
     */
    function readTail(entries) {
      const out = [];
      const list = Array.isArray(entries) ? entries : [];
      for (const entry of list) {
        if (!entry || entry.type !== 'event') continue;
        const event = entry.event;
        if (!event || event.surfaceOp !== 'append') continue;
        if (event.type === 'user/message') {
          const data = event.data || {};
          if (!data.source || data.source.kind !== 'user') continue;
          const text = textOf(data.content);
          if (text !== '') out.push({ who: 'me', text, seq: event.seq });
        } else if (event.type === 'assistant/message') {
          const data = event.data || {};
          const text = textOf((data.message || {}).content);
          if (text !== '') out.push({ who: 'fou', text, seq: event.seq });
        }
      }
      return out.slice(-TAIL_LIMIT);
    }

    const POS_KEY = 'fou.bar.pos.v1';
    const DODGE_KEY = 'fou.bar.dodge.v1';
    const EDGE = 8;

    /**
     * 顶部安全线：DSH 窗口最上面那条（标题/菜单栏）是 **Electron 窗口拖动区**
     * （`-webkit-app-region: drag`）。拖动区在**窗口层**吞掉鼠标事件 —— 网页元素
     * 即使 z-index 更高也收不到点击，拖它等于拖整个窗口（用户 2026-11-04 实测）。
     * CSS 修不了这个，所以**不许浮游把自己放进那条带子里**。
     */
    const TOP_SAFE = 46;

    // ------------------------------------------------- 浮游功能坞（协议 v0）
    //
    // 其它插件**可选**把自己的功能挂进来。浮游只负责画右键菜单，不关心对方是谁。
    // 软依赖：没有浮游时，对方照常独立运行，只需 `window.__fouDock?.register(...)`。
    //
    // 条目形状：{ id, label, icon?, run(), mount? }
    //
    // 两条路（2026-11-08「硬挂载」）：
    //   · run()             软挂靠：一个动作（遥控 / 自己弹窗）
    //   · mount(container)  硬挂载：把界面画进浮游给的容器，**返回 cleanup**
    // 分工判据：[浮游，插件]：[硬挂载，软优化] —— 能用浮游保证，好看插件自负。
    const DOCK_GLOBAL = '__fouDock';
    const DOCK_EVENT = 'fou:dock';
    const dockEntries = [];

    function registerDock(entry) {
      if (!entry || typeof entry !== 'object') return false;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (id === '') return false;
      const record = {
        id,
        label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label : id,
        icon: typeof entry.icon === 'string' ? entry.icon : '',
        run: typeof entry.run === 'function' ? entry.run : null,
        mount: typeof entry.mount === 'function' ? entry.mount : null,
        // 简讯（2026-11-09）：插件可以报一条"当前状态"，浮游的胶囊左栏能显示它。
        // 返回 { icon, text } 或 null（null = 此刻没什么可报）。
        // 这是"应用槽位"的第一个用途 —— 胶囊从左栏 `✉` 切到插件自己的图标。
        brief: typeof entry.brief === 'function' ? entry.brief : null,
      };
      const index = dockEntries.findIndex((item) => item.id === id);
      if (index >= 0) dockEntries[index] = record;
      else dockEntries.push(record);
      try {
        window.dispatchEvent(new CustomEvent(DOCK_EVENT));
      } catch (error) {
        /* no listeners yet */
      }
      return true;
    }

    function publishDock() {
      try {
        window[DOCK_GLOBAL] = {
          version: 0,
          register: registerDock,
          list: () => dockEntries.slice(),
        };
      } catch (error) {
        /* window unavailable */
      }
    }

    function readDodge() {
      try {
        return window.localStorage.getItem(DODGE_KEY) === '1';
      } catch (error) {
        return false;
      }
    }

    function writeDodge(value) {
      try {
        window.localStorage.setItem(DODGE_KEY, value ? '1' : '0');
      } catch (error) {
        /* storage unavailable */
      }
    }

    /** Saved drag position, or null for the default bottom-centre dock. */
    function loadPos() {
      try {
        const raw = window.localStorage.getItem(POS_KEY);
        if (!raw) return null;
        const value = JSON.parse(raw);
        if (!value || typeof value.x !== 'number' || typeof value.y !== 'number') return null;
        return { x: value.x, y: value.y };
      } catch (error) {
        return null;
      }
    }

    function savePos(pos) {
      try {
        if (pos) window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
        else window.localStorage.removeItem(POS_KEY);
      } catch (error) {
        /* storage unavailable — position is a nicety, never a hard failure */
      }
    }

    // ------------------------------------------------------- 硬挂载点（2026-11-08）
    //
    // 浮游只负责给一个**空的 Shadow Root**，插件把界面画进去、并返回 cleanup。
    // 分工：[浮游，插件]：[硬挂载，软优化] —— 能用浮游保证，好看插件自负。
    // Shadow DOM 让两边的 CSS 互不串味；外面再包 CourierBoundary，插件崩了不连累坞。
    function MountHost(props) {
      const ref = React.useRef(null);
      const entry = props.entry;
      const [failed, setFailed] = React.useState('');
      React.useEffect(() => {
        const host = ref.current;
        if (!host || !entry || typeof entry.mount !== 'function') return undefined;
        let shadow = host.shadowRoot;
        if (!shadow) {
          try {
            shadow = host.attachShadow({ mode: 'open' });
          } catch (error) {
            shadow = host;
          }
        }
        let cleanup = null;
        try {
          cleanup = entry.mount(shadow);
        } catch (error) {
          setFailed(String((error && error.message) || error));
        }
        return () => {
          try {
            if (typeof cleanup === 'function') cleanup();
          } catch (error) {
            /* 插件的清理失败不连累浮游 */
          }
          try {
            while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
          } catch (error) {
            /* 同上 */
          }
        };
        // entry.id 变了才重建（同 id 重新挂载会复用同一个 host）
      }, [entry && entry.id]);
      return h(
        'div',
        { className: 'cur-mount' },
        h('div', { className: 'cur-mount-host', ref }),
        failed
          ? h('div', { className: 'cur-mount-err' }, '这个插件没挂上：' + failed)
          : null,
      );
    }


    function CourierBar(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const sessions = props.sessions;
      const jump = typeof props.jump === 'function' ? props.jump : null;
      // 档位：orb（40px 球）/ pill（44px 胶囊）/ bar（单条输入）/ panel（全窗）。
      // 旧的 collapsed 只是其中一档，保留它让既有调用点不用改。
      const [mode, setMode] = React.useState(readMode);
      const collapsed = mode === 'orb';
      // 「单条 vs 全窗」= 对话区显不显示，是内容开关而不是形态档位。
      const [logHidden, setLogHidden] = React.useState(readLogHidden);
      const setCollapsed = (value) => setMode(value ? 'orb' : 'panel');
      const [draft, setDraft] = React.useState('');
      const [phase, setPhase] = React.useState('idle'); // idle | sending | queued | error
      const [failure, setFailure] = React.useState('');
      const [activeId, setActiveId] = React.useState(() => {
        const row = findActive(sessions);
        return row ? row.id : null;
      });
      const [activeTitle, setActiveTitle] = React.useState(() => titleOf(findActive(sessions)));
      // 滚轮 handler 要读"可选会话列表""跳转函数"，
      // 但它挂在 effect 里、闭包会过期 —— 所以用 ref 跟住最新的。
      // （"当前在哪个会话"复用下面已有的 activeIdRef。）
      const pickerRowsRef = React.useRef([]);
      const pillJumpRef = React.useRef(null);

      const inputRef = React.useRef(null);
      // 胶囊三态（2026-11-09）：中键滚动切换 消息 / 穿越 / 输入。
      // 零阶 = 就地 —— 不改变形态，在胶囊里完成呼机的功能。
      // 判据：胶囊三态是呼机的**分时版**（呼机=上下两半同时显示；胶囊=轮流单独显示）。
      const [pillPane, setPillPane] = React.useState(readPillPane);
      const pillPaneRef = React.useRef(pillPane);
      // 胶囊的会话下拉（2026-11-09 用户敲定）：
      //   **取消"滚轮切会话"** —— 滚轮只负责三态，否则同一个滚轮两套含义。
      //   选会话 = 点框弹列表 → 点一下直达。
      //   判据：滚轮适合相邻、列表适合直达 —— 只留一个，取列表。
      const [pillListOpen, setPillListOpen] = React.useState(false);
      const pillListRef = React.useRef(null);
      // 左栏 = 应用槽位（2026-11-09 第一步：接单形态地颂）。
      // pillApp = null 表示"浮游自己"；否则是某个坞条目的 id（如 'song.dock'）。
      // 切换只用**点击左栏**，不用滚轮 —— 滚轮已经归三态了，不能再分一个含义。
      const [pillApp, setPillApp] = React.useState(null);
      const [pillAppTick, setPillAppTick] = React.useState(0);
      // 首次教学（2026-11-10）：localStorage 里没有 fou.seen.v1 就显示一句怎么用。
      const SEEN_KEY = 'fou.seen.v1';
      const [learning, setLearning] = React.useState(() => {
        try {
          return window.localStorage.getItem(SEEN_KEY) !== '1';
        } catch (error) {
          return false;
        }
      });
      const markSeen = React.useCallback(() => {
        try {
          window.localStorage.setItem(SEEN_KEY, '1');
        } catch (error) {
          /* storage unavailable */
        }
        setLearning(false);
      }, []);
      // 横滚（2026-11-09）：简讯放不下才滚。用 ref 量真实宽度，别靠字数猜。
      const pillTextRef = React.useRef(null);
      const [pillOverflow, setPillOverflow] = React.useState(false);
      const pillWrapRef = React.useRef(null);
      // 球也要挂滚轮（2026-11-09 第 3 条：球支持滚轮切应用）。
      const bubbleRef = React.useRef(null);
      const pillEditRef = React.useRef(null);
      const timerRef = React.useRef(null);
      const mountedRef = React.useRef(true);
      const inflightRef = React.useRef(new Set());
      const sendingRef = React.useRef(false);
      const [rows, setRows] = React.useState([]);
      // null = follow the session the main view shows; an id = the user picked one.
      const pickedRef = React.useRef(null);
      const [picking, setPicking] = React.useState(false);
      // 穿越记账：最近去过谁那儿。序位是值，序位的变化率才是权重 —— 这里记变化。
      const [jumps, setJumps] = React.useState(readJumps);
      const [parking, setParking] = React.useState(false);
      const [pins, setPins] = React.useState(readPins);
      // 会话列表排序方式（2026-11-12）：time / freq / weight，存 localStorage。
      const [sortMode, setSortMode] = React.useState(readSort);
      // openSettings 在 sortMode 声明之前就会定义（render 顺序），所以走 ref。
      const sortModeRef = React.useRef(sortMode);
      sortModeRef.current = sortMode;
      // 宽面板：装一个同源页面（iframe）。这是"操作界面"的穷人版 ——
      // 不需要别的插件改协议，只要页面同源就能装进来。
      const [sheet, setSheet] = React.useState(null);
      // 「最近打开」：只在开间里出现，只回答"我刚才看了什么"（2026-11-07）
      const [recent, setRecent] = React.useState(readRecent);
      const [recentOpen, setRecentOpen] = React.useState(false);

      /** 当前开间是哪个模式 —— 由里面装的 URL 反推，不另存状态。 */
      /** 当前开间是哪个模式 —— 由里面装的 URL 反推，不另存状态。
       *  硬挂载（sheet.mount）不属于这三种，单独记 'mount'（三个图标都不亮）。 */
      const sheetMode = sheet ? (sheet.mount ? 'mount' : modeOfUrl(sheet.url)) : 'browse';

      // 桌面（2026-11-10）：右键 → 打开桌面。用 ref 让"React 之外"的右键处理器能调它。
      // ⚠ 必须**声明在使用之前** —— openDesk 一赋值就读它。
      //   2026-11-10 踩过 TDZ：`Cannot access before initialization`，
      //   整个 CourierBar 崩掉，浮游直接从页面上消失（用户："浮游坏了"）。
      const deskOpenRef = React.useRef(null);

      /** 三个模式图标点下去：换页（同一个框，换内容）。 */
      const openModeSheet = (want) => {
        const params = new URLSearchParams();
        if (activeId) {
          params.set('notify', activeId);
          params.set('notifyName', activeTitle || '');
        }
        const query = params.toString();
        const qs = query ? '?' + query : '';
        setRecentOpen(false);
        setMenuTab(null);
        if (want === 'edit') {
          const url = '/dsh-fou/editor.html' + qs;
          pushRecent({ openUrl: url, title: t('sheetEditor'), mode: 'edit', kind: 'edit', target: url });
          setSheet({ url, title: t('sheetEditor') });
          setMode('panel');
          return;
        }
        if (want === 'form') {
          const url = '/dsh-fou/panels.html' + qs;
          pushRecent({ openUrl: url, title: t('sheetPanels'), mode: 'form', kind: 'form', target: url });
          setSheet({ url, title: t('sheetPanels') });
          setMode('panel');
          return;
        }
        // browse：回到最近浏览的那一件。
        // 若一条浏览记录都没有（比如上次最后停在挂板），**关掉开间回到坞** ——
        // 否则会"点了浏览却还停在挂板"，用户会以为坏了（2026-11-08 实测）。
        const list = readRecentFor('browse');
        if (list.length > 0) {
          setSheet({ url: list[0].openUrl, title: list[0].title });
        } else {
          setSheet(null);
        }
        setMode('panel');
      };

      // ── 桌面（2026-11-10 用户："右键打开一个桌面"）
      //
      // 它是**摊开的菜单**：原来右键里藏着的（浏览/编辑/挂板/挂靠/设置），
      // 全摆在这一页的图标上。判据：**不告诉用户有什么，把东西摆出来让他看见。**
      //
      // 坞条目通过 URL 传过去（桌面是 iframe，读不到浮游的 React 状态）。
      // ⚠ URL 有长度上限，但坞条目一般 <10 个，够用。
      const openDesk = () => {
        const params = new URLSearchParams();
        if (activeId) {
          params.set('notify', activeId);
          params.set('notifyName', activeTitle || '');
        }
        const items = dockEntries
          .map((entry) => ({
            id: entry.id,
            label: entry.label || entry.id,
            icon: entry.icon || '',
          }))
          .filter((item) => item.id !== 'fou.hop');
        if (items.length > 0) params.set('dock', JSON.stringify(items));
        const qs = params.toString();
        const url = '/dsh-fou/desk.html' + (qs ? '?' + qs : '');
        setRecentOpen(false);
        setMenuTab(null);
        setSheet({ url, title: t('deskTitle') });
        setMode('panel');
      };
      deskOpenRef.current = openDesk;

      // 设置页（2026-11-10 用户第 1 条）：点 ⚙ 打开一**页**，不是一个菜单。
      // 判据：**菜单回答"能做什么"，设置页回答"现在是什么"。**
      const openSettings = () => {
        setRecentOpen(false);
        setMenuTab(null);
        setMenu(null);
        setSheet({
          url:
            '/dsh-fou/settings.html?mode=' +
            encodeURIComponent(mode) +
            '&sort=' +
            encodeURIComponent(sortModeRef.current),
          title: t('settingsTitle'),
        });
        setMode('panel');
      };

      // 把"打开这个 url"的能力交给 factory 里的链接右键处理器（它活在 React 之外）。
      // 挂载时注册，卸载时撤销；同时把"坞还没出来时收到的请求"补开一次。
      React.useEffect(() => {
        const opener = (url, title) => {
          if (typeof url !== 'string' || url === '') return;
          setSheet({ url, title: title || url.slice(0, 48) });
          setMode('panel');
        };
        if (typeof props.setOpenInFou === 'function') props.setOpenInFou(opener);
        const pending = typeof props.takePendingOpen === 'function' ? props.takePendingOpen() : null;
        if (pending) opener(pending.url, pending.title);
        return () => {
          if (typeof props.setOpenInFou === 'function') props.setOpenInFou(null);
        };
        // 只在挂载/卸载时跑一次：opener 用的是 setState，本身是稳定的。
      }, []);

      // 单击 / 双击分离：单击延迟 240ms 才执行，若第二次点击在窗口内到来就算双击。
      // 否则"双击会话名"会同时被读成两次单选开关（用户 2026-11-03 指出的冲突）。
      const clickTimersRef = React.useRef({});
      const tap = (key, single, double) => (event) => {
        const timers = clickTimersRef.current;
        if (timers[key]) {
          clearTimeout(timers[key]);
          delete timers[key];
          if (typeof double === 'function') double(event);
          return;
        }
        timers[key] = window.setTimeout(() => {
          delete timers[key];
          if (typeof single === 'function') single(event);
        }, 240);
      };

      const jumpToActive = () => jumpTo(activeId);

      /** 跳到某个会话（并记账 —— 这就是"序位的变化"）。 */
      const jumpTo = (id) => {
        if (!id || !jump) return;
        recordJump(id);
        jump(id);
      };

      /** 记一条边（from → to）。边才是真实的单位；from === to 是自环，不记。 */
      const recordJump = (to) => {
        if (!to) return;
        const fromRow = findActive(sessions);
        const from = fromRow && fromRow.id ? fromRow.id : '';
        // 自环 = 双击/点的是"我已经在的会话" —— 什么都没发生，别让它涨权重。
        if (from === to) return;
        setJumps((current) => {
          const next = [{ from, to, at: Date.now() }].concat(current).slice(0, JUMP_LIMIT);
          saveJumps(next);
          return next;
        });
      };

      const togglePin = (id) => {
        setPins((current) => {
          const next = current.indexOf(id) >= 0
            ? current.filter((item) => item !== id)
            : current.concat(id);
          savePins(next);
          return next;
        });
      };
      // Right-click menu: { x, y } in client coords, or null when closed.
      const [menu, setMenu] = React.useState(null);
      // 右键菜单三分区（功能/挂靠/设置）各自的展开状态：null | 'browse' | 'dock' | 'setting'
      const [menuTab, setMenuTab] = React.useState(null);
      // Pure charm, opt-in: hop a little when the menu is dismissed.
      const [dodge, setDodge] = React.useState(readDodge);
      // Dock entries come from other plugins; this tick re-renders when they change.
      const [dockTick, setDockTick] = React.useState(0);
      React.useEffect(() => {
        const bump = () => setDockTick((current) => current + 1);
        window.addEventListener(DOCK_EVENT, bump);
        return () => window.removeEventListener(DOCK_EVENT, bump);
      }, []);

      // Esc has to work after the focus has moved around inside the bar, so it
      // lives on the document and only acts when the bar (or its menu) is involved.
      React.useEffect(() => {
        const onDocKey = (event) => {
          if (event.key !== 'Escape') return;
          if (menu) {
            setMenu(null);
            return;
          }
          if (sheet) {
            setSheet(null);
            return;
          }
          const host = hostRef.current;
          const active = document.activeElement;
          if (host && active && host.contains(active)) {
            setCollapsed(true);
            if (inputRef.current) inputRef.current.blur();
          }
        };
        document.addEventListener('keydown', onDocKey);
        return () => document.removeEventListener('keydown', onDocKey);
        // `sheet` 与 `menu` 都只在上游声明，依赖表里写它们是安全的。
      }, [menu, sheet]);

      // Measure the box; a ResizeObserver keeps it honest through every mode change
      // so the render-time clamp below always sees the real size.
      const [boxSize, setBoxSize] = React.useState({ w: 0, h: 0 });
      React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const measure = () => {
          const w = host.offsetWidth || 0;
          const h = host.offsetHeight || 0;
          setBoxSize((current) => (current.w === w && current.h === h ? current : { w, h }));
        };
        measure();
        let observer;
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure);
          observer.observe(host);
        }
        window.addEventListener('resize', measure);
        return () => {
          if (observer) observer.disconnect();
          window.removeEventListener('resize', measure);
        };
        // Only `mode` is a dep: it is declared above, and it is what changes the size.
      }, [mode]);
      // Self-test entry: proves the dock pipeline end to end without any other plugin.
      const hopRef = React.useRef(null);
      React.useEffect(() => {
        // Assigned inside the effect on purpose: `hop` is declared further down,
        // and touching it during render would hit the temporal dead zone.
        hopRef.current = hop;
        registerDock({
          id: 'fou.hop',
          label: t('dockHop'),
          icon: '∼',
          run: () => {
            if (hopRef.current) hopRef.current();
          },
        });
      }, []);

      /** Nudge the bar a few dozen pixels away — playfulness, kept behind a switch. */
      const hop = () => {
        const host = hostRef.current;
        if (!host) return;
        const width = host.offsetWidth || 0;
        const height = host.offsetHeight || 0;
        const maxX = Math.max(EDGE, window.innerWidth - width - EDGE);
        const maxY = Math.max(EDGE, window.innerHeight - height - EDGE);
        const base = posRef.current || {
          x: Math.round((window.innerWidth - width) / 2),
          y: Math.max(EDGE, window.innerHeight - height - 18),
        };
        const jump = () => Math.round(24 + Math.random() * 40) * (Math.random() < 0.5 ? -1 : 1);
        const next = {
          x: Math.min(Math.max(EDGE, base.x + jump()), maxX),
          y: Math.min(Math.max(TOP_SAFE, base.y + jump()), maxY),
        };
        posRef.current = next;
        setPos(next);
        savePos(next);
      };

      const closeMenu = (fromBackdrop) => {
        setMenu(null);
        if (fromBackdrop && dodge) hop();
      };

      const openMenu = (event) => {
        const target = event.target;
        // Let the browser keep its own menu inside text fields (paste, spellcheck).
        if (target && typeof target.closest === 'function' && target.closest('input, textarea')) {
          return;
        }
        event.preventDefault();
        // ── 右键 = 打开桌面（2026-11-10 用户："右键打开一个桌面"）
        //
        // 原来的右键菜单被**摊开**成了桌面上的图标（浏览/编辑/挂板/插件/设置）。
        // 判据：**菜单是"告诉你有几项"，桌面是"把东西摆出来"。**
        // ——而桌面能留白，菜单不能。
        const open = deskOpenRef.current;
        if (typeof open === 'function') {
          open();
          return;
        }
        // 兜底（正常不会走到）：桌面还没挂上时，退回旧菜单
        const box = { w: 196, h: 320 };
        setMenuTab(null);
        setMenu({
          x: Math.min(event.clientX, Math.max(EDGE, window.innerWidth - box.w - EDGE)),
          y: Math.min(event.clientY, Math.max(EDGE, window.innerHeight - box.h - EDGE)),
        });
      };

      // Drag: any part of the box except the text field and the picker list.
      // A 4px threshold separates "I meant to click that button" from "I meant to
      // move the box", so buttons inside the header keep working.
      const [pos, setPos] = React.useState(loadPos);
      const posRef = React.useRef(pos);
      const dragRef = React.useRef(null);
      const hostRef = React.useRef(null);
      const justDraggedRef = React.useRef(false);

      // ---- 边框拖拽（用户 2026-11-05 定：出厂尺寸即默认，可拖、可记忆） ----
      // 只改自己的面板，不碰 DSH 主链路；找不到宿主就什么都不写（退让优先）。
      const [panelW, setPanelW] = React.useState(readPanelWidth);
      // 全窗也能**纵向**拖（用户 2026-11-05 验收 ②）；null = 保持内容自适应。
      const [panelH, setPanelH] = React.useState(readPanelHeight);
      // 胶囊/呼机**只横不纵**（用户 2026-11-05 验收 ①）：一行高的东西，纵向没意义。
      const [pillW, setPillW] = React.useState(readPillWidth);
      const [wideSize, setWideSize] = React.useState(readWideSize);
      const resizeRef = React.useRef(null);
      const lastGripTapRef = React.useRef(0);

      const startResize = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        // 双击复位：不依赖 dblclick（pointer capture 会吃它），自己计时更可靠。
        const now = Date.now();
        if (now - lastGripTapRef.current < 320) {
          lastGripTapRef.current = 0;
          event.preventDefault();
          event.stopPropagation();
          resetSize();
          return;
        }
        lastGripTapRef.current = now;
        event.preventDefault();
        event.stopPropagation();
        const host = hostRef.current;
        if (!host) return;
        const rect = host.getBoundingClientRect();
        // 宽面板的 --cur-wide-h 管的是**iframe**那一块，不是整扇窗。
        // 拿整扇窗的高度去填它，每拖一次就多算一个标题栏+内边距（"比全窗还差一点"就是这么来的）。
        const frame = host.querySelector('.cur-frame');
        const frameRect = frame ? frame.getBoundingClientRect() : null;
        resizeRef.current = {
          x: event.clientX,
          y: event.clientY,
          w: rect.width || 0,
          h: frameRect && frameRect.height > 0 ? frameRect.height : rect.height || 0,
          // 整扇窗比 iframe 多出来的那部分（标题栏 + 内边距），拖到最大时要减掉
          chrome: frameRect ? Math.max(0, (rect.height || 0) - frameRect.height) : 55,
          wide: Boolean(sheet),
          pill: !sheet && mode === 'pill',
          moved: false,
          pointerId: event.pointerId,
        };
        try {
          if (typeof host.setPointerCapture === 'function') host.setPointerCapture(event.pointerId);
        } catch (error) {
          /* capture 只是保险 */
        }
      };

      const moveResize = (event) => {
        const r = resizeRef.current;
        if (!r) return;
        event.preventDefault();
        // 真拖了才算拖：没有位移时不要改任何尺寸（否则"点一下"就会切档）
        if (!r.moved) {
          if (
            Math.abs(event.clientX - r.x) < 8 &&
            Math.abs(event.clientY - r.y) < 8
          ) {
            return;
          }
          r.moved = true;
        }
        const minW = r.wide ? 320 : 240;
        // 宽度上限：**左右边距相等**（用户 2026-11-05 图三：全窗铺满后右侧还余一截）。
        // 左边距是 EDGE，所以上限 = 视口宽 − 2×EDGE。
        const maxW = Math.max(minW, window.innerWidth - 2 * EDGE);
        // 高度上限必须**减去当前顶部位置**，否则面板底部会伸到视口外、被 Windows 任务栏挡住，
        // 然后拖不回来（用户 2026-11-05 图四）。8 = 底部留边。
        const topNow = pos ? Math.max(TOP_SAFE, pos.y) : TOP_SAFE;
        const maxH = Math.max(140, window.innerHeight - topNow - 8);
        const w = Math.round(
          Math.min(Math.max(minW, r.w + (event.clientX - r.x)), maxW),
        );
        if (r.pill) {
          // 胶囊/呼机：只横
          const w = Math.round(
            Math.min(Math.max(180, r.w + (event.clientX - r.x)), Math.max(180, maxW)),
          );
          setPillW(w);
          savePillWidth(w);
          return;
        }
        // 「收起对话区的全窗」在视觉上就是呼机 —— 高度也必须锁死，
        // 否则它会拖出"下巴"、不再像呼机（用户 2026-11-05：呼机其实是全窗的隐藏对话态）。
        // ⚠️ 必须限定 !r.wide：宽面板（挂板/编辑器）在"对话区收起"时也存在，
        //    少了这个条件，拖挂板会去改 panelW —— 挂板调不动、且宽度污染全窗/呼机。
        if (logHidden && !r.wide) {
          setPanelW(w);
          savePanelWidth(w);
          return;
        }
        if (r.wide) {
          const minH = 220;
          // iframe 的天花板 = 视口 − 顶部 − 8 − 这扇窗自己的"框"（标题栏+内边距）
          const maxFrameH = Math.max(minH, window.innerHeight - topNow - 8 - (r.chrome || 55));
          const h = Math.round(Math.min(Math.max(minH, r.h + (event.clientY - r.y)), maxFrameH));
          const next = { w, h };
          setWideSize(next);
          saveWideSize(next);
        } else {
          setPanelW(w);
          savePanelWidth(w);
          // 全窗纵向（用户 2026-11-05 定的两条）：
          //   ① 高度下限 = **保留一行对话**（不能矮到只剩输入框）
          //   ② 继续往下拖过下限就直接切呼机（拖到"没有对话"= 它本来就是呼机）
          const MIN_ONE_LINE = 120;
          const dy = event.clientY - r.y;
          const rawH = r.h + dy;
          if (dy > 8 && rawH <= MIN_ONE_LINE - 30) {
            resizeRef.current = null;
            setPanelH(null);
            savePanelHeight(null);
            toMode('pill');
            return;
          }
          const h = Math.round(Math.min(Math.max(MIN_ONE_LINE, rawH), maxH));
          setPanelH(h);
          savePanelHeight(h);
        }
      };

      const endResize = () => {
        resizeRef.current = null;
      };

      /** 双击把手 → 回到出厂尺寸（"出厂即默认"）。 */
      const resetSize = () => {
        setPanelW(PANEL_W_DEFAULT);
        savePanelWidth(PANEL_W_DEFAULT);
        setPanelH(null);
        savePanelHeight(null);
        setPillW(PILL_W_DEFAULT);
        savePillWidth(PILL_W_DEFAULT);
        const next = { w: WIDE_W_DEFAULT, h: WIDE_H_DEFAULT };
        setWideSize(next);
        saveWideSize(next);
      };

      /** 挂板一键铺满：不再靠"拖得够准"（用户 2026-11-05 连着两轮都差一丢丢）。 */
      const fillSheet = () => {
        const host = hostRef.current;
        if (!host) return;
        const rect = host.getBoundingClientRect();
        const frame = host.querySelector('.cur-frame');
        const frameRect = frame ? frame.getBoundingClientRect() : null;
        const chrome = frameRect ? Math.max(0, (rect.height || 0) - frameRect.height) : 55;
        const y = Math.max(TOP_SAFE, Math.round(rect.top || TOP_SAFE));
        const w = Math.max(320, Math.round(window.innerWidth - 2 * EDGE));
        const h = Math.max(220, Math.round(window.innerHeight - y - 8 - chrome));
        const next = { w, h };
        setWideSize(next);
        saveWideSize(next);
        setPos({ x: EDGE, y });
      };

      const dragStart = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        const target = event.target;
        if (
          target &&
          typeof target.closest === 'function' &&
          target.closest('.cur-row, .cur-picker, .cur-layer, .cur-sheet, .cur-grip, input, textarea')
        ) {
          return;
        }
        const host = hostRef.current;
        if (!host) return;
        const rect = host.getBoundingClientRect();
        dragRef.current = {
          dx: event.clientX - rect.left,
          dy: event.clientY - rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          pointerId: event.pointerId,
        };
        justDraggedRef.current = false;
      };

      const dragMove = (event) => {
        const drag = dragRef.current;
        const host = hostRef.current;
        if (!drag || !host) return;
        if (!drag.moved) {
          if (
            Math.abs(event.clientX - drag.startX) < 4 &&
            Math.abs(event.clientY - drag.startY) < 4
          ) {
            return; // still a click
          }
          drag.moved = true;
          justDraggedRef.current = true;
          try {
            if (typeof host.setPointerCapture === 'function') {
              host.setPointerCapture(drag.pointerId);
            }
          } catch (error) {
            /* capture is a nicety */
          }
        }
        const width = host.offsetWidth || 0;
        const height = host.offsetHeight || 0;
        const maxX = Math.max(EDGE, window.innerWidth - width - EDGE);
        const maxY = Math.max(EDGE, window.innerHeight - height - EDGE);
        const next = {
          x: Math.min(Math.max(EDGE, event.clientX - drag.dx), maxX),
          y: Math.min(Math.max(TOP_SAFE, event.clientY - drag.dy), maxY),
        };
        posRef.current = next;
        setPos(next);
      };

      const dragEnd = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag && drag.moved) savePos(posRef.current);
      };

      /** Swallow the click that belongs to a drag, so dragging does not also "press" it. */
      const clickGuard = (event) => {
        if (!justDraggedRef.current) return;
        justDraggedRef.current = false;
        event.stopPropagation();
        event.preventDefault();
      };

      const resetPos = () => {
        posRef.current = null;
        savePos(null);
        setPos(null);
      };

      // Follow the sessions store: the active row changes when the user switches
      // sessions, and disappears when the last reference is released.
      React.useEffect(() => {
        const sync = () => {
          if (pickedRef.current) return; // an explicit pick outranks the main view
          const row = findActive(sessions);
          setActiveId(row ? row.id : null);
          setActiveTitle(titleOf(row));
        };
        sync();
        let stop;
        try {
          stop = sessions.list.subscribe(sync);
        } catch (error) {
          stop = undefined;
        }
        return () => {
          if (typeof stop === 'function') stop();
        };
      }, [sessions]);

      // Read-only follow of the active session, alive only while the bar is open.
      // Collapsed = no subscription and no retained reference, so nothing keeps
      // a follow stream running in the background.
      React.useEffect(() => {
        if (collapsed || !activeId) {
          setRows([]);
          return undefined;
        }
        let disposed = false;
        let reference;
        let stop;
        const start = async () => {
          try {
            reference = sessions.retain(activeId, { source: SOURCE });
            inflightRef.current.add(reference);
            const binding = await reference.ready;
            if (disposed) return;
            const source = binding && binding.eventSource;
            if (!source || typeof source.getSnapshot !== 'function') return;
            const sync = () => {
              if (disposed) return;
              try {
                const snapshot = source.getSnapshot();
                setRows(readTail(snapshot && snapshot.entries));
              } catch (error) {
                /* window closed */
              }
            };
            sync();
            if (typeof source.subscribe === 'function') stop = source.subscribe(sync);
          } catch (error) {
            /* reading is a bonus; a failure must never break the send box */
          }
        };
        void start();
        return () => {
          disposed = true;
          if (typeof stop === 'function') {
            try {
              stop();
            } catch (error) {
              /* already stopped */
            }
          }
          if (reference) {
            inflightRef.current.delete(reference);
            try {
              reference.release();
            } catch (error) {
              /* already released */
            }
          }
        };
      }, [collapsed, activeId, sessions]);

      // Unmount: stop timers and release a send that is still in flight. The
      // one-shot reference has no lifetime beyond its send, so nothing else can
      // leak here.
      React.useEffect(
        () => () => {
          mountedRef.current = false;
          if (timerRef.current) clearTimeout(timerRef.current);
          for (const reference of inflightRef.current) {
            try {
              reference.release();
            } catch (error) {
              /* already released */
            }
          }
          inflightRef.current.clear();
        },
        [],
      );

      const toMode = (next) => {
        setMode(next);
        saveMode(next);
      };

      const expand = () => {
        toMode('panel');
        window.setTimeout(() => {
          if (mountedRef.current && inputRef.current) inputRef.current.focus();
        }, 0);
      };

      /** One step smaller: panel → bar → pill → orb. */
      const cycleDown = () => {
        const index = MODES.indexOf(mode);
        toMode(index <= 0 ? 'orb' : MODES[index - 1]);
        if (mode === 'panel' && inputRef.current) inputRef.current.blur();
        setPicking(false);
      };

      const collapse = () => {
        toMode('orb');
        if (inputRef.current) inputRef.current.blur();
        setPicking(false);
      };

      const pick = (row) => {
        pickedRef.current = row.id;
        setActiveId(row.id);
        setActiveTitle(row.title);
        setPicking(false);
      };

      const follow = () => {
        pickedRef.current = null;
        const row = findActive(sessions);
        setActiveId(row ? row.id : null);
        setActiveTitle(titleOf(row));
        setPicking(false);
      };

      const submit = async () => {
        const text = draft.trim();
        if (text === '' || sendingRef.current) return;

        // Send where the bar is *looking*: an explicit pick outranks the main view.
        // (Reading already honoured pickedRef; sending used to re-derive from
        // findActive, so a picked session got the answer while the view's own
        // session received the question.)
        const pinned = pickedRef.current;
        const id = pinned || activeId || ((findActive(sessions) || {}).id || null);
        if (!id) {
          setPhase('error');
          setFailure(t('noSessionHint'));
          return;
        }

        sendingRef.current = true;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setPhase('sending');
        setFailure('');

        let reference;
        try {
          reference = sessions.retain(id, { source: SOURCE });
          inflightRef.current.add(reference);
          await reference.ready;

          const scoped = sessions.scope(id);
          if (!scoped) throw new Error(t('noScope'));
          const conversation =
            typeof scoped.get === 'function' ? scoped.get('conversation') : scoped.conversation;
          if (!conversation || typeof conversation.send !== 'function') {
            throw new Error(t('noConversation'));
          }

          await conversation.send(text);

          if (!mountedRef.current) return;
          // Clear only what was sent; text typed while the send was in flight survives.
          setDraft((current) => (current.trim() === text ? '' : current));
          setPhase('queued');
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            if (mountedRef.current) setPhase((current) => (current === 'queued' ? 'idle' : current));
          }, QUEUED_MS);
        } catch (error) {
          if (mountedRef.current) {
            setPhase('error');
            setFailure(describeError(error, t));
          }
        } finally {
          sendingRef.current = false;
          if (reference) {
            inflightRef.current.delete(reference);
            try {
              reference.release();
            } catch (error) {
              /* already released on unmount */
            }
          }
        }
      };

      // 验收表提交后"通知会话"：iframe 用 postMessage 交给浮游来做。
      // 为什么不用 /dsh-dispatch/send：调度总台当前**未激活**（405），而浮游手里
      // 就有会话控制器 —— 同源消息 + 现成通道，少一个依赖。
      const notifyRef = React.useRef(null);
      // 消息回调里要用"当前会话"，但 effect 的依赖不能放进 activeId（会反复重建监听），
      // 所以按"用 ref 取最新"的老规矩来。
      const activeIdRef = React.useRef(null);
      activeIdRef.current = activeId;
      const deliverNotice = async (id, text) => {
        let reference;
        try {
          reference = sessions.retain(id, { source: SOURCE });
          inflightRef.current.add(reference);
          await reference.ready;
          const scoped = sessions.scope(id);
          if (!scoped) throw new Error(t('noScope'));
          const conversation =
            typeof scoped.get === 'function' ? scoped.get('conversation') : scoped.conversation;
          if (!conversation || typeof conversation.send !== 'function') {
            throw new Error(t('noConversation'));
          }
          await conversation.send(text);
          return true;
        } finally {
          if (reference && typeof reference.release === 'function') {
            inflightRef.current.delete(reference);
            try {
              reference.release();
            } catch (error) {
              /* already released */
            }
          }
        }
      };
      notifyRef.current = deliverNotice;

      React.useEffect(() => {
        const onMessage = (event) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data;
          if (!data || typeof data.type !== 'string') return;

          // 「在浮游浏览里再点一个链接」：页面（view.html）把点击拦下来发这里，
          // 我们**换掉开间里的这一件**，而不是开新窗口（2026-11-08，用户点名要）。
          if (data.type === 'fou:open-url') {
            const url = typeof data.url === 'string' ? data.url : '';
            if (!url) return;
            const title = typeof data.title === 'string' && data.title ? data.title : url;
            openInFouNow(url, title, { kind: 'url', target: url });
            return;
          }

          // 「设置页动了一下」（2026-11-10 用户第 1 条）：设置页是 iframe，
          // 它只负责"显示当前值 + 报动作"，真正的改动在这里做。
          if (data.type === 'fou:setting') {
            const action = typeof data.action === 'string' ? data.action : '';
            if (action === 'mode') {
              const next = typeof data.value === 'string' ? data.value : '';
              if (next === 'orb' || next === 'pill' || next === 'panel') {
                setMode(next);
                saveMode(next);
              }
              return;
            }
            if (action === 'reset') {
              resetPos();
              return;
            }
            if (action === 'collapse') {
              collapse();
              return;
            }
            return;
          }

          // 「桌面点了一个图标」（2026-11-10）：桌面是 iframe，它只负责"被点"，
          // 真正的动作在这里执行 —— 因为它要动浮游自己的状态（形态 / 开间）。
          //
          // ⚠ 只用**已存在**的函数与状态（openModeSheet / dockEntries / setSheet / setMode /
          //   setMenu / setMenuTab）。设置仍走旧菜单 —— 它是浮游自身的开关，不需要"摆出来"。
          if (data.type === 'fou:desk') {
            const action = typeof data.action === 'string' ? data.action : '';
            if (action === 'browse' || action === 'edit' || action === 'panels') {
              setMenu(null);
              setMenuTab(null);
              openModeSheet(action === 'panels' ? 'form' : action);
              return;
            }
            if (action === 'dock') {
              const id = typeof data.id === 'string' ? data.id : '';
              if (!id) return;
              const entry = dockEntries.find((item) => item && item.id === id);
              if (!entry) return;
              setMenu(null);
              setMenuTab(null);
              // 硬挂载优先（2026-11-08）：有 mount 就挂进开间，是活的界面；
              // 没有 mount 才退回 run（遥控 / 让它自己弹窗）。
              if (typeof entry.mount === 'function') {
                setSheet({ mount: entry, title: entry.label });
                setMode('panel');
                return;
              }
              if (typeof entry.run === 'function') {
                try {
                  entry.run();
                } catch (error) {
                  /* 坏条目不能弄坏桌面 */
                }
              }
              return;
            }
            if (action === 'setting') {
              openSettings();
              return;
            }
            // 排序方式（2026-11-12 用户第一需求）：设置页里改，立刻生效并记住。
            if (action === 'sort') {
              const next = typeof data.value === 'string' ? data.value : '';
              if (SORT_MODES.indexOf(next) >= 0) {
                setSortMode(next);
                saveSort(next);
              }
              return;
            }
            // ➕ 挂载插件（2026-11-10 用户第 3 条）：
            // **不写一句"你可以这样做"，而是**替他说出口**。
            // 桌布上点 ➕ → 浮游给当前会话发一条消息 → agent 收到就去做。
            // 判据：文字的引导要求用户自己做一步；界面的引导是替他把那步做了。
            if (action === 'addPlugin') {
              const id = activeIdRef.current;
              if (!id) {
                setFailure(t('addNoSession'));
                setMode('panel');
                return;
              }
              const say = notifyRef.current;
              if (typeof say === 'function') {
                void say(
                  id,
                  '浮游的桌布上还空着一个位置。帮我把插件挂上去 —— 先读 skill `fou-mount`，再按里面的模板接一个。'
                );
              }
              return;
            }
            return;
          }

          // 「记住一件东西」：编辑器的 [保存] 落稿后回报，记进"最近编辑"，
          // 让"最近"记的是**稿**，而不是"我打开过编辑器"（2026-11-08）。
          if (data.type === 'fou:remember') {
            const openUrl = typeof data.openUrl === 'string' ? data.openUrl : '';
            if (!openUrl) return;
            pushRecent({
              openUrl,
              title: typeof data.title === 'string' && data.title ? data.title : openUrl,
              mode: typeof data.mode === 'string' ? data.mode : 'browse',
              kind: typeof data.mode === 'string' ? data.mode : 'url',
              target: openUrl,
            });
            return;
          }

          // 编辑器：把写好的全文直接发到会话（不再需要发文件）。
          if (data.type === 'fou:editor-send') {
            const target = (typeof data.notify === 'string' && data.notify) || activeIdRef.current || '';
            const text = typeof data.text === 'string' ? data.text : '';
            if (target === '' || text.trim() === '') return;
            // 「正文 / 文件」两个勾选项（用户 2026-11-05：做成两个勾，默认双选）
            const mdPath = typeof data.mdPath === 'string' ? data.mdPath : '';
            const asBody = data.asBody !== false;
            const body = asBody
              ? text + (mdPath ? '\n\n─────\n原稿：' + mdPath : '')
              : '【已落稿，未贴正文】' + (mdPath || '（没有稿件路径）');
            const run = notifyRef.current;
            if (!run) return;
            run(target, body)
              .then(() => {
                setPhase('notified');
                timerRef.current = window.setTimeout(() => {
                  timerRef.current = null;
                  if (mountedRef.current) {
                    setPhase((current) => (current === 'notified' ? 'idle' : current));
                  }
                }, QUEUED_MS);
              })
              .catch((error) => {
                if (!mountedRef.current) return;
                setPhase('error');
                setFailure(t('notifyFailed') + '：' + describeError(error, t));
              });
            return;
          }

          if (data.type !== 'fou:accept-saved') return;
          const id = typeof data.notify === 'string' ? data.notify : '';
          if (id === '') return;
          if (data.notifyEnabled === false) return;
          const text =
            '【浮游 · 验收】结果已提交（' +
            (data.summary || '') +
            '）。\n文件：' +
            (data.mdPath || '') +
            '\n（打开即可看到逐项结论与三个文字区；无需回执。）';
          const run = notifyRef.current;
          if (!run) return;
          run(id, text)
            .then(() => {
              setPhase('notified');
              timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                if (mountedRef.current) {
                  setPhase((current) => (current === 'notified' ? 'idle' : current));
                }
              }, QUEUED_MS);
            })
            .catch((error) => {
              if (!mountedRef.current) return;
              setPhase('error');
              setFailure(t('notifyFailed') + '：' + describeError(error, t));
            });
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
      }, []);

      // 待飞：不发送，停到记事本的「待飞区.md」等指令（用户 2026-11-03 定）。
      // 会话原文是证词，不是草稿纸 —— 所以「待飞」走队列而不是直接插话。
      const park = async () => {
        const text = draft.trim();
        if (text === '' || parking) return;
        setParking(true);
        setPhase('parking');
        setFailure('');
        try {
          const response = await window.fetch('/dsh-notepad/capture', {
            method: 'POST',
            headers: { 'x-dsh-notepad': '1', 'content-type': 'application/json' },
            body: JSON.stringify({
              file: PARK_FILE,
              prefix: '- [ ] ',
              text,
              source: shortName(activeTitle) || 'DSH',
            }),
            credentials: 'same-origin',
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          if (!mountedRef.current) return;
          setDraft('');
          setPhase('parked');
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            if (mountedRef.current) setPhase((current) => (current === 'parked' ? 'idle' : current));
          }, QUEUED_MS);
        } catch (error) {
          if (mountedRef.current) {
            setPhase('error');
            setFailure(t('parkFailed') + '：' + describeError(error, t));
          }
        } finally {
          if (mountedRef.current) setParking(false);
        }
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (sheet) {
            setSheet(null);
            return;
          }
          collapse();
          return;
        }
        // Ctrl/Cmd+Enter = 待飞（Enter 是发送；加一个修饰键换个去处）
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void park();
          return;
        }
        if (event.key !== 'Enter') return;
        const native = event.nativeEvent || {};
        if (native.isComposing || event.keyCode === 229) return; // IME candidate selection
        event.preventDefault();
        void submit();
      };

      let noteText = t('hint');
      let noteKind = 'hint';
      if (phase === 'sending') {
        noteText = t('sending');
        noteKind = 'busy';
      } else if (phase === 'queued') {
        noteText = t('sent');
        noteKind = 'ok';
      } else if (phase === 'parked') {
        noteText = t('parked');
        noteKind = 'ok';
      } else if (phase === 'notified') {
        noteText = t('notified');
        noteKind = 'ok';
      } else if (phase === 'parking') {
        noteText = t('parking');
        noteKind = 'busy';
      } else if (phase === 'error') {
        noteText = failure || t('failed');
        noteKind = 'error';
      } else if (!activeId) {
        noteText = t('noSessionHint');
        noteKind = 'muted';
      }

      const busy = phase === 'sending';
      const canSend = Boolean(activeId) && !busy && draft.trim() !== '';
      const canPark = !busy && !parking && draft.trim() !== '';

      // 最近穿越：把账本里的 id 解析成简称（会话可能已被删，找不到就丢掉）。
      const jumpRows = (() => {
        if (jumps.length === 0) return [];
        let snapshot;
        try {
          snapshot = sessions.list.getSnapshot();
        } catch (error) {
          return [];
        }
        const byId = (snapshot && snapshot.byId) || {};
        const seen = new Set();
        const out = [];
        for (const edge of jumps) {
          if (!edge || !edge.to || seen.has(edge.to)) continue;
          seen.add(edge.to);
          const row = byId[edge.to];
          if (row) out.push({ id: edge.to, title: shortName(titleOf(row)) });
          if (out.length >= 8) break;
        }
        // 简称会撞名（`DSH 修复` 与 `DSH SA 调研` 都缩成 `DSH`）。
        // 撞了就退回完整标题（截断），只对重复的那几个生效。
        const tally = {};
        for (const item of out) tally[item.title] = (tally[item.title] || 0) + 1;
        for (const item of out) {
          if (tally[item.title] > 1) {
            const full = titleOf(byId[item.id]);
            item.title = full.length > 12 ? full.slice(0, 12) + '…' : full;
          }
        }
        return out;
      })();

      /** 入度：某个会话被"穿越进去"过几次（边计数，不是节点计数）。 */
      const freqMap = (() => {
        const map = {};
        for (const edge of jumps) {
          if (edge && edge.to) map[edge.to] = (map[edge.to] || 0) + 1;
        }
        return map;
      })();

      const latest = rows.length > 0 ? rows[rows.length - 1] : null;
      // 首次安装的一次性教学（2026-11-10「引导四格」的「用户·主动」）：
      // 装好后第一次打开，胶囊不显示"暂无会话"，而是显示一句怎么用；
      // 一滚轮就写标记，从此不再出现。**不弹窗、不打扰** —— 它只在"用户第一次看它"时说话。
      const pillText = learning
        ? t('firstRunHint')
        : latest
          ? pickBrief(latest.text) || t('hint')
          : t('hint');
      // 简讯排版（2026-11-09 用户）：开头是**会话名**，中间只留一个「·」，
      // 结尾留空隔 —— 这样滚起来每一段都像"一条信息"，有整体感。
      // 会话名太长就截短：胶囊空间有限，名字只是"定位"，不是内容。
      const pillFrom = (() => {
        const name = String(activeTitle || '').trim();
        if (name === '') return '';
        return (name.length > 10 ? name.slice(0, 10) + '…' : name) + ' · ';
      })();
      const pillLine = '▸ ' + pillFrom + pillText + ' ◂';
      // 段尾的间隔：三段全角空格。少了会粘成一条，多了滚起来像卡顿。
      const pillLoop = pillLine + '　　　' + pillLine + '　　　';

      // ── 应用槽位（2026-11-09 第一步：接单形态地颂）
      // 只认"报了 brief 的坞条目"：没有 brief 的插件没有"当前状态"可显示，
      // 不参与切换（否则点了会切到空白）。切换只用点击左栏，不用滚轮。
      const pillApps = dockEntries.filter((entry) => entry && entry.brief);
      const pillAppEntry = pillApp ? pillApps.find((entry) => entry.id === pillApp) || null : null;
      let pillAppBrief = null;
      if (pillAppEntry) {
        try {
          pillAppBrief = pillAppEntry.brief();
        } catch (error) {
          pillAppBrief = null;
        }
      }
      const pillAppIcon = pillAppEntry ? pillAppEntry.icon || '●' : '✉';
      // 停在插件应用上时，每 2 秒重渲染一次 —— 歌曲名会变，不刷新就一直是旧的。
      // ⚠ tick 不能进 deps：那会让 effect 每 2 秒重建一次 interval，越堆越多。
      const pillAppId = pillAppEntry ? pillAppEntry.id : null;
      React.useEffect(() => {
        if (!pillAppId || mode !== 'pill') return undefined;
        const timer = window.setInterval(() => setPillAppTick((n) => n + 1), 2000);
        return () => window.clearInterval(timer);
      }, [pillAppId, mode]);

      // 量宽决定滚不滚（2026-11-09）。字宽随字体/语言变，不靠字数猜。
      React.useEffect(() => {
        if (mode !== 'pill' || pillPane !== 'message') {
          setPillOverflow(false);
          return;
        }
        const el = pillTextRef.current;
        if (!el) return;
        // 先假设"不滚"渲染一次，再量：scrollWidth 是内容的自然宽，
        // clientWidth 是盒子给它的宽。超 2px 才算超（四舍五入的余量）。
        const probe = el.querySelector('.cur-pill-marquee') || el;
        setPillOverflow(probe.scrollWidth > el.clientWidth + 2);
      }, [mode, pillPane, pillLine]);

      // 滚轮 handler 要读的三样东西：当前会话、可选会话列表、跳转函数。
      // 它们每次渲染都会变（闭包会过期），所以统一灌进 ref。
      const pillRows = pickerRows(sessions, pins, activeId, freqMap, sortMode);
      activeIdRef.current = activeId;
      pickerRowsRef.current = pillRows;
      pillJumpRef.current = jumpTo;

      // 胶囊三态的滚轮切换（2026-11-09）。
      //
      // 为什么用 addEventListener 而不是 React 的 onWheel：
      //   React 给 wheel 挂的是**被动**监听，`preventDefault()` 会被忽略 ——
      //   那样滚胶囊等于滚底下的页面。要挡住，必须 { passive: false }。
      //
      // 判据（用户 2026-11-09）：**零阶 = 就地。** 滚轮换的是"胶囊里装哪一块"，
      // 不改变形态、不移动位置 —— 这就是它和左键运动（迁移）的分野。
      React.useEffect(() => {
        // 球也挂（2026-11-09 用户第 3 条）：球上滚轮切应用。
        if (mode !== 'pill' && mode !== 'orb') return undefined;
        const el = mode === 'orb' ? bubbleRef.current : pillWrapRef.current;
        if (!el) return undefined;
        const onWheel = (event) => {
          // 首次教学：任何一次滚轮都算"看过了"。
          if (learning) markSeen();
          // 列表浮层自己会滚 —— 在它的范围内**不劫持**滚轮。
          // 判据：任何"浮在上面"的可滚动区域，必须在它自己的范围内接管滚轮。
          // （否则滚列表 = 滚胶囊，列表永远滚不动。）
          const list = pillListRef.current;
          if (list && event.target instanceof Node && list.contains(event.target)) return;

          // ── 二维切换（2026-11-09 用户："横切纵切，哪个好用，得试一下"）
          //
          //   纵切（deltaY）→ 形态（信息 / 输入 / 穿越）
          //   横切（deltaX，或 Shift+滚轮）→ 应用（浮游 / 地颂 / …）
          //
          // ⚠ 现实问题：**普通鼠标没有 deltaX**，所以横切要退到 Shift+滚轮。
          //    这正是"得试一下"的东西 —— Shift+滚轮 的手感能不能接受。
          const horizontal =
            Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey === true;
          const magnitude = horizontal ? Math.abs(event.deltaX) : Math.abs(event.deltaY);
          // 触控板会一次抛出很多小 delta，太小不算"滚了一格"。
          // Shift+滚轮 时 deltaX 是 0，所以这里放行（用 deltaY 的符号判方向）。
          if (horizontal ? event.deltaX === 0 && !event.shiftKey : magnitude < 4) return;

          const step = horizontal
            ? event.deltaX > 0 || (event.deltaX === 0 && event.deltaY > 0)
              ? 1
              : -1
            : event.deltaY > 0
              ? 1
              : -1;

          // 球上没有"三态"，滚轮全给"切应用"。
          if (mode === 'orb' || horizontal) {
            if (pillApps.length === 0) return;
            event.preventDefault();
            const order = [null, ...pillApps.map((entry) => entry.id)];
            const at = order.indexOf(pillApp);
            const next = order[(at + step + order.length) % order.length];
            setPillApp(next);
            setPillAppTick((n) => n + 1);
            return;
          }

          // 纵切：切三态（2026-11-09 敲定：滚轮在胶囊上只干这一件事）。
          const index = PILL_PANES.indexOf(pillPaneRef.current);
          const next = PILL_PANES[(index + step + PILL_PANES.length) % PILL_PANES.length];
          if (next === pillPaneRef.current) return;
          event.preventDefault();
          pillPaneRef.current = next;
          setPillPane(next);
          savePillPane(next);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
      }, [mode, pillApps.length, pillApp]);

      // 切到输入态时，把光标放进胶囊里的输入框（否则用户还要再点一下）。
      React.useEffect(() => {
        pillPaneRef.current = pillPane;
        if (mode !== 'pill' || pillPane !== 'input') return;
        const el = pillEditRef.current;
        if (el) {
          try {
            el.focus();
          } catch (error) {
            /* 聚焦失败无所谓，用户点一下就行 */
          }
        }
      }, [mode, pillPane]);

      // 宽面板：一个同源页面装进浮游里（今天只有验收表，将来可以是批注表/别的）。
      const sheetBody = sheet
        ? h(
            'div',
            { className: 'cur-panel cur-wide', role: 'dialog', 'aria-label': sheet.title },
            h('div', {
              className: 'cur-grip',
              title: t('resizeHint'),
              onPointerDown: startResize,
              onPointerMove: moveResize,
              onPointerUp: endResize,
              onPointerCancel: endResize,
              onDoubleClick: resetSize,
            }),
            h(
              'div',
              { className: 'cur-head' },
              h('span', { className: 'cur-brand' }, t('brand')),
              h('span', { className: 'cur-target', title: sheet.title }, sheet.title),
              // 三个模式图标（2026-11-08）：容器的事 —— "能切到别处"是框的职责，不是阅读的。
              // 用户：浏览没有自己的顶栏（它的顶栏就是这个），所以切换键只能放在这儿。
              h(
                'button',
                {
                  className: 'cur-jump cur-mode' + (sheetMode === 'browse' ? ' on' : ''),
                  type: 'button',
                  title: t('modeBrowse'),
                  'aria-label': t('modeBrowse'),
                  onClick: () => openModeSheet('browse'),
                },
                '👁',
              ),
              h(
                'button',
                {
                  className: 'cur-jump cur-mode' + (sheetMode === 'edit' ? ' on' : ''),
                  type: 'button',
                  title: t('modeEdit'),
                  'aria-label': t('modeEdit'),
                  onClick: () => openModeSheet('edit'),
                },
                '✏️',
              ),
              h(
                'button',
                {
                  className: 'cur-jump cur-mode' + (sheetMode === 'form' ? ' on' : ''),
                  type: 'button',
                  title: t('modeForm'),
                  'aria-label': t('modeForm'),
                  onClick: () => openModeSheet('form'),
                },
                '📌',
              ),
              h(
                'button',
                {
                  className: 'cur-jump',
                  type: 'button',
                  title: t('recentOpen') + ' · ' + t('recentBrowse'),
                  'aria-label': t('recentOpen'),
                  onClick: () => {
                    // 2026-11-08 战术后撤（用户定）：🕘 只服务浏览。
                    // 编辑/挂表的"最近"需要 C(保存) + D(挂表标识) 才成立，先不给入口。
                    setRecent(readRecentFor('browse'));
                    setRecentOpen((current) => !current);
                  },
                },
                '🕘',
              ),
              h(
                'button',
                {
                  className: 'cur-jump',
                  type: 'button',
                  title: t('sheetFill'),
                  'aria-label': t('sheetFill'),
                  onClick: fillSheet,
                },
                '⤢',
              ),
              h(
                'button',
                {
                  className: 'cur-fold',
                  type: 'button',
                  title: t('sheetClose'),
                  'aria-label': t('sheetClose'),
                  onClick: () => setSheet(null),
                },
                '×',
              ),
            ),
            // 二选一（2026-11-08 硬挂载）：
            //   sheet.mount 有值 → 挂载点（插件把活界面画进 shadow root）
            //   否则           → iframe（装 URL）
            sheet.mount
              ? h(MountHost, { entry: sheet.mount, t })
              : h('iframe', {
                  className: 'cur-frame',
                  src: sheet.url,
                  title: sheet.title,
                }),
            recentOpen
              ? h(
                  'div',
                  { className: 'cur-recent', role: 'menu', 'aria-label': t('recentOpen') },
                  recent.length === 0
                    ? h('div', { className: 'cur-recent-tip' }, t('recentEmpty'))
                    : recent.map((entry) =>
                        h(
                          'div',
                          { className: 'cur-recent-row', key: entry.openUrl },
                          h(
                            'button',
                            {
                              className: 'cur-recent-item',
                              type: 'button',
                              onClick: () => {
                                setRecentOpen(false);
                                setSheet({ url: entry.openUrl, title: entry.title });
                                setMode('panel');
                              },
                            },
                            h('span', { className: 'cur-recent-name' }, entry.title || entry.openUrl),
                            h(
                              'span',
                              { className: 'cur-recent-meta' },
                              (entry.kind === 'file' ? '文件' : '链接') +
                                ' · ' +
                                (entry.target || entry.openUrl).slice(0, 70),
                            ),
                          ),
                          // 删掉这一条（2026-11-08 用户：最近里会出现失效链接，得能扔）
                          h(
                            'button',
                            {
                              className: 'cur-recent-del',
                              type: 'button',
                              title: t('recentRemove'),
                              'aria-label': t('recentRemove'),
                              onClick: (event) => {
                                event.stopPropagation();
                                removeRecent(entry.openUrl);
                                setRecent(readRecentFor('browse'));
                              },
                            },
                            '×',
                          ),
                        ),
                      ),
                )
              : null,
          )
        : null;

      // ⚠ 顺序有讲究（2026-11-09 修）：**球态必须最先判断**。
      // 之前是 `sheet` 优先，于是"打开过开间 → 切到球"时渲染的是大面板，
      // 球上的 ref 拿不到 → 滚轮监听挂不上（用户实测："切到球，滚轮没反应"）。
      // 顺带修掉一个潜在 bug：40px 的球里不该塞一个 cur-wide 的 iframe。
      const body = sheet && !collapsed
        ? sheetBody
        : collapsed
        ? h(
            'button',
            {
              className: 'cur-bubble',
              ref: bubbleRef,
              type: 'button',
              title: t('expand'),
              'aria-label': t('expand'),
              onClick: tap('bubble', expand, jumpToActive),
            },
            h('span', { 'aria-hidden': 'true' }, '✉'),
          )
        : mode === 'pill'
          ? h(
              'div',
              { className: 'cur-pill-wrap', ref: pillWrapRef, 'data-pane': pillPane },
              // 输入态：胶囊直接变成一条输入框（呼机下半的缩微）。
              // 这里必须是 div 而不是 button —— **button 里不能放 input**。
              pillPane === 'input'
                ? h(
                    'div',
                    { className: 'cur-pill cur-pill-edit' },
                    // 左栏 = **应用槽位**（2026-11-09 用户："左右栏布局是要在场的"）。
                    // 三态可以换右栏的内容，但不能换骨架 —— 骨架变了就不是"就地"了。
                    // 现在只有浮游一个应用，所以它是纯展示；将来接了地颂，
                    // 滚它/点它就切应用（见 §四·五 💊 胶囊双栏）。
                    h('span', { className: 'cur-pill-icon', 'aria-hidden': 'true' }, '✉'),
                    h('input', {
                      ref: pillEditRef,
                      className: 'cur-pill-input',
                      type: 'text',
                      value: draft,
                      disabled: !activeId,
                      placeholder: activeId
                        ? t('pillInputPh').replace('{n}', activeTitle || t('noSession'))
                        : t('noSession'),
                      title: activeTitle || '',
                      'aria-label': t('brand'),
                      spellCheck: false,
                      autoComplete: 'off',
                      onChange: (event) => setDraft(event.target.value),
                      onKeyDown: onKeyDown,
                    }),
                    h(
                      'button',
                      {
                        className: 'cur-pill-send',
                        type: 'button',
                        disabled: !canSend,
                        title: t('send'),
                        onClick: () => void submit(),
                      },
                      busy ? t('sendingShort') : '↵',
                    ),
                  )
                : h(
                    'button',
                    {
                      className: 'cur-pill',
                      type: 'button',
                      title: pillPane === 'cross' ? t('pillCrossHint') : t('expand'),
                      'aria-label': t('expand'),
                      onClick: (event) => {
                        event.stopPropagation();
                        // 停在插件应用上时，点胶囊 = 调它的 run（地颂 = 播放/暂停）。
                        // 这是"遥控"的自然延伸：应用槽位显示它的状态，点一下就操作它。
                        if (pillAppEntry) {
                          const run = pillAppEntry.run;
                          if (typeof run === 'function') run();
                          return;
                        }
                        tap('bubble', expand, jumpToActive)(event);
                      },
                    },
                    // 左栏 = 应用槽位。点它就在"浮游自己"和"报了 brief 的插件"之间轮转。
                    // ⚠ 不用滚轮 —— 滚轮已经归三态了。
                    pillApps.length > 0
                      ? h(
                          'button',
                          {
                            className: 'cur-pill-icon cur-pill-slot',
                            type: 'button',
                            title: t('pillSlotHint'),
                            'aria-label': t('pillSlotHint'),
                            onClick: (event) => {
                              event.stopPropagation();
                              const order = [null, ...pillApps.map((entry) => entry.id)];
                              const at = order.indexOf(pillApp);
                              const next = order[(at + 1) % order.length];
                              setPillApp(next);
                              setPillAppTick((n) => n + 1);
                            },
                          },
                          pillAppIcon,
                        )
                      : h('span', { className: 'cur-pill-icon', 'aria-hidden': 'true' }, '✉'),
                    // 正文区（2026-11-09）：
                    //   app      = 插件应用 —— 显示它的 brief（如歌名）
                    //   cross    = 穿越态 —— 会话名框，点整块弹列表
                    //   message  = 消息态 —— 最近的简讯
                    pillAppEntry
                      ? h(
                          'span',
                          { className: 'cur-pill-text' },
                          pillAppBrief && pillAppBrief.text ? pillAppBrief.text : t('noSession'),
                        )
                      : pillPane === 'cross'
                      ? h(
                          'span',
                          {
                            className: 'cur-pill-box',
                            role: 'button',
                            'aria-label': t('pillListHint'),
                            onClick: (event) => {
                              // 点框 = 弹会话列表（浮层），点一项直达。
                              event.stopPropagation();
                              setPillListOpen((open) => !open);
                            },
                          },
                          h('span', { className: 'cur-pill-text' }, activeTitle || t('noSession')),
                          h('span', { className: 'cur-pill-caret', 'aria-hidden': 'true' }, '▾'),
                        )
                      : h(
                          'span',
                          { className: 'cur-pill-text', ref: pillTextRef },
                          // 横滚（2026-11-09 用户：电视新闻底部小字那种）。
                          // 只有**放不下**时才滚 —— 短简讯滚起来像出故障。
                          // 复制两份 + translateX(-50%) = 无缝循环。
                          pillOverflow
                            ? h('span', { className: 'cur-pill-marquee' }, pillLoop)
                            : pillLine,
                        ),
                    pillPane === 'cross'
                      ? h(
                          'button',
                          {
                            className: 'cur-pill-go',
                            type: 'button',
                            title: t('jumpHint'),
                            'aria-label': t('jumpHint'),
                            onClick: (event) => {
                              event.stopPropagation();
                              jumpToActive();
                            },
                          },
                          '↗',
                        )
                      : null,
                  ),
              h('div', {
                className: 'cur-grip',
                title: t('resizeHint'),
                onPointerDown: startResize,
                onPointerMove: moveResize,
                onPointerUp: endResize,
                onPointerCancel: endResize,
                onDoubleClick: resetSize,
              }),
              // 下拉直达（浮层，绝对定位在胶囊下方）：40 个会话时"直接选"是硬需求。
              // 它不改变胶囊形态 —— 破坏的是页面，不是胶囊。
              pillListOpen && pillPane === 'cross'
                ? h(
                    'div',
                    { className: 'cur-pill-list', role: 'listbox', ref: pillListRef },
                    pillRows.length === 0
                      ? h('div', { className: 'cur-pill-list-empty' }, t('noSession'))
                      : pillRows.map((row) =>
                          h(
                            'button',
                            {
                              className:
                                'cur-pill-list-item' + (row.id === activeId ? ' is-on' : ''),
                              type: 'button',
                              key: row.id,
                              title: row.title,
                              onClick: (event) => {
                                event.stopPropagation();
                                setPillListOpen(false);
                                jumpTo(row.id);
                              },
                            },
                            row.title,
                          ),
                        ),
                  )
                : null,
            )
          : h(
            'div',
            {
              className: 'cur-panel' + (logHidden ? ' cur-compact' : ''),
              role: 'region',
              'aria-label': t('brand'),
            },
            h('div', {
              className: 'cur-grip',
              title: t('resizeHint'),
              onPointerDown: startResize,
              onPointerMove: moveResize,
              onPointerUp: endResize,
              onPointerCancel: endResize,
              onDoubleClick: resetSize,
            }),
            h(
              'div',
              {
                className: 'cur-head',
              },
              h(
                'button',
                {
                  className: 'cur-brand',
                  type: 'button',
                  title: t('collapse'),
                  'aria-label': t('collapse'),
                  onClick: collapse,
                },
                t('brand'),
              ),
              h(
                'button',
                {
                  className: 'cur-target',
                  type: 'button',
                  title: t('pickHint'),
                  'aria-label': t('pickHint'),
                  onClick: tap('target', () => setPicking((current) => !current), jumpToActive),
                },
                (activeTitle || t('noSession')) + ' ▾',
              ),
              jump && activeId
                ? h(
                    'button',
                    {
                      className: 'cur-jump',
                      type: 'button',
                      title: t('jumpHint'),
                      'aria-label': t('jumpHint'),
                      onClick: () => jumpToActive(),
                    },
                    '↗',
                  )
                : null,
              h(
                'button',
                {
                  // 不加 `.on` 高亮（用户 2026-11-09）：对话区展开与否一目了然，
                  // 再给明暗提示就是"用 UI 命令人做他已经知道的事"（人不是猫）。
                  className: 'cur-jump',
                  type: 'button',
                  title: t('logName') + '：' + (logHidden ? t('logHidden') : t('logShown')),
                  'aria-label': t('logName'),
                  onClick: () => {
                    // 2026-11-09 下沉（用户定）：对话区显隐**只在这个形态里生效**（呼机/全窗），
                    // 所以它住在这里，不住在全局设置。
                    // 判据：一个设置项如果只在一个形态里生效，它就该住在那形态里。
                    const next = !logHidden;
                    setLogHidden(next);
                    saveLogHidden(next);
                  },
                },
                '💬',
              ),
              h(
                'button',
                {
                  className: 'cur-fold',
                  type: 'button',
                  title: t('stepDown'),
                  'aria-label': t('stepDown'),
                  onClick: cycleDown,
                },
                '▾',
              ),
            ),
            picking
              ? h(
                  'div',
                  { className: 'cur-picker', role: 'listbox', 'aria-label': t('pickHint') },
                  h(
                    'button',
                    { className: 'cur-pick cur-follow', type: 'button', onClick: follow },
                    t('follow'),
                  ),
                  // 最近穿越过的地方 —— 虫洞需要路标（用户 2026-11-04）。
                  jumpRows.length > 0
                    ? h(
                        'div',
                        { className: 'cur-tunnel' },
                        h('span', { className: 'cur-tunnel-label' }, t('recentJumps')),
                        jumpRows.map((item) =>
                          h(
                            'button',
                            {
                              className: 'cur-chip',
                              type: 'button',
                              key: item.id,
                              title: item.title,
                              onClick: () => {
                                setPicking(false);
                                jumpTo(item.id);
                              },
                            },
                            item.title,
                          ),
                        ),
                      )
                    : null,
                  pickerRows(sessions, pins, activeId, freqMap, sortMode)
                    .concat(mockRows(t))
                    .map((row) =>
                    h(
                      'div',
                      { className: 'cur-pick-row', key: row.id, 'data-mock': row.mock ? '1' : undefined },
                      h(
                        'button',
                        {
                          className: 'cur-pick' + (row.id === activeId ? ' is-on' : ''),
                          type: 'button',
                          title: row.mock ? t('mockHint') : STATUS_TEXT[row.status] || '',
                          onClick: () => {
                            // 效果图那一行**不做任何跳转** —— 它只是一个样本。
                            if (row.mock) return;
                            pick(row);
                          },
                        },
                        h('span', {
                          className: 'cur-dot',
                          'data-status': row.status,
                          'data-source': row.source || undefined,
                          'aria-label': STATUS_TEXT[row.status] || '',
                        }),
                        h('span', { className: 'cur-pick-title' }, row.title),
                      ),
                      // 列序（用户 2026-11-04 定）：标题 → **箭头** → 时间 → 置顶。
                      // 时间戳原先塞在标题按钮内部，导致箭头跑到时间右边；
                      // 挪出来之后顺序才和"读起来"一致。
                      //
                      // **全部可点**（用户 2026-11-04 二次定）：早先按"我不在这儿"才可点，
                      // 结果主视图停在插件页/市场时，浮游跟随的那个会话变成不可跳 ——
                      // 用户回不去会话界面。工程严格在别处，不在这一格。
                      // 跳到自己那一行是空操作，且记账里自环已被过滤，不会污染频次。
                      jump
                        ? h(
                            'button',
                            {
                              className:
                                'cur-go is-live' + (row.freq >= FREQ_BOOST ? ' is-hot' : ''),
                              type: 'button',
                              title: t('jumpGo') + (row.freq ? '（穿越 ' + row.freq + ' 次）' : ''),
                              'aria-label': t('jumpGo'),
                              onClick: (event) => {
                                event.stopPropagation();
                                // 效果图那一行不穿越、**也不记账** —— 否则穿越账本里会多一条假边。
                                if (row.mock) return;
                                pick({ id: row.id, title: row.title });
                                jumpTo(row.id);
                              },
                            },
                            row.freq > 0 ? '↗' + row.freq : '↗',
                          )
                        : h(
                            'span',
                            {
                              className: 'cur-go' + (row.freq >= FREQ_BOOST ? ' is-hot' : ''),
                              title: row.freq ? '穿越 ' + row.freq + ' 次' : '',
                            },
                            row.freq > 0 ? '↗' + row.freq : '↗',
                          ),
                      row.updatedAt
                        ? h('span', { className: 'cur-time' }, relTime(row.updatedAt))
                        : null,
                      h(
                        'button',
                        {
                          className: 'cur-pin' + (row.pinned ? ' is-on' : ''),
                          type: 'button',
                          title: row.pinned ? t('unpin') : t('pin'),
                          'aria-label': row.pinned ? t('unpin') : t('pin'),
                          onClick: (event) => {
                            event.stopPropagation();
                            togglePin(row.id);
                          },
                        },
                        row.pinned ? '📌' : '⋮',
                      ),
                    ),
                  ),
                )
              : null,
            rows.length > 0
              ? h(
                  'div',
                  { className: 'cur-log', role: 'log', 'aria-label': t('brand') },
                  rows.map((row) =>
                    h(
                      'div',
                      {
                        className: 'cur-line',
                        'data-who': row.who,
                        key: String(row.seq === undefined ? row.text : row.seq),
                      },
                      h(
                        'span',
                        { className: 'cur-who' },
                        row.who === 'me' ? t('me') : t('fou'),
                      ),
                      h('span', { className: 'cur-text' }, previewOf(row.text)),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'cur-row' },
              h('input', {
                ref: inputRef,
                className: 'cur-input',
                type: 'text',
                value: draft,
                disabled: !activeId,
                placeholder: activeId ? t('placeholder') : t('noSession'),
                'aria-label': t('brand'),
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: onKeyDown,
              }),
              h(
                'button',
                {
                  className: 'cur-park',
                  type: 'button',
                  disabled: !canPark,
                  title: t('parkHint'),
                  'aria-label': t('parkHint'),
                  onClick: () => void park(),
                },
                t('park'),
              ),
              h(
                'button',
                {
                  className: 'cur-send',
                  type: 'button',
                  disabled: !canSend,
                  onClick: () => void submit(),
                },
                busy ? t('sendingShort') : t('send'),
              ),
            ),
            // 提示行只在"有话要说"时出现（发送中/已入队/出错/没有会话）。
            // 常态静默 —— 用户 2026-11-03：第三行常驻提示去掉。
            noteKind === 'hint'
              ? null
              : h(
                  'div',
                  { className: 'cur-note', 'data-kind': noteKind, 'aria-live': 'polite' },
                  noteText,
                ),
          );

      // The anchor (`pos`) is where the user put it — the rendered point is that
      // anchor clamped for the *current* size. Keeping them separate is what makes
      // "expand near an edge → collapse" return to the same spot instead of drifting
      // to the clamped corner.
      const viewPos = pos
        ? {
            // clamp 顺序：先 min 到上限、再 max 到下限。反过来写的话，
            // 当面板高到"上限低于 TOP_SAFE"时，min 会把 y 压进宿主拖动区
            // （用户 2026-11-05 实测：拖到接近全屏时顶部侵入宿主窗口）。
            x: Math.max(
              EDGE,
              Math.min(pos.x, Math.max(EDGE, window.innerWidth - (boxSize.w || 0) - EDGE)),
            ),
            y: Math.max(
              TOP_SAFE,
              Math.min(pos.y, Math.max(TOP_SAFE, window.innerHeight - (boxSize.h || 0) - EDGE)),
            ),
          }
        : null;

      return h(
        'div',
        {
          ref: hostRef,
          className:
            'cur-dock' +
            (viewPos ? ' is-free' : '') +
            (panelH ? ' is-sized' : '') +
            (panelW < 260 || (mode === 'pill' && pillW < 240) ? ' is-narrow' : ''),          'data-sized': panelH && !logHidden && !picking ? '1' : undefined,
          // 窄不窄要看**当前真正生效的那个宽度**：宽面板看 wideSize、胶囊看 pillW、其余看 panelW。
          'data-narrow': (sheet ? wideSize.w : mode === 'pill' ? pillW : panelW) < 260 ? '1' : undefined,
          style: Object.assign(
            {
              '--cur-panel-w': panelW + 'px',
              '--cur-wide-w': wideSize.w + 'px',
              '--cur-wide-h': wideSize.h + 'px',
              '--cur-pill-w': pillW + 'px',
              // 挂板的高度天花板与全窗同一个口径（用户 2026-11-05："挂板全屏尺寸随全窗"）：
              // 视口高 − 当前顶部 − 8 − 它自己的标题栏
              '--cur-wide-maxh':
                Math.max(220, window.innerHeight - (viewPos ? viewPos.y : TOP_SAFE) - 64) + 'px',
            },
            panelH && !logHidden && !picking ? { '--cur-panel-h': panelH + 'px' } : {},
            viewPos ? { left: viewPos.x + 'px', top: viewPos.y + 'px' } : {},
          ),
          onPointerDown: dragStart,
          onPointerMove: (event) => {
            if (resizeRef.current) return moveResize(event);
            return dragMove(event);
          },
          onPointerUp: (event) => {
            if (resizeRef.current) return endResize(event);
            return dragEnd(event);
          },
          onPointerCancel: (event) => {
            if (resizeRef.current) return endResize(event);
            return dragEnd(event);
          },
          onClickCapture: clickGuard,
          onContextMenu: openMenu,
        },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        body,
        menu
          ? h(
              'div',
              { className: 'cur-layer', key: 'menu' },
              h('div', {
                className: 'cur-backdrop',
                onPointerDown: (event) => {
                  event.stopPropagation();
                  closeMenu(true);
                },
                onContextMenu: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closeMenu(true);
                },
              }),
              h(
                'div',
                {
                  className: 'cur-menu',
                  role: 'menu',
                  style: { left: menu.x + 'px', top: menu.y + 'px' },
                },
                // ── 功能：以开间为核心，以模式为驱动（2026-11-08 三分区改版）
                // 分区标签已删（用户："可以去掉，极简主义 —— 我们用设计做说明"），只靠分隔线分组。
                h(
                  'button',
                  {
                    className: 'cur-menu-item',
                    type: 'button',
                    title: t('menuBrowseHint'),
                    onClick: () => {
                      // 浏览 = 回到"最近浏览"的那一页（一步，不展开）。
                      // ⚠ 必须用 readRecentFor('browse')：用全量的第一条会跳到挂板/编辑器去
                      // （用户 2026-11-08 实测："退出时停在挂板，右键浏览又跳回挂板"）。
                      setMenu(null);
                      setMenuTab(null);
                      openModeSheet('browse');
                    },
                  },
                  '👁 ' + t('menuBrowse'),
                ),
                h(
                  'button',
                  {
                    className: 'cur-menu-item',
                    type: 'button',
                    onClick: () => {
                      setMenu(null);
                      setMenuTab(null);
                      openModeSheet('edit');
                    },
                  },
                  '✏️ ' + t('sheetEditor'),
                ),
                h(
                  'button',
                  {
                    className: 'cur-menu-item',
                    type: 'button',
                    onClick: () => {
                      setMenu(null);
                      setMenuTab(null);
                      openModeSheet('form');
                    },
                  },
                  '📌 ' + t('sheetPanels'),
                ),

                // ── 挂靠：插件通过坞口注册，这里列常驻的三格（2026-11-08）
                h('div', { className: 'cur-menu-sep' }),
                h(
                  'button',
                  {
                    className: 'cur-menu-item',
                    type: 'button',
                    onClick: () => setMenuTab((current) => (current === 'dock' ? null : 'dock')),
                  },
                  t('menuDockOn') + (menuTab === 'dock' ? ' ▾' : ' ▸'),
                ),
                menuTab === 'dock'
                  ? (() => {
                      // `fou.hop` 是浮游自己的坞自检，不是"挂靠的插件" —— 它归设置。
                      const plugins = dockEntries.filter((entry) => entry && entry.id !== 'fou.hop');
                      try {
                        console.info(
                          '[fou] dockEntries=' + dockEntries.map((e) => e && e.id + ':' + e.label).join(' | '),
                        );
                      } catch (error) {
                        /* 日志失败无所谓 */
                      }
                      if (plugins.length === 0) {
                        return [h('div', { className: 'cur-menu-item is-empty', key: 'empty' }, t('menuDockEmpty'))];
                      }
                      return plugins.slice(0, 6).map((entry) =>
                        h(
                          'button',
                          {
                            className: 'cur-menu-item is-sub',
                            type: 'button',
                            key: 'dock-' + entry.id,
                            onClick: () => {
                              setMenu(null);
                              setMenuTab(null);
                              // 硬挂载优先（2026-11-08）：有 mount 就挂进开间，是活的界面；
                              // 没有 mount 才退回 run（遥控 / 让它自己弹窗）。
                              if (typeof entry.mount === 'function') {
                                setSheet({ mount: entry, title: entry.label });
                                setMode('panel');
                                return;
                              }
                              if (typeof entry.run === 'function') {
                                try {
                                  entry.run();
                                } catch (error) {
                                  /* a broken entry must not break the menu */
                                }
                              }
                            },
                          },
                          (entry.icon ? entry.icon + ' ' : '') + entry.label,
                        ),
                      );
                    })()
                  : null,

                // ── 设置：浮游自身的设置项（2026-11-08）
                h('div', { className: 'cur-menu-sep' }),
                h(
                  'button',
                  {
                    className: 'cur-menu-item',
                    type: 'button',
                    onClick: () => setMenuTab((current) => (current === 'setting' ? null : 'setting')),
                  },
                  t('menuSetting') + (menuTab === 'setting' ? ' ▾' : ' ▸'),
                ),
                menuTab === 'setting'
                  ? [
                      h(
                        'button',
                        {
                          className: 'cur-menu-item is-sub',
                          type: 'button',
                          key: 'set-mode',
                          onClick: () => {
                            const index = MODES.indexOf(mode);
                            toMode(MODES[(index + 1) % MODES.length]);
                          },
                        },
                        t('modeName') + '：' + t('mode_' + mode) + ' ▸',
                      ),
                      h(
                        'button',
                        {
                          className: 'cur-menu-item is-sub',
                          type: 'button',
                          key: 'set-hop',
                          onClick: () => {
                            setMenu(null);
                            setMenuTab(null);
                            hop();
                          },
                        },
                        '∼ ' + t('dockHop'),
                      ),
                      h(
                        'button',
                        {
                          className: 'cur-menu-item is-sub',
                          type: 'button',
                          key: 'set-reset',
                          onClick: () => {
                            setMenu(null);
                            setMenuTab(null);
                            resetPos();
                          },
                        },
                        t('menuReset'),
                      ),
                      h(
                        'button',
                        {
                          className: 'cur-menu-item is-sub',
                          type: 'button',
                          key: 'set-collapse',
                          onClick: () => {
                            setMenu(null);
                            setMenuTab(null);
                            collapse();
                          },
                        },
                        t('menuCollapse') + '（备用）',
                      ),
                    ]
                  : null,
                h(
                  'button',
                  {
                    className: 'cur-menu-item',
                    type: 'button',
                    onClick: () => {
                      const next = !dodge;
                      setDodge(next);
                      writeDodge(next);
                      setMenu(null);
                      setMenuTab(null);
                    },
                  },
                  t('fouName') + '：' + (dodge ? t('fouOn') : t('fouOff')),
                ),
              ),
            )
          : null,
      );
    }

    // ------------------------------------------------------------- 错误边界
    //
    // 一个常驻界面的东西，最不该有的失败方式就是静默消失（2026-11-02 它崩过一次，
    // 用户只能靠"它不见了"来推断）。边界把它降级成：红点 → 点开看原因 → 重挂。
    class CourierBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null, open: false, generation: 0 };
        this.reset = this.reset.bind(this);
        this.toggle = this.toggle.bind(this);
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error) {
        try {
          console.info('[fou] crashed, boundary engaged:', error && error.message);
        } catch (inner) {
          /* console unavailable */
        }
      }

      reset() {
        this.setState((current) => ({
          error: null,
          open: false,
          generation: current.generation + 1,
        }));
      }

      toggle() {
        this.setState((current) => ({ open: !current.open }));
      }

      render() {
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key;
        if (!this.state.error) {
          return h(CourierBar, { ...this.props, key: 'gen-' + this.state.generation });
        }
        const detail = String(
          (this.state.error && this.state.error.message) || this.state.error || '',
        ).slice(0, 240);
        return h(
          'div',
          { className: 'cur-dock' },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          this.state.open
            ? h(
                'div',
                { className: 'cur-panel', role: 'alert' },
                h(
                  'div',
                  { className: 'cur-head' },
                  h('span', { className: 'cur-brand' }, t('brand')),
                  h(
                    'button',
                    {
                      className: 'cur-jump',
                      type: 'button',
                      title: t('crashReload'),
                      'aria-label': t('crashReload'),
                      onClick: this.reset,
                    },
                    '⟳',
                  ),
                ),
                h('div', { className: 'cur-note', 'data-kind': 'error' }, t('crashTitle') + '：' + detail),
                h('div', { className: 'cur-note' }, t('crashHint')),
              )
            : h(
                'button',
                {
                  className: 'cur-bubble is-crashed',
                  type: 'button',
                  title: t('crashTitle'),
                  'aria-label': t('crashTitle'),
                  onClick: this.toggle,
                },
                '!',
              ),
        );
      }
    }

    // ------------------------------------------------------------- registration
    return {
      inject: ['slots', 'locale', 'sessions'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'courier: zh dictionary');
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'courier: en dictionary');

        const t = ctx.locale.bind(NS);


        // 坞口对外发布：其它插件 `window.__fouDock?.register({...})` 即可挂功能。
        publishDock();

        // Root-scoped list: each entry owns only its own box, so the bar floats
        // over every main view (conversation, plugins, market) without blocking
        // anything else.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'courier',
              order: 100,
              locale: NS,
              inject: () => ({
                t,
                sessions: ctx.sessions,
                // React 侧挂载后把"打开这个 url"的能力交上来
                setOpenInFou: (fn) => {
                  requestOpenInFou = typeof fn === 'function' ? fn : null;
                },
                takePendingOpen: () => {
                  const pending = pendingOpenInFou;
                  pendingOpenInFou = null;
                  return pending;
                },
                jump: (id) => {
                  if (!id) return false;
                  try {
                    const workspace = ctx.get('uiWorkspace');
                    if (workspace && typeof workspace.openSession === 'function') {
                      workspace.openSession(id);
                      return true;
                    }
                  } catch (error) {
                    /* service not mounted */
                  }
                  return false;
                },
              }),
            },
            (props) => h(CourierBoundary, props, h(CourierBar, props)),
          ),
        );

        // ------------------------------------------------------- 链接右键：在浮游打开
        //
        // 走官方扩展点（`dsh-client-ui-context-menu`），**不自己画菜单、不碰官方那三项**。
        //
        // 四条按官方源码校准过的事实（2026-11-06，DSH 修复 复核指出）：
        //   ① 真实家族名是 **`url`**（官方 client-ui-chat：`kind:"url", value:{sessionId,url}`）
        //   ② `register` **不校验 target** —— 名字写错也静默成功，所以绝不能"逐个试"
        //   ③ **`resolve` 收到的已经是 `value`**（官方包了 `input.resolve(target.value, signal)`），
        //      所以是 `value.url`，不是 `target.value.url`
        //   ④ **register 返回"撤销注册"函数**，必须交给 `ctx.effect` 做清理，
        //      否则热重载后旧贡献还在 → 撞 `Duplicate menu contribution` → 功能死到整页刷新
        //
        // 三条自律（见 `浮游协议/20-挂板协议.md` §四）：
        //   ① 只加一项，不改官方既有三项
        //   ② 不做左键单击（会破坏"点链接用浏览器打开"的预期）
        //   ③ 官方将来自己加这一项 → 让官方
        const openLinkInFou = (url) => {
          if (!url || typeof url !== 'string') return;
          let notifyFn = null;
          try {
            const menus = ctx.contextMenus || (typeof ctx.get === 'function' ? ctx.get('contextMenus') : null);
            if (menus && typeof menus.notify === 'function') notifyFn = menus.notify.bind(menus);
          } catch (error) {
            /* 没有 notify 也不影响主流程 */
          }
          const say = (text, ok) => {
            try {
              if (notifyFn) notifyFn(text, ok);
              else if (ok) console.info('[fou] ' + text);
              else console.warn('[fou] ' + text);
            } catch (error) {
              /* 提示失败不能影响主流程 */
            }
          };
          console.info('[fou] open-link-in-fou:', url);
          // 稳定 id：**同一个 URL 再挂一次 = 覆盖，不新增一条**。
          // 用户实测（2026-11-06）：连点三次堆了三条一样的，看起来像"每次都失败"。
          const stableId = (() => {
            let hash = 5381;
            for (let i = 0; i < url.length; i++) hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
            return 'url-' + hash.toString(36);
          })();
          // 与挂板同一套契约：POST /dsh-fou/hang { kind:'url' }
          fetch('/dsh-fou/hang', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-fou': '1' },
            body: JSON.stringify({
              id: stableId,
              title: (() => {
                try {
                  const parsed = new URL(url);
                  return parsed.host + parsed.pathname;
                } catch (error) {
                  return url.slice(0, 60);
                }
              })(),
              kind: 'url',
              url,
              from: '链接右键',
            }),
          })
            .then((res) => {
              console.info('[fou] hang status', res.status);
              if (res.ok) {
                const title = (() => {
                  try {
                    const parsed = new URL(url);
                    return parsed.host + parsed.pathname;
                  } catch (error) {
                    return url.slice(0, 60);
                  }
                })();
                // **直接打开**（用户 2026-11-06：要的是"在浮游中打开"，不是"挂进列表"）
                const opened = openInFouNow(url, title, { kind: 'url', target: url });
                say(opened ? '已在浮游打开：' + url.slice(0, 48) : '已挂到挂板（浮游未就绪，刷新可见）', true);
              } else say('挂板拒绝了（HTTP ' + res.status + '）', false);
            })
            .catch((error) => {
              console.warn('[fou] hang failed', error);
              say('挂不上去：' + String((error && error.message) || error).slice(0, 80), false);
            });
        };

        // ---- 文件也在浮游打开（2026-11-06 夜，子项目「浮游打开」第二步）
        //
        // 走的仍是官方扩展点，只是换了一个目标家族：`file`。
        // 链路：挂一个 kind=md/text/html/json 的 path 挂件 → 拿 panel id →
        //       用 `/dsh-fou/view?id=` 打开（那个页面会按 kind 渲染）。
        const pickKindByPath = (filePath) => {
          const lower = String(filePath || '').toLowerCase();
          if (/\.html?$/.test(lower)) return 'html';
          if (/\.(md|markdown)$/.test(lower)) return 'md';
          if (/\.json$/.test(lower)) return 'json';
          return 'text';
        };
        const baseName = (filePath) => {
          const parts = String(filePath || '').split(/[\\/]/);
          return parts[parts.length - 1] || String(filePath || '');
        };
        const openFileInFou = (filePath, label) => {
          if (!filePath || typeof filePath !== 'string') return;
          let notifyFn = null;
          try {
            const menus = ctx.contextMenus || (typeof ctx.get === 'function' ? ctx.get('contextMenus') : null);
            if (menus && typeof menus.notify === 'function') notifyFn = menus.notify.bind(menus);
          } catch (error) {
            /* 没有 notify 也不影响主流程 */
          }
          const say = (text, ok) => {
            try {
              if (notifyFn) notifyFn(text, ok);
              else console.info('[fou] ' + text);
            } catch (error) {
              /* 提示失败不能影响主流程 */
            }
          };
          console.info('[fou] open-file-in-fou:', filePath);
          let hash = 5381;
          for (let i = 0; i < filePath.length; i++) hash = ((hash << 5) + hash + filePath.charCodeAt(i)) >>> 0;
          const title = label || baseName(filePath);
          fetch('/dsh-fou/hang', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-fou': '1' },
            body: JSON.stringify({
              id: 'file-' + hash.toString(36),
              title,
              kind: pickKindByPath(filePath),
              path: filePath,
              from: '文件右键',
            }),
          })
            .then((res) =>
              res.json().then((data) => {
                if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
                return data;
              }),
            )
            .then((data) => {
              const panel = data.panel || {};
              if (!panel.id) throw new Error('没拿到 panel id');
              const viewUrl = '/dsh-fou/view?id=' + encodeURIComponent(panel.id);
              const opened = openInFouNow(viewUrl, title, { kind: 'file', target: filePath });
              say(opened ? '已在浮游打开：' + title : '已挂到挂板（浮游未就绪）', true);
            })
            .catch((error) => {
              console.warn('[fou] open-file failed', error);
              say('打不开：' + String((error && error.message) || error).slice(0, 80), false);
            });
        };

        const registerLinkMenu = (holder) => {
          const menus =
            holder && holder.contextMenus
              ? holder.contextMenus
              : holder && typeof holder.get === 'function'
                ? holder.get('contextMenus')
                : null;
          if (!menus || typeof menus.register !== 'function') return undefined;
          const disposers = [];
          const keep = (fn) => {
            if (typeof fn === 'function') disposers.push(fn);
          };
          try {
            // ① 链接（url）
            keep(
              menus.register({
                id: 'fou-open-link',
                target: 'url',
                order: 900,
                resolve: (value) => {
                  const url = value && typeof value.url === 'string' ? value.url : '';
                  if (!url) return [];
                  return [
                    {
                      id: 'fou.open-link',
                      label: '在浮游打开',
                      run: () => openLinkInFou(url),
                    },
                  ];
                },
              }),
            );
          } catch (error) {
            /* 这一族注册失败不影响下一族 */
          }
          try {
            // ② 文件（file）
            keep(
              menus.register({
                id: 'fou-open-file',
                target: 'file',
                order: 900,
                resolve: (value) => {
                  const filePath =
                    value && typeof value.path === 'string'
                      ? value.path
                      : value && typeof value.filePath === 'string'
                        ? value.filePath
                        : '';
                  if (!filePath) return [];
                  return [
                    {
                      id: 'fou.open-file',
                      label: '在浮游打开',
                      run: () => openFileInFou(filePath, value && (value.name || value.title)),
                    },
                  ];
                },
              }),
            );
          } catch (error) {
            /* 同上 */
          }
          // 两个贡献合成一个 disposer：ctx.effect 会拿它做清理
          if (disposers.length === 0) return undefined;
          return () => {
            for (const dispose of disposers) {
              try {
                dispose();
              } catch (error) {
                /* 撤销失败无所谓 */
              }
            }
          };
        };

        // `contextMenus` 由官方插件 `ctx.provide` 提供；若我们的 apply 跑在它之前，
        // 直接读会拿到 undefined。用 `ctx.inject` 等它就位（拿不到就静默降级）。
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['contextMenus'], (inner) => {
              ctx.effect(() => registerLinkMenu(inner), 'courier: open-link-in-fou');
            });
          } else {
            ctx.effect(() => registerLinkMenu(ctx), 'courier: open-link-in-fou');
          }
        } catch (error) {
          /* 没有 contextMenus 服务 → 这项功能不存在，坞照常 */
        }
      },
    };
  },
});
