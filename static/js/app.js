/* =============================================================================
   1. 基础常量与工具
   ============================================================================= */
const NAV_ITEMS = [
  { key: "home", label: "首页", icon: "home" },
  { key: "workbench", label: "检测工作台" },
  { key: "attribution", label: "归因诊断" },
  { key: "ticket", label: "整改工单" },
  { key: "verify", label: "闭环验证" },
  { key: "knowledge", label: "知识库" },
  { key: "dashboard", label: "分析看板" },
  { key: "runs", label: "复检历史" },
  { key: "alertlog", label: "报警历史" },
];

const NAV_ICONS = {
  home: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-4.5h4V19"/></svg>',
};

const NAV_GROUPS = [
  { label: "诊断流程", keys: ["workbench", "attribution", "ticket", "verify"] },
  { label: "支撑工具", keys: ["knowledge", "dashboard"] },
  { label: "历史记录", keys: ["runs", "alertlog"] },
];

let sampleManifest = null;
let currentSample = null;
let activeView = "home";

const $ = (id) => document.getElementById(id);

function fmt2(v) {
  return Number(v).toFixed(2);
}

/** 百分比展示：整数不补小数位，其余保留两位 */
function pctText(num, unit) {
  if (unit !== "%") return num;
  const n = Number(num);
  return Number.isInteger(n) ? String(n) : fmt2(n);
}

function splitValue(raw) {
  const s = String(raw == null ? "" : raw).trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { num: s, unit: "" };
  return { num: m[1], unit: m[2] };
}

function severityTag(level) {
  const map = { 轻微: "tag-minor", 中等: "tag-mid", 严重: "tag-severe", 正常: "tag-normal" };
  return `<span class="tag ${map[level] || "tag-minor"}">${level || "—"}</span>`;
}

function channelTag(channel) {
  const cls = channel === "实时推理" ? "tag-realtime" : "tag-offline";
  return `<span class="tag ${cls}">${channel}</span>`;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const ICONS = {
  info: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"/></svg>',
  bell: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 5.6 2 6.5H4c0-.9 2-1.5 2-6.5"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.8h6V7"/><path d="M6.5 7l1 12.2h9l1-12.2"/></svg>',
};

function setBtnLoading(btn, on) {
  if (!btn) return;
  if (on) {
    btn.dataset.wasDisabled = btn.disabled ? "1" : "0";
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = btn.dataset.wasDisabled === "1";
  }
}

function showToast(message, ok) {
  let root = $("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    document.body.appendChild(root);
  }
  const t = document.createElement("div");
  t.className = "toast " + (ok === false ? "toast-fail" : "toast-ok");
  t.textContent = message;
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 220);
  }, 2500);
}

function skeletonList(rows) {
  return `<div class="skeleton-list">${Array.from({ length: rows || 3 })
    .map(() => '<div class="skel-block"></div>')
    .join("")}</div>`;
}

function renderError(container, message, retryFn) {
  const el = typeof container === "string" ? $(container) : container;
  if (!el) return;
  el.innerHTML = `<div class="error-state"><span class="error-text">${message}</span><button class="btn btn-ghost btn-sm" data-retry>重试</button></div>`;
  const btn = el.querySelector("[data-retry]");
  if (btn && retryFn) btn.addEventListener("click", retryFn);
}

/** 解析后端时间戳 */
function parseTs(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

function dayKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* =============================================================================
   2. 任务中心：并发互斥、可打断、状态回写
   ============================================================================= */
const TASKS = {
  detect: { label: "缺陷识别", running: false, controller: null },
  attribute: { label: "归因诊断", running: false, controller: null },
  verify: { label: "复检推演", running: false, controller: null },
};

const TASK_BUTTONS = {
  detect: null,
  attribute: () => $("run-attr-btn"),
  verify: () => $("cl-run-btn"),
};
const TASK_STATE_EL = {
  attribute: () => $("attr-run-state"),
  verify: () => $("cl-run-state"),
};

function busyTaskLabels(exclude) {
  return Object.keys(TASKS)
    .filter((k) => k !== exclude && TASKS[k].running)
    .map((k) => TASKS[k].label);
}

/** 抢占一个任务槽；已被自己占用返回 null，被别的任务占用返回 {blockedBy} */
function acquireTask(name) {
  const t = TASKS[name];
  if (!t) return { controller: new AbortController() };
  const blocking = busyTaskLabels(name);
  if (blocking.length) return { blockedBy: blocking.join("、") };
  if (t.running) return null;
  t.running = true;
  t.controller = new AbortController();
  syncTaskUI();
  return { controller: t.controller };
}

/** 可打断任务：先中止在途请求，再重新抢占（用于切换样件） */
function restartTask(name) {
  const t = TASKS[name];
  if (t && t.controller) {
    try { t.controller.abort(); } catch (e) {}
  }
  if (t) { t.running = false; t.controller = null; }
  return acquireTask(name);
}

function releaseTask(name) {
  const t = TASKS[name];
  if (t) { t.running = false; t.controller = null; }
  syncTaskUI();
}

function setStateText(name, text, cls) {
  const get = TASK_STATE_EL[name];
  const el = get ? get() : null;
  if (!el) return;
  el.textContent = text || "";
  el.className = "run-state" + (cls ? " " + cls : "");
}

function syncTaskUI() {
  Object.keys(TASK_BUTTONS).forEach((name) => {
    const get = TASK_BUTTONS[name];
    if (!get) return;
    const btn = get();
    if (!btn) return;
    const t = TASKS[name];
    if (t.running) {
      if (!btn.dataset.idleText) btn.dataset.idleText = btn.textContent;
      btn.classList.add("loading");
      btn.disabled = true;
      btn.textContent = t.label + "中…";
    } else {
      btn.classList.remove("loading");
      if (btn.dataset.idleText) btn.textContent = btn.dataset.idleText;
      btn.disabled = btn.dataset.lockWhenIdle === "1";
    }
  });
  // 复检按钮还受勾选数量约束，交由统一入口重算
  if (typeof syncClRunBtn === "function") syncClRunBtn();
  renderFlowRail();
}

/** 通用确认弹窗，替代 confirm() */
function confirmDialog(title, text, okText) {
  return new Promise((resolve) => {
    const mask = $("modal-mask");
    const modal = $("modal");
    if (!mask || !modal) { resolve(window.confirm(text)); return; }
    $("modal-title").textContent = title;
    $("modal-text").textContent = text;
    $("modal-ok").textContent = okText || "确认";
    mask.classList.remove("hidden");
    modal.classList.remove("hidden");
    $("modal-ok").focus();
    const finish = (v) => {
      mask.classList.add("hidden");
      modal.classList.add("hidden");
      $("modal-ok").removeEventListener("click", onOk);
      $("modal-cancel").removeEventListener("click", onCancel);
      mask.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e) => { if (e.key === "Escape") finish(false); };
    $("modal-ok").addEventListener("click", onOk);
    $("modal-cancel").addEventListener("click", onCancel);
    mask.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);
  });
}

/* ---------- 通用表单弹窗：知识库编辑、工单生成共用 ---------- */
function openFormModal(opts) {
  const mask = $("form-mask");
  const modal = $("form-modal");
  if (!mask || !modal) return;
  $("form-modal-title").textContent = opts.title || "";
  $("form-modal-body").innerHTML = opts.bodyHtml || "";
  $("form-modal-foot").innerHTML =
    opts.footHtml || `<button class="btn btn-ghost btn-sm" data-close>取消</button>`;
  mask.classList.remove("hidden");
  modal.classList.remove("hidden");
  const close = () => closeFormModal();
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  $("form-modal-close").onclick = close;
  mask.onclick = close;
  modal._onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", modal._onKey);
  if (opts.onMount) opts.onMount($("form-modal-body"), $("form-modal-foot"), close);
}

function closeFormModal() {
  const mask = $("form-mask");
  const modal = $("form-modal");
  if (!mask || !modal) return;
  if (modal._onKey) document.removeEventListener("keydown", modal._onKey);
  modal._onKey = null;
  mask.classList.add("hidden");
  modal.classList.add("hidden");
  $("form-modal-body").innerHTML = "";
  $("form-modal-foot").innerHTML = "";
}

/* =============================================================================
   3. 导航与真实流程进度（四步对应四个诊断菜单）
   ============================================================================= */
const FLOW_STEPS = [
  { key: "detect", label: "检测工作台", view: "workbench", desc: "载入样件并识别缺陷" },
  { key: "attribute", label: "归因诊断", view: "attribution", desc: "结合工艺参数定位主因" },
  { key: "ticket", label: "整改工单", view: "ticket", desc: "结论转工单并派发整改" },
  { key: "verify", label: "闭环验证", view: "verify", desc: "复检推演缺陷率降幅" },
];
const FLOW_STORAGE_KEY = "flow_v3";
const FLOW_LEGACY_KEY = "flow_v2";
const FLOW_VIEWS = FLOW_STEPS.map((s) => s.view);
const FLOW_RUNNING = { detect: () => TASKS.detect.running, attribute: () => TASKS.attribute.running, verify: () => TASKS.verify.running };
let flowDone = { detect: false, attribute: false, ticket: false, verify: false };

function loadFlowProgress() {
  flowDone = { detect: false, attribute: false, ticket: false, verify: false };
  const read = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  let parsed = read(FLOW_STORAGE_KEY);
  if (!parsed) {
    const legacy = read(FLOW_LEGACY_KEY);
    if (legacy) {
      parsed = {
        detect: legacy.detect === true || legacy.sample === true,
        attribute: legacy.attribute === true,
        ticket: legacy.ticket === true,
        verify: legacy.verify === true,
      };
      try { localStorage.removeItem(FLOW_LEGACY_KEY); } catch (e) {}
    }
  }
  if (parsed) {
    FLOW_STEPS.forEach((s) => { if (parsed[s.key] === true) flowDone[s.key] = true; });
  }
}

function saveFlowProgress() {
  try { localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flowDone)); } catch (e) {}
}

function setFlow(key, done) {
  if (!(key in flowDone)) return;
  if (flowDone[key] === done) { renderFlowRail(); return; }
  flowDone[key] = done;
  saveFlowProgress();
  renderFlowRail();
}

function stepIndexOfView(view) {
  return FLOW_STEPS.findIndex((s) => s.view === view);
}

function renderNav() {
  const el = $("sidenav");
  if (!el) return;
  const home = `<div class="sidenav-group sidenav-home">${navItemHtml("home")}</div>`;
  const groups = NAV_GROUPS.map(
    (g) => `<div class="sidenav-group">
      <div class="sidenav-group-title">${g.label}</div>
      ${g.keys.map(navItemHtml).join("")}
    </div>`
  ).join("");
  el.innerHTML = `${home}${groups}`;
  el.querySelectorAll(".nav-item").forEach((n) => {
    const go = () => switchView(n.dataset.key);
    n.addEventListener("click", go);
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
  });
}

function navItemHtml(k) {
  const item = NAV_ITEMS.find((n) => n.key === k);
  if (!item) return "";
  const icon = item.icon ? `<span class="nav-item-icon">${NAV_ICONS[item.icon] || ""}</span>` : "";
  const dot = FLOW_VIEWS.includes(k) ? `<span class="nav-dot" data-dot="${k}"></span>` : "";
  return `<div class="nav-item" role="button" tabindex="0" data-key="${item.key}">${icon}${item.label}${dot}</div>`;
}

/** 顶部流程条：只在四个诊断页出现 */
function renderFlowRail() {
  const el = $("flow-rail");
  if (!el) return;
  if (!FLOW_VIEWS.includes(activeView)) {
    el.className = "flow-rail hidden";
    el.innerHTML = "";
    return;
  }
  const curIdx = stepIndexOfView(activeView);
  el.className = "flow-rail";
  const parts = [];
  FLOW_STEPS.forEach((s, i) => {
    const done = flowDone[s.key];
    const running = FLOW_RUNNING[s.key] ? FLOW_RUNNING[s.key]() : false;
    const isCur = i === curIdx;
    const cls = done ? "done" : running ? "running" : isCur ? "current" : "";
    const state = done ? "已完成" : running ? "进行中" : isCur ? "当前步骤" : "未开始";
    parts.push(`<div class="frail-item ${cls}" role="button" tabindex="0" data-flow-view="${s.view}">
      <span class="frail-no">${done ? "✓" : i + 1}</span>
      <span class="frail-body">
        <span class="frail-name">${s.label}</span>
        <span class="frail-desc">${s.desc}</span>
      </span>
      <span class="frail-state">${state}</span>
    </div>`);
    if (i < FLOW_STEPS.length - 1) parts.push('<span class="frail-sep"></span>');
  });
  el.innerHTML = parts.join("");
  const go = (node) => {
    switchView(node.dataset.flowView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  el.querySelectorAll("[data-flow-view]").forEach((n) => {
    n.addEventListener("click", () => go(n));
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(n); }
    });
  });
}

/** 刷新侧栏流程点 */
function renderNavDots() {
  const nav = $("sidenav");
  if (!nav) return;
  nav.querySelectorAll("[data-dot]").forEach((d) => {
    const key = d.dataset.dot;
    const step = FLOW_STEPS.find((s) => s.view === key);
    let state = "todo";
    if (key === activeView) state = "current";
    else if (step && flowDone[step.key]) state = "done";
    d.className = "nav-dot " + state;
  });
}

/* =============================================================================
   4. 视图切换
   ============================================================================= */
const VIEW_IDS = [
  "view-home", "view-workbench", "view-attribution", "view-ticket", "view-verify",
  "view-knowledge", "view-dashboard", "view-runs", "view-alertlog",
];
const BASE_TITLE = "钢材表面质量缺陷智能归因与闭环处置平台";
const VIEW_META = {
  home: { label: "首页" },
  workbench: { label: "检测工作台" },
  attribution: { label: "归因诊断" },
  ticket: { label: "整改工单" },
  verify: { label: "闭环验证" },
  knowledge: { label: "知识库" },
  dashboard: { label: "分析看板" },
  runs: { label: "复检历史" },
  alertlog: { label: "报警历史" },
};

function showView(id) {
  VIEW_IDS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
}

function setDocumentTitle(key) {
  document.title = key === "home" ? BASE_TITLE : `${VIEW_META[key].label} · ${BASE_TITLE}`;
}

function pushViewHistory(key) {
  const hash = "#" + key;
  if (location.hash === hash) return;
  try { history.pushState({ view: key }, "", hash); } catch (e) {}
}

