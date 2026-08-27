/**
 * dsh-plugin-token-usage — browser half (hand-authored client bundle).
 *
 * Ships as a lazy-CJS factory for the DSH client module system: the bundle
 * registers itself with `window.__ModuleLoader__.load({ id, factory })` and
 * resolves its externals (React, the slot/locale services) through the
 * injected `require` — the loader's module table. No build step involved.
 *
 * UI contributions:
 *  - a `sidebar.footer.action` entry (icon button above Settings);
 *  - a `shell.overlay` entry rendering the stats modal while open.
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-token-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const { createElement: h, useState, useEffect, useSyncExternalStore, Fragment } = React;

		/* ------------------------------------------------------------------ */
		/* stylesheet (idempotent injection, same discipline as built bundles) */

		const PLUGIN_ID = "dsh-plugin-token-usage";
		const CSS_TAG = `${PLUGIN_ID}/styles.css`;

		const CSS = `
.dtu-foot { display: flex; width: 100%; }
.dtu-footBtn { display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; margin: 2px 6px;
  background: transparent; color: var(--dsw-alias-label-secondary, #5c5c66);
  font-size: 12px; line-height: 20px; cursor: pointer; transition: background .12s ease, color .12s ease; }
.dtu-footBtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(29, 26, 44, .06));
  color: var(--dsw-alias-label-primary, #1d1a2c); }
.dtu-footBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c6bfe); outline-offset: 1px; }
.dtu-footBtn[data-rail="true"] { justify-content: center; margin: 2px 4px; padding: 6px 0; }
.dtu-footBtn svg { flex: none; }

.dtu-root { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  pointer-events: auto; }
.dtu-backdrop { position: absolute; inset: 0; background: rgba(15, 13, 26, .38); backdrop-filter: blur(2px); }
.dtu-modal { position: relative; width: min(780px, calc(100vw - 48px)); max-height: min(640px, calc(100vh - 64px));
  display: flex; flex-direction: column; border-radius: 16px; overflow: hidden;
  background: var(--dsw-alias-bg-overlay, #fff); color: var(--dsw-alias-label-primary, #1d1a2c);
  box-shadow: 0 18px 60px rgba(10, 8, 20, .28), 0 2px 8px rgba(10, 8, 20, .18);
  border: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .08)); }
.dtu-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .08)); }
.dtu-headMain { flex: 1; min-width: 0; }
.dtu-title { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .2px; }
.dtu-desc { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8794); }
.dtu-close { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-tertiary, #8a8794); cursor: pointer; font-size: 16px; }
.dtu-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(29, 26, 44, .06));
  color: var(--dsw-alias-label-primary, #1d1a2c); }

.dtu-body { flex: 1; overflow-y: auto; padding: 16px 20px 20px; }
.dtu-chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 8px; }
.dtu-chip { border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-module-platform, #f5f4f8);
  border: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .06)); }
.dtu-chipValue { font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; }
.dtu-chipLabel { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8794); }
.dtu-chip[data-accent="brand"] { background: rgba(76, 107, 254, .12); }
.dtu-chip[data-accent="brand"] .dtu-chipValue {
  color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, var(--dsw-alias-label-primary, #4c6bfe)); }

.dtu-secTitle { margin: 20px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .4px;
  color: var(--dsw-alias-label-secondary, #5c5c66); text-transform: uppercase; }
.dtu-modelRow { margin-bottom: 10px; }
.dtu-modelHead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.dtu-modelName { font-size: 12px; font-weight: 600; font-family: var(--dsw-alias-font-family-mono, ui-monospace, monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dtu-modelNums { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8794); font-variant-numeric: tabular-nums;
  white-space: nowrap; }
.dtu-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden;
  background: var(--dsw-alias-bg-skeleton, rgba(29, 26, 44, .07)); }
.dtu-barSeg { height: 100%; }
.dtu-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 10px 0 0; }
.dtu-legendItem { display: inline-flex; align-items: center; gap: 5px; font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8a8794); }
.dtu-dot { width: 8px; height: 8px; border-radius: 2px; }

.dtu-tableWrap { border: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .08)); border-radius: 10px; overflow: auto;
  max-height: 300px; }
.dtu-table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
.dtu-table th { position: sticky; top: 0; text-align: left; padding: 8px 10px; font-weight: 600; white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform, #f5f4f8);
  color: var(--dsw-alias-label-secondary, #5c5c66); border-bottom: 1px solid var(--dsw-alias-border-l, rgba(29,26,44,.08)); }
.dtu-table td { padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .05));
  white-space: nowrap; }
.dtu-table tr:last-child td { border-bottom: 0; }
.dtu-table td[data-num], .dtu-table th[data-num] { text-align: right; }
.dtu-model { max-width: 220px; overflow: hidden; text-overflow: ellipsis;
  font-family: var(--dsw-alias-font-family-mono, ui-monospace, monospace); font-size: 11px; }
.dtu-total { font-weight: 650; }

.dtu-footBar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px;
  border-top: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .08));
  background: var(--dsw-alias-bg-module-platform, #faf9fc); }
.dtu-updated { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8794); }
.dtu-refresh { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l, rgba(29, 26, 44, .14)); background: var(--dsw-alias-bg-overlay, #fff);
  color: var(--dsw-alias-label-secondary, #5c5c66); font-size: 12px; cursor: pointer; }
.dtu-refresh:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(29, 26, 44, .06));
  color: var(--dsw-alias-label-primary, #1d1a2c); }
.dtu-refresh[data-busy="true"] { opacity: .6; pointer-events: none; }
.dtu-center { padding: 40px 0; text-align: center; color: var(--dsw-alias-label-tertiary, #8a8794); font-size: 13px; }
.dtu-error { padding: 16px; border-radius: 10px; background: rgba(226, 65, 90, .08);
  color: #c2355a; font-size: 12px; word-break: break-all; }

/* Dark theme: brighten fixed accent colors for the dark surfaces. */
body[data-ds-dark-theme] .dtu-error { background: rgba(229, 122, 147, .12); color: #e57a93; }
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
		/* shared open/close store (footer button <-> overlay panel)           */

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

		const NS = "tokenUsage";
		const zh = {
			"entry.label": "Token 用量",
			"panel.title": "Token 用量统计",
			"panel.desc": "汇总本机全部持久会话中 assistant 消息记录的 token 用量。",
			"panel.refresh": "刷新",
			"panel.loading": "统计中…",
			"panel.empty": "还没有可统计的会话。",
			"panel.error": "加载失败：{message}",
			"panel.updated": "更新于 {time}",
			"panel.calls": "{count} 次调用 · {sessions} 个会话",
			"chip.input": "输入",
			"chip.output": "输出",
			"chip.cacheRead": "缓存读",
			"chip.cacheWrite": "缓存写",
			"chip.billed": "计费输入",
			"chip.sessions": "会话",
			"chip.turns": "轮次",
			"models.title": "按模型",
			"models.none": "暂无模型用量记录。",
			"sessions.title": "按会话",
			"table.time": "时间",
			"table.model": "模型",
			"table.turns": "轮次",
			"table.in": "输入",
			"table.cache": "缓存",
			"table.out": "输出",
			"table.total": "合计",
		};
		const en = {
			"entry.label": "Token usage",
			"panel.title": "Token usage",
			"panel.desc": "Aggregates usage recorded on assistant messages across persisted sessions.",
			"panel.refresh": "Refresh",
			"panel.loading": "Crunching numbers…",
			"panel.empty": "No sessions to report yet.",
			"panel.error": "Failed to load: {message}",
			"panel.updated": "Updated {time}",
			"panel.calls": "{count} calls · {sessions} sessions",
			"chip.input": "Input",
			"chip.output": "Output",
			"chip.cacheRead": "Cache read",
			"chip.cacheWrite": "Cache write",
			"chip.billed": "Billed input",
			"chip.sessions": "Sessions",
			"chip.turns": "Turns",
			"models.title": "By model",
			"models.none": "No model usage recorded.",
			"sessions.title": "By session",
			"table.time": "Time",
			"table.model": "Model",
			"table.turns": "Turns",
			"table.in": "In",
			"table.cache": "Cache",
			"table.out": "Out",
			"table.total": "Total",
		};

		/** Translate with leftover `{param}` substitution (idempotent on an already-expanded string). */
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

		const fmt = (n) => {
			if (typeof n !== "number" || !Number.isFinite(n)) return "–";
			if (n < 1000) return String(n);
			const units = [["G", 1e9], ["M", 1e6], ["k", 1e3]];
			for (const [suffix, size] of units) {
				if (n >= size) {
					const v = n / size;
					return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${suffix}`;
				}
			}
			return String(n);
		};

		const timeFmt = new Intl.DateTimeFormat(undefined, {
			month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
		});
		const fmtTime = (ms) => (typeof ms === "number" && ms > 0 ? timeFmt.format(new Date(ms)) : "–");

		/* ------------------------------------------------------------------ */
		/* icons                                                               */

		const ChartIcon = ({ size = 16 }) => h("svg", {
			width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true",
		},
			h("path", {
				d: "M2.5 13.5h11M4 11V7.5M7.5 11V4M11 11V8.5",
				stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round",
			}));

		const SEGMENTS = [
			["inputTokens", "#4C6BFE"],
			["cacheReadTokens", "#7A5CFF"],
			["cacheWriteTokens", "#22B8CF"],
			["outputTokens", "#2FBF71"],
		];

		/* ------------------------------------------------------------------ */
		/* components                                                          */

		function FooterAction(props) {
			const wide = props.wide === true;
			const label = tt(props.t, "entry.label");
			return h("div", { className: "dtu-foot" },
				h("button", {
					type: "button",
					className: "dtu-footBtn",
					"data-rail": String(!wide),
					title: label,
					"aria-label": label,
					onClick: () => { setOpen(true); },
				},
					h(ChartIcon, { size: wide ? 15 : 17 }),
					wide ? h("span", { className: "dtu-footLabel" }, label) : null,
				));
		}

		function Chip({ label, value, accent }) {
			return h("div", { className: "dtu-chip", "data-accent": accent ?? "plain" },
				h("div", { className: "dtu-chipValue" }, value),
				h("div", { className: "dtu-chipLabel" }, label));
		}

		function ModelRow({ t, model, max }) {
			const billed = model.inputTokens + model.cacheReadTokens + model.cacheWriteTokens;
			const total = billed + model.outputTokens;
			return h("div", { className: "dtu-modelRow" },
				h("div", { className: "dtu-modelHead" },
					h("span", { className: "dtu-modelName", title: `${model.provider}:${model.model}` },
						model.model),
					h("span", { className: "dtu-modelNums" },
						tt(t, "panel.calls", { count: model.calls, sessions: model.sessions }),
						` · ${fmt(total)}`)),
				h("div", { className: "dtu-bar", role: "img", "aria-label": model.model },
					SEGMENTS.map(([bucket, color]) => model[bucket] > 0
						? h("div", {
							key: bucket, className: "dtu-barSeg",
							style: { width: `${(model[bucket] / Math.max(total, 1)) * 100}%`, background: color },
						})
						: null)));
		}

		function SessionsTable({ t, sessions }) {
			return h("div", { className: "dtu-tableWrap" },
				h("table", { className: "dtu-table" },
					h("thead", null,
						h("tr", null,
							h("th", null, tt(t, "table.time")),
							h("th", null, tt(t, "table.model")),
							h("th", { "data-num": "true" }, tt(t, "table.turns")),
							h("th", { "data-num": "true" }, tt(t, "table.in")),
							h("th", { "data-num": "true" }, tt(t, "table.cache")),
							h("th", { "data-num": "true" }, tt(t, "table.out")),
							h("th", { "data-num": "true" }, tt(t, "table.total")))),
					h("tbody", null,
						sessions.map((row) => {
							const cache = row.cacheReadTokens + row.cacheWriteTokens;
							const billed = row.inputTokens + cache;
							const models = Object.keys(row.models);
							return h("tr", { key: row.id },
								h("td", null, fmtTime(row.lastTime ?? row.createdAt)),
								h("td", null,
									h("div", { className: "dtu-model", title: models.join("\n") },
										models.length > 0 ? models.map((k) => k.split(":").pop()).join(", ") : "–")),
								h("td", { "data-num": "true" }, String(row.turns)),
								h("td", { "data-num": "true" }, fmt(row.inputTokens)),
								h("td", { "data-num": "true" }, fmt(cache)),
								h("td", { "data-num": "true" }, fmt(row.outputTokens)),
								h("td", { "data-num": "true" }, h("span", { className: "dtu-total" }, fmt(billed + row.outputTokens))));
						}))));
		}

		function Modal(props) {
			const t = props.t;
			const [state, setState] = useState({ phase: "loading" });
			const [reloadKey, setReloadKey] = useState(0);

			useEffect(() => {
				let cancelled = false;
				setState({ phase: "loading" });
				fetch("/plugins/token-usage/stats", { cache: "no-store" })
					.then(res => res.json().then(body => {
						if (cancelled) return;
						if (res.ok) setState({ phase: "ready", data: body });
						else setState({ phase: "error", message: body?.error ?? `HTTP ${res.status}` });
					}))
					.catch(error => {
						if (cancelled) return;
						setState({ phase: "error", message: error?.message ?? String(error) });
					});
				return () => { cancelled = true; };
			}, [reloadKey]);

			useEffect(() => {
				const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
				window.addEventListener("keydown", onKey);
				return () => { window.removeEventListener("keydown", onKey); };
			}, []);

			const data = state.phase === "ready" ? state.data : undefined;
			const totals = data?.totals;
			const maxModelTotal = data !== undefined
				? Math.max(1, ...data.byModel.map((m) =>
					m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens + m.outputTokens))
				: 1;

			return h("div", { className: "dtu-root" },
				h("div", { className: "dtu-backdrop", onClick: () => { setOpen(false); } }),
				h("div", { className: "dtu-modal", role: "dialog", "aria-modal": "true", "aria-label": tt(t, "panel.title") },
					h("div", { className: "dtu-head" },
						h("div", { className: "dtu-headMain" },
							h("h2", { className: "dtu-title" }, tt(t, "panel.title")),
							h("p", { className: "dtu-desc" }, tt(t, "panel.desc"))),
						h("button", {
							type: "button", className: "dtu-close", "aria-label": "close",
							onClick: () => { setOpen(false); },
						}, "✕")),
					h("div", { className: "dtu-body" },
						state.phase === "loading" ? h("div", { className: "dtu-center" }, tt(t, "panel.loading")) : null,
						state.phase === "error"
							? h("div", { className: "dtu-error" }, tt(t, "panel.error", { message: state.message }))
							: null,
						data !== undefined && data.sessions.length === 0
							? h("div", { className: "dtu-center" }, tt(t, "panel.empty"))
							: null,
						totals !== undefined
							? h("div", { className: "dtu-chips" },
								h(Chip, { label: tt(t, "chip.billed"), accent: "brand",
									value: fmt(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens) }),
								h(Chip, { label: tt(t, "chip.output"), value: fmt(totals.outputTokens) }),
								h(Chip, { label: tt(t, "chip.input"), value: fmt(totals.inputTokens) }),
								h(Chip, { label: tt(t, "chip.cacheRead"), value: fmt(totals.cacheReadTokens) }),
								h(Chip, { label: tt(t, "chip.cacheWrite"), value: fmt(totals.cacheWriteTokens) }),
								h(Chip, { label: tt(t, "chip.sessions"), value: fmt(totals.sessions) }),
								h(Chip, { label: tt(t, "chip.turns"), value: fmt(totals.turns) }))
							: null,
						data !== undefined && data.byModel.length > 0
							? h(Fragment, null,
								h("div", { className: "dtu-secTitle" }, tt(t, "models.title")),
								data.byModel.map((model) =>
									h(ModelRow, { key: `${model.provider}:${model.model}`, t, model, max: maxModelTotal })),
								h("div", { className: "dtu-legend" },
									SEGMENTS.map(([bucket, color]) =>
										h("span", { key: bucket, className: "dtu-legendItem" },
											h("span", { className: "dtu-dot", style: { background: color } }),
											tt(t, `chip.${bucket === "inputTokens" ? "input"
												: bucket === "outputTokens" ? "output"
													: bucket === "cacheReadTokens" ? "cacheRead" : "cacheWrite"}`)))))
							: null,
						data !== undefined && data.sessions.length > 0
							? h(Fragment, null,
								h("div", { className: "dtu-secTitle" }, tt(t, "sessions.title")),
								h(SessionsTable, { t, sessions: data.sessions }))
							: null),
					h("div", { className: "dtu-footBar" },
						h("span", { className: "dtu-updated" },
							data !== undefined ? tt(t, "panel.updated", { time: fmtTime(data.generatedAt) }) : ""),
						h("button", {
							type: "button", className: "dtu-refresh",
							"data-busy": String(state.phase === "loading"),
							onClick: () => { setReloadKey((k) => k + 1); },
						}, tt(t, "panel.refresh")))));
		}

		function Panel(props) {
			const isOpen = useSyncExternalStore(subscribe, snapshot);
			if (!isOpen) return null;
			return h(Modal, { t: props.t });
		}

		/* ------------------------------------------------------------------ */
		/* plugin entry                                                        */

		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "token-usage: dictionaries");
			ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () =>
				ctx.slots.register({
					name: "sidebar.footer.action",
					id: "token-usage",
					order: 20,
					locale: NS,
				}, FooterAction)), "token-usage: footer action");
			ctx.effect(() => ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({
					name: "shell.overlay",
					id: "token-usage-panel",
					locale: NS,
				}, Panel)), "token-usage: overlay panel");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = PLUGIN_ID;
		return module.exports;
	}
});
