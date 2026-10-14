/* =============================================================================
   1. 基础常量与工具
   ============================================================================= */
const NAV_ITEMS = [
  { key: "home", label: "首页", icon: "home" },
  { key: "workbench", label: "检测工作台" },
  { key: "attribution", label: "归因诊断" },
  { key: "ticket", label: "整改工单" },
  { key: "verify", label: "闭环验证" },
  { key: "qa", label: "智能问答" },
  { key: "knowledge", label: "知识库" },
  { key: "dashboard", label: "分析看板" },
  { key: "batches", label: "数据批次" },
  { key: "detectlog", label: "检测记录" },
  { key: "runs", label: "复检历史" },
  { key: "alertlog", label: "报警历史" },
];

const NAV_ICONS = {
  home: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-4.5h4V19"/></svg>',
};

const NAV_GROUPS = [
  { label: "诊断流程", keys: ["workbench", "attribution", "ticket", "verify"] },
  { label: "支撑工具", keys: ["qa", "knowledge", "batches", "dashboard"] },
  { label: "历史记录", keys: ["detectlog", "runs", "alertlog"] },
];

/** 完整功能模式（已移除评委大屏演示入口） */
const DEMO_MODE = false;
const FULL_MODE = true;
let demoSessionWoId = null;
let demoDockBound = false;

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
  if (DEMO_MODE) {
    flowDone = { detect: false, attribute: false, ticket: false, verify: false };
    return;
  }
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
  if (DEMO_MODE) return;
  try { localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flowDone)); } catch (e) {}
}

/* =============================================================================
   3b. 评委演示：顶栏 KPI + 底栏四步 + 线性闭环（≤8 次点击）
   ============================================================================= */
const FLOW_KPI_LABELS = ["缺陷识别准确率", "根因定位准确率", "闭环缺陷率降幅", "改进建议可执行率"];
const DEMO_KPI_LABELS = FLOW_KPI_LABELS;

function initDemoChrome() {
  document.body.classList.add("full-mode");
}

function resetDemoSession() {
  flowDone = { detect: false, attribute: false, ticket: false, verify: false };
  demoSessionWoId = null;
  currentSample = null;
  lastAttrResult = null;
  lastAttrFingerprint = null;
  lastAttrIsSample = false;
  attrWoOrder = null;
  attrWoFingerprint = null;
  clResultDirty = false;
  clSelTouched = false;
  clSel = new Set();
  try { localStorage.removeItem(FLOW_STORAGE_KEY); } catch (e) {}
  renderEmpty({ title: "等待检测" });
  renderWorkbenchNext(false);
  if ($("attr-body")) renderAttrEmpty();
  switchView("workbench", true);
  try { history.replaceState({ view: "workbench" }, "", "#workbench"); } catch (e) {}
  showToast("演示已重置");
  renderDemoChrome();
}

function renderDemoKpiStrip() {
  const el = $("demo-kpi-strip");
  if (!el || !DEMO_MODE || !metricsData) return;
  const pick = metricsData.items.filter((m) => DEMO_KPI_LABELS.includes(m.label));
  const items = (pick.length ? pick : metricsData.items.slice(0, 4));
  el.innerHTML = items
    .map((m) => {
      const { num, unit } = splitValue(m.value);
      const hint = METRIC_HINT[m.label] ? ` title="${METRIC_HINT[m.label]}"` : "";
      return `<div class="demo-kpi-item"${hint}>
        <span class="demo-kpi-val num">${pctText(num, unit)}${unit || ""}</span>
        <span class="demo-kpi-label">${m.label}</span>
      </div>`;
    })
    .join("");
}

function demoContextText() {
  if (!currentSample) return "";
  const parts = [
    `样件 <b>${escapeHtml(currentSample.image || "—")}</b>`,
    `缺陷 <b>${escapeHtml(currentSample.defect_cn || "—")}</b>`,
    `置信度 <b>${currentSample.confidence_pct != null ? currentSample.confidence_pct.toFixed(1) + "%" : "—"}</b>`,
  ];
  if (lastAttrResult && lastAttrResult.top_root_cause && !lastAttrResult.error) {
    parts.push(`主因 <b>${escapeHtml(lastAttrResult.top_root_cause)}</b>`);
  }
  if (demoSessionWoId && woAll.length) {
    const wo = woAll.find((o) => o.id === demoSessionWoId);
    if (wo) parts.push(`工单 <b>${escapeHtml(wo.ticket_no || "—")}</b>`);
  }
  return parts.join(" · ");
}

function renderDemoDockSteps() {
  const el = $("demo-dock-steps");
  if (!el || !DEMO_MODE) return;
  const cur = activeView;
  const parts = [];
  FLOW_STEPS.forEach((s, i) => {
    const done = flowDone[s.key];
    const isCur = s.view === cur;
    const cls = isCur ? "current" : done ? "done" : "";
    const mark = done ? "✓" : String(i + 1);
    parts.push(`<div class="demo-dock-step ${cls}" data-demo-step="${s.view}">
      <span class="ds-no">${mark}</span><span>${s.label}</span>
    </div>`);
    if (i < FLOW_STEPS.length - 1) parts.push('<span class="demo-dock-sep"></span>');
  });
  el.innerHTML = parts.join("");
  el.querySelectorAll("[data-demo-step]").forEach((node) => {
    const key = node.dataset.demoStep;
    const go = () => {
      if (!demoCanNavigateTo(key, true)) return;
      switchView(key);
    };
    node.addEventListener("click", go);
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
  });
}

function demoActiveWorkOrder() {
  if (demoSessionWoId) {
    const o = woAll.find((x) => x.id === demoSessionWoId);
    if (o) return o;
  }
  if (attrWoOrder && attrWoOrder.id) return woAll.find((x) => x.id === attrWoOrder.id) || attrWoOrder;
  return null;
}

function demoWoReadyForVerify() {
  const o = demoActiveWorkOrder();
  return o && woReadyForVerify(o);
}

function demoCanNavigateTo(key, quiet) {
  if (!DEMO_MODE || !FLOW_VIEWS.includes(key)) return true;
  if (key === "workbench") return true;
  if (key === "attribution") {
    if (!currentSample) {
      if (!quiet) showToast("请先完成缺陷识别", false);
      return false;
    }
    return true;
  }
  if (key === "ticket") {
    if (!lastAttrResult || lastAttrResult.error) {
      if (!quiet) showToast("请先完成归因诊断", false);
      return false;
    }
    if (!demoActiveWorkOrder()) {
      if (!quiet) showToast("请先生成整改工单", false);
      return false;
    }
    return true;
  }
  if (key === "verify") {
    if (!demoWoReadyForVerify()) {
      if (!quiet) showToast("请先将工单推进至可复检状态", false);
      return false;
    }
    return true;
  }
  return true;
}

function getDemoDockCta() {
  const view = activeView;
  if (view === "workbench") {
    if (!currentSample || !flowDone.detect) {
      return { label: "请先选择样件", disabled: true, action: null };
    }
    return { label: "下一步：归因诊断 →", disabled: false, action: "goto-attribution" };
  }
  if (view === "attribution") {
    if (!currentSample) return { label: "请先选择样件", disabled: true, action: null };
    if (!lastAttrResult || lastAttrResult.error) {
      return { label: "开始归因", disabled: TASKS.attribute.running, action: "run-attribute" };
    }
    const wo = demoActiveWorkOrder();
    if (!wo) {
      return { label: "生成整改工单", disabled: false, action: "open-wo-modal" };
    }
    return { label: "下一步：整改工单 →", disabled: false, action: "goto-ticket" };
  }
  if (view === "ticket") {
    const wo = demoActiveWorkOrder();
    if (!wo) return { label: "请先生成工单", disabled: true, action: null };
    if (!woReadyForVerify(wo)) {
      return { label: "一键推进至可验证", disabled: false, action: "fast-track-wo" };
    }
    return { label: "下一步：闭环验证 →", disabled: false, action: "goto-verify" };
  }
  if (view === "verify") {
    if (!demoWoReadyForVerify()) {
      return { label: "请先完成工单推进", disabled: true, action: null };
    }
    if (clResultDirty) {
      return { label: "闭环演示已完成", disabled: true, action: null };
    }
    return { label: "开始复检推演", disabled: TASKS.verify.running, action: "run-verify" };
  }
  return { label: "—", disabled: true, action: null };
}

async function onDemoDockCta() {
  const cta = getDemoDockCta();
  if (cta.disabled || !cta.action) return;
  if (cta.action === "goto-attribution") {
    ensureDemoScenario();
    switchView("attribution");
    return;
  }
  if (cta.action === "run-attribute") {
    await runAttribution(false);
    renderDemoChrome();
    return;
  }
  if (cta.action === "open-wo-modal") {
    if (lastAttrResult && !lastAttrResult.error) openWorkOrderModal(lastAttrResult);
    return;
  }
  if (cta.action === "goto-ticket") {
    switchView("ticket");
    await loadTickets();
    return;
  }
  if (cta.action === "fast-track-wo") {
    const wo = demoActiveWorkOrder();
    if (wo) await demoFastTrackWorkOrder(wo.id);
    return;
  }
  if (cta.action === "goto-verify") {
    switchView("verify");
    await loadVerify();
    const wo = demoActiveWorkOrder();
    if (wo) {
      clSelTouched = true;
      clSel = new Set([wo.id]);
      renderVerifyOrders();
    }
    return;
  }
  if (cta.action === "run-verify") {
    await runVerify({ save: true });
    setFlow("verify", true);
    renderDemoChrome();
  }
}

