const NAV_ITEMS = [
  { key: "home", label: "首页", icon: "home" },
  { key: "workbench", label: "检测工作台" },
  { key: "attribution", label: "归因诊断" },
  { key: "knowledge", label: "知识库" },
  { key: "ticket", label: "整改工单" },
  { key: "verify", label: "闭环验证" },
  { key: "dashboard", label: "分析看板" },
];

const NAV_ICONS = {
  home: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-4.5h4V19"/></svg>',
};

let sampleManifest = null;
let currentSample = null;
let activeView = "home";

const $ = (id) => document.getElementById(id);

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

const ICONS = {
  info: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"/></svg>',
  bell: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 5.6 2 6.5H4c0-.9 2-1.5 2-6.5"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>',
  trash: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4.8h6V7"/><path d="M6.5 7l1 12.2h9l1-12.2"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 12.5l5 5 9-11"/></svg>',
};

function fmt2(v) {
  return Number(v).toFixed(2);
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

/* ---------- 导航 ---------- */
const NAV_GROUPS = [
  { label: "流程", keys: ["workbench", "attribution", "ticket", "verify"] },
  { label: "工具", keys: ["knowledge", "dashboard"] },
];

/* 流程步骤：样件 / 结果 / 归因 / 工单 / 复检（共 5 步） */
const FLOW_PROGRESS_KEYS = ["sample", "detect", "attribute", "ticket", "verify"];
const PAGE_FLOW = {
  workbench: ["sample", "detect"],
  attribution: ["attribute"],
  ticket: ["ticket"],
  verify: ["verify"],
};

function navItemHtml(k) {
  const item = NAV_ITEMS.find((n) => n.key === k);
  if (!item) return "";
  const icon = item.icon ? `<span class="nav-item-icon">${NAV_ICONS[item.icon] || ""}</span>` : "";
  const dot = PAGE_FLOW[k] ? `<span class="nav-dot" data-dot="${k}"></span>` : "";
  return `<div class="nav-item" role="button" tabindex="0" data-key="${item.key}">${icon}${item.label}${dot}</div>`;
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
  el.innerHTML = `${home}${groups}<div class="sidenav-progress" id="nav-progress"></div>`;
  el.querySelectorAll(".nav-item").forEach((n) => {
    const go = () => switchView(n.dataset.key);
    n.addEventListener("click", go);
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
  updateNavProgress();
}

function updateNavProgress() {
  const el = $("sidenav");
  if (!el) return;
  el.querySelectorAll("[data-dot]").forEach((d) => {
    const keys = PAGE_FLOW[d.dataset.dot];
    let state = "todo";
    if (d.dataset.dot === activeView) state = "current";
    else if (keys && keys.every((k) => flowDone[k])) state = "done";
    d.className = "nav-dot " + state;
  });
  const prog = $("nav-progress");
  if (prog) {
    const n = FLOW_PROGRESS_KEYS.filter((k) => flowDone[k]).length;
    prog.textContent = `进度 ${n} / ${FLOW_PROGRESS_KEYS.length}`;
  }
}

const VIEW_IDS = [
  "view-home",
  "view-workbench",
  "view-attribution",
  "view-knowledge",
  "view-ticket",
  "view-verify",
  "view-dashboard",
];

function showView(id) {
  VIEW_IDS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
}

/* ---------- 进度状态 ---------- */
const FLOW_STEPS = [
  { key: "sample", label: "上传样件", view: "workbench" },
  { key: "detect", label: "缺陷识别", view: "workbench" },
  { key: "attribute", label: "归因诊断", view: "attribution" },
  { key: "ticket", label: "生成工单", view: "ticket" },
  { key: "verify", label: "闭环验证", view: "verify" },
  { key: "dashboard", label: "查看看板", view: "dashboard" },
];
const FLOW_STORAGE_KEY = "flow_v2";
let flowDone = { sample: false, detect: false, attribute: false, ticket: false, verify: false, dashboard: false };

function loadFlowProgress() {
  flowDone = { sample: false, detect: false, attribute: false, ticket: false, verify: false, dashboard: false };
  try {
    const raw = localStorage.getItem(FLOW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      FLOW_STEPS.forEach((s) => {
        if (parsed && parsed[s.key] === true) flowDone[s.key] = true;
      });
    }
  } catch (e) {}
}

function saveFlowProgress() {
  try {
    localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flowDone));
  } catch (e) {}
}

function setFlow(key, done) {
  if (flowDone[key] === done) {
    updateNavProgress();
    return;
  }
  flowDone[key] = done;
  saveFlowProgress();
  updateNavProgress();
}

/* ---------- 使用说明抽屉 ---------- */
const HELP_SEEN_KEY = "helpDrawerSeen";

function openDrawer() {
  $("help-drawer").classList.remove("hidden");
  $("drawer-mask").classList.remove("hidden");
}

function closeDrawer() {
  $("help-drawer").classList.add("hidden");
  $("drawer-mask").classList.add("hidden");
}

function bindDrawer() {
  $("help-btn").addEventListener("click", () => {
    hideHelpBubble();
    openDrawer();
  });
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-mask").addEventListener("click", closeDrawer);
  $("help-bubble").addEventListener("click", () => {
    hideHelpBubble();
    openDrawer();
  });
  let seen = false;
  try {
    seen = localStorage.getItem(HELP_SEEN_KEY) === "1";
  } catch (e) {}
  if (!seen) {
    $("help-bubble").classList.remove("hidden");
  }
}

function hideHelpBubble() {
  const b = $("help-bubble");
  if (b) b.classList.add("hidden");
  try {
    localStorage.setItem(HELP_SEEN_KEY, "1");
  } catch (e) {}
}

/* ---------- 演示舞台模式 ---------- */
const DEMO_STEPS = [
  {
    view: "workbench",
    target: "#samples",
    title: "检测工作台",
    text: "从样件库或本地上传图片，系统调用实时 ONNX 模型识别缺陷类型、置信度与严重等级。",
    next: "去归因诊断",
    action: async () => {
      await loadFirstSample();
    },
  },
  {
    view: "attribution",
    target: "#attr-body",
    title: "归因诊断",
    text: "结合缺陷类型与工艺参数，匹配 30 条冶金规则定位主因，输出证据链与可执行改进建议。",
    next: "生成整改工单",
    action: async () => {
      if (currentSample) await runAttribution();
    },
  },
  {
    view: "ticket",
    target: "#wo-list",
    title: "整改工单",
    text: "按主因生成整改工单并指定责任人，状态沿 待处理→处理中→已完成→已关闭 逐步流转。",
    next: "去闭环验证",
    action: async () => {
      await loadTickets();
    },
  },
  {
    view: "verify",
    target: "#cl-measures",
    title: "闭环验证",
    text: "勾选已完成整改的措施，按规则库推演缺陷降幅，并结合真实工单状态判定闭环效果。",
    next: "查看分析看板",
    action: async () => {
      await loadVerify();
      await runVerify(false, false, true, true);
    },
  },
  {
    view: "dashboard",
    target: "#dash-cards",
    title: "分析看板",
    text: "汇总累计检测、缺陷分布、根因 Top5 与月度趋势，支撑产线质量决策。",
    next: "完成",
    action: async () => {
      await loadDashboard();
    },
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
  hideHelpBubble();
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
    const t = document.querySelector(step.target);
    if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth", block: "center" });
    demoReposition();
    if (step.action) await step.action();
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


/* ---------- 页内子标签 ---------- */
function bindSubTabs(root) {
  if (!root) return;
  const scope = root.parentElement;
  root.querySelectorAll(".subtab").forEach((t) => {
    t.addEventListener("click", () => {
      root.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === t));
      scope.querySelectorAll(".subpane").forEach((p) => {
        p.classList.toggle("hidden", p.dataset.pane !== t.dataset.tab);
      });
    });
  });
}

/* ---------- 视图切换 ---------- */
const BASE_TITLE = "钢材表面质量缺陷智能归因与闭环处置平台";
const VIEW_META = {
  home: { label: "首页" },
  workbench: { label: "检测工作台" },
  attribution: { label: "归因诊断" },
  knowledge: { label: "知识库" },
  ticket: { label: "整改工单" },
  verify: { label: "闭环验证" },
  dashboard: { label: "分析看板" },
};

function setDocumentTitle(key) {
  document.title = key === "home" ? BASE_TITLE : `${VIEW_META[key].label} · ${BASE_TITLE}`;
}

function pushViewHistory(key) {
  const hash = "#" + key;
  if (location.hash === hash) return;
  try {
    history.pushState({ view: key }, "", hash);
  } catch (e) {}
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
  if (key === "home") {
    showView("view-home");
    renderHome();
    return;
  }
  if (key === "workbench") {
    showView("view-workbench");
    return;
  }
  if (key === "attribution") {
    showView("view-attribution");
    ensureAttributionView();
    return;
  }
  if (key === "knowledge") {
    showView("view-knowledge");
    loadKb();
    return;
  }
  if (key === "ticket") {
    showView("view-ticket");
    loadTickets();
    return;
  }
  if (key === "verify") {
    showView("view-verify");
    loadVerify();
    return;
  }
  if (key === "dashboard") {
    showView("view-dashboard");
    loadDashboard();
    return;
  }
}

/* ---------- 随视图切换的全局区块 ---------- */
function applyChrome() {
  renderMetrics();
  renderSampleBar();
  updateAlertVisibility();
  updateAttrGuide();
  updateNavProgress();
}

function updateAttrGuide() {
  const g = $("attr-guide");
  const panel = $("context-panel");
  const btn = $("run-attr-btn");
  const locked = !currentSample;
  if (g) g.classList.toggle("hidden", !(activeView === "attribution" && locked));
  if (panel) panel.classList.toggle("locked", locked);
  if (btn) btn.disabled = locked;
}

/* ---------- 指标卡 / 紧凑胶囊条 ---------- */
let metricsData = null;

async function loadMetrics() {
  const box = $("metrics");
  try {
    const res = await fetch("/api/metrics");
    metricsData = await res.json();
    renderMetrics();
    renderHomeMetrics();
  } catch (e) {
    if (activeView === "home") {
      renderError("home-metrics-body", "指标加载失败", loadMetrics);
    } else {
      renderError(box, "指标加载失败", loadMetrics);
    }
    renderHomeMetrics();
  }
}

function renderMetrics() {
  const box = $("metrics");
  if (!box) return;
  if (activeView === "home") {
    box.className = "metrics hidden";
    box.innerHTML = "";
    return;
  }
  if (!metricsData) {
    box.className = activeView === "dashboard" ? "metrics" : "metrics pills";
    box.innerHTML = `<div class="empty small">指标加载中…</div>`;
    return;
  }
  if (activeView === "dashboard") {
    box.className = "metrics";
    box.innerHTML = metricsData.items
      .map((m) => {
        const { num, unit } = splitValue(m.value);
        const numTxt = unit === "%" ? fmt2(num) : num;
        return `<div class="metric">
          <div class="metric-label">${m.label}</div>
          <div class="metric-value">${numTxt}${unit ? `<span class="metric-unit">${unit}</span>` : ""}</div>
          <div class="metric-note">${m.note}</div>
        </div>`;
      })
      .join("");
  } else {
    box.className = "metrics pills";
    box.innerHTML = metricsData.items
      .map((m) => {
        const { num, unit } = splitValue(m.value);
        const numTxt = unit === "%" ? fmt2(num) : num;
        return `<button class="metric-pill" data-jump="dashboard">${m.label} <b>${numTxt}${unit || ""}</b></button>`;
      })
      .join("");
    box.querySelectorAll("[data-jump]").forEach((b) =>
      b.addEventListener("click", () => {
        switchView("dashboard");
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
    );
  }
}

/* ---------- 首页 ---------- */
const HOME_FLOW = [
  { no: "①", title: "检测", desc: "上传图片识别六类缺陷", view: "workbench" },
  { no: "②", title: "归因", desc: "结合工艺参数定位根因", view: "attribution" },
  { no: "③", title: "工单", desc: "生成整改工单并推进状态", view: "ticket" },
  { no: "④", title: "闭环", desc: "复检推演验证降幅", view: "verify" },
  { no: "⑤", title: "看板", desc: "查看全局指标与趋势", view: "dashboard" },
];

function renderHome() {
  renderHomeMetrics();
  renderHomeFlow();
  renderHomeAlerts();
}

function renderHomeMetrics() {
  const el = $("home-metrics-body");
  if (!el) return;
  if (!metricsData) return;
  el.innerHTML = metricsData.items
    .map((m) => {
      const { num, unit } = splitValue(m.value);
      const numTxt = unit === "%" ? fmt2(num) : num;
      return `<div class="home-metric">
        <div class="home-metric-value">${numTxt}${unit ? `<span class="home-metric-unit">${unit}</span>` : ""}</div>
        <div class="home-metric-label">${m.label}</div>
      </div>`;
    })
    .join("");
}

function renderHomeFlow() {
  const el = $("home-flow");
  if (!el || el.dataset.bound === "1") return;
  el.innerHTML = HOME_FLOW.map(
    (s) => `<li class="home-flow-item" role="button" tabindex="0" data-view="${s.view}">
      <span class="home-flow-no">${s.no}</span>
      <span class="home-flow-body">
        <span class="home-flow-title">${s.title}</span>
        <span class="home-flow-desc">${s.desc}</span>
      </span>
    </li>`
  ).join("");
  el.dataset.bound = "1";
  const go = (li) => {
    switchView(li.dataset.view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  el.querySelectorAll(".home-flow-item").forEach((li) => {
    li.addEventListener("click", () => go(li));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go(li);
      }
    });
  });
}

function renderHomeAlerts() {
  const el = $("home-alerts");
  if (!el) return;
  const d = alertData;
  if (!d || !d.has_alert || !(d.items && d.items.length)) {
    el.innerHTML = `<div class="empty small">暂无告警</div>`;
    return;
  }
  el.innerHTML = d.items
    .slice(0, 3)
    .map(
      (i) => `<div class="home-alert">
        <span class="home-alert-dot"></span>
        <span class="home-alert-title">${i.title}</span>
        <span class="home-alert-detail">${i.detail || ""}</span>
      </div>`
    )
    .join("");
}

let homeSourceBound = false;
function bindHome() {
  const start = $("home-start-btn");
  if (start) {
    start.addEventListener("click", () => {
      switchView("workbench");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  const card = $("home-metrics");
  if (card) {
    const go = () => {
      switchView("dashboard");
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  }
  if (!homeSourceBound) {
    homeSourceBound = true;
    const btn = $("home-source-btn");
    const pop = $("home-source-pop");
    const source = $("source-pop");
    if (btn && pop) {
      pop.innerHTML = source ? source.innerHTML : "";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        pop.classList.toggle("hidden");
      });
      document.addEventListener("click", (e) => {
        if (!pop.classList.contains("hidden") && !pop.contains(e.target) && e.target !== btn) {
          pop.classList.add("hidden");
        }
      });
    }
  }
  renderHome();
}

/* ---------- 示例样件 ---------- */
async function loadManifest() {
  const box = $("samples");
  box.innerHTML = skeletonList(3);
  try {
    const res = await fetch("/api/manifest");
    const data = await res.json();
    sampleManifest = data;
    renderSamples(data.classes);
  } catch (e) {
    renderError(box, "示例样件加载失败", loadManifest);
  }
}

function renderSamples(classes) {
  const box = $("samples");
  if (!classes || !classes.length) {
    box.innerHTML = `<div class="empty small">暂无示例样件</div>`;
    return;
  }
  box.innerHTML = classes
    .map((group) => {
      const img = (group.images && group.images[0]) || null;
      if (!img) return "";
      return `<button class="thumb sample-card" data-file="${img.file}" data-url="${img.url}" title="${group.cn}">
        <img src="${img.url}" alt="${group.cn}" loading="lazy">
        <div class="sample-card-foot">
          <span class="sc-cn">${group.cn}</span>
          <span class="sc-en">${group.key}</span>
        </div>
      </button>`;
    })
    .join("");
  box.querySelectorAll(".thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      markActiveThumb(btn);
      detectSample(btn.dataset.file, btn.dataset.url);
    });
  });
}

function markActiveThumb(btn) {
  $("samples").querySelectorAll(".thumb").forEach((el) => el.classList.remove("active"));
  btn.classList.add("active");
}

function firstSample() {
  if (!sampleManifest) return null;
  for (const group of sampleManifest.classes) {
    if (group.images && group.images.length) return group.images[0];
  }
  return null;
}

/* ---------- 识别结果 ---------- */
function renderLoading() {
  $("result-panel").innerHTML = `<div class="panel-title">识别结果</div>
    <div class="loading"><span class="spinner"></span>正在识别…</div>`;
}

function renderEmpty(message) {
  $("result-panel").innerHTML = `<div class="panel-title">识别结果</div>
    <div class="empty">
      <div class="empty-title">${message.title}</div>
      <div class="empty-sub">${message.sub}</div>
      ${message.retry ? `<button class="btn btn-ghost btn-sm" id="result-retry" style="margin-top:12px">重试</button>` : ""}
    </div>`;
  const r = $("result-retry");
  if (r && message.retry) r.addEventListener("click", message.retry);
}

function renderResult(result, imageUrl, inferMs) {
  if (!result.available) {
    renderEmpty({ title: "无可用识别结果", sub: result.reason || "该图片无离线评测记录" });
    return;
  }
  const weak = result.confidence < 0.7 ? " weak" : "";
  const realtime = result.mode === "realtime";
  const shownImage = realtime && result.annotated_url ? result.annotated_url : imageUrl;
  const boxCount = realtime ? result.detection_count || 0 : 0;
  const capCls = realtime ? "realtime" : "";
  const imgCap = shownImage
    ? `<div class="result-cap ${capCls}">${realtime ? "实时推理" : "离线评测"}</div>`
    : "";
  const paramsBlock = realtime
    ? `<div class="result-params">
        <div class="param"><span class="k">推理耗时</span><span class="v">${inferMs != null ? inferMs + " ms" : "—"}</span></div>
        <div class="param"><span class="k">conf 阈值</span><span class="v">0.25</span></div>
        <div class="param"><span class="k">NMS IoU</span><span class="v">0.70</span></div>
        <div class="param"><span class="k">NMS 保留框</span><span class="v">${boxCount}</span></div>
      </div>`
    : "";
  const confInfo =
    result.defect === "crazing"
      ? `<span class="info-dot" title="识别难点：龟裂 AP 0.383，为六类中识别难度最高">${ICONS.info}</span>`
      : "";

  $("result-panel").innerHTML = `
    <div class="panel-title">识别结果</div>
    <div class="result-head">
      ${shownImage ? `<figure class="result-figure"><img class="result-preview" src="${shownImage}" alt="${result.file}">${imgCap}</figure>` : ""}
      <div class="result-main">
        <div class="result-lead">
          <div class="result-lead-block">
            <div class="result-lead-label">缺陷类型</div>
            <div class="result-defect-big">${result.defect_cn}<span class="en">${result.defect}</span></div>
          </div>
          <div class="result-lead-block">
            <div class="result-lead-label">置信度</div>
            <div class="result-conf-big${weak}">${result.confidence_pct.toFixed(2)}<span class="unit">%</span>${confInfo}</div>
          </div>
          <div class="result-lead-block">
            <div class="result-lead-label">严重等级</div>
            <div>${severityTag(result.severity)}</div>
          </div>
        </div>
        <div class="result-row"><span class="k">识别通道</span>${channelTag(result.mode_cn)}</div>
      </div>
      ${paramsBlock}
    </div>
    <div class="next-step"><button class="btn" id="go-attr-btn">去归因诊断 →</button></div>`;
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

/* ---------- 当前样本上下文条 ---------- */
function updateSampleBar(result) {
  if (!result || !result.available) return;
  currentSample = {
    image: result.file,
    defect_cn: result.defect_cn,
    defect: result.defect,
    confidence_pct: result.confidence_pct,
    severity: result.severity,
    channel: result.mode_cn,
  };
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

async function detectSample(file, imageUrl) {
  renderLoading();
  try {
    const t0 = performance.now();
    const res = await fetch("/api/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
    });
    const data = await res.json();
    const ms = Math.round(performance.now() - t0);
    renderResult(data.result, data.result.image_url || imageUrl, ms);
    if (data.result && data.result.available) {
      setFlow("sample", true);
      setFlow("detect", true);
    }
    if (data.record) prependRecord(data.record);
    loadAlerts();
  } catch (e) {
    renderEmpty({ title: "识别失败", sub: "请稍后重试", retry: () => detectSample(file, imageUrl) });
  }
}

async function detectUpload(file) {
  renderLoading();
  const form = new FormData();
  form.append("file", file);
  try {
    const t0 = performance.now();
    const res = await fetch("/api/detect/upload", { method: "POST", body: form });
    const data = await res.json();
    const ms = Math.round(performance.now() - t0);
    renderResult(data.result, data.result.image_url, ms);
    if (data.result && data.result.available) {
      setFlow("sample", true);
      setFlow("detect", true);
    }
    if (data.record) prependRecord(data.record);
    loadAlerts();
  } catch (e) {
    renderEmpty({ title: "识别失败", sub: "请稍后重试", retry: () => detectUpload(file) });
  }
}

/* ---------- 检测记录表 ---------- */
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
  body.innerHTML = recordsAll
    .slice(start, start + RECORDS_PAGE_SIZE)
    .map(recordRow)
    .join("");
  $("records-pager").innerHTML = `
    <button class="btn btn-ghost btn-sm" id="records-prev"${recordsPage <= 1 ? " disabled" : ""}>上一页</button>
    <span class="pager-info">第 ${recordsPage} / ${totalPages} 页</span>
    <button class="btn btn-ghost btn-sm" id="records-next"${recordsPage >= totalPages ? " disabled" : ""}>下一页</button>`;
  $("records-prev").addEventListener("click", () => {
    recordsPage -= 1;
    renderRecordsPage();
  });
  $("records-next").addEventListener("click", () => {
    recordsPage += 1;
    renderRecordsPage();
  });
}

/* ---------- 归因诊断 ---------- */
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
  sel.innerHTML = attrSchema.defect_types
    .map((d) => `<option value="${d.key}">${d.cn}</option>`)
    .join("");
}