function switchView(key, fromPop) {
  if (!VIEW_META[key]) key = "home";
  activeView = key;
  document.querySelectorAll(".nav-item").forEach((el) => {
    const on = el.dataset.key === key;
    el.classList.toggle("active", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  setDocumentTitle(key);
  if (!fromPop) pushViewHistory(key);
  applyChrome();
  if (key === "home") { showView("view-home"); renderHome(); return; }
  if (key === "workbench") { showView("view-workbench"); return; }
  if (key === "attribution") { showView("view-attribution"); ensureAttributionView(); return; }
  if (key === "ticket") { showView("view-ticket"); loadTickets(); return; }
  if (key === "verify") { showView("view-verify"); loadVerify(); return; }
  if (key === "knowledge") { showView("view-knowledge"); loadKb(); return; }
  if (key === "dashboard") { showView("view-dashboard"); loadDashboard(); return; }
  if (key === "runs") { showView("view-runs"); loadRuns(); return; }
  if (key === "alertlog") { showView("view-alertlog"); loadAlertLog(); return; }
}

function applyChrome() {
  renderMetrics();
  renderSampleBar();
  renderFlowRail();
  renderNavDots();
  updateAttrGuide();
}

function updateAttrGuide() {
  const panel = $("context-panel");
  const btn = $("run-attr-btn");
  const locked = !currentSample;
  if (panel) panel.classList.toggle("locked", locked);
  if (btn) { btn.disabled = locked || TASKS.attribute.running; btn.dataset.lockWhenIdle = locked ? "1" : "0"; }
}

/** 工艺参数表单默认收起，让结论与「生成整改工单」先进入视野 */
function setContextOpen(open) {
  const form = $("context-form");
  const btn = $("context-toggle");
  const state = $("context-state");
  if (!form) return;
  form.classList.toggle("hidden", !open);
  if (btn) {
    btn.textContent = open ? "收起参数" : "展开参数";
    btn.setAttribute("aria-expanded", String(open));
  }
  if (state) {
    state.textContent = open ? "缺什么就补什么，参数越全归因越准" : "参数表单已收起 · 使用当前参数可直接归因";
  }
}

/* =============================================================================
   5. 指标
   ============================================================================= */
let metricsData = null;

async function loadMetrics() {
  const box = $("metrics");
  try {
    const res = await fetch("/api/metrics");
    metricsData = await res.json();
    renderMetrics();
    renderHomeMetrics();
  } catch (e) {
    if (activeView === "home") renderError("home-metrics-body", "指标加载失败", loadMetrics);
    else renderError(box, "指标加载失败", loadMetrics);
    renderHomeMetrics();
  }
}

/* 指标口径提示：把「降幅怎么来的」讲清楚，避免单类与全局口径混淆 */
const METRIC_HINT = {
  闭环缺陷率降幅: "六类缺陷全部整改后的整体相对降幅。只整改其中一类时，该类的有效降幅会小得多，原因见闭环验证页的降幅说明。",
  改进建议可执行率: "知识库全部解决策略中，可直接落地执行的比例。",
  缺陷识别准确率: "NEU-DET 测试集 170/180，离线评测结果。",
  根因定位准确率: "离线评测集结果，基线 92.13%。",
};

function renderMetrics() {
  const box = $("metrics");
  if (!box) return;
  if (activeView !== "dashboard") {
    box.className = "eval-bar hidden";
    box.innerHTML = "";
    return;
  }
  if (!metricsData) {
    box.className = "eval-bar";
    box.innerHTML = `<span class="eval-label">离线评测指标</span><span class="eval-item">指标加载中…</span>`;
    return;
  }
  box.className = "eval-bar";
  box.innerHTML =
    `<span class="eval-label">离线评测指标</span>` +
    metricsData.items
      .map((m) => {
        const { num, unit } = splitValue(m.value);
        const hint = METRIC_HINT[m.label] ? ` title="${METRIC_HINT[m.label]}"` : "";
        return `<span class="eval-item"${hint}>${m.label}<b>${pctText(num, unit)}${unit || ""}</b></span>`;
      })
      .join("");
}

/* =============================================================================
   6. 首页
   ============================================================================= */
function renderHome() {
  renderHomeMetrics();
}

function renderHomeMetrics() {
  const el = $("home-metrics-body");
  if (!el || !metricsData) return;
  el.innerHTML = metricsData.items
    .map((m) => {
      const { num, unit } = splitValue(m.value);
      const numTxt = pctText(num, unit);
      const hint = METRIC_HINT[m.label] ? ` title="${METRIC_HINT[m.label]}"` : "";
      return `<div class="home-metric"${hint}>
        <div class="home-metric-value">${numTxt}${unit ? `<span class="home-metric-unit">${unit}</span>` : ""}</div>
        <div class="home-metric-label">${m.label}</div>
      </div>`;
    })
    .join("");
}

let homeBound = false;
function bindHome() {
  if (homeBound) return;
  homeBound = true;
  const start = $("home-start-btn");
  if (start) start.addEventListener("click", () => {
    switchView("workbench");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  const capBtn = $("home-cap-btn");
  if (capBtn) capBtn.addEventListener("click", () => {
    const el = $("home-cap");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const kpiMore = $("home-kpi-more");
  if (kpiMore) kpiMore.addEventListener("click", () => {
    switchView("dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.querySelectorAll(".cap-card").forEach((card) => {
    const go = () => {
      switchView(card.dataset.view);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
  });
  document.querySelectorAll(".cap-shot img").forEach((img) => {
    img.addEventListener("error", () => img.parentElement.classList.add("no-shot"));
    if (img.complete && img.naturalWidth === 0) img.parentElement.classList.add("no-shot");
  });
}

/* =============================================================================
   7. 检测工作台
   ============================================================================= */
async function loadManifest() {
  const box = $("samples");
  box.innerHTML = skeletonList(3);
  try {
    const res = await fetch("/api/manifest");
    sampleManifest = await res.json();
    renderSamples(sampleManifest.classes);
  } catch (e) {
    renderError(box, "示例样件加载失败", loadManifest);
  }
}

function renderSamples(classes) {
  const box = $("samples");
  if (!classes || !classes.length) {
    box.innerHTML = `<div class="empty-state small"><span class="empty-title">暂无示例样件</span></div>`;
    return;
  }
  box.innerHTML = classes
    .map((group) => {
      const img = (group.images && group.images[0]) || null;
      if (!img) return "";
      return `<button class="sample-card" data-file="${img.file}" data-url="${img.url}" title="${group.cn}">
        <img src="${img.url}" alt="${group.cn}" loading="lazy">
        <span class="sample-card-foot">
          <span class="sc-cn">${group.cn}</span>
          <span class="sc-en">${group.key}</span>
        </span>
      </button>`;
    })
    .join("");
  box.querySelectorAll(".sample-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      markActiveThumb(btn);
      detectSample(btn.dataset.file, btn.dataset.url);
    });
  });
}

function markActiveThumb(btn) {
  $("samples").querySelectorAll(".sample-card").forEach((el) => el.classList.remove("active"));
  btn.classList.add("active");
}

function firstSample() {
  if (!sampleManifest) return null;
  for (const group of sampleManifest.classes) {
    if (group.images && group.images.length) return group.images[0];
  }
  return null;
}

function renderLoading() {
  $("result-panel").innerHTML = `<div class="panel-head"><h2 class="panel-title">识别结果</h2></div>
    <div class="loading" style="min-height:340px"><span class="spinner"></span>正在识别…</div>`;
}

function renderEmpty(message) {
  $("result-panel").innerHTML = `<div class="panel-head"><h2 class="panel-title">识别结果</h2></div>
    <div class="empty-state guide-card">
      <span class="empty-title">${message.title}</span>
      <span class="empty-sub">${message.sub}</span>
      ${message.retry ? `<button class="btn btn-ghost btn-sm" id="result-retry" style="margin-top:12px">重试</button>` : ""}
    </div>`;
  const r = $("result-retry");
  if (r && message.retry) r.addEventListener("click", message.retry);
}

/** 识别结果：左侧图片铺开，右侧纵向信息栏，面板高度随内容收口 */
function renderResult(result, imageUrl, inferMs) {
  if (!result.available) {
    renderEmpty({ title: "无可用识别结果", sub: result.reason || "该图片无离线评测记录" });
    return;
  }
  const weak = result.confidence < 0.7 ? " weak" : "";
  const realtime = result.mode === "realtime";
  const shownImage = realtime && result.annotated_url ? result.annotated_url : imageUrl;
  const boxCount = realtime ? result.detection_count || 0 : 0;
  const confInfo =
    result.defect === "crazing"
      ? `<span class="info-dot" title="识别难点：龟裂 AP 0.383，为六类中识别难度最高">${ICONS.info}</span>`
      : "";
  const rows = realtime
    ? `<div class="row"><span class="k">推理耗时</span><span class="v">${inferMs != null ? inferMs + " ms" : "—"}</span></div>
       <div class="row"><span class="k">conf 阈值</span><span class="v">0.25</span></div>
       <div class="row"><span class="k">NMS IoU</span><span class="v">0.70</span></div>
       <div class="row"><span class="k">NMS 保留框</span><span class="v">${boxCount}</span></div>`
    : `<div class="row"><span class="k">评测来源</span><span class="v plain">NEU-DET 离线评测集</span></div>`;

  $("result-panel").innerHTML = `
    <div class="panel-head">
      <h2 class="panel-title">识别结果</h2>
      <span class="panel-sub">${result.file || ""}</span>
    </div>
    <div class="result-split">
      <figure class="result-figure">
        ${shownImage ? `<img class="result-preview" src="${shownImage}" alt="${result.file || "样件"}">` : ""}
        <figcaption class="result-cap ${realtime ? "realtime" : ""}">${realtime ? "实时推理 · 已标注缺陷位置" : "离线评测结果"}</figcaption>
      </figure>
      <div class="result-side">
        <div class="result-defect">
          <span class="result-defect-big">${result.defect_cn}<span class="en">${result.defect}</span></span>
          ${severityTag(result.severity)}
        </div>
        <div class="result-kv">
          <div class="row"><span class="k">置信度</span><span class="v${weak}">${result.confidence_pct.toFixed(2)}<span class="unit">%</span>${confInfo}</span></div>
          <div class="row"><span class="k">识别通道</span><span class="v plain">${channelTag(result.mode_cn)}</span></div>
          ${rows}
        </div>
        <div class="result-actions">
          <button class="btn btn-primary" id="go-attr-btn">去归因诊断 →</button>
        </div>
      </div>
    </div>`;
  setDefectSelect(result.defect);
  updateSampleBar(result);
  const goAttr = $("go-attr-btn");
  if (goAttr) {
    goAttr.addEventListener("click", () => {
      switchView("attribution");
      ensureAttributionView();
    });
  }
}

function updateSampleBar(result) {
  if (!result || !result.available) return;
  const changed = currentSample && currentSample.defect !== result.defect;
  currentSample = {
    image: result.file,
    defect_cn: result.defect_cn,
    defect: result.defect,
    confidence_pct: result.confidence_pct,
    severity: result.severity,
    channel: result.mode_cn,
  };
  if (changed && lastAttrResult) {
    lastAttrResult = null;
    lastAttrFingerprint = null;
    showToast("已切换样件，此前的归因结论不再适用，请重新归因");
  }
  renderSampleBar();
  updateAttrGuide();
}

function renderSampleBar() {
  const el = $("sample-bar");
  if (!el) return;
  const onView = activeView === "workbench" || activeView === "attribution";
  if (!currentSample || !onView) {
    el.className = "sample-bar hidden";
    el.innerHTML = "";
    return;
  }
  const s = currentSample;
  el.className = "sample-bar";
  el.innerHTML = `<span class="sample-item"><span class="k">图片名</span><span class="v">${s.image}</span></span>
    <span class="sample-sep"></span>
    <span class="sample-item"><span class="k">缺陷类型</span><span class="v">${s.defect_cn}<span class="en">${s.defect}</span></span></span>
    <span class="sample-sep"></span>
    <span class="sample-item"><span class="k">置信度</span><span class="v num">${s.confidence_pct.toFixed(2)}%</span></span>
    <span class="sample-sep"></span>
    <span class="sample-item"><span class="k">严重等级</span>${severityTag(s.severity)}</span>`;
}

function setDefectSelect(defect) {
  const sel = $("defect-select");
  if (sel && [...sel.options].some((o) => o.value === defect)) sel.value = defect;
}

/** 检测：允许打断在途请求（切换样件时） */
async function detectSample(file, imageUrl) {
  const blocking = busyTaskLabels("detect");
  if (blocking.length) {
    showToast(`${blocking.join("、")}进行中，请稍候再试`, false);
    return;
  }
  const got = restartTask("detect");
  if (!got || !got.controller) return;
  renderLoading();
  try {
    const res = await fetch("/api/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
      signal: got.controller.signal,
    });
    const data = await res.json();
    renderResult(data.result, data.result.image_url || imageUrl, null);
    if (data.result && data.result.available) setFlow("detect", true);
    if (data.record) prependRecord(data.record);
    invalidateAlertLog();
    loadAlerts();
  } catch (e) {
    if (e && e.name === "AbortError") return;
    renderEmpty({ title: "识别失败", sub: "请稍后重试", retry: () => detectSample(file, imageUrl) });
  } finally {
    releaseTask("detect");
  }
}

async function detectUpload(file) {
  const blocking = busyTaskLabels("detect");
  if (blocking.length) {
    showToast(`${blocking.join("、")}进行中，请稍候再试`, false);
    return;
  }
  const got = acquireTask("detect");
  if (!got || !got.controller) return;
  renderLoading();
  const form = new FormData();
  form.append("file", file);
  try {
    const t0 = performance.now();
    const res = await fetch("/api/detect/upload", { method: "POST", body: form, signal: got.controller.signal });
    const data = await res.json();
    renderResult(data.result, data.result.image_url, Math.round(performance.now() - t0));
    if (data.result && data.result.available) setFlow("detect", true);
    if (data.record) prependRecord(data.record);
    invalidateAlertLog();
    loadAlerts();
  } catch (e) {
    if (e && e.name === "AbortError") return;
    renderEmpty({ title: "识别失败", sub: "请稍后重试", retry: () => detectUpload(file) });
  } finally {
    releaseTask("detect");
  }
}

/* ---------- 检测记录 ---------- */
function recordRow(rec) {
  const weak = rec.confidence < 0.7 ? " weak" : "";
  return `<tr>
    <td class="num">${rec.ts}</td>
    <td>${rec.image_name}</td>
    <td>${rec.defect_cn}</td>
    <td class="num${weak}">${(rec.confidence * 100).toFixed(2)}%</td>
    <td>${severityTag(rec.severity)}</td>
    <td>${channelTag(rec.channel)}</td>
  </tr>`;
}

function prependRecord(rec) {
  recordsAll.unshift(rec);
  $("records-title").textContent = `检测记录（${recordsAll.length} 条）`;
  renderRecordsPage();
}

const RECORDS_PAGE_SIZE = 10;
let recordsAll = [];
let recordsPage = 1;

async function loadRecords() {
  const body = $("records-body");
  body.innerHTML = Array.from({ length: 3 })
    .map(() => `<tr><td colspan="6" class="skel-cell"><div class="skel-block"></div></td></tr>`)
    .join("");
  try {
    const res = await fetch("/api/records?limit=200");
    const data = await res.json();
    recordsAll = data.items || [];
    $("records-title").textContent = `检测记录（${recordsAll.length} 条）`;
    recordsPage = 1;
    renderRecordsPage();
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6"><div class="error-state"><span class="error-text">检测记录加载失败</span><button class="btn btn-ghost btn-sm" data-retry>重试</button></div></td></tr>`;
    const r = body.querySelector("[data-retry]");
    if (r) r.addEventListener("click", loadRecords);
  }
}

function renderRecordsPage() {
  const body = $("records-body");
  if (!recordsAll.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty-cell">暂无检测记录</td></tr>`;
    $("records-pager").innerHTML = "";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(recordsAll.length / RECORDS_PAGE_SIZE));
  recordsPage = Math.min(Math.max(1, recordsPage), totalPages);
  const start = (recordsPage - 1) * RECORDS_PAGE_SIZE;
  body.innerHTML = recordsAll.slice(start, start + RECORDS_PAGE_SIZE).map(recordRow).join("");
  $("records-pager").innerHTML = `
    <button class="btn btn-ghost btn-sm" id="records-prev"${recordsPage <= 1 ? " disabled" : ""}>上一页</button>
    <span class="pager-info">第 ${recordsPage} / ${totalPages} 页</span>
    <button class="btn btn-ghost btn-sm" id="records-next"${recordsPage >= totalPages ? " disabled" : ""}>下一页</button>`;
  $("records-prev").addEventListener("click", () => { recordsPage -= 1; renderRecordsPage(); });
  $("records-next").addEventListener("click", () => { recordsPage += 1; renderRecordsPage(); });
}

/* =============================================================================
   8. 归因诊断
   ============================================================================= */
const FIELD_LABELS = {
  roll_temp: "轧制温度", roll_speed: "轧制速度", tension: "张力",
  descaling_pressure: "除鳞水压力", roll_gap: "辊缝", reduction_rate: "压下率",
  steel_grade: "钢种", heat_no: "炉号", mn_s_ratio: "Mn/S 比",
  flux_batch_abnormal: "保护渣批次", refine_time: "精炼时间",
  shift_team: "班组", skill_level: "技能等级",
  first_coil_after_roll_change: "是否换辊后首卷", shift: "班次",
  env_temp: "环境温度", env_humidity: "环境湿度",
  dust: "粉尘浓度", cooling_water_temp: "冷却水温",
};

let attrSchema = null;
let lastAttrResult = null;
let lastAttrIsSample = false;
let lastAttrFingerprint = null;
/* 当前结论已生成过的工单：同一条结论不再重复引导生成 */
let attrWoOrder = null;
let attrWoFingerprint = null;

async function loadSchema() {
  $("context-form").innerHTML = `<div class="loading"><span class="spinner"></span>载入工艺参数…</div>`;
  try {
    const res = await fetch("/api/attribute/schema");
    attrSchema = await res.json();
    renderDefectSelect();
    renderScenarioSelect();
    renderContextForm(attrSchema.default_context || {});
  } catch (e) {
    renderError("context-form", "工艺参数加载失败", loadSchema);
  }
}

function renderDefectSelect() {
  const sel = $("defect-select");
  sel.innerHTML = attrSchema.defect_types.map((d) => `<option value="${d.key}">${d.cn}</option>`).join("");
}

function renderScenarioSelect() {
  const sel = $("scenario-select");
  sel.innerHTML =
    `<option value="">选择样例…</option>` +
    attrSchema.scenarios
      .map((s, i) => `<option value="${i}">${s.defect_cn} · ${s.record_id}（${s.steel_grade}）</option>`)
      .join("");
}

const DEFAULT_OPEN_GROUPS = ["设备参数", "物料信息"];

function renderContextForm(context) {
  const box = $("context-form");
  box.innerHTML = attrSchema.groups
    .map((group) => {
      const open = DEFAULT_OPEN_GROUPS.includes(group.title);
      const fields = group.fields
        .map((f) => {
          const val = context[f.key] !== undefined ? context[f.key] : f.default;
          const unit = f.unit ? `<span class="unit">${f.unit}</span>` : "";
          let control;
          if (f.type === "select") {
            control = `<select data-key="${f.key}">${f.options
              .map((o) => `<option value="${o.value}"${String(o.value) === String(val) ? " selected" : ""}>${o.label}</option>`)
              .join("")}</select>`;
          } else {
            const type = f.type === "number" ? "number" : "text";
            const step = f.step !== undefined ? ` step="${f.step}"` : "";
            const cls = f.type === "number" ? ' class="num"' : "";
            control = `<input type="${type}"${cls}${step} data-key="${f.key}" value="${val !== undefined && val !== null ? val : ""}">`;
          }
          return `<label class="form-field">
            <span class="field-label">${f.label}${unit}</span>
            ${control}
          </label>`;
        })
        .join("");
      return `<div class="form-group${open ? " open" : ""}" data-group="${group.title}" data-dim="${group.fields[0] ? group.fields[0].dimension : ""}">
        <div class="form-group-head" data-group-toggle role="button" tabindex="0" aria-expanded="${open ? "true" : "false"}">
          <span class="form-group-title">${group.title}</span>
          <span class="group-badge hidden" data-group-badge></span>
          <span class="group-caret">▾</span>
        </div>
        <div class="form-grid">${fields}</div>
      </div>`;
    })
    .join("");
  box.querySelectorAll("[data-group-toggle]").forEach((head) => {
    const group = head.closest(".form-group");
    const toggle = () => {
      const isOpen = group.classList.toggle("open");
      head.setAttribute("aria-expanded", String(isOpen));
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}

function updateGroupBadges(result) {
  const box = $("context-form");
  if (!box) return;
  const counts = {};
  ((result && result.contributions) || []).forEach((c) => {
    counts[c.dimension] = (c.evidence || []).filter((e) => e.hit).length;
  });
  box.querySelectorAll(".form-group").forEach((g) => {
    const badge = g.querySelector("[data-group-badge]");
    if (!badge) return;
    const n = counts[g.dataset.dim] || 0;
    if (n > 0) {
      badge.textContent = `异常 ${n} 项`;
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "";
      badge.classList.add("hidden");
    }
  });
}

function collectContext() {
  const ctx = {};
  $("context-form").querySelectorAll("[data-key]").forEach((el) => {
    ctx[el.dataset.key] = el.value;
  });
  return ctx;
}

function loadScenario(index) {
  const s = attrSchema.scenarios[index];
  if (!s) return;
  $("defect-select").value = s.defect_type;
  renderContextForm(s.context);
}

/** 归因：不可打断，重复点击忽略，换参数重跑需确认 */
async function runAttribution(skipConfirm) {
  const blocking = busyTaskLabels("attribute");
  if (blocking.length) {
    showToast(`${blocking.join("、")}进行中，请等待完成后再归因`, false);
    return;
  }
  const defect = $("defect-select").value;
  const context = collectContext();
  const fingerprint = defect + "|" + JSON.stringify(context);

  if (!skipConfirm && lastAttrResult && lastAttrFingerprint && lastAttrFingerprint !== fingerprint) {
    const ok = await confirmDialog(
      "重新归因会覆盖当前结论",
      `当前工艺参数与上次归因（${lastAttrResult.top_root_cause || "—"}）不一致。继续将基于新参数重新计算，原结论会被替换。`,
      "重新归因"
    );
    if (!ok) return;
  }

  const got = acquireTask("attribute");
  if (!got) return;
  if (got.blockedBy) {
    showToast(`${got.blockedBy}进行中，请等待完成后再归因`, false);
    return;
  }
  setStateText("attribute", "正在匹配规则库…", "busy");
  try {
    const res = await fetch("/api/attribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defect_type: defect, context }),
      signal: got.controller.signal,
    });
    const data = await res.json();
    if (data.error) {
      lastAttrResult = { error: data.error };
      lastAttrIsSample = false;
      lastAttrFingerprint = null;
      showToast("归因失败：" + data.error, false);
      setStateText("attribute", "归因失败：" + data.error, "fail");
    } else {
      lastAttrResult = data;
      lastAttrIsSample = false;
      lastAttrFingerprint = fingerprint;
      renderAttribution(data, false);
      setFlow("attribute", true);
      showToast("归因完成");
      setStateText("attribute", "归因完成", "ok");
    }
    switchView("attribution");
  } catch (e) {
    if (e && e.name === "AbortError") { setStateText("attribute", "", ""); return; }
    $("attr-body").innerHTML = `<div class="panel placeholder-panel"><div class="empty-state">
      <span class="empty-title">归因失败</span>
      <span class="empty-sub">请稍后重试</span>
      <button class="btn btn-ghost btn-sm" id="attr-retry" style="margin-top:12px">重试</button></div></div>`;
    const r = $("attr-retry");
    if (r) r.addEventListener("click", () => runAttribution(true));
    switchView("attribution");
    showToast("归因失败，请稍后重试", false);
    setStateText("attribute", "归因失败", "fail");
  } finally {
    releaseTask("attribute");
  }
}

function evidenceLevel(e) {
  if (e.hit) return "severe";
  const v = parseFloat(e.value);
  const t = parseFloat(e.threshold);
  if (e.op !== "==" && isFinite(v) && isFinite(t) && t !== 0 && Math.abs(v - t) <= 0.1 * Math.abs(t)) {
    return "warn";
  }
  return "normal";
}

/** 归因结果：结论 + 建议 + 依据，追问收进折叠 */
function renderAttribution(result, isSample) {
  const body = $("attr-body");
  if (!result.top_root_cause) {
    updateGroupBadges({ contributions: [] });
    body.innerHTML = `<div class="panel placeholder-panel"><div class="empty-state">
      <span class="empty-title">未得到归因结论</span>
      <span class="empty-sub">未命中候选根因，请补充数据</span></div></div>`;
    return;
  }
  const conf = (result.confidence * 100).toFixed(2);

  const bars = result.contributions
    .map((c, i) => {
      const width = Math.max(0, Math.min(100, c.score));
      const cls = i === 0 ? "" : "secondary";
      return `<div class="bar-row">
        <div class="bar-name">${c.dimension_cn}</div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width:${width}%"></div></div>
        <div class="bar-value${c.score === 0 ? " zero" : ""}">${c.score.toFixed(2)}%</div>
        <div class="bar-flag">${c.insufficient ? "数据不足" : ""}</div>
      </div>`;
    })
    .join("");

  const evidenceAll = result.contributions.flatMap((c) => c.evidence.map((e) => ({ dim: c.dimension_cn, ...e })));
  const evidenceRows = evidenceAll
    .map((e) => {
      const level = evidenceLevel(e);
      const tag =
        level === "severe" ? '<span class="tag tag-severe">超标</span>'
          : level === "warn" ? '<span class="tag tag-warn">临界</span>'
          : '<span class="tag tag-normal">正常</span>';
      return `<tr class="ev-${level}">
        <td>${e.dim}</td>
        <td>${e.field_label}</td>
        <td class="num">${e.value}</td>
        <td class="num">${e.threshold}</td>
        <td>${e.op}</td>
        <td>${tag}</td>
      </tr>`;
    })
    .join("");
  const normalCount = evidenceAll.filter((e) => evidenceLevel(e) === "normal").length;

  const candidates = result.candidates.length
    ? result.candidates
        .map(
          (c) => `<div class="candidate">
            <div class="candidate-name">
              <span>${c.root_cause}</span>
              <span class="tag ${c.hit ? "tag-severe" : "tag-normal"}">${c.hit ? "命中" : "未命中"}</span>
            </div>
            <div class="candidate-meta">${c.dimension_cn} · 强度 ${(c.strength * 100).toFixed(2)}%${
            c.expected_drop_pct != null ? ` · 预期降幅 ${c.expected_drop_pct}%` : ""
          }</div>
            <div class="candidate-solution">${c.solution || ""}</div>
          </div>`
        )
        .join("")
    : `<div class="empty-state small"><span class="empty-title">除主因外无其他候选根因</span></div>`;

  const missingHtml =
    result.missing_fields.length || result.insufficient_dimensions.length
      ? `<div class="notice notice-warn" style="margin-top:12px;margin-bottom:0">
          <span class="notice-title">数据不足</span>
          <span class="notice-text">以下字段缺失，对应维度未参与计算：${
            result.missing_fields.map((m) => m.label + "（" + m.dimension_cn + "）").join("、") || "—"
          }</span>
        </div>`
      : "";

  body.innerHTML = `
    <section class="panel sec sec-lead" id="sec-conclusion">
      <div class="sec-head">
        <span class="sec-no">1</span><h2 class="panel-title">主因结论</h2>
        <span class="sec-note">${result.defect_cn} · 置信度 ${conf}%${isSample ? " · 离线样例" : ""}</span>
      </div>
      <div class="attr-main">
        <div class="attr-cause">
          <div class="attr-cause-label">主因根因</div>
          <div class="attr-cause-name">${result.top_root_cause}</div>
          <div class="attr-cause-sub">所属维度 · ${result.top_dimension_cn}</div>
        </div>
        <div class="attr-metric">
          <span class="k">根因置信度</span>
          <span class="v">${conf}%</span>
        </div>
        <div class="attr-metric">
          <span class="k">建议预期降幅</span>
          <span class="v">${result.expected_drop_pct != null ? result.expected_drop_pct + "%" : "—"}</span>
        </div>
      </div>
      <div class="attr-solution"><span class="attr-solution-label">整改建议</span>${escapeHtml(result.solution || "—")}</div>
      <div class="attr-cta" id="attr-cta"></div>
      ${missingHtml}
    </section>

    <section class="panel sec" id="sec-basis">
      <div class="sec-head"><span class="sec-no">2</span><h2 class="panel-title">归因依据</h2>
        <span class="sec-note">贡献度 · 候选根因 · 证据明细</span></div>
      <div class="attr-cols">
        <div>
          <div class="collapse-title" style="margin-bottom:10px">四维贡献度</div>
          <div class="bars">${bars}</div>
        </div>
        <div>
          <div class="collapse-title" style="margin-bottom:10px">候选根因（${result.candidates.length}）</div>
          <div>${candidates}</div>
        </div>
      </div>
      <div style="margin-top:var(--gap)">
        <div class="collapse-title" style="margin-bottom:8px">证据明细</div>
        <div class="table-wrap">
          <table class="data-table evidence-table">
            <thead><tr>
              <th>维度</th><th>字段名</th><th>实际值</th><th>阈值</th><th>比较符</th><th>是否超标</th>
            </tr></thead>
            <tbody>${
              evidenceRows || `<tr><td colspan="6" class="empty-cell">无命中证据（当前参数均未超出阈值）</td></tr>`
            }</tbody>
          </table>
        </div>
        ${
          normalCount
            ? `<button class="btn btn-ghost btn-sm evidence-toggle" id="evidence-toggle">显示全部 ${evidenceAll.length} 项（含 ${normalCount} 项正常）</button>`
            : ""
        }
      </div>
    </section>

    <section class="panel sec" id="sec-qa">
      <div class="collapse" id="qa-collapse">
        <div class="collapse-head" role="button" tabindex="0" aria-expanded="false" id="qa-toggle">
          <h3 class="collapse-title">针对本次结论追问</h3>
          <span class="collapse-note">已注入本次归因证据链</span>
          <span class="collapse-caret">▾</span>
        </div>
        <div class="collapse-body" id="qa-body"></div>
      </div>
    </section>`;

  renderQa(result);
  renderAttrCta(result);
  updateGroupBadges(result);

  const evToggle = $("evidence-toggle");
  if (evToggle) {
    evToggle.addEventListener("click", () => {
      const table = document.querySelector(".evidence-table");
      if (!table) return;
      const on = table.classList.toggle("show-normal");
      evToggle.textContent = on
        ? "仅显示超标与临界项"
        : `显示全部 ${evidenceAll.length} 项（含 ${normalCount} 项正常）`;
    });
  }
  const qaToggle = $("qa-toggle");
  if (qaToggle) {
    const toggle = () => {
      const box = $("qa-collapse");
      const open = box.classList.toggle("open");
      qaToggle.setAttribute("aria-expanded", String(open));
    };
    qaToggle.addEventListener("click", toggle);
    qaToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  }
}

/** 结论区的唯一行动入口：未生成时引导生成，已生成后转为跟踪入口 */
function renderAttrCta(result) {
  const box = $("attr-cta");
  if (!box) return;
  const wo = attrWoFingerprint && attrWoFingerprint === lastAttrFingerprint ? attrWoOrder : null;

  if (wo) {
    box.className = "attr-cta is-done";
    box.innerHTML = `
      <span class="attr-cta-tag">已生成整改工单</span>
      <span class="attr-cta-no">${escapeHtml(wo.ticket_no || "—")}</span>
      <span class="attr-cta-meta">责任人 ${escapeHtml(wo.owner || "待指派")} · ${STATUS_LABEL[wo.status] || wo.status} · ${escapeHtml(wo.created_at || "")}</span>
      <span class="attr-cta-hint">到整改工单页推进状态，完工后在闭环验证里勾选这张工单复检。</span>
      <div class="attr-cta-ops">
        <button class="btn btn-primary" id="attr-go-ticket">去整改工单页派发</button>
        <button class="btn btn-ghost" id="attr-wo-again">再生成一张</button>
      </div>`;
    $("attr-go-ticket").addEventListener("click", () => {
      highlightWoId = wo.id;
      switchView("ticket");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("attr-wo-again").addEventListener("click", () => openWorkOrderModal(result));
    return;
  }

  box.className = "attr-cta";
  box.innerHTML = `
    <span class="attr-cta-title">下一步：把这条结论转成整改工单</span>
    <span class="attr-cta-hint">生成后指派责任人并推进到已完成，整改完成后在闭环验证里勾选这张工单复检降幅。</span>
    <div class="attr-cta-ops">
      <button class="btn btn-primary" id="attr-wo-btn">生成整改工单</button>
    </div>`;
  $("attr-wo-btn").addEventListener("click", () => openWorkOrderModal(result));
}

/** 无结论时的空态：没有样件就引导去检测工作台，有样件就引导开始归因 */
function renderAttrEmpty() {
  updateGroupBadges({ contributions: [] });
  attrWoOrder = null;
  attrWoFingerprint = null;
  const hasSample = !!currentSample;
  $("attr-body").innerHTML = `<div class="panel placeholder-panel">
    <div class="empty-state attr-empty">
      <span class="empty-title">${hasSample ? "尚未开始归因" : "还没有选择样件"}</span>
      <span class="empty-sub">${
        hasSample
          ? "工艺参数已就绪，点上方「开始归因」得到主因结论、四维贡献度与整改建议。"
          : "归因以一次缺陷识别的结果为起点，请先到检测工作台载入样件。"
      }</span>
      ${
        hasSample
          ? ""
          : `<div class="attr-empty-ops"><button class="btn btn-primary btn-sm" id="attr-empty-go">去检测工作台</button></div>`
      }
    </div>
  </div>`;
  const go = $("attr-empty-go");
  if (go) {
    go.addEventListener("click", () => {
      switchView("workbench");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
}

function ensureAttributionView() {
  if (lastAttrResult) {
    if (lastAttrResult.error) {
      $("attr-body").innerHTML = `<div class="panel placeholder-panel"><div class="empty-state">
        <span class="empty-title">归因失败</span><span class="empty-sub">${lastAttrResult.error}</span>
        <button class="btn btn-ghost btn-sm" id="attr-retry" style="margin-top:12px">重试</button></div></div>`;
      const r = $("attr-retry");
      if (r) r.addEventListener("click", () => runAttribution(true));
      return;
    }
    renderAttribution(lastAttrResult, lastAttrIsSample);
    return;
  }
  /* 没有归因结果就不展示任何结论：不预置离线样例，避免与「还没选样件」互相矛盾 */
  renderAttrEmpty();
}

async function loadFirstSample() {
  if (!sampleManifest) await loadManifest();
  const sample = firstSample();
  if (!sample) return;
  const btn = $("samples").querySelector(`.sample-card[data-file="${sample.file}"]`);
  if (btn) markActiveThumb(btn);
  await detectSample(sample.file, sample.url);
}

/* ---------- 工单生成弹窗 ---------- */
function openWorkOrderModal(result) {
  openFormModal({
    title: "生成整改工单",
    bodyHtml: `
      <div class="form-readonly">
        <div class="row"><span class="k">缺陷类型</span><span class="v">${result.defect_cn || "—"}</span></div>
        <div class="row"><span class="k">主因根因</span><span class="v">${escapeHtml(result.top_root_cause || "—")}</span></div>
        <div class="row"><span class="k">根因维度</span><span class="v">${result.top_dimension_cn || "—"}</span></div>
        ${result.expected_drop_pct != null
          ? `<div class="row"><span class="k">预期降幅</span><span class="v">${result.expected_drop_pct}%</span></div>`
          : ""}
      </div>
      <div class="form-grid-2">
        <label class="form-field full"><span class="field-label">整改措施</span>
          <textarea id="wo-f-measure" rows="3">${escapeHtml(result.solution || "")}</textarea></label>
        <label class="form-field"><span class="field-label">责任人</span>
          <input type="text" id="wo-f-owner" placeholder="如：张工 / 甲班"></label>
        <label class="form-field"><span class="field-label">关联检测记录</span>
          <input type="text" id="wo-f-record" placeholder="可留空"></label>
      </div>`,
    footHtml: `<span class="foot-note">生成后状态为「待处理」，可在整改工单页推进到已关闭。</span>
      <button class="btn btn-ghost btn-sm" data-close>取消</button>
      <button class="btn btn-primary btn-sm" id="wo-f-submit">确认生成</button>`,
    onMount(box, foot, close) {
      const rec = $("wo-f-record");
      if (rec && currentSample && currentSample.image) rec.value = currentSample.image;
      $("wo-f-submit").addEventListener("click", async () => {
        const measure = $("wo-f-measure").value.trim();
        if (!measure) {
          showToast("整改措施不能为空", false);
          return;
        }
        const owner = $("wo-f-owner").value.trim() || "待指派";
        const btn = $("wo-f-submit");
        setBtnLoading(btn, true);
        try {
          const res = await fetch("/api/work-orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              record_ref: $("wo-f-record").value.trim() || "—",
              defect_cn: result.defect_cn || "",
              root_cause: result.top_root_cause || "",
              dimension_cn: result.top_dimension_cn || "",
              measure,
              owner,
            }),
          });
          if (!res.ok) {
            let msg = "工单生成失败";
            try { const d = await res.json(); if (d && d.detail) msg = d.detail; } catch (e) {}
            throw new Error(msg);
          }
          const order = await res.json();
          close();
          attrWoOrder = order && order.id ? order : null;
          attrWoFingerprint = lastAttrFingerprint;
          renderAttrCta(result);
          setFlow("ticket", true);
          showToast(`整改工单 ${order && order.ticket_no ? order.ticket_no : ""} 已生成，可到整改工单页派发`);
        } catch (e) {
          setBtnLoading(btn, false);
          showToast(e.message || "工单生成失败，请重试", false);
        }
      });
    },
  });
}

/* ---------- 智能问答 ---------- */
function renderQa(result) {
  const el = $("qa-body");
  if (!el) return;
  el.innerHTML = `<div class="qa-samples">
      <button class="btn btn-ghost btn-sm" data-q="为什么会出现${result.defect_cn}？">为什么会出现${result.defect_cn}？</button>
      <button class="btn btn-ghost btn-sm" data-q="支持这个主因的证据链是什么？">支持这个主因的证据链是什么？</button>
    </div>
    <div class="qa-input-row">
      <input id="qa-input" placeholder="追问，例如：为什么会出现${result.defect_cn}？">
      <button class="btn" id="qa-ask">提问</button>
    </div>
    <div class="qa-answer" id="qa-answer"></div>`;
  el.querySelectorAll("[data-q]").forEach((b) =>
    b.addEventListener("click", () => {
      $("qa-input").value = b.dataset.q;
      askQa(result, b.dataset.q);
    })
  );
  $("qa-ask").addEventListener("click", () => {
    const q = $("qa-input").value.trim();
    if (q) askQa(result, q);
  });
}

async function askQa(result, question) {
  const box = $("qa-answer");
  box.innerHTML = `<div class="loading"><span class="spinner"></span>模型思考中…</div>`;
  try {
    const res = await fetch("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, defect_type: result.defect_type, attribution: result }),
    });
    const d = await res.json();
    box.innerHTML = `${escapeHtml(d.answer || "")}
      <div class="qa-evidence">${d.source || ""}<br>本次证据链：主因 ${result.top_root_cause || "—"}（${
      result.top_dimension_cn || "—"
    }）；贡献度 ${(result.contributions || []).map((c) => c.dimension_cn + " " + c.score + "%").join("、")}</div>`;
  } catch (e) {
    renderError(box, "问答请求失败", () => askQa(result, question));
  }
}

/* =============================================================================
   9. 知识库：三筛选联动 + 按维度分组折叠 + 弹窗编辑
   ============================================================================= */
const KB_DEFECTS = [
  { key: "crazing", cn: "龟裂" },
  { key: "inclusion", cn: "夹杂" },
  { key: "patches", cn: "斑块" },
  { key: "pitted_surface", cn: "麻点" },
  { key: "rolled-in_scale", cn: "氧化皮压入" },
  { key: "scratches", cn: "划痕" },
];
const KB_DIMENSIONS = [
  { key: "equipment", cn: "设备参数" },
  { key: "material", cn: "物料批次" },
  { key: "operator", cn: "人员操作" },
  { key: "environment", cn: "环境条件" },
];

let kbRules = [];
let kbMetaLoaded = false;
let kbStats = null;

async function loadKb() {
  if (kbMetaLoaded) { renderKbGroups(); return; }
  $("kb-list").innerHTML = skeletonList(3);
  try {
    const res = await fetch("/api/kb/rules");
    const d = await res.json();
    kbRules = d.items || [];
    $("kb-filter").innerHTML =
      `<option value="">全部缺陷类型</option>` +
      (d.defects || []).map((x) => `<option value="${x.key}">${x.cn}</option>`).join("");
    $("kb-dim-filter").innerHTML =
      `<option value="">全部根因维度</option>` +
      (d.dimensions || KB_DIMENSIONS).map((x) => `<option value="${x.key}">${x.cn}</option>`).join("");
    $("kb-filter").addEventListener("change", renderKbGroups);
    $("kb-dim-filter").addEventListener("change", renderKbGroups);
    $("kb-search").addEventListener("input", renderKbGroups);
    $("kb-add-btn").addEventListener("click", () => openKbEditor(null));
    kbMetaLoaded = true;
    renderKbGroups();
    loadSuggestionStats();
  } catch (e) {
    renderError("kb-list", "规则加载失败", loadKb);
  }
}

/** 建议可执行率并入知识库，作为规则库的统计口径 */
async function loadSuggestionStats() {
  const el = $("kb-stat");
  if (!el) return;
  try {
    const res = await fetch("/api/suggestions/stats");
    kbStats = await res.json();
    renderKbStat();
  } catch (e) {
    el.innerHTML = `<span class="kb-stat-note">建议可执行率统计加载失败</span>`;
  }
}

function renderKbStat() {
  const el = $("kb-stat");
  if (!el || !kbStats) return;
  el.innerHTML = `<span class="kb-stat-item">已生成建议<b>${kbStats.total}</b></span>
    <span class="kb-stat-item">可执行<b>${kbStats.executable}</b></span>
    <span class="kb-stat-item">占比<b>${kbStats.rate}%</b></span>
    <span class="kb-stat-note" title="${(kbStats.criteria || []).map((c) => c.label + "：" + c.desc).join("\n")}">${kbStats.source}</span>`;
}

function kbFiltered() {
  const defect = $("kb-filter").value;
  const dim = $("kb-dim-filter").value;
  const kw = ($("kb-search").value || "").trim().toLowerCase();
  return kbRules.filter((r) => {
    if (defect && r.defect !== defect) return false;
    if (dim && (r.dimension || "equipment") !== dim) return false;
    if (kw) {
      const hay = `${r.root_cause} ${r.trigger_text} ${r.solution} ${r.defect_cn}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function kbCardHtml(r) {
  return `<div class="kb-card ${r.enabled ? "" : "disabled"}">
    <div class="kb-card-head">
      <span class="kb-rule-id">${r.rule_id || "#" + r.id} · ${r.defect_cn}</span>
      <label class="switch" title="${r.enabled ? "停用" : "启用"}">
        <input type="checkbox" data-act="toggle" data-id="${r.id}" ${r.enabled ? "checked" : ""}>
        <span class="switch-track"></span>
      </label>
    </div>
    <div class="kb-field"><span class="k">根因</span><span class="v">${escapeHtml(r.root_cause)}</span></div>
    <div class="kb-field"><span class="k">触发条件</span><span class="v kb-cond">${escapeHtml(r.trigger_text)}</span></div>
    <div class="kb-field"><span class="k">解决策略</span><span class="v kb-sol">${escapeHtml(r.solution)}</span></div>
    <div class="kb-field"><span class="k">预期降幅</span><span class="v kb-drop">${r.expected_drop_pct}%</span></div>
    <div class="kb-actions">
      <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">编辑</button>
    </div>
  </div>`;
}

function renderKbGroups() {
  const el = $("kb-list");
  const countEl = $("kb-count");
  const items = kbFiltered();
  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-title">没有匹配的规则</span><span class="empty-sub">换个筛选条件或关键词试试</span></div>`;
    if (countEl) countEl.textContent = `共 ${kbRules.length} 条 · 当前 0 条`;
    return;
  }
  if (countEl) countEl.textContent = `共 ${kbRules.length} 条 · 当前 ${items.length} 条`;
  const groups = KB_DIMENSIONS.map((d) => ({
    key: d.key, cn: d.cn,
    items: items.filter((r) => (r.dimension || "equipment") === d.key),
  })).filter((g) => g.items.length);
  const others = items.filter((r) => !KB_DIMENSIONS.some((d) => d.key === (r.dimension || "equipment")));
  if (others.length) groups.push({ key: "other", cn: "其他", items: others });

  el.innerHTML = groups
    .map(
      (g, i) => `<div class="kb-group ${i === 0 ? "open" : ""}" data-group="${g.key}">
        <div class="kb-group-head" data-group-toggle role="button" tabindex="0" aria-expanded="${i === 0 ? "true" : "false"}">
          <span class="kb-group-title">${g.cn}</span>
          <span class="kb-group-count">${g.items.length} 条</span>
          <span class="kb-group-caret">▾</span>
        </div>
        <div class="kb-group-body">${g.items.map(kbCardHtml).join("")}</div>
      </div>`
    )
    .join("");
  el.querySelectorAll("[data-group-toggle]").forEach((head) => {
    const g = head.closest(".kb-group");
    const toggle = () => {
      const open = g.classList.toggle("open");
      head.setAttribute("aria-expanded", String(open));
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
  el.querySelectorAll("[data-act]").forEach((b) => {
    if (b.tagName === "INPUT") b.addEventListener("change", () => kbAction("toggle", Number(b.dataset.id)));
    else b.addEventListener("click", () => kbAction(b.dataset.act, Number(b.dataset.id)));
  });
}

async function kbAction(act, id) {
  const rule = kbRules.find((r) => r.id === id);
  if (!rule) return;
  if (act === "toggle") {
    await fetch(`/api/kb/rules/${id}/toggle`, { method: "POST" });
    await reloadKb();
  } else if (act === "edit") {
    openKbEditor(rule);
  }
}

async function reloadKb() {
  const res = await fetch("/api/kb/rules");
  const d = await res.json();
  kbRules = d.items || [];
  renderKbGroups();
}

function openKbEditor(rule) {
  const isNew = !rule;
  openFormModal({
    title: `${isNew ? "新增规则" : "编辑规则"}${rule ? " · " + (rule.rule_id || "#" + rule.id) : ""}`,
    bodyHtml: `<div class="form-grid-2">
      <label class="form-field"><span class="field-label">缺陷类型</span>
        <select id="kb-f-defect">${KB_DEFECTS.map(
          (d) => `<option value="${d.key}"${rule && rule.defect === d.key ? " selected" : ""}>${d.cn}</option>`
        ).join("")}</select></label>
      <label class="form-field"><span class="field-label">预期降幅（%）</span>
        <input type="number" class="num" id="kb-f-drop" value="${rule ? rule.expected_drop_pct : 0}"></label>
      <label class="form-field full"><span class="field-label">根因</span>
        <input type="text" id="kb-f-root" value="${rule ? escapeHtml(rule.root_cause) : ""}"></label>
      <label class="form-field full"><span class="field-label">触发条件</span>
        <input type="text" id="kb-f-trigger" value="${rule ? escapeHtml(rule.trigger_text) : ""}" placeholder="如：轧制温度 < 1100℃"></label>
      <label class="form-field full"><span class="field-label">解决策略</span>
        <textarea id="kb-f-solution" rows="3">${rule ? escapeHtml(rule.solution) : ""}</textarea></label>
      <label class="form-field"><span class="field-label">状态</span>
        <select id="kb-f-enabled">
          <option value="1"${!rule || rule.enabled ? " selected" : ""}>启用</option>
          <option value="0"${rule && !rule.enabled ? " selected" : ""}>停用</option>
        </select></label>
    </div>`,
    footHtml: `${!isNew ? `<button class="btn btn-danger btn-sm" id="kb-delete">${ICONS.trash}删除规则</button>` : ""}
      <span class="foot-note"></span>
      <button class="btn btn-ghost btn-sm" data-close>取消</button>
      <button class="btn btn-primary btn-sm" id="kb-save">${isNew ? "新增" : "保存"}</button>`,
    onMount(box, foot, close) {
      const del = $("kb-delete");
      if (del) {
        del.addEventListener("click", async () => {
          const ok = await confirmDialog("删除规则", `删除规则「${rule.root_cause}」后将无法恢复，确认删除？`, "删除");
          if (!ok) return;
          await fetch(`/api/kb/rules/${rule.id}`, { method: "DELETE" });
          close();
          await reloadKb();
          showToast("规则已删除");
        });
      }
      $("kb-save").addEventListener("click", async () => {
        const payload = {
          defect: $("kb-f-defect").value,
          defect_cn: KB_DEFECTS.find((d) => d.key === $("kb-f-defect").value).cn,
          root_cause: $("kb-f-root").value.trim(),
          trigger_text: $("kb-f-trigger").value.trim(),
          solution: $("kb-f-solution").value.trim(),
          expected_drop_pct: Number($("kb-f-drop").value || 0),
          enabled: $("kb-f-enabled").value === "1",
        };
        if (!payload.root_cause || !payload.solution) {
          showToast("根因与解决策略必填", false);
          return;
        }
        const btn = $("kb-save");
        setBtnLoading(btn, true);
        try {
          const url = isNew ? "/api/kb/rules" : `/api/kb/rules/${rule.id}`;
          const res = await fetch(url, {
            method: isNew ? "POST" : "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error("保存失败");
          close();
          await reloadKb();
          showToast(isNew ? "规则已新增" : "规则已保存");
        } catch (e) {
          setBtnLoading(btn, false);
          showToast("保存失败，请重试", false);
        }
      });
    },
  });
}

/* =============================================================================
   10. 整改工单
   ============================================================================= */
let woMetaLoaded = false;
let woAll = [];
let woActiveStatus = "";
let highlightWoId = null;

const STATUS_LABEL = { 待处理: "待处理", 处理中: "处理中", 已解决: "已完成", 已关闭: "已关闭" };
const STATUS_CLASS = { 待处理: "status-pending", 处理中: "status-doing", 已解决: "status-done", 已关闭: "status-closed" };
const WO_STATUSES = ["待处理", "处理中", "已解决", "已关闭"];
const WO_TRACK_HINT = {
  待处理: "点击「开始整改」进入处理中",
  处理中: "整改完成后点「完成整改」",
  已解决: "可去闭环验证，或验收后关闭工单",
  已关闭: "已闭环归档",
};

function statusTag(s) {
  return `<span class="tag status-pill ${STATUS_CLASS[s] || ""}">${STATUS_LABEL[s] || s}</span>`;
}

function emptyVal(x) {
  if (x === null || x === undefined || x === "") {
    return `<span class="v v-empty">—</span>`;
  }
  return `<span class="v">${escapeHtml(String(x))}</span>`;
}

async function loadTickets() {
  $("wo-list").innerHTML = skeletonList(3);
  try {
    const res = await fetch("/api/work-orders");
    const d = await res.json();
    if (!woMetaLoaded) {
      $("wo-dim-filter").innerHTML =
        `<option value="">全部维度</option>` + (d.dimensions || []).map((x) => `<option value="${x.cn}">${x.cn}</option>`).join("");
      $("wo-dim-filter").addEventListener("change", renderTickets);
      $("wo-search").addEventListener("input", renderTickets);
      woMetaLoaded = true;
    }
    woAll = d.items || [];
    renderWoTabs();
    renderTickets();
  } catch (e) {
    renderError("wo-list", "工单加载失败", loadTickets);
  }
}

function renderWoTabs() {
  const el = $("wo-tabs");
  if (!el) return;
  const tabs = [{ key: "", label: "全部", count: woAll.length }].concat(
    WO_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], count: woAll.filter((o) => o.status === s).length }))
  );
  el.innerHTML = tabs
    .map(
      (t) => `<button class="wo-tab${woActiveStatus === t.key ? " active" : ""}" data-wo-tab="${t.key}">
        ${t.label}<span class="wo-tab-count">${t.count}</span>
      </button>`
    )
    .join("");
  el.querySelectorAll("[data-wo-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      woActiveStatus = b.dataset.woTab;
      highlightWoId = null;
      renderWoTabs();
      renderTickets();
    })
  );
}

function woFiltered() {
  const dim = $("wo-dim-filter") ? $("wo-dim-filter").value : "";
  const kwEl = $("wo-search");
  const kw = kwEl ? (kwEl.value || "").trim().toLowerCase() : "";
  return woAll.filter((o) => {
    if (woActiveStatus && o.status !== woActiveStatus) return false;
    if (dim && o.dimension_cn !== dim) return false;
    if (kw) {
      const hay = `${o.ticket_no} ${o.root_cause} ${o.measure} ${o.owner} ${o.defect_cn}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function renderTickets() {
  const el = $("wo-list");
  const countEl = $("wo-count");
  const items = woFiltered();
  if (countEl) countEl.textContent = `共 ${woAll.length} 条 · 当前 ${items.length} 条`;
  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-title">${woAll.length ? "当前筛选下没有工单" : "暂无工单"}</span><span class="empty-sub">${
      woAll.length ? "换个状态或维度筛选试试" : "在归因诊断页得到主因后，点击「生成整改工单」即可创建"
    }</span></div>`;
    return;
  }
  el.innerHTML = items
    .map((o) => {
      const idx = WO_STATUSES.indexOf(o.status);
      const track = WO_STATUSES.map((s, i) => {
        const cls = i < idx ? "done" : i === idx ? "current" : "todo";
        const node = `<span class="wo-track-node ${cls}"><span class="wo-track-dot"></span><span class="wo-track-label">${STATUS_LABEL[s]}</span></span>`;
        const sep = i < WO_STATUSES.length - 1 ? '<span class="wo-track-sep"></span>' : "";
        return node + sep;
      }).join("");
      const hl = highlightWoId && Number(highlightWoId) === o.id ? " highlight" : "";
      return `<div class="wo-card${hl}" data-wo="${o.id}">
        <div class="wo-card-head">
          <span class="wo-no">${o.ticket_no}</span>
          ${statusTag(o.status)}
          ${o.defect_cn ? `<span class="tag tag-dim">${o.defect_cn}</span>` : ""}
          <div class="wo-actions">${ticketAction(o)}</div>
        </div>
        <div class="wo-grid">
          <div class="wo-field wide"><span class="k">主因</span>${emptyVal(o.root_cause)}</div>
          <div class="wo-field wide"><span class="k">整改措施</span>${emptyVal(o.measure)}</div>
          <div class="wo-field"><span class="k">根因维度</span>${emptyVal(o.dimension_cn)}</div>
          <div class="wo-field"><span class="k">责任人</span>${emptyVal(o.owner)}</div>
          <div class="wo-field"><span class="k">关联记录</span>${emptyVal(o.record_ref)}</div>
          <div class="wo-field wide"><span class="k">时间</span><span class="v">创建 ${escapeHtml(String(o.created_at || "—"))}${
            o.updated_at && o.updated_at !== o.created_at ? ` · 更新 ${escapeHtml(String(o.updated_at))}` : ""
          }</span></div>
        </div>
        <div class="wo-track">${track}<span class="wo-track-hint">${WO_TRACK_HINT[o.status] || ""}</span></div>
      </div>`;
    })
    .join("");
  el.querySelectorAll("[data-rectify]").forEach((b) => b.addEventListener("click", () => advanceOrder(b, "rectify")));
  el.querySelectorAll("[data-wo-status-btn]").forEach((b) =>
    b.addEventListener("click", () => advanceOrder(b, "status", b.dataset.next))
  );
  el.querySelectorAll("[data-gov]").forEach((b) =>
    b.addEventListener("click", () => {
      switchView("verify");
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );
  if (highlightWoId) {
    const card = el.querySelector(`.wo-card[data-wo="${highlightWoId}"]`);
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightWoId = null;
  }
}

function ticketAction(o) {
  if (o.status === "待处理") return `<button class="btn btn-primary btn-sm" data-rectify="${o.id}">开始整改</button>`;
  if (o.status === "处理中") return `<button class="btn btn-primary btn-sm" data-wo-status-btn="${o.id}" data-next="已解决">完成整改</button>`;
  if (o.status === "已解决") {
    return `<button class="btn btn-ghost btn-sm" data-gov="${o.id}">去闭环验证</button>
      <button class="btn btn-primary btn-sm" data-wo-status-btn="${o.id}" data-next="已关闭">关闭工单</button>`;
  }
  return `<span class="tag status-pill status-closed">已闭环</span>`;
}

async function advanceOrder(btn, kind, next) {
  const id = Number(btn.dataset.rectify || btn.dataset.woStatusBtn);
  setBtnLoading(btn, true);
  try {
    let res;
    if (kind === "rectify") {
      res = await fetch(`/api/work-orders/${id}/rectify`, { method: "POST" });
    } else {
      if (next === "已关闭") {
        const ok = await confirmDialog(
          "关闭工单",
          "关闭表示该整改项已验收归档，之后不再参与新的复检推演。确认关闭？",
          "确认关闭"
        );
        if (!ok) { setBtnLoading(btn, false); return; }
      }
      res = await fetch(`/api/work-orders/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    }
    if (!res.ok) throw new Error("request failed");
    const data = await res.json();
    const order = data.order || data;
    const it = woAll.find((x) => x.id === id);
    if (it && order && order.status) { it.status = order.status; it.updated_at = order.updated_at || it.updated_at; }
    renderWoTabs();
    renderTickets();
    const msgs = {
      rectify: "工单已进入处理中",
      已解决: "整改已完成，可去闭环验证",
      已关闭: "工单已关闭，该整改项闭环归档",
    };
    showToast(msgs[kind === "rectify" ? "rectify" : next] || "状态已更新");
    if (activeView === "verify") loadVerify();
  } catch (e) {
    setBtnLoading(btn, false);
    showToast("操作失败，请重试", false);
  }
}

/* =============================================================================
   11. 闭环验证
   ============================================================================= */
let clLoaded = false;
let clInitPromise = null;
let clCharts = {};
let clDropMap = {};
let clOrders = [];          // 可纳入验证的整改工单
let clMeasures = [];        // 静默推演返回的按类措施，用于展示该类综合预期降幅
let clSel = new Set();      // 勾选中的工单 id
let clSelTouched = false;   // 用户是否手动调整过勾选
let clResultDirty = false;
let runVerifyController = null;

const DEFECT_KEY_BY_CN = {
  龟裂: "crazing",
  夹杂: "inclusion",
  斑块: "patches",
  麻点: "pitted_surface",
  氧化皮压入: "rolled-in_scale",
  划痕: "scratches",
};
const DEFECT_ORDER = ["龟裂", "夹杂", "斑块", "麻点", "氧化皮压入", "划痕"];

/** 取可纳入验证的工单与各类综合预期降幅（静默推演，不留痕） */
async function refreshClOrders() {
  try {
    const [rw, rv] = await Promise.all([
      fetch("/api/work-orders"),
      fetch("/api/closed-loop/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch: $("cl-batch").value || "ALL",
          sample_size: Number($("cl-sample").value || 200),
        }),
      }),
    ]);
    const w = await rw.json();
    const v = await rv.json();
    clOrders = (w.items || []).filter(woReadyForVerify);
    clMeasures = v.measures || [];
    clDropMap = {};
    clMeasures.forEach((m) => { clDropMap[m.defect] = m.expected_drop || 0; });
    const valid = new Set(clOrders.map((o) => o.id));
    clSel = new Set([...clSel].filter((id) => valid.has(id)));
    if (!clSelTouched) clSel = new Set(clOrders.map((o) => o.id));
  } catch (e) {
    clOrders = [];
    clMeasures = [];
  }
}

/** 批次或样本量变化：清结果、重取可纳入工单 */
async function onClScopeChange() {
  clResultDirty = false;
  clSelTouched = false;
  clSel = new Set();
  showClEmptyState();
  await refreshClOrders();
  renderVerifyOrders();
}

async function initVerify() {
  $("cl-measures").innerHTML = skeletonList(3);
  try {
    const rb = await fetch("/api/closed-loop/batches");
    const d = await rb.json();
    $("cl-batch").innerHTML = d.items
      .map((b) => `<option value="${b.key}">${b.label}（${b.date_range}）</option>`)
      .join("");
    $("cl-sample").value = d.default_sample || 200;
    $("cl-batch").addEventListener("change", onClScopeChange);
    $("cl-sample").addEventListener("change", onClScopeChange);
    $("cl-run-btn").addEventListener("click", () => runVerify({ save: true }));
    $("cl-prereq-go").addEventListener("click", () => {
      switchView("ticket");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("cl-sel-all").addEventListener("click", () => setClSelAll(true));
    $("cl-sel-none").addEventListener("click", () => setClSelAll(false));
    clLoaded = true;
  } catch (e) {
    clInitPromise = null;
    renderError("cl-measures", "批次加载失败", () => { clInitPromise = null; initVerify(); });
  }
}

async function loadVerify() {
  if (!clLoaded) {
    if (!clInitPromise) clInitPromise = initVerify();
    await clInitPromise;
    if (!clLoaded) return;
  }
  await refreshClOrders();
  renderVerifyOrders();
  if (!clResultDirty) showClEmptyState();
}

function showClEmptyState() {
  $("cl-result").innerHTML = `<div class="panel cl-result-empty"><div class="empty-state">
    <span class="empty-title">尚未开始复检推演</span>
    <span class="empty-sub">勾选要纳入的整改工单后，点击「开始复检推演」查看降幅</span>
  </div></div>`;
}

function selectedOrders() {
  return clOrders.filter((o) => clSel.has(o.id));
}

function setClSelAll(on) {
  clSelTouched = true;
  clSel = on ? new Set(clOrders.map((o) => o.id)) : new Set();
  renderVerifyOrders();
}

/** 勾选的工单聚合为缺陷类，与后端 executed 口径一致 */
function collectExecuted() {
  const keys = new Set();
  selectedOrders().forEach((o) => {
    const k = DEFECT_KEY_BY_CN[o.defect_cn];
    if (k) keys.add(k);
  });
  return [...keys];
}

async function runVerify(opts = {}) {
  const save = !!opts.save;
  const renderResult = opts.renderResult !== false;
  const blocking = busyTaskLabels("verify");
  if (blocking.length) {
    showToast(`${blocking.join("、")}进行中，请稍候再试`, false);
    return;
  }
  let controller = null;
  if (save) {
    const got = acquireTask("verify");
    if (!got || got.blockedBy) {
      if (got && got.blockedBy) showToast(`${got.blockedBy}进行中，请等待完成后再复检`, false);
      return;
    }
    controller = got.controller;
    runVerifyController = controller;
    setStateText("verify", "正在推演…", "busy");
  }
  const chosen = selectedOrders();
  const body = {
    batch: $("cl-batch").value,
    sample_size: Number($("cl-sample").value || 200),
    executed: collectExecuted(),
    order_ids: chosen.map((o) => o.id),
  };
  if (save) body.save = true;
  if (renderResult) {
    $("cl-result").innerHTML = `<div class="panel cl-result-empty"><div class="loading"><span class="spinner"></span>复检推演中…</div></div>`;
  }
  try {
    const res = await fetch("/api/closed-loop/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: save && controller ? controller.signal : undefined,
    });
    const d = await res.json();
    if (renderResult) {
      renderVerifyResult(d, chosen);
      clResultDirty = true;
    }
    if (save) {
      setFlow("verify", true);
      showToast(chosen.length ? `复检推演完成，纳入 ${chosen.length} 张工单` : "复检推演完成");
      setStateText("verify", "推演完成", "ok");
    }
  } catch (e) {
    if (renderResult) {
      renderError("cl-result", "复检失败", () => runVerify(opts));
    }
    if (save) {
      showToast("复检失败，请稍后重试", false);
      setStateText("verify", "复检失败", "fail");
    }
  } finally {
    if (save) { releaseTask("verify"); runVerifyController = null; }
  }
}

/** 已完成整改（含已关闭归档）的工单才可纳入验证 */
function woReadyForVerify(wo) {
  return !!wo && (wo.status === "已解决" || wo.status === "已关闭");
}

/** 第 2 步：按工单逐张列出，勾选决定纳入哪些整改项 */
function renderVerifyOrders() {
  const box = $("cl-measures");
  if (!box) return;

  if (!clOrders.length) {
    box.innerHTML = `<div class="empty-state small">
      <span class="empty-title">暂无可纳入验证的整改工单</span>
      <span class="empty-sub">整改工单推进到「已完成」，或关闭归档后，就会出现在这里。</span>
    </div>`;
    const bar = $("cl-selbar");
    if (bar) bar.classList.add("hidden");
    renderClMissing();
    renderVerifyPrereq();
    syncClRunBtn();
    return;
  }

  const groups = {};
  clOrders.forEach((o) => {
    const cn = o.defect_cn || "未分类";
    (groups[cn] = groups[cn] || []).push(o);
  });
  const cns = DEFECT_ORDER.filter((cn) => groups[cn]).concat(
    Object.keys(groups).filter((cn) => !DEFECT_ORDER.includes(cn))
  );

  box.innerHTML = cns
    .map((cn) => {
      const list = groups[cn].slice().sort((a, b) => (b.id || 0) - (a.id || 0));
      const drop = clDropMap[DEFECT_KEY_BY_CN[cn]];
      const meta = `${list.length} 张工单${drop != null ? ` · 该类综合预期降幅 ${fmt2(drop)}%` : ""}`;
      return `<div class="cl-group">
        <div class="cl-group-head">
          <span class="cl-group-name">${escapeHtml(cn)}</span>
          <span class="cl-group-meta">${meta}</span>
        </div>
        ${list.map((o) => clOrderHtml(o)).join("")}
      </div>`;
    })
    .join("");

  box.querySelectorAll("input[data-order]").forEach((b) =>
    b.addEventListener("change", () => {
      const id = Number(b.dataset.order);
      if (b.checked) clSel.add(id);
      else clSel.delete(id);
      clSelTouched = true;
      const card = b.closest(".cl-order");
      if (card) card.classList.toggle("off", !b.checked);
      updateClSelSummary();
      syncClRunBtn();
    })
  );

  updateClSelSummary();
  renderClMissing();
  renderVerifyPrereq();
  syncClRunBtn();
}

function clOrderHtml(o) {
  const on = clSel.has(o.id);
  const root = o.root_cause || "—";
  const measure = o.measure || "—";
  return `<label class="cl-order${on ? "" : " off"}">
    <input type="checkbox" data-order="${o.id}" ${on ? "checked" : ""}>
    <span class="cl-order-body">
      <span class="cl-order-main">
        <span class="cl-order-no">${escapeHtml(o.ticket_no || "—")}</span>
        ${statusTag(o.status)}
        <span class="cl-order-owner">责任人 ${escapeHtml(o.owner || "待指派")}</span>
        <span class="cl-order-time">${escapeHtml(o.updated_at || o.created_at || "—")}</span>
      </span>
      <span class="cl-order-line" title="${escapeHtml(root)}"><b>主因</b>${escapeHtml(root)}</span>
      <span class="cl-order-line" title="${escapeHtml(measure)}"><b>措施</b>${escapeHtml(measure)}</span>
    </span>
  </label>`;
}

function updateClSelSummary() {
  const bar = $("cl-selbar");
  const sum = $("cl-sel-summary");
  const note = $("cl-sel-note");
  if (!bar || !sum) return;
  if (!clOrders.length) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  const sel = selectedOrders();
  const cns = [...new Set(sel.map((o) => o.defect_cn).filter(Boolean))];
  sum.innerHTML = `已选 <b>${sel.length}</b> / ${clOrders.length} 张工单${
    cns.length ? `，覆盖 <b>${cns.length}</b> 类缺陷（${cns.join("、")}）` : ""
  }`;
  if (note) note.textContent = "复检按缺陷类统计缺陷率，同类的多张工单会合并计入该类。";
}

/** 本批次里还没有可纳入工单的缺陷类 */
function renderClMissing() {
  const el = $("cl-missing");
  if (!el) return;
  const have = new Set(clOrders.map((o) => o.defect_cn));
  const miss = (clMeasures || []).filter((m) => !have.has(m.defect_cn)).map((m) => m.defect_cn);
  if (!miss.length) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = `<span class="cl-missing-title">本次不纳入</span>
    <span class="cl-missing-text">${miss.join("、")} 这 ${miss.length} 类还没有已完成或已关闭的工单；如需纳入，先到整改工单页把对应工单推进到已完成。</span>`;
}

function renderVerifyPrereq() {
  const text = $("cl-prereq-text");
  const go = $("cl-prereq-go");
  if (!text) return;
  if (clOrders.length) {
    text.innerHTML = `<span class="cl-prereq-ok">可纳入验证的整改工单 <b>${clOrders.length}</b> 张</span>，勾选后开始复检推演`;
    if (go) go.classList.add("hidden");
  } else {
    text.innerHTML = `<span class="cl-prereq-warn">暂无可纳入验证的整改工单</span>，请先在整改工单页把状态推进到「已完成」或关闭归档`;
    if (go) go.classList.remove("hidden");
  }
}

function syncClRunBtn() {
  const btn = $("cl-run-btn");
  if (!btn) return;
  const n = clSel.size;
  const lock = n === 0;
  btn.disabled = lock || TASKS.verify.running;
  btn.dataset.lockWhenIdle = lock ? "1" : "0";
  btn.textContent = n ? `开始复检推演（${n} 张工单）` : "开始复检推演";
}

function disposeClCharts() {
  Object.values(clCharts).forEach((c) => { try { c.dispose(); } catch (e) {} });
  clCharts = {};
}

function renderVerifyResult(d, sel) {
  disposeClCharts();
  const chosen = sel || [];
  const size = d.batch_size || 1;
  const rows = d.per_class
    .map((p) => {
      const br = ((p.before_count / size) * 100).toFixed(2);
      const ar = ((p.after_count / size) * 100).toFixed(2);
      return `<tr>
        <td>${p.defect_cn}</td>
        <td class="num">${br}%</td>
        <td class="num">${ar}%</td>
        <td class="num">${p.expected_drop}%</td>
        <td class="num">${p.attribution_acc}%</td>
        <td class="num">${p.effective_drop}%</td>
        <td class="${p.executed ? "cl-tag-exec" : "cl-tag-skip"}">${p.executed ? "已执行" : "未执行"}</td>
      </tr>`;
    })
    .join("");

  const chosenCn = [...new Set(chosen.map((o) => o.defect_cn).filter(Boolean))];

  $("cl-result").innerHTML = `
    <div class="cl-band" id="cl-band" style="margin-top:var(--gap)">
      <div class="cl-band-card">
        <span class="cl-band-label">复检前缺陷率</span>
        <span class="cl-band-value cl-before" id="cl-band-before">—</span>
      </div>
      <div class="cl-band-card">
        <span class="cl-band-label">复检后缺陷率</span>
        <span class="cl-band-value cl-after" id="cl-band-after">—</span>
      </div>
      <div class="cl-band-card">
        <span class="cl-band-label">降幅</span>
        <span class="cl-band-value" id="cl-band-drop">—</span>
      </div>
      <div class="cl-band-card">
        <span class="cl-band-label">判定</span>
        <span class="cl-band-verdict" id="cl-band-verdict"><span class="tag status-pill status-locked">待推演</span></span>
      </div>
    </div>

    <section class="panel stack-gap">
      <div class="sec-head"><span class="sec-no">1</span><h2 class="panel-title">整改前后对比</h2>
        <span class="sec-note">${d.batch_label} · ${d.date_range}</span></div>
      <div class="cl-charts">
        <div class="cl-chart" id="cl-bar"></div>
        <div class="cl-chart" id="cl-trend"></div>
      </div>
    </section>

    <section class="panel stack-gap">
      <div class="sec-head"><span class="sec-no">2</span><h2 class="panel-title">修复项与指标变化的对应关系</h2>
        <span class="sec-note">占比按批次规模折算</span></div>
      <p class="cl-sel-line">
        本次纳入的整改工单：<b>${
          chosen.length ? chosen.map((o) => `${escapeHtml(o.ticket_no || "—")}（${escapeHtml(o.defect_cn || "")}）`).join("、") : "无（未勾选工单）"
        }</b>${
          chosenCn.length ? `<span class="cl-sel-line-note">共 ${chosen.length} 张 · 覆盖 ${chosenCn.length} 类缺陷</span>` : ""
        }
      </p>
      <div class="table-wrap">
        <table class="data-table cl-table">
          <thead>
            <tr>
              <th>缺陷类型</th><th>整改前缺陷率</th><th>整改后缺陷率</th>
              <th>预期降幅</th><th>归因正确率</th><th>有效降幅</th><th>是否执行</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <details class="drop-details">
        <summary>降幅口径说明</summary>
        <div class="drop-explain">
          <p style="margin:0">每一类的变化是这样算出来的：先由规则库给出该根因的<b>预期降幅</b>，再乘以离线评测得到的<b>归因正确率</b>，得到真正计入结果的<b>有效降幅</b>。
            <span class="drop-formula">有效降幅 = 预期降幅 × 归因正确率</span>
          </p>
          <p style="margin:0">把各类的有效降幅代回批次缺陷数，就得到复检后的<b>整体缺陷率</b>：
            <span class="drop-formula">整体降幅 =（复检前缺陷率 − 复检后缺陷率）÷ 复检前缺陷率</span>
          </p>
          <p style="margin:0">口径差异：整体降幅是全局口径，只整改一类时它的有效降幅看着小，是因为这一类只占总缺陷的一部分；平台首页与看板展示的 25.64% 是六类全部整改后的整体降幅。</p>
          <p style="margin:0;color:var(--dim)">${d.disclaimer} ${d.disclaimer_next}</p>
        </div>
      </details>
    </section>`;

  renderVerifyBand(d);
  renderVerifyCharts(d);
}

function renderVerifyBand(d) {
  const before = $("cl-band-before");
  const after = $("cl-band-after");
  const drop = $("cl-band-drop");
  const verdict = $("cl-band-verdict");
  if (!before) return;
  before.textContent = fmt2(d.before_rate) + "%";
  after.textContent = fmt2(d.after_rate) + "%";
  drop.textContent = fmt2(d.drop_pct) + "%";
  const positive = d.verdict_cls !== "verdict-weak";
  verdict.innerHTML = `<span class="tag status-pill ${positive ? "band-ok" : "band-fail"}">${d.verdict}</span>`;
}

function renderVerifyCharts(d) {
  if (typeof echarts === "undefined") {
    $("cl-bar").innerHTML = `<div class="empty-state small"><span class="empty-title">图表库未加载</span></div>`;
    $("cl-trend").innerHTML = "";
    return;
  }
  const axisColor = "#1E3350";
  const textColor = "#7E9BBE";
  const afterColor = d.verdict_cls === "verdict-weak" ? "#EF9F27" : d.verdict_cls === "verdict-strong" ? "#2FD4C4" : "#378ADD";

  clCharts.bar = echarts.init($("cl-bar"));
  clCharts.bar.setOption({
    backgroundColor: "transparent",
    title: { text: "整改前后缺陷率", left: "center", top: 4, textStyle: { color: "#A8C0DC", fontSize: 13, fontWeight: 500 } },
    grid: { left: 46, right: 20, top: 44, bottom: 28 },
    tooltip: { trigger: "axis", valueFormatter: (v) => v + "%" },
    xAxis: {
      type: "category", data: ["整改前", "整改后"],
      axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: "#A8C0DC" },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor, formatter: "{value}%" }, splitLine: { lineStyle: { color: axisColor } },
    },
    series: [{
      type: "bar", barWidth: "46%",
      data: [
        { value: d.before_rate, itemStyle: { color: "#E24B4A" } },
        { value: d.after_rate, itemStyle: { color: afterColor } },
      ],
      label: { show: true, position: "top", color: "#A8C0DC", formatter: "{c}%" },
    }],
  });

  const t = d.trend;
  clCharts.trend = echarts.init($("cl-trend"));
  clCharts.trend.setOption({
    backgroundColor: "transparent",
    title: { text: "连续批次缺陷率趋势", left: "center", top: 4, textStyle: { color: "#A8C0DC", fontSize: 13, fontWeight: 500 } },
    grid: { left: 46, right: 24, top: 44, bottom: 44 },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : v + "%") },
    legend: { data: ["整改前", "整改后（推演）"], bottom: 0, textStyle: { color: textColor }, itemWidth: 10, itemHeight: 10 },
    xAxis: { type: "category", data: t.labels, boundaryGap: false, axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: textColor } },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor, formatter: "{value}%" }, splitLine: { lineStyle: { color: axisColor } },
    },
    series: [
      {
        name: "整改前", type: "line", smooth: true, data: t.before,
        itemStyle: { color: "#E24B4A" }, lineStyle: { color: "#E24B4A" },
        markLine: {
          silent: true, symbol: "none",
          lineStyle: { color: "#EF9F27", type: "dashed" },
          label: { formatter: t.marker_label, color: "#EF9F27" },
          data: [{ xAxis: t.labels[t.marker_index] }],
        },
      },
      {
        name: "整改后（推演）", type: "line", smooth: true, data: t.after,
        itemStyle: { color: "#2FD4C4" }, lineStyle: { color: "#2FD4C4", type: "dashed" },
      },
    ],
  });
}

function verdictCls(drop) {
  if (drop >= 30) return "verdict-strong";
  if (drop >= 20) return "verdict-ok";
  return "verdict-weak";
}

/* =============================================================================
   12. 复检历史（独立页面）
   ============================================================================= */
async function loadRuns() {
  const body = $("runs-body");
  const countEl = $("runs-count");
  body.innerHTML = `<tr><td colspan="9" class="empty-cell">正在载入复检记录…</td></tr>`;
  try {
    const [rr, rw] = await Promise.all([
      fetch("/api/closed-loop/runs?limit=50"),
      fetch("/api/work-orders"),
    ]);
    const d = await rr.json();
    const w = await rw.json();
    const allOrders = w.items || [];
    const items = d.items || [];
    if (countEl) countEl.textContent = items.length ? `共 ${items.length} 条` : "—";
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty-cell">暂无复检记录，到闭环验证页跑一次推演后会留痕在这里</td></tr>`;
      return;
    }
    body.innerHTML = items
      .map((r) => {
        const orders = r.orders || [];
        return `<tr class="runs-row">
          <td class="num">${escapeHtml(r.created_at || "—")}</td>
          <td>${escapeHtml(r.batch_label || "—")}</td>
          <td>${runDefectBrief(r, orders)}</td>
          <td class="num">${r.sample_size || "—"}</td>
          <td class="num">${r.before_rate != null ? fmt2(r.before_rate) + "%" : "—"}</td>
          <td class="num">${r.after_rate != null ? fmt2(r.after_rate) + "%" : "—"}</td>
          <td class="num">${r.drop_pct != null ? fmt2(r.drop_pct) + "%" : "—"}</td>
          <td><span class="runs-verdict ${verdictCls(r.drop_pct || 0)}">${escapeHtml(r.verdict || "—")}</span></td>
          <td><button class="btn btn-ghost btn-sm runs-toggle" data-run-toggle="${r.id}" aria-expanded="false">查看明细</button></td>
        </tr>
        <tr class="runs-detail-row hidden" data-run-detail="${r.id}">
          <td colspan="9">${runDetailHtml(r, orders, allOrders)}</td>
        </tr>`;
      })
      .join("");
    body.querySelectorAll("[data-run-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const row = body.querySelector(`[data-run-detail="${b.dataset.runToggle}"]`);
        if (!row) return;
        const closed = row.classList.toggle("hidden");
        b.textContent = closed ? "查看明细" : "收起明细";
        b.setAttribute("aria-expanded", String(!closed));
      })
    );
  } catch (e) {
    renderError(body.parentElement, "复检记录加载失败", loadRuns);
  }
}

/** 纳入列：新记录取工单留痕，老记录退化为按类汇总 */
function runDefectBrief(r, orders) {
  if (orders.length) {
    const cns = [...new Set(orders.map((o) => o.defect_cn).filter(Boolean))];
    return `<span class="runs-orders">${escapeHtml(cns.join("、") || "—")}</span>
      <span class="runs-orders-n">${orders.length} 张工单</span>`;
  }
  const exec = (r.per_class || []).filter((p) => p.executed).map((p) => p.defect_cn);
  if (!exec.length) return `<span class="v v-empty">—</span>`;
  return `<span class="runs-orders">${escapeHtml(exec.join("、"))}</span>
    <span class="runs-orders-n">未记录工单</span>`;
}

/** 老记录没有工单留痕：按当时纳入的缺陷类，给出该类当前工单作对照 */
function legacyOrderBlock(r, allOrders) {
  const execCns = (r.per_class || []).filter((p) => p.executed).map((p) => p.defect_cn);
  if (!execCns.length) {
    return `<p class="runs-none">该次复检没有纳入任何缺陷类，也没有记录关联工单。</p>`;
  }
  const rows = execCns
    .map((cn) => {
      const list = (allOrders || []).filter((o) => o.defect_cn === cn).sort((a, b) => (b.id || 0) - (a.id || 0));
      const latest = list[0];
      if (!latest) {
        return `<tr><td>${escapeHtml(cn)}</td><td colspan="4" class="runs-none">该类当前没有工单</td></tr>`;
      }
      return `<tr>
        <td>${escapeHtml(cn)}</td>
        <td class="num">${escapeHtml(latest.ticket_no || "—")}</td>
        <td>${escapeHtml(latest.root_cause || "—")}</td>
        <td>${escapeHtml(latest.owner || "—")}</td>
        <td>${escapeHtml(latest.status || "—")}</td>
      </tr>`;
    })
    .join("");
  return `<p class="runs-none">该次复检早于留痕改版，没有记录当次勾选的工单；下面按当时纳入的缺陷类，列出该类当前工单作为对照。</p>
    <div class="table-wrap"><table class="data-table runs-sub">
      <thead><tr><th>纳入的缺陷类</th><th>当前工单号</th><th>主因</th><th>责任人</th><th>工单状态</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
}

function runDetailHtml(r, orders, allOrders) {
  const orderBlock = orders.length
    ? `<div class="table-wrap"><table class="data-table runs-sub">
        <thead><tr><th>工单号</th><th>缺陷类型</th><th>主因</th><th>整改措施</th><th>责任人</th><th>工单状态</th></tr></thead>
        <tbody>${orders
          .map(
            (o) => `<tr>
              <td class="num">${escapeHtml(o.ticket_no || "—")}</td>
              <td>${escapeHtml(o.defect_cn || "—")}</td>
              <td>${escapeHtml(o.root_cause || "—")}</td>
              <td>${escapeHtml(o.measure || "—")}</td>
              <td>${escapeHtml(o.owner || "—")}</td>
              <td>${escapeHtml(o.status || "—")}</td>
            </tr>`
          )
          .join("")}</tbody></table></div>`
    : legacyOrderBlock(r, allOrders);

  const pcBlock = (r.per_class || []).length
    ? `<div class="table-wrap"><table class="data-table runs-sub">
        <thead><tr><th>缺陷类型</th><th>整改前件数</th><th>整改后件数</th><th>预期降幅</th><th>归因正确率</th><th>有效降幅</th><th>是否纳入</th></tr></thead>
        <tbody>${(r.per_class || [])
          .map(
            (p) => `<tr>
              <td>${escapeHtml(p.defect_cn || "—")}</td>
              <td class="num">${p.before_count}</td>
              <td class="num">${p.after_count}</td>
              <td class="num">${fmt2(p.expected_drop)}%</td>
              <td class="num">${fmt2(p.attribution_acc)}%</td>
              <td class="num">${fmt2(p.effective_drop)}%</td>
              <td class="${p.executed ? "cl-tag-exec" : "cl-tag-skip"}">${p.executed ? "已纳入" : "未纳入"}</td>
            </tr>`
          )
          .join("")}</tbody></table></div>`
    : `<p class="runs-none">该条记录没有分缺陷类型明细。</p>`;

  const measuresBlock = (r.measures || []).length
    ? `<div class="table-wrap"><table class="data-table runs-sub">
        <thead><tr><th>缺陷类型</th><th>代表措施</th><th>预期降幅</th><th>归因正确率</th><th>规则</th><th>是否纳入</th></tr></thead>
        <tbody>${(r.measures || [])
          .map(
            (m) => `<tr>
              <td>${escapeHtml(m.defect_cn || "—")}</td>
              <td>${escapeHtml(m.solution || "—")}</td>
              <td class="num">${fmt2(m.expected_drop)}%</td>
              <td class="num">${fmt2(m.attribution_acc)}%</td>
              <td class="num">${escapeHtml(m.rule_id || "—")}</td>
              <td class="${m.executed ? "cl-tag-exec" : "cl-tag-skip"}">${m.executed ? "已纳入" : "未纳入"}</td>
            </tr>`
          )
          .join("")}</tbody></table></div>`
    : "";

  return `<div class="runs-detail">
    <div class="runs-detail-head">
      <span>复检时间 ${escapeHtml(r.created_at || "—")}</span>
      <span>批次 ${escapeHtml(r.batch_label || "—")}</span>
      <span>样本量 ${r.sample_size || "—"}</span>
      <span>降幅 ${fmt2(r.drop_pct)}% · ${escapeHtml(r.verdict || "")}</span>
    </div>
    <div class="runs-detail-sec">
      <div class="runs-detail-title">纳入本次复检的整改工单（${orders.length}）</div>
      ${orderBlock}
    </div>
    <div class="runs-detail-sec">
      <div class="runs-detail-title">分缺陷类型明细</div>
      ${pcBlock}
    </div>
    <div class="runs-detail-sec">
      <div class="runs-detail-title">措施清单</div>
      ${measuresBlock}
    </div>
    <p class="runs-detail-note">复检按缺陷类统计：同类多张工单的措施合并计入该类。有效降幅 = 预期降幅 × 归因正确率；整体降幅 =（复检前缺陷率 − 复检后缺陷率）÷ 复检前缺陷率。本条记录为基于规则库预期降幅的工况推演留痕，不代表真实产线效果。</p>
  </div>`;
}

/* =============================================================================
   13. 报警历史（前端按天聚合检测记录）
   ============================================================================= */
const ALERT_TYPES = [
  { key: "crazing", cn: "龟裂" },
  { key: "inclusion", cn: "夹杂" },
  { key: "patches", cn: "斑块" },
  { key: "pitted_surface", cn: "麻点" },
  { key: "rolled-in_scale", cn: "氧化皮压入" },
  { key: "scratches", cn: "划痕" },
];
const ALERT_THRESHOLD = 3;
const ALERT_SEVERE_LEVEL = "严重";
let alertLogRecords = null;
let alertLogMetaLoaded = false;

function invalidateAlertLog() {
  alertLogRecords = null;
}

async function loadAlertLog() {
  if (!alertLogMetaLoaded) {
    $("al-defect").innerHTML =
      `<option value="">全部缺陷类型</option>` + ALERT_TYPES.map((t) => `<option value="${t.cn}">${t.cn}</option>`).join("");
    $("al-range").addEventListener("change", renderAlertLog);
    $("al-level").addEventListener("change", renderAlertLog);
    $("al-defect").addEventListener("change", renderAlertLog);
    alertLogMetaLoaded = true;
  }
  if (alertLogRecords) { renderAlertLog(); return; }
  const list = $("alertlog-list");
  list.innerHTML = `<div class="empty-state small"><span class="empty-title">正在载入告警记录…</span></div>`;
  try {
    const res = await fetch("/api/records?limit=200");
    const d = await res.json();
    alertLogRecords = d.items || [];
    renderAlertLog();
  } catch (e) {
    renderError(list, "检测记录加载失败", loadAlertLog);
  }
}

/** 与后端告警口径一致：当日存在「严重」→ 单次告警；同一缺陷类型当日超过阈值 → 聚集告警 */
function buildAlertDays() {
  const byDay = new Map();
  (alertLogRecords || []).forEach((r) => {
    const t = parseTs(r.ts);
    if (!t) return;
    const key = dayKey(t);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({ rec: r, time: t });
  });
  const days = [];
  Array.from(byDay.keys()).sort().reverse().forEach((key) => {
    const list = byDay.get(key);
    const items = [];
    const severe = list
      .filter((x) => x.rec.severity === ALERT_SEVERE_LEVEL)
      .sort((a, b) => b.time - a.time);
    if (severe.length) {
      const latest = severe[0];
      items.push({
        level: "severe",
        defect: latest.rec.defect_cn,
        title: `检出「严重」等级缺陷（${severe.length} 件）`,
        detail: `最近一例：${latest.rec.defect_cn} · ${latest.rec.ts} · 置信度 ${(Number(latest.rec.confidence || 0) * 100).toFixed(1)}%`,
        time: latest.rec.ts,
      });
    }
    const counter = new Map();
    list.forEach((x) => {
      const cn = x.rec.defect_cn;
      if (!cn) return;
      if (!counter.has(cn)) counter.set(cn, []);
      counter.get(cn).push(x);
    });
    Array.from(counter.entries())
      .filter(([, arr]) => arr.length > ALERT_THRESHOLD)
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([cn, arr]) => {
        const latest = arr.sort((a, b) => b.time - a.time)[0];
        items.push({
          level: "cluster",
          defect: cn,
          title: `「${cn}」当日出现 ${arr.length} 次（阈值 >${ALERT_THRESHOLD}）`,
          detail: "疑似批量性缺陷，建议核查对应工序并触发闭环整改",
          time: latest.rec.ts,
        });
      });
    days.push({ date: key, total: list.length, items });
  });
  return days;
}

function renderAlertLog() {
  const list = $("alertlog-list");
  const countEl = $("alertlog-count");
  const statsEl = $("alertlog-stats");
  const range = Number($("al-range").value || 0);
  const level = $("al-level").value;
  const defect = $("al-defect").value;

  let days = buildAlertDays();
  if (range > 0) {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (range - 1));
    const fromKey = dayKey(from);
    days = days.filter((d) => d.date >= fromKey);
  }
  days = days
    .map((d) => ({
      ...d,
      items: d.items.filter((i) => (!level || i.level === level) && (!defect || i.defect === defect)),
    }))
    .filter((d) => d.items.length);

  const alertCount = days.reduce((n, d) => n + d.items.length, 0);
  const severeCount = days.reduce((n, d) => n + d.items.filter((i) => i.level === "severe").length, 0);
  const defectSet = new Set();
  days.forEach((d) => d.items.forEach((i) => { if (i.defect) defectSet.add(i.defect); }));

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="alertlog-stat"><div class="k">告警条目</div><div class="v">${alertCount}</div></div>
      <div class="alertlog-stat"><div class="k">严重缺陷告警</div><div class="v danger">${severeCount}</div></div>
      <div class="alertlog-stat"><div class="k">涉及缺陷类型</div><div class="v">${defectSet.size}</div></div>`;
  }
  if (countEl) countEl.textContent = alertCount ? `按天聚合 · 共 ${alertCount} 条` : "—";

  if (!alertCount) {
    list.innerHTML = `<div class="empty-state"><span class="empty-title">当前筛选下没有告警</span><span class="empty-sub">告警规则：单次检出「严重」等级立即告警；同一缺陷类型 24 小时内出现超过 ${ALERT_THRESHOLD} 次触发聚集告警</span></div>`;
    return;
  }

  list.innerHTML = days
    .map(
      (d) => `<div class="alertlog-day">
        <div class="alertlog-day-head">
          <span class="alertlog-day-date">${d.date}</span>
          <span class="alertlog-day-count">当日检测 ${d.total} 次 · 告警 ${d.items.length} 条</span>
        </div>
        <div class="alertlog-day-items">
          ${d.items
            .map(
              (i) => `<div class="alertlog-item">
                <span class="alertlog-dot ${i.level}"></span>
                <span class="alertlog-item-body">
                  <span class="alertlog-item-title">${i.title}</span>
                  <span class="alertlog-item-detail">${i.detail}</span>
                </span>
                <span class="alertlog-item-time">${i.time}</span>
              </div>`
            )
            .join("")}
        </div>
      </div>`
    )
    .join("");
}

/* =============================================================================
   14. 分析看板
   ============================================================================= */
const CHART = {
  primary: "#2FD4C4", accent: "#378ADD", warn: "#EF9F27", ok: "#639922",
  danger: "#E24B4A", muted: "#7E9BBE", text: "#A8C0DC", dim: "#7E9BBE", line: "#1E3350",
};
const PIE_COLORS = [CHART.primary, CHART.accent, CHART.warn, CHART.danger];
const CYAN_SCALE = ["#2FD4C4", "#29B4AB", "#239392", "#1E7379", "#185260", "#123247"];
const RING_EMPTY = "#1E3350";
let dashCharts = {};
let dashLoaded = false;

function ringData(items, nameKey, valKey, colors) {
  const palette = colors || PIE_COLORS;
  return items.map((x, i) => ({
    name: x[nameKey], value: x[valKey],
    itemStyle: { color: i < palette.length ? palette[i] : RING_EMPTY },
  }));
}

function ringOption(data) {
  return {
    backgroundColor: "transparent",
    tooltip: { trigger: "item", formatter: "{b}：{c} 件（{d}%）" },
    legend: {
      bottom: 0, left: "center", orient: "horizontal",
      textStyle: { color: CHART.dim }, itemWidth: 10, itemHeight: 10,
      formatter: (name) => (name === "正常" ? "无缺陷" : name),
    },
    series: [{
      type: "pie", radius: ["44%", "62%"], center: ["50%", "46%"],
      label: { color: CHART.text, formatter: "{d}%" },
      labelLine: { length: 6, length2: 6, lineStyle: { color: CHART.line } },
      data,
    }],
  };
}

function baseAxis() {
  return {
    axisLine: { lineStyle: { color: CHART.line } },
    axisLabel: { color: CHART.dim },
    splitLine: { lineStyle: { color: CHART.line } },
  };
}

const DASH_ICONS = {
  累计检测数: '<path d="M4 7.5l8-3.5 8 3.5-8 3.5z"/><path d="M4 12l8 3.5 8-3.5"/><path d="M4 16.5L12 20l8-3.5"/>',
  缺陷率: '<path d="M12 4l8 15H4z"/><path d="M12 10v4"/><circle cx="12" cy="16.4" r=".6" fill="currentColor" stroke="none"/>',
  平均处置时长: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l3 1.8"/>',
  闭环达标率: '<circle cx="12" cy="12" r="8"/><path d="M8.4 12.4l2.6 2.6 4.6-5"/>',
};
const DASH_EMPTY_NOTE = { 平均处置时长: "暂无已闭环工单数据" };
const DASH_NOTES = { 闭环达标率: "6 类缺陷中 5 类降幅达标", 平均处置时长: "基于已推进工单创建至处置时长" };

function renderDashCards(cards) {
  $("dash-cards").innerHTML = cards
    .map((c) => {
      const raw = String(c.value == null ? "" : c.value).trim();
      const parsed = parseFloat(raw);
      const isEmpty = raw === "" || isNaN(parsed) || parsed === 0;
      let numTxt = raw;
      let unit = c.unit || "";
      if (isEmpty) { numTxt = "—"; unit = ""; }
      else if (unit === "%") numTxt = fmt2(parsed);
      const icon = DASH_ICONS[c.label] || DASH_ICONS["累计检测数"];
      const note = (isEmpty ? DASH_EMPTY_NOTE[c.label] : "") || DASH_NOTES[c.label] || "";
      return `<div class="dash-card">
        <div class="dash-card-top">
          <span class="dash-card-icon"><svg class="icon" viewBox="0 0 24 24">${icon}</svg></span>
          <div class="dash-card-label">${c.label}</div>
        </div>
        <div class="dash-card-value">${numTxt}${unit ? `<span class="dash-card-unit">${unit}</span>` : ""}</div>
        ${note ? `<div class="dash-card-note">${note}</div>` : ""}
      </div>`;
    })
    .join("");
}

async function loadDashboard() {
  disposeDashCharts();
  if (!dashLoaded) {
    $("dash-cards").innerHTML = skeletonList(3);
    $("dash-top").innerHTML = skeletonList(3);
  }
  try {
    const res = await fetch("/api/dashboard");
    const d = await res.json();
    dashLoaded = true;
    renderDashCards(d.cards);
    renderDashCharts(d);
    renderTopRoots(d.top_root_causes);
    const tTitle = $("dash-trend-title");
    const tInfo = $("dash-trend-info");
    if (d.trend_title && tTitle) {
      const m = String(d.trend_title).match(/^(.*?)[（(](.*?)[）)]\s*$/);
      if (m) {
        tTitle.textContent = m[1].trim();
        if (tInfo) { tInfo.title = m[2].trim(); tInfo.classList.remove("hidden"); }
      } else {
        tTitle.textContent = d.trend_title;
        if (tInfo) tInfo.classList.add("hidden");
      }
    }
    const kpiInfo = $("kpi-info");
    if (kpiInfo) kpiInfo.title = "指标由平台样例数据离线计算，用于功能演示";
  } catch (e) {
    renderError("dash-cards", "看板数据加载失败", loadDashboard);
  }
}

function disposeDashCharts() {
  Object.values(dashCharts).forEach((c) => { try { c.dispose(); } catch (e) {} });
  dashCharts = {};
}

function renderDashCharts(d) {
  if (typeof echarts === "undefined") {
    ["dash-defect-pie", "dash-sev-ring", "dash-dim", "dash-trend"].forEach((id) => {
      $(id).innerHTML = `<div class="empty-state small"><span class="empty-title">图表库未加载</span></div>`;
    });
    return;
  }
  dashCharts.defect = echarts.init($("dash-defect-pie"));
  dashCharts.defect.setOption(ringOption(ringData(d.defect_distribution, "name", "count", CYAN_SCALE)));
  dashCharts.sev = echarts.init($("dash-sev-ring"));
  dashCharts.sev.setOption(ringOption(ringData(d.severity_distribution, "level", "count")));
  dashCharts.dim = echarts.init($("dash-dim"));
  dashCharts.dim.setOption(ringOption(ringData(d.dimension_distribution, "dimension", "count")));

  const t = d.monthly_trend || [];
  dashCharts.trend = echarts.init($("dash-trend"));
  dashCharts.trend.setOption({
    backgroundColor: "transparent",
    grid: { left: 48, right: 24, top: 24, bottom: 44 },
    tooltip: { trigger: "axis", valueFormatter: (v) => v + "%" },
    legend: { data: ["缺陷率"], bottom: 0, textStyle: { color: CHART.dim }, itemWidth: 10, itemHeight: 10 },
    xAxis: { type: "category", data: t.map((x) => x.month), boundaryGap: false, ...baseAxis() },
    yAxis: { type: "value", axisLabel: { color: CHART.dim, formatter: "{value}%" }, splitLine: { lineStyle: { color: CHART.line } } },
    series: [{
      name: "缺陷率", type: "line", smooth: true, symbolSize: 7,
      data: t.map((x) => x.defect_rate),
      itemStyle: { color: CHART.primary }, lineStyle: { color: CHART.primary, width: 2 },
      areaStyle: { color: "rgba(47,212,196,0.10)" },
      label: { show: true, position: "top", distance: 8, color: CHART.text, formatter: "{c}%" },
    }],
  });
}

function renderTopRoots(list) {
  const el = $("dash-top");
  if (!list || !list.length) {
    el.innerHTML = `<div class="empty-state small"><span class="empty-title">暂无根因统计</span></div>`;
    return;
  }
  const max = Math.max(...list.map((x) => x.hits)) || 1;
  el.innerHTML = list
    .map(
      (x, i) => `<div class="top-root">
        <div class="top-rank${i === 0 ? " first" : ""}">${i + 1}</div>
        <div class="top-body">
          <div class="top-head">
            <span class="top-cause">${escapeHtml(x.root_cause)}</span>
            <span class="top-hits">命中 ${x.hits} 次 · 占比 ${x.share}%</span>
          </div>
          <div class="top-bar-track"><div class="top-bar-fill" style="width:${(x.hits / max) * 100}%"></div></div>
          <div class="top-meta">
            <span class="tag tag-dim">${x.defect_cn}</span>
            <span class="tag tag-dim">${x.dimension_cn}</span>
            <span class="top-strategy">${escapeHtml(x.strategy)}</span>
          </div>
        </div>
      </div>`
    )
    .join("");
}

/* =============================================================================
   15. 质量告警：右上角铃铛 + 面板 + 报警历史页
   ============================================================================= */
let alertData = null;

function bindAlertBell() {
  const bell = $("alert-bell");
  const panel = $("alert-panel");
  if (!bell || !panel) return;
  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.classList.add("hidden");
    }
  });
}

async function loadAlerts() {
  try {
    const res = await fetch("/api/alerts");
    alertData = await res.json();
    renderAlerts();
  } catch (e) {}
}

function renderAlerts() {
  const badge = $("alert-badge");
  const panel = $("alert-panel");
  const d = alertData;
  if (!badge || !panel) return;
  if (!d || !d.has_alert) {
    badge.classList.add("hidden");
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }
  badge.textContent = d.severe_count || d.items.length;
  badge.classList.remove("hidden");
  panel.innerHTML = `<div class="alert-panel-head">
      <span>质量告警 · 最近 ${d.window_hours} 小时</span>
      <span class="alert-panel-time">${d.generated_at || ""}</span>
    </div>
    <div class="alert-list">
      ${d.items.map((i) => `<div class="alert-item"><span class="alert-item-title">${i.title}</span><span class="alert-item-detail">${i.detail || ""}</span></div>`).join("")}
    </div>
    <div class="alert-panel-foot">
      <button class="btn btn-primary btn-sm" id="alert-push-btn">推送告警通知</button>
      <button class="btn btn-ghost btn-sm" id="alert-history-btn">查看报警历史 →</button>
      <span class="alert-push-result" id="alert-push-result"></span>
    </div>`;
  $("alert-push-btn").addEventListener("click", pushAlertNotify);
  $("alert-history-btn").addEventListener("click", () => {
    panel.classList.add("hidden");
    switchView("alertlog");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

async function pushAlertNotify() {
  const btn = $("alert-push-btn");
  const box = $("alert-push-result");
  if (!btn || !box) return;
  setBtnLoading(btn, true);
  box.textContent = "";
  try {
    const res = await fetch("/api/alert/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const d = await res.json();
    box.className = "alert-push-result " + (d.ok ? "ok" : "fail");
    box.textContent = d.ok ? d.message : `${d.message}${d.hint ? "：" + d.hint : ""}`;
    showToast(d.ok ? "告警已推送" : "推送失败", !!d.ok);
  } catch (e) {
    box.className = "alert-push-result fail";
    box.textContent = "推送请求失败，请重试";
    showToast("推送请求失败", false);
  } finally {
    setBtnLoading(btn, false);
  }
}

/* =============================================================================
   16. 帮助抽屉与新手导览
   ============================================================================= */
const HELP_SEEN_KEY = "helpDrawerSeen";

function openDrawer() {
  $("help-drawer").classList.remove("hidden");
  $("drawer-mask").classList.remove("hidden");
}

function closeDrawer() {
  $("help-drawer").classList.add("hidden");
  $("drawer-mask").classList.add("hidden");
  try { localStorage.setItem(HELP_SEEN_KEY, "1"); } catch (e) {}
}

function bindDrawer() {
  $("help-btn").addEventListener("click", openDrawer);
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-mask").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("help-drawer").classList.contains("hidden")) closeDrawer();
  });
  let seen = false;
  try { seen = localStorage.getItem(HELP_SEEN_KEY) === "1"; } catch (e) {}
  if (!seen) {
    const btn = $("help-btn");
    if (btn) {
      btn.classList.add("attention");
      setTimeout(() => btn.classList.remove("attention"), 6000);
    }
  }
}

const DEMO_STEPS = [
  {
    view: "workbench", target: "#samples", title: "检测工作台",
    text: "从样件库点一张图，系统调用实时 ONNX 模型识别缺陷类型、置信度与严重等级，并在图上标出缺陷位置。",
    next: "去归因诊断",
    action: async () => { await loadFirstSample(); },
  },
  {
    view: "attribution", target: "#sec-conclusion", title: "归因诊断",
    text: "结合缺陷类型与工艺参数，匹配 30 条冶金规则定位主因，输出四维贡献度、证据链与可执行改进建议。",
    next: "生成整改工单",
    action: async () => { if (currentSample) await runAttribution(true); },
  },
  {
    view: "ticket", target: "#wo-list", title: "整改工单",
    text: "按主因生成整改工单并指定责任人，状态沿 待处理 → 处理中 → 已完成 → 已关闭 逐步流转，到关闭才算验收归档。",
    next: "去闭环验证",
    action: async () => { await loadTickets(); },
  },
  {
    view: "verify", target: "#cl-measures", title: "闭环验证",
    text: "勾选已完成整改的措施，按规则库推演缺陷降幅，并结合真实工单状态判定闭环效果。",
    next: "完成",
    action: async () => { await loadVerify(); await runVerify(false, false, true, true); },
  },
];

let demoIdx = -1;
let demoEls = null;
let demoBusy = false;

function bindDemo() {
  const btn = $("help-demo-link");
  if (btn) btn.addEventListener("click", demoStart);
}

function demoStart() {
  if (demoIdx >= 0) return;
  closeDrawer();
  if (!demoEls) demoBuild();
  demoEls.card.focus();
  document.addEventListener("keydown", demoKey);
  window.addEventListener("resize", demoReposition);
  window.addEventListener("scroll", demoReposition, true);
  demoGo(0);
}

function demoBuild() {
  const spot = document.createElement("div");
  spot.className = "demo-spot";
  const card = document.createElement("div");
  card.className = "demo-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "演示讲解");
  card.setAttribute("tabindex", "-1");
  card.innerHTML = `<div class="demo-card-head">
      <span class="demo-step-no" id="demo-step-no"></span>
      <button class="demo-exit" id="demo-exit" type="button">退出演示</button>
    </div>
    <div class="demo-card-title" id="demo-title"></div>
    <div class="demo-card-text" id="demo-text"></div>
    <div class="demo-card-actions">
      <button class="btn btn-ghost" id="demo-prev" type="button">上一步</button>
      <button class="btn btn-primary" id="demo-next" type="button">下一步</button>
    </div>`;
  document.body.append(spot, card);
  demoEls = { spot, card };
  card.querySelector("#demo-exit").addEventListener("click", demoStop);
  card.querySelector("#demo-prev").addEventListener("click", () => demoGo(demoIdx - 1));
  card.querySelector("#demo-next").addEventListener("click", demoNext);
}

async function demoGo(i) {
  if (i < 0 || i >= DEMO_STEPS.length || demoBusy) return;
  demoBusy = true;
  try {
    demoIdx = i;
    const step = DEMO_STEPS[i];
    switchView(step.view);
    $("demo-step-no").textContent = `步骤 ${i + 1} / ${DEMO_STEPS.length}`;
    $("demo-title").textContent = step.title;
    $("demo-text").textContent = step.text;
    $("demo-prev").disabled = i === 0;
    $("demo-next").textContent = step.next;
    demoReposition();
    if (step.action) await step.action();
    const t = document.querySelector(step.target);
    if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth", block: "center" });
    demoReposition();
    setTimeout(demoReposition, 350);
  } catch (e) {
    demoReposition();
  } finally {
    demoBusy = false;
  }
}

function demoNext() {
  if (demoIdx >= DEMO_STEPS.length - 1) {
    demoStop();
    showToast("演示结束");
    return;
  }
  demoGo(demoIdx + 1);
}

function demoReposition() {
  if (demoIdx < 0 || !demoEls) return;
  const step = DEMO_STEPS[demoIdx];
  const { spot, card } = demoEls;
  const margin = 12;
  const cw = Math.min(360, window.innerWidth - margin * 2);
  card.style.width = cw + "px";
  const t = document.querySelector(step.target);
  const ch = card.offsetHeight || 180;
  if (!t) {
    spot.style.display = "none";
    card.style.left = Math.round((window.innerWidth - cw) / 2) + "px";
    card.style.top = Math.round((window.innerHeight - ch) / 2) + "px";
    return;
  }
  const r = t.getBoundingClientRect();
  const pad = 8;
  spot.style.display = "block";
  spot.style.left = r.left - pad + "px";
  spot.style.top = r.top - pad + "px";
  spot.style.width = r.width + pad * 2 + "px";
  spot.style.height = r.height + pad * 2 + "px";
  const left = Math.min(Math.max(margin, r.left), window.innerWidth - cw - margin);
  let top;
  if (r.bottom + ch + margin + 12 <= window.innerHeight) top = r.bottom + 14;
  else if (r.top - ch - 14 >= margin) top = r.top - ch - 14;
  else top = Math.max(margin, window.innerHeight - ch - margin);
  card.style.left = Math.round(left) + "px";
  card.style.top = Math.round(top) + "px";
}

function demoKey(e) {
  if (e.key === "Escape") demoStop();
  else if (e.key === "ArrowRight") demoNext();
  else if (e.key === "ArrowLeft") demoGo(demoIdx - 1);
}

function demoStop() {
  demoIdx = -1;
  document.removeEventListener("keydown", demoKey);
  window.removeEventListener("resize", demoReposition);
  window.removeEventListener("scroll", demoReposition, true);
  if (demoEls) {
    demoEls.spot.remove();
    demoEls.card.remove();
    demoEls = null;
  }
}

/* =============================================================================
   17. 事件绑定与启动
   ============================================================================= */
function bindEvents() {
  $("upload-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) detectUpload(file);
    e.target.value = "";
  });
  $("load-scenario-btn").addEventListener("click", () => {
    const idx = $("scenario-select").value;
    if (idx !== "") loadScenario(Number(idx));
  });
  $("run-attr-btn").addEventListener("click", () => runAttribution(false));
  $("scenario-select").addEventListener("change", () => {
    const idx = $("scenario-select").value;
    if (idx !== "") loadScenario(Number(idx));
  });
  const clRunsLink = $("cl-runs-link");
  if (clRunsLink) {
    clRunsLink.addEventListener("click", () => {
      switchView("runs");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  const ctxToggle = $("context-toggle");
  if (ctxToggle) {
    ctxToggle.addEventListener("click", () => setContextOpen($("context-form").classList.contains("hidden")));
  }
  setContextOpen(false);
  const toggleRecords = () => {
    const collapsed = $("records-body-wrap").classList.toggle("hidden");
    $("records-toggle").textContent = collapsed ? "展开" : "收起";
    $("records-head").setAttribute("aria-expanded", String(!collapsed));
  };
  $("records-head").addEventListener("click", toggleRecords);
  $("records-head").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRecords(); }
  });
}

function startClock() {
  const el = $("clock");
  if (!el) return;
  const p = (n) => String(n).padStart(2, "0");
  const tick = () => {
    const d = new Date();
    el.textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

/** 深链直达：?boot=detect|attribute|verify|ticket|runs|alertlog，用于演示与截图 */
async function runBoot() {
  const boot = new URLSearchParams(location.search).get("boot");
  if (!boot) return;
  try {
    if (boot === "detect" || boot === "attribute" || boot === "verify") {
      await loadManifest();
      await loadFirstSample();
    }
    if (boot === "detect") {
      switchView("workbench");
    }
    if (boot === "attribute") {
      switchView("attribution");
      await runAttribution(true);
      document.querySelectorAll("#context-form .form-group").forEach((g) => {
        g.classList.remove("open");
        const h = g.querySelector("[data-group-toggle]");
        if (h) h.setAttribute("aria-expanded", "false");
      });
      setContextOpen(false);
    }
    if (boot === "verify") {
      switchView("verify");
      await loadVerify();
      await runVerify({ renderResult: true });
    }
    if (boot === "ticket") {
      switchView("ticket");
      await loadTickets();
    }
    if (boot === "runs") {
      switchView("runs");
      await loadRuns();
    }
    if (boot === "alertlog") {
      switchView("alertlog");
      await loadAlertLog();
    }
  } catch (e) {}
}

renderNav();
bindEvents();
bindDrawer();
bindAlertBell();
bindDemo();
bindHome();
startClock();
loadFlowProgress();
loadMetrics();
applyChrome();
loadManifest();
loadRecords();
loadSchema();
loadAlerts();

const initView = (location.hash || "").replace(/^#/, "");
switchView(VIEW_META[initView] ? initView : "home", true);
runBoot();

window.addEventListener("popstate", () => {
  const key = (location.hash || "").replace(/^#/, "");
  switchView(VIEW_META[key] ? key : "home", true);
});

window.addEventListener("resize", () => {
  [...Object.values(clCharts), ...Object.values(dashCharts)].forEach((c) => {
    try { c.resize(); } catch (e) {}
  });
});