async function demoFastTrackWorkOrder(id) {
  const btn = $("demo-dock-cta");
  setBtnLoading(btn, true);
  try {
    let o = woAll.find((x) => x.id === id);
    if (!o) await loadTickets();
    o = woAll.find((x) => x.id === id);
    if (!o) throw new Error("missing");
    if (o.status === "待处理") {
      const r1 = await fetch(`/api/work-orders/${id}/rectify`, { method: "POST" });
      if (!r1.ok) throw new Error("rectify");
      const d1 = await r1.json();
      if (d1.order) o = d1.order;
    }
    if (o.status === "处理中") {
      const r2 = await fetch(`/api/work-orders/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "已解决" }),
      });
      if (!r2.ok) throw new Error("status");
      o = await r2.json();
    }
    const it = woAll.find((x) => x.id === id);
    if (it && o && o.status) {
      it.status = o.status;
      it.updated_at = o.updated_at || it.updated_at;
    }
    demoSessionWoId = id;
    setFlow("ticket", true);
    renderWoTabs();
    renderTickets();
    showToast("整改已推进至可复检状态");
    renderDemoChrome();
  } catch (e) {
    showToast("工单推进失败，请重试", false);
  } finally {
    setBtnLoading(btn, false);
  }
}

function ensureDemoScenario() {
  if (!DEMO_MODE || !attrSchema || !attrSchema.scenarios || !attrSchema.scenarios.length) return;
  const defect = $("defect-select")?.value || (currentSample && currentSample.defect);
  let idx = attrSchema.scenarios.findIndex((s) => s.defect_type === defect);
  if (idx < 0) idx = 0;
  loadScenario(idx);
}

function renderDemoChrome() {
  if (!DEMO_MODE) return;
  renderDemoKpiStrip();
  renderDemoDockSteps();
  const ctx = $("demo-dock-context");
  if (ctx) ctx.innerHTML = demoContextText();
  const cta = getDemoDockCta();
  const btn = $("demo-dock-cta");
  if (btn) {
    btn.textContent = cta.label;
    btn.disabled = !!cta.disabled;
  }
}

/** 预拉工单列表，用于闭环验证前的流程守卫 */
async function ensureWoLoaded() {
  if (woAll.length) return;
  try {
    const res = await fetch("/api/work-orders");
    const d = await res.json();
    woAll = d.items || [];
  } catch (e) {}
}

/** 四步闭环页的导航守卫：演示模式更严格，完整版允许先看工单列表 */
function guardFlowNavigation(key, quiet) {
  if (DEMO_MODE && key === "home") return "workbench";
  if (!FLOW_VIEWS.includes(key)) return key;
  if (DEMO_MODE) {
    if (demoCanNavigateTo(key, quiet)) return key;
    return activeView;
  }
  if (key === "attribution") {
    if (!currentSample) {
      if (!quiet) showToast("请先完成缺陷识别", false);
      return activeView;
    }
    return key;
  }
  if (key === "verify") {
    if (!woAll.some(woReadyForVerify)) {
      if (!quiet) showToast("请先将至少一张工单推进至「已完成」", false);
      return activeView;
    }
  }
  return key;
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

/** 顶部流程条：完整版已用底部 flow-action-dock 统一展示，此处不再渲染避免重复 */
function renderFlowRail() {
  const el = $("flow-rail");
  if (!el) return;
  if (DEMO_MODE || FULL_MODE) {
    el.className = "flow-rail hidden";
    el.innerHTML = "";
    return;
  }
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
    const cls = running ? "running" : isCur ? "current" : done ? "done" : "";
    const state = running ? "进行中" : isCur ? "当前步骤" : done ? "已完成" : "未开始";
    parts.push(`<div class="frail-item ${cls}" role="button" tabindex="0" data-flow-view="${s.view}" title="点击进入${s.label}">
      <span class="frail-no">${done ? "✓" : i + 1}</span>
      <span class="frail-body">
        <span class="frail-name">${s.label}</span>
      </span>
      <span class="frail-state">${state}</span>
    </div>`);
    if (i < FLOW_STEPS.length - 1) parts.push('<span class="frail-sep"></span>');
  });
  el.innerHTML = parts.join("");
  const go = async (node) => {
    const target = node.dataset.flowView;
    if (target === "verify") await ensureWoLoaded();
    const allowed = guardFlowNavigation(target, false);
    if (allowed !== target) return;
    switchView(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  el.querySelectorAll("[data-flow-view]").forEach((n) => {
    n.addEventListener("click", () => { go(n); });
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(n); }
    });
  });
}

function flowStepsHtml() {
  const curIdx = stepIndexOfView(activeView);
  return FLOW_STEPS.map((s, i) => {
    const done = flowDone[s.key];
    const running = FLOW_RUNNING[s.key] ? FLOW_RUNNING[s.key]() : false;
    const isCur = i === curIdx;
    const cls = [done ? "done" : "", isCur ? "current" : "", running ? "running" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="fds-step ${cls}" data-flow-jump="${s.view}">
      <span class="fds-no">${done ? "✓" : i + 1}</span>
      <span class="fds-label">${s.label}</span>
    </button>`;
  }).join('<span class="fds-sep" aria-hidden="true"></span>');
}

function bindFlowGuideHandlers(root, action) {
  if (!root) return;
  root.querySelectorAll("[data-flow-jump]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.flowJump;
      if (target === "verify") await ensureWoLoaded();
      const allowed = guardFlowNavigation(target, false);
      if (allowed !== target) return;
      switchView(target);
    });
  });
  const primary = root.querySelector("[data-flow-primary]");
  if (primary && action.onPrimary) primary.addEventListener("click", action.onPrimary);
  root.querySelectorAll("[data-flow-secondary]").forEach((b) => {
    if (action.onSecondary && b.dataset.flowSecondary === action.secondaryKey) {
      b.addEventListener("click", action.onSecondary);
    }
  });
}

/** 顶栏左侧：当前步骤标签 + 状态摘要（闭环后两步不依赖 currentSample） */
function flowContextStatusBlock() {
  const step = FLOW_STEPS.find((s) => s.view === activeView);
  const tag = escapeHtml(step ? step.label : "流程");

  if (activeView === "verify") {
    const n = clSel ? clSel.size : 0;
    const batchEl = $("cl-batch");
    const batchTxt =
      batchEl && batchEl.selectedOptions[0] ? batchEl.selectedOptions[0].textContent.trim() : "";
    let main;
    if (n > 0) {
      main = `<span class="fc-item">纳入 <b>${n}</b> 张工单</span>`;
      if (batchTxt) {
        main += `<span class="fc-dot">·</span><span class="fc-item">${escapeHtml(batchTxt)}</span>`;
      }
      if (clResultDirty) {
        main += `<span class="fc-dot">·</span><span class="fc-item">预览已更新</span>`;
      }
    } else {
      main = `<span class="fc-item fc-empty">勾选工单后自动预览，左侧按钮可保存推演</span>`;
    }
    return { tag, statusMain: main };
  }

  if (activeView === "ticket") {
    const readyCount = woAll.filter(woReadyForVerify).length;
    const pending = woAll.filter((o) => o.status === "待处理" || o.status === "处理中").length;
    let main = `<span class="fc-item">可验证 <b>${readyCount}</b> 张</span>`;
    if (pending) {
      main += `<span class="fc-dot">·</span><span class="fc-item">待推进 <b>${pending}</b></span>`;
    }
    return { tag, statusMain: main };
  }

  const s = currentSample;
  const sel = $("defect-select");
  const analyzed = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.trim() : "";
  const mismatch = s && analyzed && s.defect_cn && analyzed !== s.defect_cn;
  const statusMain = s
    ? `<span class="fc-item"><b>${escapeHtml(s.defect_cn || "—")}</b></span>
       <span class="fc-dot">·</span>
       <span class="fc-item fc-mono">${escapeHtml(s.image || "—")}</span>
       <span class="fc-dot">·</span>
       <span class="fc-item fc-mono">${s.confidence_pct != null ? s.confidence_pct.toFixed(1) + "%" : "—"}</span>
       ${severityTag(s.severity)}
       ${mismatch ? `<span class="fc-dot">·</span><span class="fc-item fc-warn">归因 ${escapeHtml(analyzed)}</span>` : ""}`
    : `<span class="fc-item fc-empty">请先完成样件识别</span>`;
  return { tag, statusMain };
}

