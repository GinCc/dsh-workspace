/**
 * dsh-plugin-session-import — browser half (hand-authored client bundle).
 *
 * Lazy-CJS factory bundle for the DSH client module system. UI contributions:
 *  - a `sidebar.footer.action` entry (import button above Settings);
 *  - a `shell.overlay` entry rendering the import dialog while open.
 *
 * The dialog has two import paths:
 *  - 自动识别: the host scans other-agent transcripts on this machine
 *    (~/.claude/projects, ~/.codex/sessions) and flags the ones whose cwd
 *    matches the current workspace; each row still requires an explicit
 *    click before anything is imported;
 *  - 手动导入: the original file picker / drag-drop flow, kept intact.
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-session-import",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const { createElement: h, useState, useEffect, useCallback, useRef, useSyncExternalStore, Fragment } = React;

		/* ------------------------------------------------------------------ */
		/* stylesheet                                                          */

		const PLUGIN_ID = "dsh-plugin-session-import";
		const CSS_TAG = `${PLUGIN_ID}/styles.css`;

		const CSS = `
.dsi-foot { display: flex; width: 100%; }
.dsi-footBtn { display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; margin: 2px 6px;
  background: transparent; color: var(--dsw-alias-label-secondary, #5c5c66);
  font-size: 12px; line-height: 20px; cursor: pointer; transition: background .12s ease, color .12s ease; }
.dsi-footBtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(29, 26, 44, .06));
  color: var(--dsw-alias-label-primary, #1d1a2c); }
.dsi-footBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c6bfe); outline-offset: 1px; }
.dsi-footBtn[data-rail="true"] { justify-content: center; margin: 2px 4px; padding: 6px 0; }
.dsi-footBtn svg { flex: none; }

.dsi-root { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  pointer-events: auto; }
.dsi-backdrop { position: absolute; inset: 0; background: rgba(15, 13, 26, .38); backdrop-filter: blur(2px); }
.dsi-modal { position: relative; width: min(720px, calc(100vw - 48px)); max-height: min(640px, calc(100vh - 64px));
  display: flex; flex-direction: column; border-radius: 16px; overflow: hidden;
  background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #1d1a2c);
  box-shadow: 0 18px 60px rgba(10, 8, 20, .28), 0 2px 8px rgba(10, 8, 20, .18);
  border: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .08)); }
.dsi-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .08)); }
.dsi-headMain { flex: 1; min-width: 0; }
.dsi-title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .2px; }
.dsi-desc { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8794); }
.dsi-close { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-tertiary, #8a8794); cursor: pointer; font-size: 16px; }
.dsi-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(29, 26, 44, .06));
  color: var(--dsw-alias-label-primary, #1d1a2c); }

.dsi-body { flex: 1; overflow-y: auto; padding: 14px 20px 20px; }
.dsi-secHead { display: flex; align-items: center; gap: 8px; margin: 14px 0 8px; }
.dsi-secHead:first-child { margin-top: 0; }
.dsi-secTitle { font-size: 12px; font-weight: 650; letter-spacing: .4px; color: var(--dsw-alias-label-secondary, #5c5c66);
  text-transform: uppercase; }
.dsi-secSpacer { flex: 1; }
.dsi-secBtn { padding: 3px 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l, rgba(29,26,44,.16));
  background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-secondary, #5c5c66);
  font-size: 11px; cursor: pointer; }
.dsi-secBtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(29,26,44,.06)); color: var(--dsw-alias-label-primary, #1d1a2c); }
.dsi-secBtn[data-busy="true"] { opacity: .6; pointer-events: none; }
.dsi-secBtn[data-primary="true"] { border: 0; background: var(--dsw-alias-button-primary-fill, #1f2126);
  color: var(--dsw-alias-label-primary-foreground, #fff); font-weight: 550; }
.dsi-secBtn[data-primary="true"]:hover { background: var(--dsw-alias-button-primary-hover, #34363b); }
.dsi-wsChip { display: inline-flex; align-items: center; max-width: 100%; gap: 6px; padding: 2px 9px; border-radius: 999px;
  background: rgba(76, 107, 254, .12);
  color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, var(--dsw-alias-label-primary, #4c6bfe));
  font-size: 11px; font-family: var(--dsw-alias-font-family-mono, ui-monospace, monospace); }
.dsi-wsChip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsi-wsSelect { max-width: 300px; padding: 3px 8px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l, rgba(29,26,44,.18));
  background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-secondary, #5c5c66);
  font-size: 11px; cursor: pointer; }
.dsi-wsSelect:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 1px; }
.dsi-wsSelect option { color: #1d1a2c; background: #fff; }

.dsi-list { display: flex; flex-direction: column; gap: 6px; }
.dsi-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .08));
  background: var(--dsw-alias-bg-module-platform, #faf9fc); }
.dsi-rowMain { flex: 1; min-width: 0; }
.dsi-rowTitle { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsi-rowMeta { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8794);
  display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.dsi-badge { display: inline-flex; align-items: center; padding: 0 6px; margin-right: 6px; border-radius: 999px;
  font-size: 10px; font-weight: 600; letter-spacing: .3px; vertical-align: 1px; }
.dsi-badge[data-agent="claude-code"] { background: rgba(208, 122, 50, .12); color: #b06a2c; }
.dsi-badge[data-agent="codex"] { background: rgba(20, 134, 110, .12); color: #16866e; }
.dsi-badge[data-agent="openai"] { background: rgba(23, 122, 184, .12); color: #177ab8; }
.dsi-importBtn { flex: none; padding: 4px 13px; border-radius: 8px; border: 0; cursor: pointer; font-size: 12px;
  background: var(--dsw-alias-button-primary-fill, #1f2126);
  color: var(--dsw-alias-label-primary-foreground, #fff); font-weight: 550; }
.dsi-importBtn:hover { background: var(--dsw-alias-button-primary-hover, #34363b); }
.dsi-importBtn[data-disabled="true"] { opacity: .45; pointer-events: none; }
.dsi-importBtn[data-ghost="true"] { background: transparent; color: var(--dsw-alias-label-secondary, #5c5c66);
  border: 1px solid var(--dsw-alias-border-l, rgba(29,26,44,.16)); }
.dsi-importBtn[data-ghost="true"]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14)); }
.dsi-doneChip { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px;
  background: rgba(46, 158, 91, .10); color: var(--dsw-alias-state-success-primary, #2e9e5b);
  font-size: 11px; font-weight: 600; }
.dsi-collapsedToggle { border: 0; background: transparent; padding: 2px 4px; border-radius: 6px; cursor: pointer;
  font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8794); }
.dsi-collapsedToggle:hover { color: var(--dsw-alias-label-primary, #1d1a2c);
  background: var(--dsw-alias-interactive-bg-hover, rgba(29,26,44,.06)); }

.dsi-drop { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 20px 16px; border-radius: 12px; border: 1.5px dashed var(--dsw-alias-border-l, rgba(29,26,44,.2));
  background: var(--dsw-alias-bg-module-platform, #f7f6fa); color: var(--dsw-alias-label-tertiary, #8a8794);
  font-size: 12px; cursor: pointer; transition: border-color .12s ease, background .12s ease; }
.dsi-drop:hover, .dsi-drop[data-over="true"] { border-color: var(--dsw-alias-brand-primary, #4c6bfe);
  background: rgba(76, 107, 254, .06); color: var(--dsw-alias-label-secondary, #5c5c66); }
.dsi-dropMain { font-size: 13px; font-weight: 550; color: var(--dsw-alias-label-secondary, #5c5c66); }
.dsi-hint { margin-top: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8794); text-align: center; }
.dsi-center { padding: 26px 0; text-align: center; color: var(--dsw-alias-label-tertiary, #8a8794); font-size: 13px; }
.dsi-inlineErr { font-size: 11px; color: #c2355a; word-break: break-all; }
.dsi-ok { color: var(--dsw-alias-state-success-primary, #2e9e5b); font-weight: 550; }
.dsi-err { color: #c2355a; }
.dsi-warn { color: #b8860b; }

/* Dark theme: brighten the fixed accent colors for the dark surfaces. */
body[data-ds-dark-theme] .dsi-badge[data-agent="claude-code"] { color: #d99a5e; }
body[data-ds-dark-theme] .dsi-badge[data-agent="codex"] { color: #5cc4ad; }
body[data-ds-dark-theme] .dsi-badge[data-agent="openai"] { color: #6db8e8; }
body[data-ds-dark-theme] .dsi-doneChip { background: rgba(88, 201, 139, .14); color: #58c98b; }
body[data-ds-dark-theme] .dsi-ok { color: #58c98b; }
body[data-ds-dark-theme] .dsi-err, body[data-ds-dark-theme] .dsi-inlineErr { color: #e57a93; }
body[data-ds-dark-theme] .dsi-warn { color: #d9a94a; }
`;

		if (typeof document !== "undefined"
			&& document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/* ------------------------------------------------------------------ */
		/* open/close store                                                    */

		let open = false;
		const listeners = new Set();
		const notify = () => { for (const fn of listeners) fn(); };
		const subscribe = (fn) => {
			listeners.add(fn);
			return () => { listeners.delete(fn); };
		};
		const snapshot = () => open;
		const setOpen = (value) => {
			if (open === value) return;
			open = value;
			notify();
		};

		/* ------------------------------------------------------------------ */
		/* locale                                                              */

		const NS = "sessionImport";
		const zh = {
			"entry.label": "导入会话",
			"panel.title": "导入外部会话",
			"panel.desc": "将其他 agent 的原始会话记录导入为本机 DSH 会话；每条记录都需要你手动确认才会导入。",
			"auto.title": "自动识别",
			"auto.workspace": "当前工作区",
			"auto.none": "当前工作区下没有发现其他 agent 的会话。",
			"auto.rescan": "重新扫描",
			"auto.scanning": "扫描中…",
			"auto.failed": "扫描失败：{message}",
			"auto.unsupported": "自动识别需要更新后的插件：重启 dsh web 后可用（手动导入不受影响）。",
			"auto.others": "其他工作区的会话（{count}）",
			"auto.imported": "已导入",
			"auto.import": "导入",
			"auto.importing": "导入中…",
			"auto.importFailed": "导入失败：{message}",
			"auto.mode": "自动（跟随当前会话）",
			"auto.modeWith": "自动 · {path}",
			"ws.unregistered": "未注册",
			"ws.noneFound": "该工作区下没有发现其他 agent 的会话。",
			"ws.createFailed": "工作区归属失败：{message}",
			"manual.title": "手动导入文件",
			"manual.drop": "点击选择或拖入文件",
			"manual.dropHint": "支持多选 · Claude Code JSONL · Codex rollout JSONL · OpenAI 风格消息数组",
			"manual.import": "导入",
			"manual.importAll": "全部导入",
			"manual.inspecting": "预检中…",
			"manual.imported": "已导入 {turns} 轮 · {messages} 条消息 · {events} 个事件",
			"manual.importedSkipped": "（跳过 {count} 条工具记录）",
			"manual.failed": "导入失败：{message}",
			"manual.inspectFailed": "预检失败：{message}",
			"manual.turns": "{turns} 轮",
			"manual.messages": "{user} 用户 · {assistant} 助手",
			"manual.skipped": "跳过 {count} 条工具记录",
			"manual.noContent": "未发现可导入的对话内容",
			"manual.clear": "清空",
			"note.refresh": "导入完成后可在左侧会话列表打开；如未出现，刷新页面即可。",
			"rel.now": "刚刚",
			"rel.min": "{n} 分钟前",
			"rel.hour": "{n} 小时前",
			"rel.day": "{n} 天前",
		};
		const en = {
			"entry.label": "Import sessions",
			"panel.title": "Import external sessions",
			"panel.desc": "Turn raw transcripts from other agents into local DSH sessions; every row still needs your explicit click.",
			"auto.title": "Auto-detect",
			"auto.workspace": "Current workspace",
			"auto.none": "No other-agent sessions found for the current workspace.",
			"auto.rescan": "Rescan",
			"auto.scanning": "Scanning…",
			"auto.failed": "Scan failed: {message}",
			"auto.unsupported": "Auto-detect needs the updated host plugin: restart dsh web to enable it (manual import still works).",
			"auto.others": "Sessions in other workspaces ({count})",
			"auto.imported": "Imported",
			"auto.import": "Import",
			"auto.importing": "Importing…",
			"auto.importFailed": "Import failed: {message}",
			"auto.mode": "Auto (follow current session)",
			"auto.modeWith": "Auto · {path}",
			"ws.unregistered": "not registered",
			"ws.noneFound": "No other-agent sessions found for this workspace.",
			"ws.createFailed": "Workspace membership failed: {message}",
			"manual.title": "Manual file import",
			"manual.drop": "Click to pick or drop files",
			"manual.dropHint": "Multiple files · Claude Code JSONL · Codex rollout JSONL · OpenAI-style message arrays",
			"manual.import": "Import",
			"manual.importAll": "Import all",
			"manual.inspecting": "Inspecting…",
			"manual.imported": "Imported {turns} turns · {messages} messages · {events} events",
			"manual.importedSkipped": " ({count} tool records skipped)",
			"manual.failed": "Import failed: {message}",
			"manual.inspectFailed": "Inspect failed: {message}",
			"manual.turns": "{turns} turns",
			"manual.messages": "{user} user · {assistant} assistant",
			"manual.skipped": "{count} tool records skipped",
			"manual.noContent": "No importable conversation content found",
			"manual.clear": "Clear",
			"note.refresh": "Imported sessions appear in the sidebar list; refresh the page if they don't.",
			"rel.now": "just now",
			"rel.min": "{n}m ago",
			"rel.hour": "{n}h ago",
			"rel.day": "{n}d ago",
		};

		const tt = (t, key, params) => {
			let text = key;
			try {
				text = t !== undefined ? t(key, params) : key;
			} catch {
				text = key;
			}
			if (params !== undefined) {
				for (const [name, value] of Object.entries(params)) {
					text = text.split(`{${name}}`).join(String(value));
				}
			}
			return text;
		};

		/* ------------------------------------------------------------------ */
		/* formatting helpers                                                  */

		const fmtBytes = (n) => {
			if (typeof n !== "number" || !Number.isFinite(n)) return "–";
			if (n < 1024) return `${n} B`;
			if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
			return `${(n / (1024 * 1024)).toFixed(1)} MB`;
		};

		const fmtRel = (t, ms, now = Date.now()) => {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "–";
			const delta = Math.max(0, now - ms);
			if (delta < 60_000) return tt(t, "rel.now");
			if (delta < 3_600_000) return tt(t, "rel.min", { n: Math.floor(delta / 60_000) });
			if (delta < 86_400_000) return tt(t, "rel.hour", { n: Math.floor(delta / 3_600_000) });
			if (delta < 30 * 86_400_000) return tt(t, "rel.day", { n: Math.floor(delta / 86_400_000) });
			const d = new Date(ms);
			return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		};

		/* ------------------------------------------------------------------ */
		/* icons                                                               */

		const ImportIcon = ({ size = 16 }) => h("svg", {
			width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true",
		},
			h("path", {
				d: "M8 2.5v7.5M5 7.5 8 10.5 11 7.5M3 12.5h10",
				stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round",
			}));

		/* ------------------------------------------------------------------ */
		/* host calls                                                          */

		const PREFIX = "/plugins/session-import";

		const post = (endpoint, body) =>
			fetch(`${PREFIX}/${endpoint}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}).then(async (res) => {
				const json = await res.json().catch(() => ({}));
				if (!res.ok) {
					const error = new Error(json?.error ?? `HTTP ${res.status}`);
					error.status = res.status;
					throw error;
				}
				return json;
			});

		/* ------------------------------------------------------------------ */
		/* components                                                          */

		function FooterAction(props) {
			const wide = props.wide === true;
			const label = tt(props.t, "entry.label");
			return h("div", { className: "dsi-foot" },
				h("button", {
					type: "button",
					className: "dsi-footBtn",
					"data-rail": String(!wide),
					title: label,
					"aria-label": label,
					onClick: () => { setOpen(true); },
				},
					h(ImportIcon, { size: wide ? 15 : 17 }),
					wide ? h("span", { className: "dsi-footLabel" }, label) : null));
		}

		function AgentBadge({ agent }) {
			const kind = agent === "claude-code" ? "claude-code" : agent === "codex" ? "codex" : "openai";
			const label = agent === "claude-code" ? "Claude Code" : agent === "codex" ? "Codex" : "Export";
			return h("span", { className: "dsi-badge", "data-agent": kind }, label);
		}

		function AutoRow({ t, entry, state, onImport }) {
			const busy = state === "importing";
			const failed = typeof state === "object" && state !== null && state.error !== undefined;
			const done = state === "done"
				|| (typeof state === "object" && state !== null && state.ok === true)
				|| entry.imported !== null;
			const warn = typeof state === "object" && state !== null ? state.warn : undefined;
			return h("div", { className: "dsi-row" },
				h("div", { className: "dsi-rowMain" },
					h("div", { className: "dsi-rowTitle", title: entry.title },
						h(AgentBadge, { agent: entry.agent }),
						entry.title),
					h("div", { className: "dsi-rowMeta" },
						h("span", null,
							tt(t, "manual.turns", { turns: entry.userMessages }),
							` · ${entry.userMessages + entry.assistantMessages} msg · ${fmtBytes(entry.sizeBytes)}`),
						h("span", null, fmtRel(t, entry.lastTime ?? entry.mtimeMs)),
						entry.cwd !== null
							? h("span", {
								title: entry.cwd,
								style: { fontFamily: "var(--dsw-alias-font-family-mono, ui-monospace, monospace)" },
							}, entry.cwd.replace(/^\/Users\/[^/]+/, "~"))
							: null,
						failed ? h("span", { className: "dsi-err" },
							tt(t, "auto.importFailed", { message: state.error })) : null,
						warn !== undefined ? h("span", { className: "dsi-warn" },
							tt(t, "ws.createFailed", { message: warn })) : null)),
				busy ? h("button", { type: "button", className: "dsi-importBtn", "data-ghost": "true", disabled: true },
					tt(t, "auto.importing"))
					: done ? h("span", { className: "dsi-doneChip" }, `✓ ${tt(t, "auto.imported")}`)
						: h("button", {
							type: "button", className: "dsi-importBtn",
							onClick: () => { onImport(entry); },
						}, tt(t, "auto.import")));
		}

		function ManualRow({ t, file, onImport }) {
			const phase = file.phase; // 'inspecting' | 'ready' | 'error' | 'importing' | 'imported'
			const preview = file.preview;
			const meta = [];
			if (phase === "inspecting") {
				meta.push(h("span", { key: "p" }, tt(t, "manual.inspecting")));
			} else if (phase === "error") {
				meta.push(h("span", { key: "e", className: "dsi-err" },
					tt(t, "manual.inspectFailed", { message: file.error })));
			} else if (phase === "imported") {
				meta.push(h("span", { key: "ok", className: "dsi-ok" },
					tt(t, "manual.imported", {
						turns: file.result.turns,
						messages: file.result.userMessages + file.result.assistantMessages,
						events: file.result.events,
					})));
				if (file.result.skippedToolItems > 0) {
					meta.push(h("span", { key: "sk" },
						tt(t, "manual.importedSkipped", { count: file.result.skippedToolItems })));
				}
				const wsWarn = file.result?.workspace?.warn;
				if (wsWarn !== undefined) {
					meta.push(h("span", { key: "ws", className: "dsi-warn" },
						tt(t, "ws.createFailed", { message: wsWarn })));
				}
			} else if (preview !== undefined) {
				meta.push(h("span", { key: "fmt", className: "dsi-ok" }, preview.sourceAgent));
				meta.push(h("span", { key: "turns" }, tt(t, "manual.turns", { turns: preview.turns })));
				meta.push(h("span", { key: "msgs" },
					tt(t, "manual.messages", { user: preview.userMessages, assistant: preview.assistantMessages })));
				if (preview.skippedToolItems > 0) {
					meta.push(h("span", { key: "sk", className: "dsi-warn" },
						tt(t, "manual.skipped", { count: preview.skippedToolItems })));
				}
			}
			return h("div", { className: "dsi-row" },
				h("div", { className: "dsi-rowMain" },
					h("div", { className: "dsi-rowTitle", title: file.name },
						preview !== undefined ? h(AgentBadge, { agent: preview.format }) : null,
						file.name,
						h("span", { style: { marginLeft: "8px", fontWeight: 400, color: "var(--dsw-alias-label-tertiary, #8a8794)" } },
							fmtBytes(file.size))),
					h("div", { className: "dsi-rowMeta" }, ...meta),
					preview !== undefined && preview.warnings.length > 0
						? h("div", { style: { marginTop: "2px", fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #8a8794)" } },
							preview.warnings.slice(0, 3).join(" · "))
						: null),
				phase === "ready"
					? h("button", {
						type: "button", className: "dsi-importBtn",
						onClick: () => { onImport(file.id); },
					}, tt(t, "manual.import"))
					: null,
				phase === "importing"
					? h("button", { type: "button", className: "dsi-importBtn", "data-ghost": "true", disabled: true }, "…")
					: null);
		}

		function SectionHead({ title, children }) {
			return h("div", { className: "dsi-secHead" },
				h("span", { className: "dsi-secTitle" }, title),
				h("span", { className: "dsi-secSpacer" }),
				children);
		}

		/**
		 * Resolve the workspace path the panel should scan: the CURRENT
		 * session's cwd first (this is what "switched workspace" means to the
		 * user), then the workspace owning the current session, then the
		 * most-recently-active workspace, then the first listed one.
		 */
		function currentWorkspacePath(wsSnap, sessSnap) {
			try {
				const currentId = sessSnap?.current
				if (currentId !== undefined) {
					const summary = sessSnap.byId?.[currentId]
					if (summary !== undefined && typeof summary.cwd === "string" && summary.cwd.length > 0) {
						return summary.cwd
					}
					const owner = wsSnap.items.find((item) => item.sessionIds?.includes(currentId))
					if (owner !== undefined && typeof owner.path === "string") return owner.path
				}
				const recent = wsSnap.recentWorkspaceId !== undefined
					? wsSnap.items.find((item) => item.workspaceId === wsSnap.recentWorkspaceId)
					: undefined
				const fallback = recent ?? wsSnap.items[0]
				return fallback !== undefined && typeof fallback.path === "string" ? fallback.path : null
			} catch {
				return null
			}
		}

		function Modal(props) {
			const t = props.t;
			// Live workspace tracking: these re-render the panel on every
			// selection/workspace change, so an open dialog follows the user.
			const wsList = useSyncExternalStore(props.subscribeWorkspaces, props.getWorkspaces);
			const sessList = useSyncExternalStore(props.subscribeSessions, props.getSessions);
			const wsPath = currentWorkspacePath(wsList, sessList);

			const [discover, setDiscover] = useState({ phase: "scanning" });
			const [showOthers, setShowOthers] = useState(false);
			const [selection, setSelection] = useState("auto"); // 'auto' | a workspace path
			const [rowState, setRowState] = useState({}); // path -> 'importing' | {ok} | {error}
			const [files, setFiles] = useState([]);
			const [dragOver, setDragOver] = useState(false);
			const [anyImported, setAnyImported] = useState(false);

			// 'auto' follows the live current-workspace resolution; an explicit
			// selection pins the scan to that path until the user switches back.
			const effectiveCwd = selection === "auto" ? wsPath : selection;

			const runDiscover = useCallback((cwd) => {
				setDiscover({ phase: "scanning" });
				post("discover", { cwd: cwd !== null ? cwd : undefined })
					.then((data) => { setDiscover({ phase: "ready", data }); })
					.catch((error) => {
						if (error?.status === 404) setDiscover({ phase: "unsupported" });
						else setDiscover({ phase: "error", error: error?.message ?? String(error) });
					});
			}, []);

			useEffect(() => {
				runDiscover(effectiveCwd);
			}, [effectiveCwd, runDiscover]);

			// Archive/delete status changes happen OUTSIDE this panel — refresh
			// the imported badges when the user comes back to the window, so a
			// delete in the sidebar is reflected without a manual rescan.
			// Debounced: at most one rescan per 3s of focus events.
			const lastScanRef = useRef(0);
			useEffect(() => {
				lastScanRef.current = Date.now();
			}, [discover]);
			useEffect(() => {
				const rescanOnFocus = () => {
					if (document.visibilityState === "hidden") return
					if (Date.now() - lastScanRef.current < 3000) return
					lastScanRef.current = Date.now()
					runDiscover(effectiveCwd)
				}
				window.addEventListener("focus", rescanOnFocus)
				document.addEventListener("visibilitychange", rescanOnFocus)
				return () => {
					window.removeEventListener("focus", rescanOnFocus)
					document.removeEventListener("visibilitychange", rescanOnFocus)
				}
			}, [effectiveCwd, runDiscover]);

			useEffect(() => {
				const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
				window.addEventListener("keydown", onKey);
				return () => { window.removeEventListener("keydown", onKey); };
			}, []);

			const importDiscovered = useCallback(async (entry) => {
				setRowState((current) => ({ ...current, [entry.path]: "importing" }));
				try {
					const result = await post("import-file", { path: entry.path });
					const warn = result?.workspace?.warn;
					setRowState((current) => ({
						...current,
						[entry.path]: { ok: true, ...(warn !== undefined ? { warn } : {}) },
					}));
					setAnyImported(true);
				} catch (error) {
					setRowState((current) => ({
						...current,
						[entry.path]: { error: error?.message ?? String(error) },
					}));
				}
			}, []);

			const inspect = useCallback(async (id, name, text) => {
				try {
					const preview = await post("inspect", { name, text });
					setFiles((current) => current.map((file) => (file.id === id
						? (preview.turns === 0
							? { ...file, phase: "error", error: tt(t, "manual.noContent"), preview }
							: { ...file, phase: "ready", preview })
						: file)));
				} catch (error) {
					setFiles((current) => current.map((file) => (file.id === id
						? { ...file, phase: "error", error: error?.message ?? String(error) }
						: file)));
				}
			}, [t]);

			const addFiles = useCallback((fileList) => {
				const picked = [...fileList];
				if (picked.length === 0) return;
				const staged = picked.map((f) => ({
					id: crypto.randomUUID(),
					name: f.name,
					size: f.size,
					phase: "inspecting",
					text: undefined,
				}));
				setFiles((current) => [...current, ...staged]);
				picked.forEach((f, index) => {
					const entry = staged[index];
					f.text().then((text) => {
						setFiles((current) => current.map((file) =>
							(file.id === entry.id ? { ...file, text } : file)));
						void inspect(entry.id, entry.name, text);
					});
				});
			}, [inspect]);

			const importOne = useCallback(async (id) => {
				const file = files.find((f) => f.id === id);
				if (file === undefined || file.text === undefined) return;
				setFiles((current) => current.map((f) => (f.id === id ? { ...f, phase: "importing" } : f)));
				try {
					const result = await post("import", { name: file.name, text: file.text });
					setFiles((current) => current.map((f) => (f.id === id
						? { ...f, phase: "imported", result }
						: f)));
					setAnyImported(true);
				} catch (error) {
					setFiles((current) => current.map((f) => (f.id === id
						? { ...f, phase: "error", error: error?.message ?? String(error) }
						: f)));
				}
			}, [files]);

			const importAll = useCallback(async () => {
				for (const file of files) {
					if (file.phase === "ready") await importOne(file.id);
				}
			}, [files, importOne]);

			const sessions = discover.phase === "ready" ? discover.data.sessions : [];
			const explicit = selection !== "auto";
			// The discover response flags matches for the cwd it was called
			// with (host normalizes both sides — symlink-safe), so both the
			// auto mode and an explicit selection read the same flag.
			const currentOnes = sessions.filter((entry) => entry.matchesCurrentWorkspace);
			const otherOnes = explicit ? [] : sessions.filter((entry) => !entry.matchesCurrentWorkspace);

			// Dropdown roster: every DSH workspace plus cwds found only in
			// other-agent transcripts (offered for registration on import).
			const registeredPaths = new Set(wsList.items.map((item) => item.path));
			const extraCwds = [...new Set(
				sessions.map((entry) => entry.cwd).filter((cwd) => cwd !== null && !registeredPaths.has(cwd)),
			)].sort();
			const shortPath = (p) => p.replace(/^\/Users\/[^/]+/, "~");
			const autoLabel = wsPath !== null
				? tt(t, "auto.modeWith", { path: shortPath(wsPath) })
				: tt(t, "auto.mode");

			return h("div", { className: "dsi-root" },
				h("div", { className: "dsi-backdrop", onClick: () => { setOpen(false); } }),
				h("div", { className: "dsi-modal", role: "dialog", "aria-modal": "true", "aria-label": tt(t, "panel.title") },
					h("div", { className: "dsi-head" },
						h("div", { className: "dsi-headMain" },
							h("h2", { className: "dsi-title" }, tt(t, "panel.title")),
							h("p", { className: "dsi-desc" }, tt(t, "panel.desc"))),
						h("button", {
							type: "button", className: "dsi-close", "aria-label": "close",
							onClick: () => { setOpen(false); },
						}, "✕")),
					h("div", { className: "dsi-body" },

						/* ---- section 1: workspace picker + auto-detected sessions ---- */
						h(SectionHead, { title: tt(t, "auto.title") },
							h("select", {
								className: "dsi-wsSelect",
								value: selection,
								title: selection === "auto" ? (wsPath ?? "") : selection,
								onChange: (event) => { setSelection(event.target.value); },
							},
								h("option", { value: "auto" }, autoLabel),
								wsList.items.map((item) =>
									h("option", { key: item.workspaceId, value: item.path }, shortPath(item.path))),
								extraCwds.map((cwd) =>
									h("option", { key: cwd, value: cwd },
										`${shortPath(cwd)} · ${tt(t, "ws.unregistered")}`))),
							h("button", {
								type: "button", className: "dsi-secBtn",
								"data-busy": String(discover.phase === "scanning"),
								onClick: () => { runDiscover(effectiveCwd); },
							}, tt(t, "auto.rescan"))),

						discover.phase === "scanning"
							? h("div", { className: "dsi-center" }, tt(t, "auto.scanning")) : null,
						discover.phase === "unsupported"
							? h("div", { className: "dsi-center" }, tt(t, "auto.unsupported")) : null,
						discover.phase === "error"
							? h("div", { className: "dsi-center" },
								h("span", { className: "dsi-inlineErr" }, tt(t, "auto.failed", { message: discover.error })))
							: null,
						discover.phase === "ready" && currentOnes.length === 0
							? h("div", { className: "dsi-center" },
								tt(t, explicit ? "ws.noneFound" : "auto.none")) : null,
						discover.phase === "ready" && currentOnes.length > 0
							? h("div", { className: "dsi-list" },
								currentOnes.map((entry) =>
									h(AutoRow, {
										key: entry.path, t, entry,
										state: rowState[entry.path],
										onImport: (e) => { void importDiscovered(e); },
									})))
							: null,

						/* ---- collapsed: other workspaces ---- */
						discover.phase === "ready" && otherOnes.length > 0
							? h(Fragment, null,
								h("div", { style: { marginTop: "10px" } },
									h("button", {
										type: "button", className: "dsi-collapsedToggle",
										onClick: () => { setShowOthers(!showOthers); },
									}, `${showOthers ? "▾" : "▸"} ${tt(t, "auto.others", { count: otherOnes.length })}`)),
								showOthers
									? h("div", { className: "dsi-list", style: { marginTop: "6px" } },
										otherOnes.map((entry) =>
											h(AutoRow, {
												key: entry.path, t, entry,
												state: rowState[entry.path],
												onImport: (e) => { void importDiscovered(e); },
											})))
									: null)
							: null,

						/* ---- section 2: manual import ---- */
						h("div", { style: { marginTop: "18px" } },
							h(SectionHead, { title: tt(t, "manual.title") },
								files.length > 0
									? h("button", {
										type: "button", className: "dsi-secBtn",
										onClick: () => { setFiles([]); },
									}, tt(t, "manual.clear"))
									: null,
								files.some((f) => f.phase === "ready")
									? h("button", {
										type: "button", className: "dsi-secBtn", "data-primary": "true",
										onClick: () => { void importAll(); },
									}, tt(t, "manual.importAll"))
									: null),
							h("div", {
								className: "dsi-drop",
								"data-over": String(dragOver),
								onClick: () => { document.getElementById("dsi-fileInput")?.click(); },
								onDragOver: (event) => {
									event.preventDefault();
									setDragOver(true);
								},
								onDragLeave: () => { setDragOver(false); },
								onDrop: (event) => {
									event.preventDefault();
									setDragOver(false);
									addFiles(event.dataTransfer?.files ?? []);
								},
							},
								h(ImportIcon, { size: 18 }),
								h("div", { className: "dsi-dropMain" }, tt(t, "manual.drop")),
								h("div", null, tt(t, "manual.dropHint"))),
							h("input", {
								id: "dsi-fileInput",
								type: "file",
								accept: ".jsonl,.json,.txt,application/json,text/plain",
								multiple: true,
								style: { display: "none" },
								onChange: (event) => {
									addFiles(event.target?.files ?? []);
									if (event.target !== undefined) event.target.value = "";
								},
							}),
							files.length > 0
								? h("div", { className: "dsi-list", style: { marginTop: "8px" } },
									files.map((file) =>
										h(ManualRow, { key: file.id, t, file, onImport: (id) => { void importOne(id); } })))
								: null),

						anyImported
							? h("div", { className: "dsi-hint" }, tt(t, "note.refresh"))
							: null)));
		}

		function Panel(props) {
			const isOpen = useSyncExternalStore(subscribe, snapshot);
			if (!isOpen) return null;
			return h(Modal, {
				t: props.t,
				subscribeWorkspaces: props.subscribeWorkspaces,
				getWorkspaces: props.getWorkspaces,
				subscribeSessions: props.subscribeSessions,
				getSessions: props.getSessions,
			});
		}

		/* ------------------------------------------------------------------ */
		/* plugin entry                                                        */

		const inject = ["slots", "locale", "workspaces", "sessions"];

		function apply(ctx) {
			// Store bridges: arrows keep `this` binding on the caller's side and
			// read the live stores at call time, so the panel follows selection
			// changes made after this plugin loaded.
			const bridgeStores = () => ({
				subscribeWorkspaces: (fn) => ctx.workspaces.list.subscribe(fn),
				getWorkspaces: () => ctx.workspaces.list.getSnapshot(),
				subscribeSessions: (fn) => ctx.sessions.list.subscribe(fn),
				getSessions: () => ctx.sessions.list.getSnapshot(),
			});

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-import: dictionaries");
			ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () =>
				ctx.slots.register({
					name: "sidebar.footer.action",
					id: "session-import",
					order: 10,
					locale: NS,
				}, FooterAction)), "session-import: footer action");
			ctx.effect(() => ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({
					name: "shell.overlay",
					id: "session-import-panel",
					locale: NS,
					inject: bridgeStores,
				}, Panel)), "session-import: overlay panel");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = PLUGIN_ID;
		return module.exports;
	}
});