function renderScenarioSelect() {
  const sel = $("scenario-select");
  sel.innerHTML =
    `<option value="">选择样例…</option>` +
    attrSchema.scenarios
      .map(
        (s, i) =>
          `<option value="${i}">${s.defect_cn} · ${s.record_id}（${s.steel_grade}）</option>`
      )
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
              .map(
                (o) =>
                  `<option value="${o.value}"${String(o.value) === String(val) ? " selected" : ""}>${o.label}</option>`
              )
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
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
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

async function runAttribution() {
  const defect = $("defect-select").value;
  const context = collectContext();
  const btn = $("run-attr-btn");
  setBtnLoading(btn, true);
  try {
    const res = await fetch("/api/attribute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defect_type: defect, context }),
    });
    const data = await res.json();
    if (data.error) {
      lastAttrResult = { error: data.error };
      lastAttrIsSample = false;
      showToast("归因失败：" + data.error, false);
    } else {
      lastAttrResult = data;
      lastAttrIsSample = false;
      renderAttribution(data, false);
      setFlow("attribute", true);
      showToast("归因完成");
    }
    switchView("attribution");
  } catch (e) {
    $("attr-body").innerHTML = `<div class="panel placeholder-panel"><div class="empty">
      <div class="empty-title">归因失败</div><div class="empty-sub">请稍后重试</div>
      <button class="btn btn-ghost btn-sm" id="attr-retry" style="margin-top:12px">重试</button></div></div>`;
    const r = $("attr-retry");
    if (r) r.addEventListener("click", runAttribution);
    switchView("attribution");
    showToast("归因失败，请稍后重试", false);
  } finally {
    setBtnLoading(btn, false);
  }
}