/** 四步流程顶栏：步骤 + 本次诊断样件 + 当前步骤说明与主操作（合并原 flow-context 与 flow-action-dock） */
function renderFlowContext() {
  const el = $("flow-context");
  if (!el) return;
  if (DEMO_MODE || !FLOW_VIEWS.includes(activeView)) {
    el.className = "flow-context hidden";
    el.innerHTML = "";
    return;
  }
  const { tag, statusMain } = flowContextStatusBlock();

  const action = buildFlowAction();
  const stepsBlock = FULL_MODE
    ? ""
    : `<div class="fc-steps-row">
      <div class="fds-steps" role="tablist" aria-label="闭环四步">${flowStepsHtml()}</div>
    </div>`;

  const sampleOptional = activeView === "verify" || activeView === "ticket";
  let actionHtml = action.ops || "";
  if (!currentSample && !sampleOptional) {
    if (activeView === "workbench") {
      actionHtml = `<button type="button" class="btn btn-primary btn-sm" id="fc-pick-btn">选样件</button>`;
    } else if (!actionHtml.includes("data-flow-primary")) {
      actionHtml = `<button type="button" class="btn btn-ghost btn-sm" id="fc-pick-btn">去工作台</button>${actionHtml}`;
    } else {
      actionHtml = `<button type="button" class="btn btn-ghost btn-sm" id="fc-pick-btn">去工作台</button>`;
    }
  }

  const hint = action.html ? `<span class="fc-hint">${action.html}</span>` : "";

  el.className = "flow-context flow-context-unified";
  el.innerHTML = `
    ${stepsBlock}
    <div class="fc-bar">
      <span class="fc-tag">${tag}</span>
      <div class="fc-status">${statusMain}${hint}</div>
      <div class="fc-actions">${actionHtml}</div>
    </div>`;

  bindFlowGuideHandlers(el, action);
  const pickBtn = $("fc-pick-btn");
  if (pickBtn) pickBtn.addEventListener("click", () => switchView("workbench"));
}

function runVerifyFlowPrimary() {
  const btn = $("cl-run-btn");
  if (btn && !btn.disabled) btn.click();
  else runVerify({ save: true });
}

/** 页面内仅提示，主操作统一在顶部 #flow-context */
function flowPageHint(actionLabel) {
  if (!actionLabel) return "";
  return `<div class="flow-page-hint" role="status">
    <span>请使用顶部流程条继续：<b>${escapeHtml(actionLabel)}</b></span>
  </div>`;
}

/** @deprecated 推进条与顶栏重复，保留供兼容 */
function nextStepBarHtml(currentView, opts = {}) {
  const idx = stepIndexOfView(currentView);
  const next = FLOW_STEPS[idx + 1];
  if (!next) {
    return `<div class="next-step-bar">
      <button class="btn btn-ghost btn-sm" data-goto="workbench">开始新一轮 →</button></div>`;
  }
  const ready = opts.ready !== false;
  return `<div class="next-step-bar">
    <button class="btn btn-primary btn-sm" data-goto="${next.view}"${ready ? "" : " disabled"}>下一步：${next.label} →</button>
  </div>`;
}

/** 绑定推进条按钮（内容重渲染后需重新调用） */
function bindNextStepBar(root) {
  if (!root) return;
  root.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      const target = b.dataset.goto;
      if (target === "verify") await ensureWoLoaded();
      const allowed = guardFlowNavigation(target, false);
      if (allowed !== target) return;
      switchView(target);
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );
}

/** @deprecated 已合并至 renderFlowContext；保留调用点兼容 */
function renderFlowActionDock() {
  const dock = $("flow-action-dock");
  if (dock) {
    dock.classList.add("hidden");
    dock.innerHTML = "";
  }
  renderFlowContext();
}

