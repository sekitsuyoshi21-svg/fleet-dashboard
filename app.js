(() => {
  "use strict";

  const demoVehicles = [
    { id:"A-001", name:"品川 100 あ 12-34", driver:"佐藤", level:"critical", status:"要対応", title:"エンジン異常", code:"P0301 / シリンダー1失火検出", updated:"17:06", operation:"稼働中", inspection:"確認が必要" },
    { id:"A-023", name:"品川 100 か 56-78", driver:"鈴木", level:"critical", status:"要対応", title:"バッテリー電圧低下", code:"電源電圧が基準値を下回りました", updated:"16:30", operation:"停車中", inspection:"要確認" },
    { id:"A-015", name:"練馬 100 き 90-12", driver:"田中", level:"warning", status:"要注意", title:"定期点検まで3日", code:"次回点検日 2026/10/31", updated:"16:48", operation:"稼働中", inspection:"予約未登録" },
    { id:"A-032", name:"多摩 100 く 34-56", driver:"高橋", level:"normal", status:"正常", title:"異常なし", code:"すべての項目が正常です", updated:"16:21", operation:"稼働中", inspection:"完了" }
  ];

  let api = null;
  let vehicles = [...demoVehicles];
  let activeFilter = "all";

  const $ = (id) => document.getElementById(id);
  const els = {
    priorityGrid:$("priorityGrid"), tableBody:$("vehicleTableBody"), search:$("searchInput"),
    empty:$("emptyState"), drawer:$("vehicleDrawer"), backdrop:$("drawerBackdrop"),
    drawerBody:$("drawerBody"), drawerTitle:$("drawerTitle"), toast:$("toast"),
    refresh:$("refreshButton"), updatedAt:$("updatedAt")
  };

  const levelLabel = { critical:"要対応", warning:"要注意", normal:"正常" };
  const levelDot = { critical:"red", warning:"amber", normal:"green" };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  }

  function render() {
    renderPriority();
    renderTable();
    renderCounts();
  }

  function renderPriority() {
    const critical = vehicles.filter(v => v.level === "critical").slice(0, 2);
    els.priorityGrid.innerHTML = critical.map(v => `
      <article class="priority-card">
        <div class="alert-badge" aria-hidden="true">!</div>
        <div class="priority-main">
          <h3>${escapeHtml(v.id)}　${escapeHtml(v.title)}</h3>
          <p><span class="code">${escapeHtml(v.code.split(" / ")[0])}</span>${v.code.includes(" / ") ? "　" + escapeHtml(v.code.split(" / ").slice(1).join(" / ")) : ""}</p>
        </div>
        <button class="row-button" data-open="${escapeHtml(v.id)}" type="button">異常を確認 →</button>
      </article>`).join("");
  }

  function filteredVehicles() {
    const q = els.search.value.trim().toLowerCase();
    return vehicles.filter(v => {
      const filterMatch = activeFilter === "all" || v.level === activeFilter;
      const text = `${v.id} ${v.name} ${v.driver} ${v.title} ${v.code}`.toLowerCase();
      return filterMatch && (!q || text.includes(q));
    });
  }

  function renderTable() {
    const rows = filteredVehicles();
    els.tableBody.innerHTML = rows.map(v => `
      <tr>
        <td><div class="vehicle-name">${escapeHtml(v.id)}</div><div class="vehicle-sub">${escapeHtml(v.name)}</div></td>
        <td><span class="status-pill status-pill--${v.level}"><i class="dot dot--${levelDot[v.level]}"></i>${escapeHtml(v.status)}</span></td>
        <td>${escapeHtml(v.driver)}</td>
        <td><div class="detail-title">${escapeHtml(v.title)}</div><div class="detail-code">${escapeHtml(v.code)}</div></td>
        <td>${escapeHtml(v.updated)}</td>
        <td><button class="chevron-button" data-open="${escapeHtml(v.id)}" type="button" aria-label="${escapeHtml(v.id)}の詳細を見る">›</button></td>
      </tr>`).join("");
    els.empty.hidden = rows.length !== 0;
  }

  function renderCounts() {
    const counts = {
      critical: vehicles.filter(v => v.level === "critical").length,
      warning: vehicles.filter(v => v.level === "warning").length,
      normal: vehicles.filter(v => v.level === "normal").length
    };
    $("allBadge").textContent = vehicles.length;
    $("criticalBadge").textContent = counts.critical;
    $("warningBadge").textContent = counts.warning;
    $("normalBadge").textContent = counts.normal;
    $("criticalCount").textContent = counts.critical;
    $("warningCount").textContent = counts.warning;
  }

  function openDrawer(id) {
    const v = vehicles.find(item => item.id === id);
    if (!v) return;
    els.drawerTitle.textContent = v.id;
    els.drawerBody.innerHTML = `
      <div class="drawer-status ${v.level}"><p>現在の状態</p><strong>${escapeHtml(v.status)}：${escapeHtml(v.title)}</strong><div>${escapeHtml(v.code)}</div></div>
      <div class="detail-list">
        <div class="detail-item"><span>運転者</span><strong>${escapeHtml(v.driver)}</strong></div>
        <div class="detail-item"><span>最終通信</span><strong>${escapeHtml(v.updated)}</strong></div>
        <div class="detail-item"><span>稼働状態</span><strong>${escapeHtml(v.operation)}</strong></div>
        <div class="detail-item"><span>点検状態</span><strong>${escapeHtml(v.inspection)}</strong></div>
      </div>
      <div class="next-action"><h3>推奨する次の操作</h3><ol><li>故障・注意内容を確認</li><li>過去の同一事象を確認</li><li>整備または点検の要否を判断</li></ol><button class="button button--primary drawer-action" id="recordActionButton" type="button">対応を記録する</button></div>`;
    els.backdrop.hidden = false;
    els.drawer.classList.add("is-open");
    els.drawer.setAttribute("aria-hidden", "false");
    setTimeout(() => $("recordActionButton")?.addEventListener("click", () => showToast("対応記録機能は次の実装ステップです")), 0);
  }

  function closeDrawer() {
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => { els.backdrop.hidden = true; }, 240);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2300);
  }

  async function refreshData() {
    els.refresh.disabled = true;
    els.refresh.classList.add("is-spinning");
    try {
      if (api) {
        const devices = await geotabCall("Get", { typeName:"Device", search:{ fromDate:new Date().toISOString() } });
        // 実運用では Device、DeviceStatusInfo、FaultData 等を結合して vehicles を構築します。
        $("activeCount").textContent = Array.isArray(devices) ? devices.length : vehicles.length;
        showToast("MyGeotabの車両データを更新しました");
      } else {
        await new Promise(resolve => setTimeout(resolve, 550));
        showToast("デモデータを更新しました");
      }
      els.updatedAt.textContent = new Date().toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" });
      render();
    } catch (error) {
      console.error(error);
      showToast("データを取得できませんでした");
    } finally {
      els.refresh.disabled = false;
      els.refresh.classList.remove("is-spinning");
    }
  }

  function geotabCall(method, params) {
    return new Promise((resolve, reject) => api.call(method, params, resolve, reject));
  }

  document.addEventListener("click", event => {
    const opener = event.target.closest("[data-open]");
    if (opener) openDrawer(opener.dataset.open);
  });
  els.search.addEventListener("input", renderTable);
  document.querySelectorAll(".filter-chip").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach(b => b.classList.remove("is-active"));
    button.classList.add("is-active");
    activeFilter = button.dataset.filter;
    renderTable();
  }));
  $("showCriticalButton").addEventListener("click", () => {
    document.querySelector('[data-filter="critical"]').click();
    document.querySelector(".fleet-panel").scrollIntoView({ behavior:"smooth" });
  });
  $("closeDrawerButton").addEventListener("click", closeDrawer);
  els.backdrop.addEventListener("click", closeDrawer);
  els.refresh.addEventListener("click", refreshData);
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeDrawer(); });

  els.updatedAt.textContent = new Date().toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" });
  render();

  // MyGeotab Custom Page Add-In entry point.
  // config.json の addinId と、下の fleetDashboard を一致させてください。
  window.geotab = window.geotab || {};
  window.geotab.addin = window.geotab.addin || {};
  window.geotab.addin.fleetDashboard = function () {
    return {
      initialize(freshApi, state, callback) { api = freshApi; callback(); },
      focus(freshApi) { api = freshApi; refreshData(); },
      blur() { closeDrawer(); }
    };
  };
})();