function normalizeDemo(demo) {
  const contributions = (demo.contributions || []).map((c) => ({
    dimension: c.dimension,
    dimension_cn: c.dimension_cn,
    score: c.score,
    insufficient: false,
    evidence: (c.evidence || []).map((e) => ({
      ...e,
      field_label: FIELD_LABELS[e.field] || e.field,
    })),
  }));
  return {
    defect_type: demo.defect_type,
    defect_cn: demo.defect_cn,
    top_root_cause: demo.top_root_cause,
    top_dimension_cn: demo.top_dimension_cn,
    confidence: demo.confidence,
    solution: demo.solution,
    expected_drop_pct: demo.expected_drop_pct,
    solution_executable: true,
    contributions,
    candidates: (demo.candidates || []).filter(
      (c) => c.root_cause !== demo.top_root_cause
    ),
    missing_fields: [],
    insufficient_dimensions: [],
  };
}

function renderAttribution(result, isSample) {
  const body = $("attr-body");
  if (!result.top_root_cause) {
    updateGroupBadges({ contributions: [] });
    body.innerHTML = `<div class="panel placeholder-panel"><div class="empty">
      <div class="empty-title">未得到归因结论</div>
      <div class="empty-sub">未命中候选根因，请补充数据</div></div></div>`;
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

  const evidenceAll = result.contributions.flatMap((c) =>
    c.evidence.map((e) => ({ dim: c.dimension_cn, ...e }))
  );
  const evidenceRows = evidenceAll
    .map((e) => {
      const level = evidenceLevel(e);
      const tag =
        level === "severe"
          ? '<span class="tag tag-severe">超标</span>'
          : level === "warn"
          ? '<span class="tag tag-warn">临界</span>'
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
    : `<div class="empty small">除主因外无其他候选根因</div>`;

  const missingHtml =
    result.missing_fields.length || result.insufficient_dimensions.length
      ? `<div class="panel" style="margin-top:12px">
          <div class="missing-box">
            <div class="m-title">数据不足提示</div>
            ${
              result.insufficient_dimensions.length
                ? `<div style="font-size:12px;color:var(--muted)">以下维度因字段缺失未参与计算：${result.insufficient_dimensions.join("、")}</div>`
                : ""
            }
            <ul>${result.missing_fields
              .map((m) => `<li>${m.label}（${m.dimension_cn}）</li>`)
              .join("")}</ul>
          </div>
        </div>`
      : "";

  body.innerHTML = `
    <div class="subtabs" id="attr-tabs">
      <button class="subtab active" data-tab="evidence">主因与证据</button>
      <button class="subtab" data-tab="advice">改进建议</button>
      <button class="subtab" data-tab="qa">智能问答</button>
    </div>

    <div class="subpane" data-pane="evidence">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">归因诊断 · ${result.defect_cn}${isSample ? "（离线样例）" : ""}</div>
          <div class="panel-sub">数据口径见页脚「数据来源」</div>
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
        <div class="attr-source">整改建议：${result.solution || "—"}</div>
      </div>

      <div class="attr-cols">
        <div class="panel">
          <div class="panel-title">四维贡献度</div>
          <div class="bars">${bars}</div>
        </div>
        <div class="panel">
          <details class="collapsible">
            <summary class="collapsible-summary">
              <span class="panel-title">候选根因（${result.candidates.length}）</span>
              <span class="collapse-caret">▾</span>
            </summary>
            <div class="collapsible-body">${candidates}</div>
          </details>
        </div>
      </div>

      <div class="panel" style="margin-top:12px">
        <div class="panel-head">
          <div class="panel-title">证据明细</div>
          <div class="panel-sub">默认仅显示超标与临界项</div>
        </div>
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
      ${missingHtml}
    </div>

    <div class="subpane hidden" data-pane="advice">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">改进建议</div>
          <div class="panel-sub">匹配自知识库解决策略，原文输出</div>
        </div>
        <div id="suggestion-list"></div>
        <button class="btn btn-primary" id="create-wo-btn" style="margin-top:10px">生成整改工单</button>
        <div class="qa-input-row" id="wo-create-row" style="display:none;margin-top:10px">
          <input id="wo-owner" placeholder="责任人">
          <input id="wo-record" placeholder="关联检测记录（如 QC20261121）">
          <button class="btn" id="wo-confirm">确认生成</button>
        </div>
      </div>

      <div class="panel" style="margin-top:12px">
        <div class="panel-head">
          <div class="panel-title">建议可执行率</div>
          <div class="panel-sub">判定对象：知识库全部解决策略</div>
        </div>
        <div id="exec-stats"><div class="loading"><span class="spinner"></span>统计中…</div></div>
      </div>
    </div>

    <div class="subpane hidden" data-pane="qa">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title">智能问答</div>
          <div class="panel-sub">已注入本次归因证据链</div>
        </div>
        <div id="qa-body"></div>
      </div>
    </div>`;

  bindSubTabs($("attr-tabs"));
  renderSuggestions(result);
  bindWorkOrderCreate(result);
  loadSuggestionStats();
  renderQa(result);
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

function ensureAttributionView() {
  if (lastAttrResult) {
    if (lastAttrResult.error) {
      $("attr-body").innerHTML = `<div class="panel placeholder-panel"><div class="empty">
        <div class="empty-title">归因失败</div><div class="empty-sub">${lastAttrResult.error}</div>
        <button class="btn btn-ghost btn-sm" id="attr-retry" style="margin-top:12px">重试</button></div></div>`;
      const r = $("attr-retry");
      if (r) r.addEventListener("click", runAttribution);
      return;
    }
    renderAttribution(lastAttrResult, lastAttrIsSample);
    return;
  }
  if (attrSchema && attrSchema.demos && attrSchema.demos.length) {
    renderAttribution(normalizeDemo(attrSchema.demos[0]), true);
  } else {
    $("attr-body").innerHTML = `<div class="panel placeholder-panel"><div class="empty">
      <div class="empty-title">暂无归因结果</div>
      <div class="empty-sub">请在检测工作台载入工艺上下文并开始归因</div></div></div>`;
  }
}


async function loadFirstSample() {
  if (!sampleManifest) await loadManifest();
  const sample = firstSample();
  if (!sample) return;
  const btn = $("samples").querySelector(`.thumb[data-file="${sample.file}"]`);
  if (btn) markActiveThumb(btn);
  await detectSample(sample.file, sample.url);
}

function bindEvents() {
  $("upload-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) detectUpload(file);
    e.target.value = "";
  });
  $("load-demo-btn").addEventListener("click", async () => {
    $("samples").scrollIntoView({ behavior: "smooth", block: "nearest" });
    await loadFirstSample();
  });
  $("guide-load-btn").addEventListener("click", loadFirstSample);
  $("attr-guide-btn").addEventListener("click", () => {
    switchView("workbench");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("load-scenario-btn").addEventListener("click", () => {
    const idx = $("scenario-select").value;
    if (idx !== "") loadScenario(Number(idx));
  });
  $("run-attr-btn").addEventListener("click", runAttribution);
  $("scenario-select").addEventListener("change", () => {
    const idx = $("scenario-select").value;
    if (idx !== "") loadScenario(Number(idx));
  });
  const toggleRecords = () => {
    const collapsed = $("records-body-wrap").classList.toggle("hidden");
    $("records-toggle").textContent = collapsed ? "展开" : "收起";
    $("records-head").setAttribute("aria-expanded", String(!collapsed));
  };
  $("records-head").addEventListener("click", toggleRecords);
  $("records-head").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleRecords();
    }
  });
  bindSubTabs($("verify-tabs"));
  const srcBtn = $("data-source-btn");
  const srcPop = $("source-pop");
  if (srcBtn && srcPop) {
    srcBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      srcPop.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
      if (!srcPop.classList.contains("hidden") && !srcPop.contains(e.target) && e.target !== srcBtn) {
        srcPop.classList.add("hidden");
      }
    });
  }
}