function buildFlowAction() {
  const noop = { html: "", ops: "", onPrimary: null };
  if (activeView === "workbench") {
    const ready = currentSample && flowDone.detect;
    if (!ready) return noop;
    return {
      html: "",
      ops: `<button type="button" class="btn btn-primary btn-sm" data-flow-primary>归因诊断 →</button>`,
      onPrimary: () => {
        switchView("attribution");
        ensureAttributionView();
      },
    };
  }
  if (activeView === "attribution") {
    const wo = attrWoFingerprint && attrWoFingerprint === lastAttrFingerprint ? attrWoOrder : null;
    if (!currentSample) return noop;
    if (!lastAttrResult || lastAttrResult.error) {
      return {
        html: "",
        ops: `<button type="button" class="btn btn-primary" data-flow-primary ${TASKS.attribute.running ? "disabled" : ""}>开始归因</button>`,
        onPrimary: () => runAttribution(false),
      };
    }
    if (wo) {
      return {
        html: `工单 <b>${escapeHtml(wo.ticket_no || "—")}</b> · ${STATUS_LABEL[wo.status] || wo.status}`,
        ops: `<button type="button" class="btn btn-ghost btn-sm" data-flow-secondary="wo-again">再生成一张</button>
          <button type="button" class="btn btn-primary" data-flow-primary>下一步：整改工单 →</button>`,
        onPrimary: () => {
          highlightWoId = wo.id;
          switchView("ticket");
        },
        secondaryKey: "wo-again",
        onSecondary: () => openWorkOrderModal(lastAttrResult),
      };
    }
    return {
      html: "",
      ops: `<button type="button" class="btn btn-primary" data-flow-primary>生成整改工单</button>`,
      onPrimary: () => openWorkOrderModal(lastAttrResult),
    };
  }
  if (activeView === "ticket") {
    const readyCount = woAll.filter(woReadyForVerify).length;
    if (!readyCount) {
      return {
        html: "",
        ops: `<button type="button" class="btn btn-primary" data-flow-primary disabled>下一步：闭环验证 →</button>`,
        onPrimary: null,
      };
    }
    return {
      html: "",
      ops: `<button type="button" class="btn btn-primary" data-flow-primary>下一步：闭环验证 →</button>`,
      onPrimary: async () => {
        await ensureWoLoaded();
        switchView("verify");
        loadVerify();
      },
    };
  }
  if (activeView === "verify") {
    if (clResultDirty) {
      return {
        html: "",
        ops: `<button type="button" class="btn btn-primary btn-sm" data-flow-primary>开启新一轮 →</button>`,
        onPrimary: () => {
          switchView("workbench");
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
      };
    }
    return noop;
  }
  return noop;
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
  "view-qa", "view-knowledge", "view-batches", "view-dashboard", "view-detectlog", "view-runs", "view-alertlog",
];
const BASE_TITLE = "钢材表面质量缺陷智能归因与闭环处置平台";
const VIEW_META = {
  home: { label: "首页" },
  workbench: { label: "检测工作台" },
  attribution: { label: "归因诊断" },
  ticket: { label: "整改工单" },
  verify: { label: "闭环验证" },
  qa: { label: "智能问答" },
  knowledge: { label: "知识库" },
  batches: { label: "数据批次" },
  dashboard: { label: "分析看板" },
  detectlog: { label: "检测记录" },
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

async function switchView(key, fromPop) {
  if (!VIEW_META[key]) key = "home";
  if (key === "verify") await ensureWoLoaded();
  key = guardFlowNavigation(key, false);
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
  if (key === "attribution") {
    showView("view-attribution");
    ensureDemoScenario();
    ensureAttributionView();
    return;
  }
  if (key === "ticket") { showView("view-ticket"); loadTickets(); return; }
  if (key === "verify") { showView("view-verify"); loadVerify(); return; }
  if (key === "qa") { showView("view-qa"); loadQaView(); return; }
  if (key === "knowledge") { showView("view-knowledge"); loadKb(); return; }
  if (key === "batches") { showView("view-batches"); loadBatchesPage(); return; }
  if (key === "dashboard") { showView("view-dashboard"); loadDashboard(); return; }
  if (key === "detectlog") { showView("view-detectlog"); loadRecords(); return; }
  if (key === "runs") { showView("view-runs"); loadRuns(); return; }
  if (key === "alertlog") { showView("view-alertlog"); loadAlertLog(); return; }
}

function applyChrome() {
  renderMetrics();
  renderSampleBar();
  renderFlowRail();
  renderFlowContext();
  renderNavDots();
  updateAttrGuide();
  renderDemoChrome();
  document.body.classList.toggle("flow-dock-on", FULL_MODE && FLOW_VIEWS.includes(activeView));
}

function updateAttrGuide() {
  const panel = $("context-panel");
  const btn = $("run-attr-btn");
  const locked = !currentSample;
  if (panel) panel.classList.toggle("locked", locked);
  if (btn) { btn.disabled = locked || TASKS.attribute.running; btn.dataset.lockWhenIdle = locked ? "1" : "0"; }
}

/** 工艺参数默认展开（用户明确要求：参数应默认可见，缺什么补什么） */
function setContextOpen(open) {
  const form = $("context-form");
  if (!form) return;
  form.classList.toggle("hidden", !open);
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
    renderDemoKpiStrip();
  } catch (e) {
    if (box) renderError(box, "指标加载失败", loadMetrics);
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
    box.innerHTML = `<span class="eval-item">指标加载中…</span>`;
    return;
  }
  box.className = "eval-bar";
  box.innerHTML =
    "" +
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
  const dashBtn = $("home-dash-btn");
  if (dashBtn) dashBtn.addEventListener("click", () => {
    switchView("dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.querySelectorAll(".pipeline-card, .cap-card").forEach((card) => {
    const go = async () => {
      const view = card.dataset.view;
      if (view === "verify" || view === "ticket") await ensureWoLoaded();
      switchView(view);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
  });
  const homeVisual = document.querySelector(".home-card-visual img");
  if (homeVisual) {
    homeVisual.addEventListener("error", () => homeVisual.closest(".home-card-visual")?.classList.add("no-shot"));
  }
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

function sampleImageUrl(img) {
  const raw = (img && (img.url || img.file)) || "";
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/")) return raw;
  return `/demo_images/${String(raw).replace(/^.*[/\\]/, "")}`;
}

function renderSamples(classes) {
  const box = $("samples");
  if (!classes || !classes.length) {
    box.innerHTML = `<div class="empty-state small"><span class="empty-title">暂无示例样件</span></div>`;
    return;
  }
  box.innerHTML = classes
    .map((group) => {
      const imgs = group.images || [];
      if (!imgs.length) return "";
      return `<section class="sample-group" data-defect="${escapeHtml(group.key)}">
        <header class="sample-group-head">
          <span class="sample-group-cn">${escapeHtml(group.cn)}</span>
        </header>
        <div class="sample-group-grid">
          ${imgs
            .map((img) => {
              const src = sampleImageUrl(img);
              const label = img.description || group.cn;
              return `<button class="sample-card sample-card-thumb" type="button" data-file="${escapeHtml(img.file)}" data-url="${escapeHtml(src)}" title="${escapeHtml(label)}">
                <img src="${escapeHtml(src)}" alt="${escapeHtml(group.cn)}" loading="lazy" decoding="async" width="96" height="96">
              </button>`;
            })
            .join("")}
        </div>
      </section>`;
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
  const sub = message.sub
    ? `<span class="empty-sub">${message.sub}</span>`
    : "";
  $("result-panel").innerHTML = `<div class="panel-head"><h2 class="panel-title">识别结果</h2></div>
    <div class="empty-state guide-card">
      <span class="empty-title">${message.title}</span>
      ${sub}
      ${message.retry ? `<button class="btn btn-ghost btn-sm" id="result-retry" style="margin-top:12px">重试</button>` : ""}
    </div>`;
  const r = $("result-retry");
  if (r && message.retry) r.addEventListener("click", message.retry);
}

/** 识别结果：左侧图片铺开，右侧纵向信息栏，面板高度随内容收口 */
function renderResult(result, imageUrl, inferMs) {
  if (!result.available) {
    renderEmpty({ title: "无可用识别结果", sub: result.reason || "该图片无离线评测记录" });
    renderWorkbenchNext(false);
    return;
  }
  const weak = result.confidence < 0.7 ? " weak" : "";
  const realtime = result.mode === "realtime";
  const shownImage = realtime && result.annotated_url ? result.annotated_url : imageUrl;
  const boxCount = realtime ? result.detection_count || 0 : 0;
  const rows = realtime
    ? `<div class="row"><span class="k">推理耗时</span><span class="v">${inferMs != null ? inferMs + " ms" : "—"}</span></div>
       <div class="row"><span class="k">conf 阈值</span><span class="v">0.25</span></div>
       <div class="row"><span class="k">NMS IoU</span><span class="v">0.70</span></div>
       <div class="row"><span class="k">NMS 保留框</span><span class="v">${boxCount}</span></div>`
    : "";

  $("result-panel").innerHTML = `
    <div class="panel-head">
      <h2 class="panel-title">识别结果</h2>
      <span class="panel-sub">${result.file || ""}</span>
    </div>
    <div class="result-split">
      <figure class="result-figure">
        ${shownImage ? `<img class="result-preview" src="${shownImage}" alt="${result.file || "样件"}">` : ""}
        <figcaption class="result-cap ${realtime ? "realtime" : ""}">${realtime ? "实时" : "离线"}</figcaption>
      </figure>
      <div class="result-side">
        <div class="result-defect">
          <span class="result-defect-big">${result.defect_cn}<span class="en">${result.defect}</span></span>
          ${severityTag(result.severity)}
        </div>
        <div class="result-kv">
          <div class="row"><span class="k">置信度</span><span class="v${weak}">${result.confidence_pct.toFixed(2)}<span class="unit">%</span></span></div>
          <div class="row"><span class="k">识别通道</span><span class="v plain">${channelTag(result.mode_cn)}</span></div>
          ${rows}
        </div>
        ${flowPageHint("归因诊断 →")}
      </div>
    </div>`;
  setDefectSelect(result.defect);
  updateSampleBar(result);
  renderFlowActionDock();
}

function renderWorkbenchNext(ready) {
  renderFlowActionDock();
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
  renderFlowContext();
  updateAttrGuide();
}

function renderSampleBar() {
  const el = $("sample-bar");
  if (!el) return;
  /* 样件信息统一由「本次诊断」上下文条承载，旧的样本条不再使用 */
  el.className = "sample-bar hidden";
  el.innerHTML = "";
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
    renderDemoChrome();
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
    renderDemoChrome();
  } catch (e) {
    if (e && e.name === "AbortError") return;
    renderEmpty({ title: "识别失败", sub: "请稍后重试", retry: () => detectUpload(file) });
  } finally {
    releaseTask("detect");
  }
}

/* ---------- 历史记录页（检测 / 复检 / 报警）共用 ---------- */
function renderHistoryKpi(elId, cards) {
  const el = $(elId);
  if (!el) return;
  if (!cards || !cards.length) {
    el.innerHTML = "";
    el.setAttribute("aria-hidden", "true");
    return;
  }
  el.removeAttribute("aria-hidden");
  el.innerHTML = cards
    .map(
      (c) =>
        `<div class="history-stat"${c.title ? ` title="${escapeHtml(c.title)}"` : ""}><div class="k">${escapeHtml(c.k)}</div><div class="v${c.danger ? " danger" : ""}">${escapeHtml(String(c.v))}</div></div>`
    )
    .join("");
}

function shortHistoryTime(ts) {
  if (!ts || ts === "—") return "—";
  const [d, t] = String(ts).split(/\s+/);
  if (!d) return escapeHtml(ts);
  const md = d.length >= 10 ? d.slice(5) : d;
  const hm = t ? t.slice(0, 5) : "";
  return `<span class="runs-ts"><span class="runs-ts-d">${escapeHtml(md)}</span>${hm ? `<span class="runs-ts-t">${escapeHtml(hm)}</span>` : ""}</span>`;
}

/* ---------- 检测记录 ---------- */
function recordRow(rec) {
  const weak = rec.confidence < 0.7 ? " weak" : "";
  const img = rec.image_name || "—";
  return `<tr>
    <td>${shortHistoryTime(rec.ts)}</td>
    <td><span class="history-ellipsis" title="${escapeHtml(img)}">${escapeHtml(img)}</span></td>
    <td>${escapeHtml(rec.defect_cn || "—")}</td>
    <td class="num${weak}">${(rec.confidence * 100).toFixed(1)}%</td>
    <td>${severityTag(rec.severity)}</td>
    <td>${channelTag(rec.channel)}</td>
  </tr>`;
}

function updateRecordsCount() {
  const n = recordsAll.length;
  const title = $("records-title");
  if (title) title.textContent = "检测记录";
  const sub = $("records-view-count");
  if (sub) sub.textContent = n ? `共 ${n} 条` : "—";
  const severe = recordsAll.filter((r) => r.severity === ALERT_SEVERE_LEVEL).length;
  const types = new Set(recordsAll.map((r) => r.defect_cn).filter(Boolean));
  renderHistoryKpi("detectlog-kpi", [
    { k: "检测次数", v: n },
    { k: "严重缺陷", v: severe, danger: severe > 0 },
    { k: "涉及类型", v: types.size },
  ]);
}

function prependRecord(rec) {
  recordsAll.unshift(rec);
  updateRecordsCount();
  if (activeView === "detectlog") renderRecordsPage();
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
    updateRecordsCount();
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
    renderContextForm(attrSchema.default_context || {});
  } catch (e) {
    renderError("context-form", "工艺参数加载失败", loadSchema);
  }
}

function renderDefectSelect() {
  const sel = $("defect-select");
  sel.innerHTML = attrSchema.defect_types.map((d) => `<option value="${d.key}">${d.cn}</option>`).join("");
}

/** 典型场景不再与缺陷类型并列（避免两个入口重复选同一件事）：弹层里选 */
function openScenarioPicker() {
  const body = attrSchema.scenarios
    .map(
      (s, i) => `<button type="button" class="scenario-item" data-scenario="${i}">
        <span class="scenario-defect">${s.defect_cn}</span>
        <span class="scenario-meta">${s.record_id} · ${s.steel_grade}</span>
      </button>`
    )
    .join("");
  openFormModal({
    title: "载入典型场景",
    bodyHtml: `<div class="scenario-list">${body}</div>`,
    footHtml: `<button class="btn btn-ghost btn-sm" data-close>取消</button>`,
    onMount(box, foot, close) {
      box.querySelectorAll("[data-scenario]").forEach((b) =>
        b.addEventListener("click", () => {
          loadScenario(Number(b.dataset.scenario));
          close();
        })
      );
    },
  });
}

function renderContextForm(context) {
  const box = $("context-form");
  box.innerHTML = attrSchema.groups
    .map((group) => {
      const fields = group.fields
        .map((f) => {
          const val = context[f.key] !== undefined ? context[f.key] : f.default;
          const unit = f.unit ? `<span class="field-unit">${f.unit}</span>` : "";
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
          return `<label class="form-field form-field-kv">
            <span class="field-label">${f.label}</span>
            <span class="field-control">${control}${unit}</span>
          </label>`;
        })
        .join("");
      return `<div class="form-group form-group-static open" data-group="${group.title}" data-dim="${group.fields[0] ? group.fields[0].dimension : ""}">
        <div class="form-group-head">
          <span class="form-group-title">${group.title}</span>
          <span class="group-badge hidden" data-group-badge></span>
        </div>
        <div class="form-grid form-grid-dense">${fields}</div>
      </div>`;
    })
    .join("");
  box.querySelectorAll("[data-key]").forEach((el) => {
    el.addEventListener("change", updateCtxFlow);
    el.addEventListener("input", updateCtxFlow);
  });
  updateCtxFlow();
  if (lastAttrResult && !lastAttrResult.error) updateGroupBadges(lastAttrResult);
}

/** 顶栏：本次归因用的缺陷类型 + 关键工艺上下文（与下方表单同步） */
function ctxChip(label, value, extraClass = "") {
  return `<span class="ctx-chip${extraClass ? ` ${extraClass}` : ""}">
    <span class="ctx-k">${escapeHtml(label)}</span>
    <span class="ctx-v">${escapeHtml(value)}</span>
  </span>`;
}

function updateCtxFlow() {
  const flow = $("ctx-flow");
  if (!flow) return;
  const sel = $("defect-select");
  const defect = sel?.selectedOptions?.[0]?.textContent?.trim() || "—";
  const hasForm = $("context-form")?.querySelector("[data-key]");
  const ctx = hasForm ? collectContext() : {};
  const detected = currentSample?.defect_cn;
  const mismatch = detected && defect && defect !== detected;
  const chips = [ctxChip("归因缺陷", defect, "ctx-chip-primary")];
  if (ctx.steel_grade) chips.push(ctxChip("钢种", ctx.steel_grade));
  if (ctx.heat_no) chips.push(ctxChip("炉号", ctx.heat_no, "ctx-chip-mono"));
  if (ctx.shift_team) chips.push(ctxChip("班组", ctx.shift_team));
  if (ctx.skill_level !== undefined && ctx.skill_level !== "") {
    chips.push(ctxChip("技能等级", String(ctx.skill_level)));
  }
  if (mismatch) {
    chips.push(
      ctxChip("视觉识别", `${detected}（与归因缺陷不一致）`, "ctx-chip-warn")
    );
  } else if (detected) {
    chips.push(ctxChip("视觉识别", detected));
  }
  flow.setAttribute(
    "aria-label",
    "本次归因上下文：" + [defect, ctx.steel_grade, ctx.heat_no, ctx.shift_team].filter(Boolean).join(" ")
  );
  flow.innerHTML = chips.join("");
}

function updateGroupBadges(result) {
  const box = $("context-form");
  if (!box) return;
  const counts = {};
  const hitFields = new Set();
  ((result && result.contributions) || []).forEach((c) => {
    const hits = (c.evidence || []).filter((e) => e.hit);
    counts[c.dimension] = hits.length;
    hits.forEach((e) => {
      if (e.field) hitFields.add(e.field);
    });
  });
  box.querySelectorAll(".form-group").forEach((g) => {
    const badge = g.querySelector("[data-group-badge]");
    if (!badge) return;
    const n = counts[g.dataset.dim] || 0;
    if (n > 0) {
      badge.textContent = `${n} 项超标`;
      badge.classList.remove("hidden");
      g.classList.add("group-has-hit");
    } else {
      badge.textContent = "";
      badge.classList.add("hidden");
      g.classList.remove("group-has-hit");
    }
  });
  box.querySelectorAll("[data-key]").forEach((el) => {
    const row = el.closest(".form-field-kv");
    if (row) row.classList.toggle("field-hit", hitFields.has(el.dataset.key));
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
  syncDefectSource(s.defect_cn);
}

/** 缺陷类型来源提示：识别结果 vs 手动指定，避免"图片是龟裂、结论算斑块"的错觉 */
function syncDefectSource(manualCn) {
  updateCtxFlow();
  renderFlowContext();
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
      renderDemoChrome();
    }
    switchView("attribution");
  } catch (e) {
    if (e && e.name === "AbortError") { setStateText("attribute", "", ""); return; }
    $("attr-body").innerHTML = `<div class="panel placeholder-panel"><div class="empty-state">
      <span class="empty-title">归因失败</span>
      <button class="btn btn-ghost btn-sm" id="attr-retry" style="margin-top:12px">重试</button></div></div>`;
    const r = $("attr-retry");
    if (r) r.addEventListener("click", () => runAttribution(true));
    switchView("attribution");
    showToast("归因失败，请稍后重试", false);
    setStateText("attribute", "归因失败", "fail");
  } finally {
    releaseTask("attribute");
    renderDemoChrome();
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
      <span class="empty-title">未得到归因结论</span></div></div>`;
    return;
  }
  const confNum = result.confidence * 100;
  const conf = confNum.toFixed(1);
  const DIM_SHORT = { 物料批次: "物料", 人员操作: "人员", 设备参数: "设备", 环境条件: "环境" };

  const dimTiles = result.contributions
    .map((c, i) => {
      const w = Math.max(0, Math.min(100, c.score));
      const short = DIM_SHORT[c.dimension_cn] || c.dimension_cn;
      const lead = i === 0 && w > 0;
      return `<div class="acb-tile${lead ? " is-lead" : ""}${w === 0 ? " is-zero" : ""}${c.insufficient ? " is-gap" : ""}">
        <span class="acb-tile-pct">${w.toFixed(0)}<small>%</small></span>
        <span class="acb-tile-name">${short}${c.insufficient ? " ·缺数" : ""}</span>
        <div class="acb-tile-bar" aria-hidden="true"><i style="width:${w}%"></i></div>
      </div>`;
    })
    .join("");

  const altCauses = result.candidates
    .slice(1, 4)
    .map(
      (c) =>
        `<span class="acb-alt-chip">
          <span class="acb-alt-name">${escapeHtml(c.root_cause)}</span>
          <span class="acb-alt-meta">匹配度 <b>${(c.strength * 100).toFixed(0)}%</b></span>
        </span>`
    )
    .join("");

  const evidenceAll = result.contributions.flatMap((c) => c.evidence.map((e) => ({ dim: c.dimension_cn, ...e })));
  const evidenceRows = evidenceAll
    .map((e) => {
      const level = evidenceLevel(e);
      const tag =
        level === "severe" ? '<span class="tag tag-severe">超标</span>'
          : level === "warn" ? '<span class="tag tag-warn">临界</span>'
          : '<span class="tag tag-normal">正常</span>';
      const dimShort = DIM_SHORT[e.dim] || e.dim;
      return `<tr class="ev-${level}">
        <td>${dimShort}</td>
        <td>${e.field_label}</td>
        <td class="num">${e.value}</td>
        <td class="num">${e.op} ${e.threshold}</td>
        <td>${tag}</td>
      </tr>`;
    })
    .join("");
  const normalCount = evidenceAll.filter((e) => evidenceLevel(e) === "normal").length;

  const missingHtml =
    result.missing_fields.length || result.insufficient_dimensions.length
      ? `<div class="notice notice-warn" style="margin-top:12px;margin-bottom:0">
          <span class="notice-text">${
            result.missing_fields.map((m) => m.label + "（" + m.dimension_cn + "）").join("、") || "—"
          }</span>
        </div>`
      : "";

  const dropHtml =
    result.expected_drop_pct != null
      ? `<span class="acb-kv"><span class="acb-k">预期降幅</span><span class="acb-drop">↓${result.expected_drop_pct}%</span></span>`
      : "";

  body.innerHTML = `
    <section class="panel sec sec-lead attr-conclusion-board" id="sec-conclusion">
      <div class="acb-hero" aria-label="归因结论摘要">
        <div class="acb-hero-left">
          <span class="acb-kv"><span class="acb-k">缺陷</span><span class="acb-defect">${escapeHtml(result.defect_cn)}</span></span>
          <span class="acb-kv"><span class="acb-k">主因维度</span><span class="acb-dim">${escapeHtml(result.top_dimension_cn || "—")}</span></span>
        </div>
        <div class="acb-hero-right">
          <span class="acb-kv acb-kv-conf"><span class="acb-k">主因置信度</span><span class="acb-conf"><b>${conf}</b><small>%</small></span></span>
          ${dropHtml}
          <button class="btn btn-ghost btn-sm" type="button" id="attr-go-qa" title="针对本结论追问">智能问答</button>
        </div>
      </div>

      <p class="acb-cause">${escapeHtml(result.top_root_cause)}</p>

      <div class="acb-action">
        <p class="acb-action-text">${escapeHtml(result.solution || "—")}</p>
      </div>

      <div class="acb-dims" role="img" aria-label="四维贡献度">${dimTiles}</div>

      ${
        altCauses
          ? `<div class="acb-alt">
              <p class="acb-alt-hint">次优根因：规则也命中，但置信低于上方主因一行；细节见证据链。</p>
              ${altCauses}
            </div>`
          : ""
      }

      ${missingHtml}
    </section>

    <section class="panel sec sec-evidence" id="sec-evidence">
      <div class="sec-head sec-head-tight">
        <h2 class="panel-title">证据链</h2>
        <span class="sec-note">${evidenceAll.length} 项</span>
      </div>
      <div class="table-wrap">
        <table class="data-table evidence-table show-normal evidence-table-compact">
          <thead><tr>
            <th>维</th><th>参数</th><th>实际</th><th>阈值</th><th>状态</th>
          </tr></thead>
          <tbody>${
            evidenceRows || `<tr><td colspan="5" class="empty-cell">无命中证据</td></tr>`
          }</tbody>
        </table>
      </div>
    </section>
    ${flowPageHint(
      attrWoFingerprint && attrWoFingerprint === lastAttrFingerprint && attrWoOrder
        ? "整改工单 →"
        : "生成整改工单"
    )}`;

  renderAttrCta();
  updateGroupBadges(result);

  const goQa = $("attr-go-qa");
  if (goQa) {
    goQa.replaceWith(goQa.cloneNode(true));
    $("attr-go-qa").addEventListener("click", () => switchView("qa"));
  }
}

/** 归因页行动入口已迁至底部引导坞 */
function renderAttrCta() {
  renderFlowActionDock();
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
      ${flowPageHint(hasSample ? "开始归因" : "选样件")}
    </div>
  </div>`;
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
    footHtml: `<button class="btn btn-ghost btn-sm" data-close>取消</button>
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
          if (order && order.id) {
            demoSessionWoId = order.id;
            highlightWoId = order.id;
          }
          renderAttrCta();
          setFlow("ticket", true);
          showToast(`整改工单 ${order && order.ticket_no ? order.ticket_no : ""} 已生成`);
          if (DEMO_MODE) {
            switchView("ticket");
            loadTickets();
          }
          renderDemoChrome();
        } catch (e) {
          setBtnLoading(btn, false);
          showToast(e.message || "工单生成失败，请重试", false);
        }
      });
    },
  });
}

/* ---------- 智能问答（独立页） ---------- */
let qaEventsBound = false;

function qaContextResult() {
  if (lastAttrResult && !lastAttrResult.error && lastAttrResult.top_root_cause) {
    return lastAttrResult;
  }
  return null;
}

function loadQaView() {
  const ctx = qaContextResult();
  renderQaChips(ctx);
  if (!qaEventsBound) {
    bindQaEvents();
    qaEventsBound = true;
  }
}

function renderQaChips(result) {
  const el = $("qa-chips");
  if (!el) return;
  const hasCtx = result && result.defect_cn;
  const items = hasCtx
    ? [
        `为什么会出现${result.defect_cn}？`,
        "支持这个主因的证据链是什么？",
        "闭环处置与验证要点是什么？",
      ]
    : [
        "平台支持哪些缺陷类型与归因维度？",
        "夹杂类缺陷常见根因与处置思路？",
        "归因置信度偏低时如何补采参数？",
      ];
  el.innerHTML = items
    .map(
      (q) =>
        `<button class="btn btn-ghost qa-chip" type="button" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`
    )
    .join("");
  el.querySelectorAll("[data-q]").forEach((b) => {
    b.addEventListener("click", () => {
      const input = $("qa-input");
      if (input) input.value = b.dataset.q;
      askQa(b.dataset.q);
    });
  });
}

function bindQaEvents() {
  const askBtn = $("qa-ask");
  const input = $("qa-input");
  const run = () => {
    const q = input ? input.value.trim() : "";
    if (q) askQa(q);
  };
  if (askBtn) askBtn.addEventListener("click", run);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run();
      }
    });
  }
}

async function askQa(question) {
  const box = $("qa-answer");
  if (!box || !question) return;
  const result = qaContextResult() || {};
  box.innerHTML = `<div class="loading"><span class="spinner"></span>正在生成回答…</div>`;
  const payload = {
    question,
    defect_type: result.defect_type || undefined,
    attribution: result.top_root_cause ? result : {},
  };
  try {
    const res = await fetch("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof d.detail === "string" ? d.detail : "问答请求失败";
      renderError(box, msg, () => askQa(question));
      return;
    }
    box.innerHTML = `<div class="qa-bubble">${escapeHtml(d.answer || "（无内容）")}</div>`;
  } catch (e) {
    renderError(box, "问答请求失败", () => askQa(question));
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
    <span class="kb-stat-item">占比<b>${kbStats.rate}%</b></span>`;
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
    el.innerHTML = `<div class="empty-state"><span class="empty-title">没有匹配的规则</span></div>`;
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
  let items = woAll.filter((o) => {
    if (woActiveStatus && o.status !== woActiveStatus) return false;
    if (dim && o.dimension_cn !== dim) return false;
    if (kw) {
      const hay = `${o.ticket_no} ${o.root_cause} ${o.measure} ${o.owner} ${o.defect_cn}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  if (DEMO_MODE && demoSessionWoId) {
    items = items.filter((o) => o.id === demoSessionWoId);
  }
  return items;
}

function renderTickets() {
  const el = $("wo-list");
  const countEl = $("wo-count");
  const items = woFiltered();
  const panel = el && el.closest(".panel");
  let banner = panel ? panel.querySelector("#demo-ticket-banner") : null;
  if (DEMO_MODE && panel) {
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "demo-ticket-banner";
      banner.className = "demo-ticket-banner";
      panel.insertBefore(banner, el);
    }
    const wo = demoActiveWorkOrder();
    const msg = wo ? `演示工单 ${wo.ticket_no}` : "";
    banner.textContent = msg;
    banner.classList.toggle("hidden", !msg);
  } else if (banner) banner.remove();
  if (countEl) countEl.textContent = `共 ${woAll.length} 条 · 当前 ${items.length} 条`;
  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-title">${woAll.length ? "当前筛选下没有工单" : "暂无工单"}</span></div>`;
    renderWoFlowHint(panel, 0);
    return;
  }
  const readyCount = items.filter(woReadyForVerify).length;
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
        <div class="wo-track">${track}</div>
      </div>`;
    })
    .join("");
  el.querySelectorAll("[data-rectify]").forEach((b) => b.addEventListener("click", () => advanceOrder(b, "rectify")));
  el.querySelectorAll("[data-wo-status-btn]").forEach((b) =>
    b.addEventListener("click", () => advanceOrder(b, "status", b.dataset.next))
  );
  if (highlightWoId) {
    const card = el.querySelector(`.wo-card[data-wo="${highlightWoId}"]`);
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightWoId = null;
  }
  renderWoFlowHint(panel, readyCount);
  renderFlowActionDock();
}

function renderWoFlowHint(panel, readyCount) {
  if (!panel) return;
  let hint = panel.querySelector(".wo-flow-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "wo-flow-hint";
    panel.appendChild(hint);
  }
  if (!readyCount) {
    hint.innerHTML = "";
    hint.classList.add("hidden");
    return;
  }
  hint.classList.remove("hidden");
  hint.innerHTML = flowPageHint("闭环验证 →");
}

function ticketAction(o) {
  if (o.status === "待处理") return `<button class="btn btn-primary btn-sm" data-rectify="${o.id}">开始整改</button>`;
  if (o.status === "处理中") return `<button class="btn btn-primary btn-sm" data-wo-status-btn="${o.id}" data-next="已解决">完成整改</button>`;
  if (o.status === "已解决") {
    return `<button class="btn btn-primary btn-sm" data-wo-status-btn="${o.id}" data-next="已关闭">关闭工单</button>`;
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
let clBatchItems = [];

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
let verifyPreviewTimer = null;

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
    const rw = await fetch("/api/work-orders");
    const w = await rw.json();
    clOrders = (w.items || []).filter(woReadyForVerify);
    const valid = new Set(clOrders.map((o) => o.id));
    clSel = new Set([...clSel].filter((id) => valid.has(id)));
    if (!clSelTouched) clSel = new Set(clOrders.map((o) => o.id));
    const chosen = clOrders.filter((o) => clSel.has(o.id));
    const rv = await fetch("/api/closed-loop/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildVerifyPayload(chosen)),
    });
    const v = await rv.json();
    clMeasures = v.measures || [];
    clDropMap = {};
    clMeasures.forEach((m) => { clDropMap[m.defect] = m.expected_drop || 0; });
  } catch (e) {
    clOrders = [];
    clMeasures = [];
  }
}

/** 批次或样本量变化：清结果、重取可纳入工单 */
function updateClScopeMeta() {
  const meta = $("cl-scope-meta");
  const sel = $("cl-batch");
  if (!meta || !sel) return;
  const opt = sel.selectedOptions[0];
  if (!opt) {
    meta.textContent = "—";
    return;
  }
  const range = opt.dataset.range || "";
  const size = opt.dataset.size || "";
  meta.textContent = range ? `${range} · 共 ${size} 件` : "—";
}

async function onClScopeChange() {
  clResultDirty = false;
  clSelTouched = false;
  clSel = new Set();
  updateClScopeMeta();
  showClEmptyState();
  await refreshClOrders();
  renderVerifyOrders();
}

function formatBatchDefects(defectCounts) {
  if (!defectCounts) return "—";
  const parts = Object.entries(defectCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cn, n]) => `${cn} ${n}`);
  return parts.length ? parts.join(" · ") : "—";
}

const BATCH_DETAIL_PAGE = 50;

function renderBatchDetailTable(d) {
  const rows = (d.items || [])
    .map(
      (r) => `<tr>
        <td class="num">${escapeHtml(r.record_id || "—")}</td>
        <td>${shortHistoryTime(r.inspect_time)}</td>
        <td>${escapeHtml(r.steel_grade || "—")}</td>
        <td>${escapeHtml(r.defect_cn || "—")}</td>
        <td>${escapeHtml(r.severity || "—")}</td>
        <td class="num">${(r.confidence * 100).toFixed(1)}%</td>
      </tr>`
    )
    .join("");
  const total = d.total || 0;
  const limit = d.limit || BATCH_DETAIL_PAGE;
  const offset = d.offset || 0;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  return `<div class="batch-detail-head">
      <span>${escapeHtml(d.batch?.label || d.batch?.key || "")} · 本批 ${total} 条</span>
      <span class="batch-detail-range">当前 ${from}–${to}</span>
    </div>
    <div class="table-wrap batch-detail-table-wrap">
      <table class="data-table history-table runs-sub">
        <thead><tr>
          <th>记录号</th><th>检测时间</th><th>钢种</th><th>缺陷</th><th>等级</th><th class="num">置信度</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty-cell">本批无记录</td></tr>`}</tbody>
      </table>
    </div>
    <div class="pager batch-detail-pager" data-batch-key="${escapeHtml(d.batch?.key || "")}" data-offset="${offset}" data-total="${total}">
      <button class="btn btn-ghost btn-sm" type="button" data-batch-prev ${offset <= 0 ? "disabled" : ""}>上一页</button>
      <span class="pager-info">第 ${page} / ${pages} 页</span>
      <button class="btn btn-ghost btn-sm" type="button" data-batch-next ${offset + limit >= total ? "disabled" : ""}>下一页</button>
    </div>`;
}

async function loadBatchDetail(key, offset, pane) {
  if (!pane) return;
  pane.innerHTML = `<div class="loading"><span class="spinner"></span>载入记录…</div>`;
  try {
    const res = await fetch(
      `/api/closed-loop/batches/${encodeURIComponent(key)}?limit=${BATCH_DETAIL_PAGE}&offset=${offset}`
    );
    if (!res.ok) throw new Error("not found");
    const d = await res.json();
    pane.innerHTML = renderBatchDetailTable(d);
    const prev = pane.querySelector("[data-batch-prev]");
    const next = pane.querySelector("[data-batch-next]");
    if (prev) {
      prev.addEventListener("click", () => {
        if (d.offset <= 0) return;
        loadBatchDetail(key, Math.max(0, d.offset - d.limit), pane);
      });
    }
    if (next) {
      next.addEventListener("click", () => {
        if (d.offset + d.limit >= d.total) return;
        loadBatchDetail(key, d.offset + d.limit, pane);
      });
    }
  } catch (e) {
    pane.innerHTML = `<div class="error-state"><span class="error-text">记录加载失败</span>
      <button class="btn btn-ghost btn-sm" type="button" data-batch-retry>重试</button></div>`;
    const r = pane.querySelector("[data-batch-retry]");
    if (r) r.addEventListener("click", () => loadBatchDetail(key, offset, pane));
  }
}

async function loadBatchesPage() {
  const body = $("batches-body");
  const goVerify = $("batches-go-verify");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="6" class="empty-cell">正在载入批次…</td></tr>`;
  try {
    const res = await fetch("/api/closed-loop/batches");
    const d = await res.json();
    const items = d.items || [];
    const total = items.find((b) => b.is_all)?.size ?? items.reduce((m, b) => Math.max(m, b.size || 0), 0);
    const sub = items.filter((b) => !b.is_all).length;
    renderHistoryKpi("batches-kpi", [
      { k: "检测记录", v: total },
      { k: "推演批次", v: sub ? `${sub} + 整体` : "—" },
      { k: "默认抽样", v: d.default_sample || 200 },
    ]);
    const badge = $("batches-count");
    if (badge) badge.textContent = items.length ? `共 ${items.length} 项` : "—";
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty-cell">暂无批次数据</td></tr>`;
      return;
    }
    body.innerHTML = items
      .map(
        (b) => `<tr class="batch-row">
          <td class="num">${escapeHtml(b.key)}</td>
          <td>${escapeHtml(b.label)}</td>
          <td class="num">${escapeHtml(b.date_range || "—")}</td>
          <td class="num">${b.size ?? "—"}</td>
          <td><span class="batch-defects" title="${escapeHtml(formatBatchDefects(b.defect_counts))}">${escapeHtml(formatBatchDefects(b.defect_counts))}</span></td>
          <td><button class="btn btn-ghost btn-sm" type="button" data-batch-toggle="${escapeHtml(b.key)}" aria-expanded="false">查看记录</button></td>
        </tr>
        <tr class="batch-detail-row hidden" data-batch-detail="${escapeHtml(b.key)}">
          <td colspan="6"><div class="batch-detail-pane" data-batch-pane="${escapeHtml(b.key)}"></div></td>
        </tr>`
      )
      .join("");
    body.querySelectorAll("[data-batch-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.batchToggle;
        const row = body.querySelector(`[data-batch-detail="${key}"]`);
        const pane = body.querySelector(`[data-batch-pane="${key}"]`);
        if (!row || !pane) return;
        const open = row.classList.toggle("hidden");
        btn.textContent = open ? "查看记录" : "收起记录";
        btn.setAttribute("aria-expanded", String(!open));
        if (!open && !pane.dataset.loaded) {
          pane.dataset.loaded = "1";
          await loadBatchDetail(key, 0, pane);
        }
      });
    });
    if (goVerify) {
      goVerify.replaceWith(goVerify.cloneNode(true));
      $("batches-go-verify").addEventListener("click", () => switchView("verify"));
    }
  } catch (e) {
    renderError(body.parentElement, "批次数据加载失败", loadBatchesPage);
  }
}

async function initVerify() {
  $("cl-measures").innerHTML = skeletonList(3);
  try {
    const rb = await fetch("/api/closed-loop/batches");
    const d = await rb.json();
    clBatchItems = d.items || [];
    $("cl-batch").innerHTML = clBatchItems
      .map(
        (b) =>
          `<option value="${b.key}" data-range="${escapeHtml(b.date_range || "")}" data-size="${b.size ?? ""}">${escapeHtml(b.label)}</option>`
      )
      .join("");
    $("cl-sample").value = d.default_sample || 200;
    updateClScopeMeta();
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
  if (DEMO_MODE && demoSessionWoId && clOrders.some((o) => o.id === demoSessionWoId)) {
    clSelTouched = true;
    clSel = new Set([demoSessionWoId]);
  }
  renderVerifyOrders();
  if (!clResultDirty) {
    if (clSel.size) scheduleVerifyPreview();
    else showClEmptyState();
  }
  renderDemoChrome();
}

function showClEmptyState() {
  $("cl-result").innerHTML = `<div class="panel cl-result-empty cl-result-placeholder"><div class="empty-state">
    <span class="empty-title">选择批次与纳入工单</span>
    <span class="empty-sub">勾选后将自动预览；确认后点左侧「开始复检推演」保存</span>
  </div></div>`;
}

function selectedOrders() {
  return clOrders.filter((o) => clSel.has(o.id));
}

function setClSelAll(on) {
  clSelTouched = true;
  clSel = on ? new Set(clOrders.map((o) => o.id)) : new Set();
  renderVerifyOrders();
  scheduleVerifyPreview();
}

/** 勾选工单变化后自动预览推演（不落库，结果区实时更新） */
function scheduleVerifyPreview() {
  if (activeView !== "verify") return;
  clearTimeout(verifyPreviewTimer);
  verifyPreviewTimer = setTimeout(() => {
    const chosen = selectedOrders();
    if (!chosen.length) {
      clResultDirty = false;
      showClEmptyState();
      renderFlowActionDock();
      return;
    }
    runVerify({ save: false, preview: true });
  }, 320);
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

/** 闭环复检请求体：勾选工单则按工单根因规则的预期降幅累乘推演 */
function buildVerifyPayload(chosen) {
  const list = chosen || selectedOrders();
  const executed = [];
  const seen = new Set();
  list.forEach((o) => {
    const k = DEFECT_KEY_BY_CN[o.defect_cn];
    if (k && !seen.has(k)) {
      seen.add(k);
      executed.push(k);
    }
  });
  const batchEl = $("cl-batch");
  return {
    batch: batchEl ? batchEl.value : "ALL",
    sample_size: Number(($("cl-sample") && $("cl-sample").value) || 200),
    executed,
    order_ids: list.map((o) => o.id),
    use_work_orders: list.length > 0,
  };
}

async function runVerify(opts = {}) {
  const save = !!opts.save;
  const preview = !!opts.preview;
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
  const body = buildVerifyPayload(chosen);
  if (save) body.save = true;
  if (renderResult && !preview) {
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
      if (save || preview) clResultDirty = true;
      if (d.measures) {
        clDropMap = {};
        d.measures.forEach((m) => { clDropMap[m.defect] = m.expected_drop || 0; });
      }
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
    renderDemoChrome();
    renderFlowActionDock();
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
      const dropChip = drop != null ? `<span class="cl-group-drop">↓${fmt2(drop)}%</span>` : "";
      return `<div class="cl-group">
        <div class="cl-group-head">
          <span class="cl-group-name">${escapeHtml(cn)}</span>
          <span class="cl-group-count">${list.length} 单</span>
          ${dropChip}
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
      scheduleVerifyPreview();
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
  const measure = o.measure || "";
  const tip = measure ? `${root} · ${measure}` : root;
  return `<label class="cl-order${on ? "" : " off"}" title="${escapeHtml(tip)}">
    <input type="checkbox" data-order="${o.id}" ${on ? "checked" : ""}>
    <span class="cl-order-body">
      <span class="cl-order-meta">
        <span class="cl-order-no">${escapeHtml(o.ticket_no || "—")}</span>
        ${statusTag(o.status)}
        <span class="cl-order-owner">${escapeHtml(o.owner || "待指派")}</span>
      </span>
      <span class="cl-order-cause">${escapeHtml(root)}</span>
      ${measure ? `<span class="cl-order-measure">${escapeHtml(measure)}</span>` : ""}
    </span>
  </label>`;
}

function updateClSelSummary() {
  const bar = $("cl-selbar");
  const sum = $("cl-sel-summary");
  if (!bar || !sum) return;
  if (!clOrders.length) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  const sel = selectedOrders();
  const cns = [...new Set(sel.map((o) => o.defect_cn).filter(Boolean))];
  sum.innerHTML = `<span class="cl-sel-label">已选工单</span><b>${sel.length}</b><span class="cl-sel-of">/ ${clOrders.length}</span>`;
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
  el.innerHTML = `<span class="cl-missing-title">本批次无工单</span><span class="cl-missing-text">${miss.join("、")}</span>`;
}

function renderVerifyPrereq() {
  const box = $("cl-prereq");
  const text = $("cl-prereq-text");
  const go = $("cl-prereq-go");
  if (!box || !text) return;
  if (clOrders.length) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  text.textContent = "无可纳入工单";
  if (go) go.classList.remove("hidden");
}

function syncClRunBtn() {
  const btn = $("cl-run-btn");
  if (!btn) return;
  const n = clSel.size;
  const lock = n === 0;
  btn.disabled = lock || TASKS.verify.running;
  btn.dataset.lockWhenIdle = lock ? "1" : "0";
  btn.textContent = n ? `开始复检推演（${n} 张工单）` : "开始复检推演";
  renderFlowActionDock();
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

  $("cl-result").innerHTML = `
    <div class="cl-band" id="cl-band">
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

    <section class="panel stack-gap cl-charts-panel">
      <div class="sec-head sec-head-tight">
        <h2 class="panel-title">趋势对比</h2>
        <span class="sec-note">${escapeHtml(d.batch_label)} · ${escapeHtml(d.date_range || "")}</span>
      </div>
      <div class="cl-charts">
        <div class="cl-chart" id="cl-bar"></div>
        <div class="cl-chart" id="cl-trend"></div>
      </div>
    </section>

    <section class="panel stack-gap">
      <div class="sec-head sec-head-tight"><h2 class="panel-title">分项明细</h2></div>
      <div class="table-wrap">
        <table class="data-table cl-table cl-table-compact">
          <thead>
            <tr>
              <th>缺陷</th><th>整改前</th><th>整改后</th>
              <th>预期降幅</th><th>归因率</th><th>有效降幅</th><th>执行</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;

  renderVerifyBand(d);
  renderVerifyCharts(d);
  renderFlowActionDock();
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
function shortRunBatch(label) {
  if (!label) return "—";
  if (label.includes("整体")) return "整体";
  const m = label.match(/B\d+/);
  return m ? m[0] : label.split("·")[0].trim();
}

function shortRunTime(ts) {
  return shortHistoryTime(ts);
}

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
    const avgDrop = items.length
      ? items.reduce((s, r) => s + (Number(r.drop_pct) || 0), 0) / items.length
      : 0;
    const effective = items.filter((r) => String(r.verdict || "").includes("有效")).length;
    renderHistoryKpi("runs-kpi", [
      { k: "复检次数", v: items.length },
      { k: "平均降幅", v: items.length ? `${fmt2(avgDrop)}%` : "—" },
      { k: "闭环有效", v: effective },
    ]);
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty-cell">暂无复检记录，到闭环验证页跑一次推演后会留痕在这里</td></tr>`;
      return;
    }
    body.innerHTML = items
      .map((r) => {
        const orders = r.orders || [];
        const batchFull = r.batch_label || "—";
        return `<tr class="runs-row">
          <td>${shortRunTime(r.created_at)}</td>
          <td><span class="runs-batch-short" title="${escapeHtml(batchFull)}">${escapeHtml(shortRunBatch(batchFull))}</span></td>
          <td>${runDefectBrief(r, orders)}</td>
          <td class="num">${r.sample_size || "—"}</td>
          <td class="num">${r.before_rate != null ? fmt2(r.before_rate) + "%" : "—"}</td>
          <td class="num">${r.after_rate != null ? fmt2(r.after_rate) + "%" : "—"}</td>
          <td class="num">${r.drop_pct != null ? fmt2(r.drop_pct) + "%" : "—"}</td>
          <td><span class="runs-verdict ${verdictCls(r.drop_pct || 0)}">${escapeHtml(r.verdict || "—")}</span></td>
          <td><button class="btn btn-ghost btn-sm runs-toggle" type="button" data-run-toggle="${r.id}" aria-expanded="false">明细</button></td>
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
        b.textContent = closed ? "明细" : "收起";
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
    const tip = cns.join("、") || "—";
    return `<span class="runs-orders" title="${escapeHtml(tip)}">${escapeHtml(tip)}</span>
      <span class="runs-orders-n">${orders.length} 单</span>`;
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
let alertLogLive = null;
let alertLogMetaLoaded = false;

function invalidateAlertLog() {
  alertLogRecords = null;
  alertLogLive = null;
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
    const [recRes, alertRes] = await Promise.all([
      fetch("/api/records?limit=1000"),
      fetch("/api/alerts"),
    ]);
    const d = await recRes.json();
    alertLogRecords = d.items || [];
    try {
      alertLogLive = await alertRes.json();
    } catch (e) {
      alertLogLive = null;
    }
    renderAlertLog();
  } catch (e) {
    renderError(list, "检测记录加载失败", loadAlertLog);
  }
}

/** 报警历史按自然日聚合；顶栏 /api/alerts 为近 24 小时滚动。当日「严重」→ 一条汇总；同类型当日 > 阈值 → 聚集告警 */
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
        title: `检出「严重」等级缺陷（当日 ${severe.length} 件）`,
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

  const scopeHint = $("alertlog-scope-hint");
  if (scopeHint) {
    const wh = alertLogLive?.window_hours ?? 24;
    const liveSevere = alertLogLive?.severe_count;
    const livePart =
      liveSevere != null
        ? `顶栏近 ${wh} 小时：严重 ${liveSevere} 件、检测 ${alertLogLive.window_total ?? "—"} 次。`
        : `顶栏为近 ${wh} 小时滚动统计。`;
    scopeHint.textContent = `${livePart}下列按自然日汇总，「当日」件数不含前一日晚间仍落在 24 小时内的记录。`;
  }

  renderHistoryKpi("alertlog-stats", [
    {
      k: "告警条目",
      v: alertCount,
      title: "筛选范围内告警消息条数（严重汇总与聚集告警各算一条）",
    },
    {
      k: "严重汇总",
      v: severeCount,
      danger: severeCount > 0,
      title: "按自然日生成的「严重」类告警条数（每天至多一条，非严重检测总件数）",
    },
    { k: "涉及类型", v: defectSet.size, title: "告警涉及的缺陷类型种数" },
  ]);
  if (countEl) countEl.textContent = alertCount ? `共 ${alertCount} 条告警` : "—";

  if (!alertCount) {
    list.innerHTML = `<div class="empty-state"><span class="empty-title">当前筛选下没有告警</span></div>`;
    return;
  }

  list.innerHTML = days
    .map(
      (d) => `<div class="alertlog-day">
        <div class="alertlog-day-head">
          <span class="alertlog-day-date">${d.date}</span>
          <span class="alertlog-day-count">检测 ${d.total} 次 · 告警条目 ${d.items.length}</span>
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
      return `<div class="dash-card">
        <div class="dash-card-top">
          <span class="dash-card-icon"><svg class="icon" viewBox="0 0 24 24">${icon}</svg></span>
          <div class="dash-card-label">${c.label}</div>
        </div>
        <div class="dash-card-value">${numTxt}${unit ? `<span class="dash-card-unit">${unit}</span>` : ""}</div>
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
    if (d.trend_title && tTitle) {
      const m = String(d.trend_title).match(/^(.*?)[（(](.*?)[）)]\s*$/);
      tTitle.textContent = m ? m[1].trim() : d.trend_title;
    }
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
            <span class="top-hits">${x.hits} · ${x.share}%</span>
          </div>
          <div class="top-bar-track"><div class="top-bar-fill" style="width:${(x.hits / max) * 100}%"></div></div>
          <div class="top-meta">
            <span class="tag tag-dim">${x.defect_cn}</span>
            <span class="tag tag-dim">${x.dimension_cn}</span>
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
    if (activeView === "alertlog") alertLogLive = alertData;
    renderAlerts();
    if (activeView === "alertlog" && alertLogRecords) renderAlertLog();
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
  badge.textContent = String(d.severe_count ?? d.items.length);
  badge.title = `近 ${d.window_hours || 24} 小时内严重等级检测 ${d.severe_count ?? 0} 件`;
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
   16. 新手导览（保留逻辑，入口已移除）
   ============================================================================= */

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
  const scenarioBtn = $("scenario-btn");
  if (scenarioBtn) scenarioBtn.addEventListener("click", openScenarioPicker);
  $("run-attr-btn").addEventListener("click", () => runAttribution(false));
  const clRunsLink = $("cl-runs-link");
  if (clRunsLink) {
    clRunsLink.addEventListener("click", () => {
      switchView("runs");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  const defectSel = $("defect-select");
  if (defectSel) defectSel.addEventListener("change", () => syncDefectSource());
  setContextOpen(true);
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

initDemoChrome();
renderNav();
bindEvents();
bindAlertBell();
bindDemo();
bindHome();
startClock();
loadFlowProgress();
loadMetrics();
applyChrome();
loadManifest();
loadSchema();
loadAlerts();
if (FULL_MODE) ensureWoLoaded();

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