/* ---------- 改进建议 / 可执行率 / 问答 ---------- */
function escapeHtml(s) {
  return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderSuggestions(result) {
  const el = $("suggestion-list");
  if (!el) return;
  const items = [];
  if (result.top_root_cause) {
    items.push({
      root_cause: result.top_root_cause,
      solution: result.solution,
      drop: result.expected_drop_pct,
      executable: result.solution_executable,
      primary: true,
    });
  }
  (result.candidates || [])
    .filter((c) => c.hit)
    .forEach((c) =>
      items.push({
        root_cause: c.root_cause,
        solution: c.solution,
        drop: c.expected_drop_pct,
        executable: c.executable,
        primary: false,
      })
    );
  el.innerHTML = items.length
    ? items
        .map(
          (s) => `<div class="suggestion ${s.primary ? "primary" : ""}">
            <div class="suggestion-text">${escapeHtml(s.solution || "—")}</div>
            <div class="suggestion-meta">
              <span>根因：${s.root_cause}</span>
              <span>预期降低缺陷率 ${s.drop != null ? s.drop + "%" : "—"}</span>
              <span class="tag ${s.executable ? "tag-ok" : "tag-warn"}">${s.executable ? "可执行" : "待完善"}</span>
            </div>
          </div>`
        )
        .join("")
    : `<div class="empty small">暂无匹配建议</div>`;
}

function bindWorkOrderCreate(result) {
  const btn = $("create-wo-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const row = $("wo-create-row");
    row.style.display = row.style.display === "none" ? "flex" : "none";
  });
  $("wo-confirm").addEventListener("click", async () => {
    const owner = $("wo-owner").value.trim() || "待指派";
    const rec = $("wo-record").value.trim() || "—";
    await fetch("/api/work-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        record_ref: rec,
        defect_cn: result.defect_cn,
        root_cause: result.top_root_cause,
        dimension_cn: result.top_dimension_cn,
        measure: result.solution,
        owner,
      }),
    });
    setFlow("ticket", true);
    switchView("ticket");
    loadTickets();
  });
}

async function loadSuggestionStats() {
  const el = $("exec-stats");
  if (!el) return;
  try {
    const res = await fetch("/api/suggestions/stats");
    const d = await res.json();
    el.innerHTML = `<div class="stat-line">
        <div class="stat-num"><span class="k">已生成建议</span><span class="v">${d.total}</span></div>
        <div class="stat-num"><span class="k">可执行</span><span class="v">${d.executable}</span></div>
        <div class="stat-num"><span class="k">占比</span><span class="v">${d.rate}%</span></div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">可执行判定条件（三条同时满足）：</div>
      <ul class="criteria-list">${d.criteria
        .map((c) => `<li><b style="color:var(--text);font-weight:500">${c.label}</b>：${c.desc}</li>`)
        .join("")}</ul>
      <div class="attr-source">${d.source}</div>`;
  } catch (e) {
    renderError(el, "统计加载失败", loadSuggestionStats);
  }
}

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

/* ---------- 知识库 ---------- */
let kbMetaLoaded = false;
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

async function loadKb() {
  const defect = $("kb-filter").value;
  const url = "/api/kb/rules" + (defect ? "?defect=" + encodeURIComponent(defect) : "");
  $("kb-list").innerHTML = skeletonList(3);
  try {
    const res = await fetch(url);
    const d = await res.json();
    if (!kbMetaLoaded) {
      $("kb-filter").innerHTML =
        `<option value="">全部缺陷类型</option>` +
        d.defects.map((x) => `<option value="${x.key}">${x.cn}</option>`).join("");
      $("kb-filter").addEventListener("change", loadKb);
      $("kb-add-btn").addEventListener("click", () => openKbEditor(null));
      kbMetaLoaded = true;
    }
    renderKbList(d.items);
  } catch (e) {
    renderError("kb-list", "规则加载失败", loadKb);
  }
}

const KB_PAGE_SIZE = 12;
let kbAllItems = [];
let kbPage = 1;

function renderKbList(items) {
  kbAllItems = items || [];
  kbPage = 1;
  renderKbPage();
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
    <div class="kb-field"><span class="k">缺陷类型</span><span class="v">${r.defect_cn}</span></div>
    <div class="kb-field"><span class="k">根因</span><span class="v">${escapeHtml(r.root_cause)}</span></div>
    <div class="kb-field"><span class="k">触发条件</span><span class="v kb-cond">${escapeHtml(r.trigger_text)}</span></div>
    <div class="kb-field"><span class="k">解决策略</span><span class="v kb-sol">${escapeHtml(r.solution)}</span></div>
    <div class="kb-field"><span class="k">预期降幅</span><span class="v">${r.expected_drop_pct}%</span></div>
    <div class="kb-actions">
      <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">编辑</button>
    </div>
  </div>`;
}

function renderKbPage() {
  const el = $("kb-list");
  const pager = $("kb-pager");
  if (!kbAllItems.length) {
    el.innerHTML = `<div class="empty small">暂无规则</div>`;
    if (pager) pager.innerHTML = "";
    return;
  }
  const totalPages = Math.max(1, Math.ceil(kbAllItems.length / KB_PAGE_SIZE));
  kbPage = Math.min(Math.max(1, kbPage), totalPages);
  const start = (kbPage - 1) * KB_PAGE_SIZE;
  el.innerHTML = kbAllItems.slice(start, start + KB_PAGE_SIZE).map(kbCardHtml).join("");
  el.querySelectorAll("[data-act]").forEach((b) => {
    if (b.tagName === "INPUT") {
      b.addEventListener("change", () => kbAction("toggle", Number(b.dataset.id), kbAllItems));
    } else {
      b.addEventListener("click", () => kbAction(b.dataset.act, Number(b.dataset.id), kbAllItems));
    }
  });
  if (pager) {
    pager.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="kb-prev"${kbPage <= 1 ? " disabled" : ""}>上一页</button>
      <span class="pager-info">第 ${kbPage} / ${totalPages} 页</span>
      <button class="btn btn-ghost btn-sm" id="kb-next"${kbPage >= totalPages ? " disabled" : ""}>下一页</button>`;
    $("kb-prev").addEventListener("click", () => {
      kbPage -= 1;
      renderKbPage();
    });
    $("kb-next").addEventListener("click", () => {
      kbPage += 1;
      renderKbPage();
    });
  }
}

async function kbAction(act, id, items) {
  const rule = items.find((r) => r.id === id);
  if (act === "toggle") {
    await fetch(`/api/kb/rules/${id}/toggle`, { method: "POST" });
    loadKb();
  } else if (act === "edit") {
    openKbEditor(rule);
  } else if (act === "del") {
    if (confirm(`确认删除规则「${rule.root_cause}」？`)) {
      await fetch(`/api/kb/rules/${id}`, { method: "DELETE" });
      loadKb();
    }
  }
}

function openKbEditor(rule) {
  const isNew = !rule;
  const el = $("kb-editor");
  el.innerHTML = `<div class="panel" style="margin-top:12px">
    <div class="panel-head">
      <div class="panel-title">${isNew ? "新增规则" : "编辑规则"}${
    rule ? " · " + (rule.rule_id || "#" + rule.id) : ""
  }</div>
      <button class="btn btn-ghost btn-sm" id="kb-editor-close">关闭</button>
    </div>
    <div class="editor-grid">
      <label class="form-field"><span class="field-label">缺陷类型</span>
        <select id="kb-f-defect">${KB_DEFECTS.map(
          (d) => `<option value="${d.key}"${rule && rule.defect === d.key ? " selected" : ""}>${d.cn}</option>`
        ).join("")}</select></label>
      <label class="form-field"><span class="field-label">预期降幅(%)</span>
        <input type="number" class="num" id="kb-f-drop" value="${rule ? rule.expected_drop_pct : 0}"></label>
      <label class="form-field full"><span class="field-label">根因</span>
        <input type="text" id="kb-f-root" value="${rule ? escapeHtml(rule.root_cause) : ""}"></label>
      <label class="form-field full"><span class="field-label">触发条件</span>
        <input type="text" id="kb-f-trigger" value="${rule ? escapeHtml(rule.trigger_text) : ""}" placeholder="如：轧制温度 < 1100℃"></label>
      <label class="form-field full"><span class="field-label">解决策略</span>
        <textarea id="kb-f-solution">${rule ? escapeHtml(rule.solution) : ""}</textarea></label>
      <label class="form-field"><span class="field-label">状态</span>
        <select id="kb-f-enabled">
          <option value="1"${!rule || rule.enabled ? " selected" : ""}>启用</option>
          <option value="0"${rule && !rule.enabled ? " selected" : ""}>停用</option>
        </select></label>
    </div>
    <div class="editor-actions">
      ${!isNew ? `<button class="btn btn-danger" id="kb-delete">${ICONS.trash}删除规则</button>` : ""}
      <button class="btn" id="kb-save">${isNew ? "新增" : "保存"}</button>
      <button class="btn btn-ghost" id="kb-cancel">取消</button>
    </div>
  </div>`;
  if (!isNew) {
    $("kb-delete").addEventListener("click", async () => {
      if (confirm(`删除规则「${rule.root_cause}」后将无法恢复，确认删除？`)) {
        await fetch(`/api/kb/rules/${rule.id}`, { method: "DELETE" });
        closeKbEditor();
        loadKb();
      }
    });
  }
  $("kb-editor-close").addEventListener("click", closeKbEditor);
  $("kb-cancel").addEventListener("click", closeKbEditor);
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
    const url = isNew ? "/api/kb/rules" : `/api/kb/rules/${rule.id}`;
    await fetch(url, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeKbEditor();
    loadKb();
  });
}

function closeKbEditor() {
  $("kb-editor").innerHTML = "";
}

/* ---------- 整改工单 ---------- */
let woMetaLoaded = false;
let woItems = [];

async function loadTickets() {
  const params = new URLSearchParams();
  if ($("wo-status-filter").value) params.set("status", $("wo-status-filter").value);
  if ($("wo-dim-filter").value) params.set("dimension_cn", $("wo-dim-filter").value);
  $("wo-list").innerHTML = skeletonList(3);
  try {
    const res = await fetch("/api/work-orders" + (params.toString() ? "?" + params : ""));
    const d = await res.json();
    if (!woMetaLoaded) {
      $("wo-status-filter").innerHTML =
        `<option value="">全部状态</option>` +
        d.statuses.map((s) => `<option value="${s}">${s}</option>`).join("");
      $("wo-dim-filter").innerHTML =
        `<option value="">全部维度</option>` +
        d.dimensions.map((x) => `<option value="${x.cn}">${x.cn}</option>`).join("");
      $("wo-status-filter").addEventListener("change", loadTickets);
      $("wo-dim-filter").addEventListener("change", loadTickets);
      woMetaLoaded = true;
    }
    woItems = d.items || [];
    renderTickets();
  } catch (e) {
    renderError("wo-list", "工单加载失败", loadTickets);
  }
}

const STATUS_LABEL = { 待处理: "待处理", 处理中: "处理中", 已解决: "已完成", 已关闭: "已关闭" };
const STATUS_CLASS = { 待处理: "status-pending", 处理中: "status-doing", 已解决: "status-done", 已关闭: "status-closed" };
const WO_STATUSES = ["待处理", "处理中", "已解决", "已关闭"];

function statusTag(s) {
  return `<span class="tag status-pill ${STATUS_CLASS[s] || ""}">${STATUS_LABEL[s] || s}</span>`;
}

function emptyVal(x) {
  if (x === null || x === undefined || x === "") {
    return `<span class="v v-empty" title="暂无关联记录">—</span>`;
  }
  return `<span class="v">${escapeHtml(String(x))}</span>`;
}

function renderTickets() {
  const el = $("wo-list");
  if (!woItems.length) {
    el.innerHTML = `<div class="empty small">暂无工单。可在归因诊断页点击「生成整改工单」。</div>`;
    return;
  }
  el.innerHTML = woItems
    .map((o) => {
      const idx = WO_STATUSES.indexOf(o.status);
      const track = WO_STATUSES.map((s, i) => {
        const cls = i < idx ? "done" : i === idx ? "current" : "todo";
        const node = `<span class="wo-track-node ${cls}"><span class="wo-track-dot"></span><span class="wo-track-label">${STATUS_LABEL[s]}</span></span>`;
        const sep = i < WO_STATUSES.length - 1 ? '<span class="wo-track-sep"></span>' : "";
        return node + sep;
      }).join("");
      return `<div class="wo-card" data-wo="${o.id}">
        <div class="wo-grid">
          <div class="wo-col">
            <div class="wo-field"><span class="k">工单号</span><span class="v">${o.ticket_no}</span></div>
            <div class="wo-field"><span class="k">主题</span>${emptyVal(o.root_cause)}</div>
            <div class="wo-field"><span class="k">整改措施</span>${emptyVal(o.measure)}</div>
          </div>
          <div class="wo-col">
            <div class="wo-field"><span class="k">缺陷类型</span>${emptyVal(o.defect_cn)}</div>
            <div class="wo-field"><span class="k">根因维度</span>${emptyVal(o.dimension_cn)}</div>
            <div class="wo-field"><span class="k">责任人</span>${emptyVal(o.owner)}</div>
            <div class="wo-field"><span class="k">状态</span><span class="v" data-wo-status>${statusTag(o.status)}</span></div>
          </div>
        </div>
        <div class="wo-track" data-wo-track>${track}</div>
        <div class="wo-actions">
          ${ticketAction(o)}
        </div>
      </div>`;
    })
    .join("");
  el.querySelectorAll("[data-rectify]").forEach((b) =>
    b.addEventListener("click", () => advanceOrder(b, "rectify"))
  );
  el.querySelectorAll("[data-wo-status-btn]").forEach((b) =>
    b.addEventListener("click", () => advanceOrder(b, "status", b.dataset.next))
  );
  el.querySelectorAll("[data-gov]").forEach((b) =>
    b.addEventListener("click", () => {
      switchView("verify");
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );
}

function ticketAction(o) {
  if (o.status === "待处理") {
    return `<button class="btn btn-primary btn-sm" data-rectify="${o.id}">开始整改</button>`;
  }
  if (o.status === "处理中") {
    return `<button class="btn btn-primary btn-sm" data-wo-status-btn="${o.id}" data-next="已解决">完成整改</button>`;
  }
  if (o.status === "已解决") {
    return `<button class="btn btn-link btn-sm" data-gov="${o.id}">去闭环验证 →</button>`;
  }
  return "";
}

async function advanceOrder(btn, kind, next) {
  const id = Number(btn.dataset.rectify || btn.dataset.woStatusBtn);
  setBtnLoading(btn, true);
  try {
    const res =
      kind === "rectify"
        ? await fetch(`/api/work-orders/${id}/rectify`, { method: "POST" })
        : await fetch(`/api/work-orders/${id}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: next }),
          });
    if (!res.ok) throw new Error("request failed");
    const data = await res.json();
    const order = data.order || data;
    const it = woItems.find((x) => x.id === id);
    if (it && order && order.status) it.status = order.status;
    renderTickets();
    showToast(kind === "rectify" ? "工单已进入处理中" : "整改已完成，可去闭环验证");
    clNeedsRefresh = true;
  } catch (e) {
    setBtnLoading(btn, false);
    showToast("操作失败，请重试", false);
  }
}

/* ---------- 闭环验证 ---------- */
let clLoaded = false;
let clInitPromise = null;
let clCharts = {};
let clDropMap = {};
let woByDefect = {};
let clResultDirty = false;
let clNeedsRefresh = false;

async function refreshWoByDefect() {
  try {
    const res = await fetch("/api/work-orders");
    const w = await res.json();
    woByDefect = {};
    (w.items || []).forEach((o) => {
      const cur = woByDefect[o.defect_cn];
      if (!cur || (o.id || 0) > (cur.id || 0)) woByDefect[o.defect_cn] = o;
    });
    clNeedsRefresh = false;
  } catch (e) {}
}

async function initVerify() {
  $("cl-measures").innerHTML = skeletonList(3);
  try {
    const [rb, rw] = await Promise.all([
      fetch("/api/closed-loop/batches"),
      fetch("/api/work-orders"),
    ]);
    const d = await rb.json();
    const w = await rw.json();
    $("cl-batch").innerHTML = d.items
      .map((b) => `<option value="${b.key}">${b.label}（${b.date_range}）</option>`)
      .join("");
    $("cl-sample").value = d.default_sample || 200;
    woByDefect = {};
    (w.items || []).forEach((o) => {
      const cur = woByDefect[o.defect_cn];
      if (!cur || (o.id || 0) > (cur.id || 0)) woByDefect[o.defect_cn] = o;
    });
    $("cl-batch").addEventListener("change", () => {
      clResultDirty = false;
      showClEmptyState();
      runVerify(false, false, true, false);
    });
    $("cl-run-btn").addEventListener("click", () => runVerify(true, true, false, true));
    $("cl-prereq-go").addEventListener("click", () => {
      switchView("ticket");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    clLoaded = true;
    clNeedsRefresh = false;
  } catch (e) {
    clInitPromise = null;
    renderError("cl-measures", "批次加载失败", () => {
      clInitPromise = null;
      initVerify();
    });
  }
}

async function loadVerify() {
  if (!clLoaded) {
    if (!clInitPromise) clInitPromise = initVerify();
    await clInitPromise;
    if (!clLoaded) return;
  }
  await refreshWoByDefect();
  await runVerify(false, false, true, false);
  if (!clResultDirty) showClEmptyState();
  loadClosedRuns();
}

function showClEmptyState() {
  $("cl-result").innerHTML = `<div class="panel cl-empty-state">
    <div class="empty-title">尚未开始复检推演</div>
    <div class="empty-sub">勾选已完成整改的措施后，点击「开始复检推演」查看降幅</div>
  </div>`;
}

function collectExecuted() {
  const boxes = document.querySelectorAll("#cl-measures input[type=checkbox]");
  if (!boxes.length) return [];
  return Array.from(boxes)
    .filter((b) => b.checked)
    .map((b) => b.dataset.defect);
}

async function runVerify(save, useSelection, rebuildMeasures, renderResult) {
  const body = {
    batch: $("cl-batch").value,
    sample_size: Number($("cl-sample").value || 200),
  };
  if (useSelection) body.executed = collectExecuted();
  if (save) body.save = true;
  const runBtn = $("cl-run-btn");
  if (save) setBtnLoading(runBtn, true);
  if (renderResult !== false) {
    $("cl-result").innerHTML =
      `<div class="panel"><div class="loading"><span class="spinner"></span>复检推演中…</div></div>`;
  }
  try {
    const res = await fetch("/api/closed-loop/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    (d.measures || []).forEach((m) => {
      clDropMap[m.defect] = Math.max(clDropMap[m.defect] || 0, m.expected_drop || 0);
    });
    if (rebuildMeasures) renderVerifyMeasures(d.measures);
    if (renderResult !== false) {
      renderVerifyResult(d);
      clResultDirty = true;
    }
    if (save) {
      setFlow("verify", true);
      loadClosedRuns();
      showToast("复检推演完成");
    }
  } catch (e) {
    if (renderResult !== false) {
      renderError("cl-result", "复检失败", () => runVerify(save, useSelection, rebuildMeasures, renderResult));
    }
    if (save) showToast("复检失败，请稍后重试", false);
  } finally {
    if (save) setBtnLoading(runBtn, false);
  }
}

function renderVerifyMeasures(measures) {
  $("cl-measures").innerHTML = measures
    .map((m) => {
      const wo = woByDefect[m.defect_cn];
      const done = !!wo && wo.status === "已解决";
      const drop = clDropMap[m.defect] != null ? clDropMap[m.defect] : m.expected_drop;
      const ticketHtml = wo
        ? `<span class="cl-measure-wo">${wo.ticket_no}</span>`
        : `<span class="cl-measure-wo empty">—</span>`;
      const badge = done
        ? `<span class="tag status-pill ${STATUS_CLASS[wo.status] || ""}">${STATUS_LABEL[wo.status] || wo.status}</span>`
        : `<span class="tag status-pill status-locked">工单未完成</span>`;
      return `<label class="cl-measure${done ? "" : " off locked"}">
        <span class="cl-measure-row">
          <input type="checkbox" data-defect="${m.defect}" ${done ? "checked" : ""} ${done ? "" : "disabled"}>
          <span class="cl-measure-name">${m.defect_cn}</span>
          <span class="cl-measure-ticket">${ticketHtml}${badge}</span>
          <span class="cl-measure-drop">预期降幅 ${fmt2(drop)}%</span>
        </span>
      </label>`;
    })
    .join("");
  $("cl-measures").querySelectorAll("input[type=checkbox]:not([disabled])").forEach((b) =>
    b.addEventListener("change", () => {
      const card = b.closest(".cl-measure");
      if (card) card.classList.toggle("off", !b.checked);
      syncClRunBtn();
    })
  );
  renderVerifyPrereq();
  syncClRunBtn();
}

function renderVerifyPrereq() {
  const text = $("cl-prereq-text");
  const go = $("cl-prereq-go");
  if (!text) return;
  const boxes = Array.from(document.querySelectorAll("#cl-measures input[type=checkbox]"));
  const done = boxes.filter((b) => !b.disabled).length;
  if (done > 0) {
    text.innerHTML = `<span class="cl-prereq-ok">本批次可纳入验证的已完成工单 <b>${done}</b> 项</span>，勾选后开始复检推演`;
    if (go) go.classList.add("hidden");
  } else {
    text.innerHTML = `<span class="cl-prereq-warn">本批次暂无已完成整改的工单</span>，请先在整改工单页完成整改`;
    if (go) go.classList.remove("hidden");
  }
}

function syncClRunBtn() {
  const btn = $("cl-run-btn");
  if (!btn) return;
  const checked = document.querySelectorAll("#cl-measures input[type=checkbox]:checked").length;
  btn.disabled = checked === 0;
}

function disposeClCharts() {
  Object.values(clCharts).forEach((c) => {
    try { c.dispose(); } catch (e) {}
  });
  clCharts = {};
}

function renderVerifyResult(d) {
  disposeClCharts();
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
    <div class="panel" style="margin-top:12px">
      <div class="panel-head">
        <div class="panel-title">整改前后对比</div>
        <div class="panel-sub">${d.batch_label} · ${d.date_range}</div>
      </div>
      <div class="cl-charts">
        <div class="cl-chart" id="cl-bar"></div>
        <div class="cl-chart" id="cl-trend"></div>
      </div>
    </div>
    <div class="panel" style="margin-top:12px">
      <div class="panel-head">
        <div class="panel-title">按缺陷类型整改前后分项对比</div>
        <div class="panel-sub">占比按批次规模折算</div>
      </div>
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
    </div>
    <div class="attr-source">${d.disclaimer} ${d.disclaimer_next}</div>`;

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
    $("cl-bar").innerHTML = `<div class="empty small">图表库未加载</div>`;
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
      type: "category",
      data: ["整改前", "整改后"],
      axisLine: { lineStyle: { color: axisColor } },
      axisLabel: { color: "#A8C0DC" },
    },
    yAxis: {
      type: "value",
      name: "缺陷率 %",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor, formatter: "{value}%" },
      splitLine: { lineStyle: { color: axisColor } },
    },
    series: [
      {
        type: "bar",
        barWidth: "46%",
        data: [
          { value: d.before_rate, itemStyle: { color: "#E24B4A" } },
          { value: d.after_rate, itemStyle: { color: afterColor } },
        ],
        label: { show: true, position: "top", color: "#A8C0DC", formatter: "{c}%" },
      },
    ],
  });

  const t = d.trend;
  clCharts.trend = echarts.init($("cl-trend"));
  clCharts.trend.setOption({
    backgroundColor: "transparent",
    title: { text: "连续批次缺陷率趋势", left: "center", top: 4, textStyle: { color: "#A8C0DC", fontSize: 13, fontWeight: 500 } },
    grid: { left: 46, right: 24, top: 44, bottom: 44 },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : v + "%") },
    legend: { data: ["整改前", "整改后（推演）"], bottom: 0, textStyle: { color: textColor }, itemWidth: 10, itemHeight: 10 },
    xAxis: {
      type: "category",
      data: t.labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: axisColor } },
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      name: "缺陷率 %",
      nameTextStyle: { color: textColor },
      axisLabel: { color: textColor, formatter: "{value}%" },
      splitLine: { lineStyle: { color: axisColor } },
    },
    series: [
      {
        name: "整改前",
        type: "line",
        smooth: true,
        data: t.before,
        itemStyle: { color: "#E24B4A" },
        lineStyle: { color: "#E24B4A" },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#EF9F27", type: "dashed" },
          label: { formatter: t.marker_label, color: "#EF9F27" },
          data: [{ xAxis: t.labels[t.marker_index] }],
        },
      },
      {
        name: "整改后（推演）",
        type: "line",
        smooth: true,
        data: t.after,
        itemStyle: { color: "#2FD4C4" },
        lineStyle: { color: "#2FD4C4", type: "dashed" },
      },
    ],
  });
}

async function loadClosedRuns() {
  const el = $("cl-runs");
  if (!el) return;
  el.innerHTML = skeletonList(3);
  try {
    const res = await fetch("/api/closed-loop/runs?limit=10");
    const d = await res.json();
    if (!d.items || !d.items.length) {
      el.innerHTML = `<div class="empty small">暂无复检记录。点击「开始复检推演」后留痕于此。</div>`;
      return;
    }
    el.innerHTML = d.items
      .slice(0, 10)
      .map(
        (r) => `<div class="cl-run">
          <span><span class="k">时间</span> <span class="v">${r.created_at}</span></span>
          <span><span class="k">批次</span> <span class="v">${r.batch_label}</span></span>
          <span><span class="k">降幅</span> <span class="v">${fmt2(r.drop_pct)}%</span></span>
          <span class="cl-verdict-badge ${verdictCls(r.drop_pct)}">${r.verdict}</span>
        </div>`
      )
      .join("");
  } catch (e) {
    renderError(el, "复检记录加载失败", loadClosedRuns);
  }
}

function verdictCls(drop) {
  if (drop >= 30) return "verdict-strong";
  if (drop >= 20) return "verdict-ok";
  return "verdict-weak";
}

/* ---------- 分析看板 ---------- */
const CHART = {
  primary: "#2FD4C4",
  accent: "#378ADD",
  warn: "#EF9F27",
  ok: "#639922",
  danger: "#E24B4A",
  muted: "#7E9BBE",
  text: "#A8C0DC",
  dim: "#7E9BBE",
  line: "#1E3350",
};
const PIE_COLORS = [CHART.primary, CHART.accent, CHART.warn, CHART.danger];
const CYAN_SCALE = ["#2FD4C4", "#29B4AB", "#239392", "#1E7379", "#185260", "#123247"];
const RING_EMPTY = "#1E3350";
let dashCharts = {};
let dashLoaded = false;

function ringData(items, nameKey, valKey, colors) {
  const palette = colors || PIE_COLORS;
  return items.map((x, i) => ({
    name: x[nameKey],
    value: x[valKey],
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
      type: "pie",
      radius: ["42%", "66%"],
      center: ["50%", "48%"],
      label: { color: CHART.text, formatter: "{b}\n{d}%" },
      labelLine: { lineStyle: { color: CHART.line } },
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
const DASH_NOTES = {
  闭环达标率: "6 类缺陷中 5 类降幅达标",
  平均处置时长: "基于已推进工单创建至处置时长",
};

function renderDashCards(cards) {
  $("dash-cards").innerHTML = cards
    .map((c) => {
      const raw = String(c.value == null ? "" : c.value).trim();
      const parsed = parseFloat(raw);
      const isEmpty = raw === "" || isNaN(parsed) || parsed === 0;
      let numTxt = raw;
      let unit = c.unit || "";
      if (isEmpty) {
        numTxt = "—";
        unit = "";
      } else if (unit === "%") {
        numTxt = fmt2(parsed);
      }
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
    setFlow("dashboard", true);
    renderDashCards(d.cards);
    renderDashCharts(d);
    renderTopRoots(d.top_root_causes);
    const tTitle = $("dash-trend-title");
    const tInfo = $("dash-trend-info");
    if (d.trend_title && tTitle) {
      const m = String(d.trend_title).match(/^(.*?)[（(](.*?)[）)]\s*$/);
      if (m) {
        tTitle.textContent = m[1].trim();
        if (tInfo) {
          tInfo.title = m[2].trim();
          tInfo.classList.remove("hidden");
        }
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
  Object.values(dashCharts).forEach((c) => {
    try { c.dispose(); } catch (e) {}
  });
  dashCharts = {};
}

function renderDashCharts(d) {
  if (typeof echarts === "undefined") {
    ["dash-defect-pie", "dash-sev-ring", "dash-dim", "dash-trend"].forEach((id) => {
      $(id).innerHTML = `<div class="empty small">图表库未加载</div>`;
    });
    return;
  }

  dashCharts.defect = echarts.init($("dash-defect-pie"));
  dashCharts.defect.setOption(
    ringOption(ringData(d.defect_distribution, "name", "count", CYAN_SCALE))
  );

  dashCharts.sev = echarts.init($("dash-sev-ring"));
  dashCharts.sev.setOption(
    ringOption(ringData(d.severity_distribution, "level", "count"))
  );

  dashCharts.dim = echarts.init($("dash-dim"));
  dashCharts.dim.setOption(
    ringOption(ringData(d.dimension_distribution, "dimension", "count"))
  );

  const t = d.monthly_trend || [];
  dashCharts.trend = echarts.init($("dash-trend"));
  dashCharts.trend.setOption({
    backgroundColor: "transparent",
    grid: { left: 48, right: 24, top: 24, bottom: 44 },
    tooltip: { trigger: "axis", valueFormatter: (v) => v + "%" },
    legend: { data: ["缺陷率"], bottom: 0, textStyle: { color: CHART.dim }, itemWidth: 10, itemHeight: 10 },
    xAxis: { type: "category", data: t.map((x) => x.month), boundaryGap: false, ...baseAxis() },
    yAxis: { type: "value", name: "缺陷率 %", nameTextStyle: { color: CHART.dim }, axisLabel: { color: CHART.dim, formatter: "{value}%" }, splitLine: { lineStyle: { color: CHART.line } } },
    series: [{
      name: "缺陷率",
      type: "line",
      smooth: true,
      symbolSize: 7,
      data: t.map((x) => x.defect_rate),
      itemStyle: { color: CHART.primary },
      lineStyle: { color: CHART.primary, width: 2 },
      areaStyle: { color: "rgba(47,212,196,0.10)" },
      label: { show: true, color: CHART.text, formatter: "{c}%" },
    }],
  });
}

function renderTopRoots(list) {
  const el = $("dash-top");
  if (!list || !list.length) {
    el.innerHTML = `<div class="empty small">暂无根因统计</div>`;
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

/* ---------- 质量告警 ---------- */
const ALERT_COMPACT_KEY = "alertCompactCollapsed";
let alertData = null;
let alertCollapsed = false;

function bindAlertBell() {
  const bell = $("alert-bell");
  const panel = $("alert-panel");
  if (!bell || !panel) return;
  try {
    alertCollapsed = localStorage.getItem(ALERT_COMPACT_KEY) === "1";
  } catch (e) {}
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
    renderHomeAlerts();
  } catch (e) {
    /* 告警加载失败时静默，不打断主流程 */
  }
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
    updateAlertVisibility();
    return;
  }
  badge.textContent = d.severe_count || d.items.length;
  badge.classList.remove("hidden");
  panel.innerHTML = `<div class="alert-panel-head">质量告警 · 最近 ${d.window_hours} 小时</div>
    <div class="alert-list">
      ${d.items
        .map((i) => `<div class="alert-item"><span class="alert-item-title">${i.title}</span><span class="alert-item-detail">${i.detail}</span></div>`)
        .join("")}
    </div>
    <div class="alert-panel-foot">
      <button class="btn btn-primary btn-sm" id="alert-push-btn">推送告警通知</button>
      <span class="alert-push-result" id="alert-push-result"></span>
    </div>`;
  $("alert-push-btn").addEventListener("click", pushAlertNotify);
  updateAlertVisibility();
}

function updateAlertVisibility() {
  const el = $("alert-compact");
  if (!el) return;
  const onView = activeView === "workbench" || activeView === "dashboard";
  if (!alertData || !alertData.has_alert || !onView || alertCollapsed) {
    el.className = "alert-compact hidden";
    el.innerHTML = "";
    return;
  }
  const text = alertData.items.map((i) => i.title).join(" · ");
  el.className = "alert-compact";
  el.innerHTML = `<span class="alert-compact-bell">${ICONS.bell}</span>
    <span class="alert-compact-text">${text}</span>
    <button class="alert-compact-close" id="alert-compact-close" aria-label="收起">×</button>`;
  $("alert-compact-close").addEventListener("click", () => {
    alertCollapsed = true;
    try {
      localStorage.setItem(ALERT_COMPACT_KEY, "1");
    } catch (e) {}
    updateAlertVisibility();
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

/* ---------- 启动 ---------- */
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

window.addEventListener("popstate", () => {
  const key = (location.hash || "").replace(/^#/, "");
  switchView(VIEW_META[key] ? key : "home", true);
});

window.addEventListener("resize", () => {
  [...Object.values(clCharts), ...Object.values(dashCharts)].forEach((c) => {
    try { c.resize(); } catch (e) {}
  });
});
