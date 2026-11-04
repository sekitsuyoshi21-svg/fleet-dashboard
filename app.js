(() => {
  "use strict";

  let api = null;
  let vehicles = [];
  let activeFilter = "all";

  const FAULT_LOOKBACK_HOURS = 24;
  const $ = (id) => document.getElementById(id);

  const els = {
    priorityGrid: $("priorityGrid"),
    tableBody: $("vehicleTableBody"),
    search: $("searchInput"),
    empty: $("emptyState"),
    drawer: $("vehicleDrawer"),
    backdrop: $("drawerBackdrop"),
    drawerBody: $("drawerBody"),
    drawerTitle: $("drawerTitle"),
    toast: $("toast"),
    refresh: $("refreshButton"),
    updatedAt: $("updatedAt")
  };

  const levelLabel = {
    critical: "要対応",
    warning: "要注意",
    normal: "正常"
  };

  const levelDot = {
    critical: "red",
    warning: "amber",
    normal: "green"
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[char]));
  }

  function referenceId(value) {
    if (!value) return "";
    return typeof value === "string" ? value : value.id || "";
  }

  function referenceName(value) {
    if (!value || typeof value === "string") return "";
    return value.name || "";
  }

  function formatTime(value) {
    if (!value) return "--:--";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "--:--";
    return date.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function geotabCall(method, params) {
    return new Promise((resolve, reject) => {
      if (!api || typeof api.call !== "function") {
        reject(new Error("MyGeotab APIが初期化されていません。"));
        return;
      }
      api.call(method, params, resolve, reject);
    });
  }

  function getDriverName(driver) {
    if (!driver) return "未割当";
    if (driver.name) return driver.name;
    const fullName = [driver.firstName, driver.lastName].filter(Boolean).join(" ");
    if (fullName) return fullName;
    return referenceId(driver) ? "割当あり" : "未割当";
  }

  function sourceText(diagnostic) {
    const source = diagnostic?.source;
    return [referenceId(source), referenceName(source)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function controllerText(diagnostic) {
    const controller = diagnostic?.controller;
    return [referenceId(controller), referenceName(controller)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function formatObdCode(diagnostic) {
    if (!diagnostic || !sourceText(diagnostic).includes("obd")) return "";

    const controller = controllerText(diagnostic);
    let prefix = "";

    if (controller.includes("powertrain")) prefix = "P";
    else if (controller.includes("body")) prefix = "B";
    else if (controller.includes("chassis")) prefix = "C";
    else if (controller.includes("network")) prefix = "U";

    const numericCode = Number(diagnostic.code);
    if (!prefix || !Number.isFinite(numericCode)) return "";

    return `${prefix}${numericCode.toString(16).toUpperCase().padStart(4, "0")}`;
  }

  function formatJ1939Code(diagnostic, failureMode) {
    if (!diagnostic || !sourceText(diagnostic).includes("j1939")) return "";

    const spn = Number.isFinite(Number(diagnostic.code))
      ? `SPN ${diagnostic.code}`
      : "";
    const fmi = Number.isFinite(Number(failureMode?.code))
      ? `FMI ${failureMode.code}`
      : "";

    return [spn, fmi].filter(Boolean).join(" / ");
  }

  function getFaultCode(fault) {
    if (!fault) return "";

    const diagnostic = fault.resolvedDiagnostic || fault.diagnostic || null;
    const failureMode = fault.resolvedFailureMode || fault.failureMode || null;

    const obdCode = formatObdCode(diagnostic);
    if (obdCode) return obdCode;

    const j1939Code = formatJ1939Code(diagnostic, failureMode);
    if (j1939Code) return j1939Code;

    if (diagnostic?.code !== undefined && diagnostic?.code !== null) {
      return `診断コード ${diagnostic.code}`;
    }

    const diagnosticId = referenceId(fault.diagnostic);
    return diagnosticId ? `Diagnostic ID: ${diagnosticId}` : "";
  }

  function getFaultDescription(fault) {
    if (!fault) return "現在確認できる故障はありません";

    const diagnostic = fault.resolvedDiagnostic || fault.diagnostic || null;
    const failureMode = fault.resolvedFailureMode || fault.failureMode || null;
    const diagnosticName = referenceName(diagnostic);
    const failureModeName = referenceName(failureMode);

    if (fault.faultDescription) return fault.faultDescription;
    if (diagnosticName && failureModeName) {
      return `${diagnosticName}（${failureModeName}）`;
    }
    if (diagnosticName) return diagnosticName;
    if (fault.effectOnComponent) return fault.effectOnComponent;
    if (failureModeName) return `故障モード：${failureModeName}`;
    if (fault.recommendation) return fault.recommendation;

    const diagnosticId = referenceId(fault.diagnostic);
    return diagnosticId
      ? `診断情報あり（${diagnosticId}）`
      : "詳細不明の故障情報";
  }

  function severityText(fault) {
    const severity = fault?.severity;
    if (!severity) return "";
    if (typeof severity === "string") return severity.toLowerCase();
    return String(severity.name || severity.id || "").toLowerCase();
  }

  async function enrichFaultDetails(faultData) {
    const faults = faultData || [];

    const diagnosticIds = [...new Set(
      faults.map((fault) => referenceId(fault.diagnostic)).filter(Boolean)
    )];

    const failureModeIds = [...new Set(
      faults
        .map((fault) => referenceId(fault.failureMode))
        .filter((id) => id && !id.includes("NoFailureModeId"))
    )];

    let diagnostics = [];
    let failureModes = [];

    if (diagnosticIds.length > 0) {
      try {
        diagnostics = await geotabCall("Get", {
          typeName: "Diagnostic",
          search: { ids: diagnosticIds }
        });
      } catch (error) {
        console.warn("Diagnosticの取得に失敗しました。", error);
      }
    }

    if (failureModeIds.length > 0) {
      try {
        failureModes = await geotabCall("Get", {
          typeName: "FailureMode",
          search: { ids: failureModeIds }
        });
      } catch (error) {
        console.warn("FailureModeの取得に失敗しました。", error);
      }
    }

    const diagnosticsById = new Map(
      (diagnostics || []).map((diagnostic) => [diagnostic.id, diagnostic])
    );
    const failureModesById = new Map(
      (failureModes || []).map((failureMode) => [failureMode.id, failureMode])
    );

    return faults.map((fault) => {
      const diagnosticId = referenceId(fault.diagnostic);
      const failureModeId = referenceId(fault.failureMode);

      return {
        ...fault,
        resolvedDiagnostic:
          diagnosticsById.get(diagnosticId) ||
          (typeof fault.diagnostic === "object" ? fault.diagnostic : null),
        resolvedFailureMode:
          failureModesById.get(failureModeId) ||
          (typeof fault.failureMode === "object" ? fault.failureMode : null)
      };
    });
  }

  function classifyVehicle(fault, statusInfo) {
    if (fault) {
      const severeLamp = fault.redStopLamp === true || fault.malfunctionLamp === true;
      const warningLamp = fault.amberWarningLamp === true || fault.protectWarningLamp === true;
      const severity = severityText(fault);

      if (
        severeLamp ||
        severity.includes("critical") ||
        severity.includes("severe") ||
        severity.includes("high")
      ) {
        return "critical";
      }

      if (warningLamp || severity) return "warning";
      return "warning";
    }

    if (statusInfo && statusInfo.isDeviceCommunicating === false) return "warning";
    return "normal";
  }

  function operationLabel(statusInfo) {
    if (!statusInfo) return "状態不明";
    if (statusInfo.isDeviceCommunicating === false) return "通信なし";
    return statusInfo.isDriving === true ? "走行中" : "停止中";
  }

  function buildVehicles(devices, statusInfos, faultData) {
    const statusByDevice = new Map();
    const latestFaultByDevice = new Map();

    for (const statusInfo of statusInfos || []) {
      const deviceId = referenceId(statusInfo.device);
      if (deviceId) statusByDevice.set(deviceId, statusInfo);
    }

    const sortedFaults = [...(faultData || [])].sort(
      (a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0)
    );

    for (const fault of sortedFaults) {
      const deviceId = referenceId(fault.device);
      if (deviceId && !latestFaultByDevice.has(deviceId)) {
        latestFaultByDevice.set(deviceId, fault);
      }
    }

    return (devices || [])
      .filter((device) => device && device.id)
      .map((device) => {
        const statusInfo = statusByDevice.get(device.id) || null;
        const fault = latestFaultByDevice.get(device.id) || null;
        const level = classifyVehicle(fault, statusInfo);
        const description = getFaultDescription(fault);
        const faultCode = getFaultCode(fault);

        let title = "異常なし";
        let code = `直近${FAULT_LOOKBACK_HOURS}時間に故障情報はありません`;

        if (fault) {
          title = description;
          code = faultCode ? `${faultCode} / ${description}` : description;
        } else if (statusInfo?.isDeviceCommunicating === false) {
          title = "車両と通信できません";
          code = "最終通信日時を確認してください";
        }

        return {
          id: device.name || device.serialNumber || device.id,
          name:
            device.licensePlate ||
            device.vehicleIdentificationNumber ||
            device.serialNumber ||
            "車両情報なし",
          deviceId: device.id,
          driver: getDriverName(statusInfo?.driver),
          level,
          status: levelLabel[level],
          title,
          code,
          updated: formatTime(fault?.dateTime || statusInfo?.dateTime),
          operation: operationLabel(statusInfo),
          inspection: fault ? "確認が必要" : "異常なし",
          speed: Number.isFinite(statusInfo?.speed) ? statusInfo.speed : null,
          latitude: statusInfo?.latitude ?? null,
          longitude: statusInfo?.longitude ?? null,
          isCommunicating: statusInfo?.isDeviceCommunicating ?? null,
          rawDevice: device,
          rawStatusInfo: statusInfo,
          rawFault: fault
        };
      })
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, normal: 2 };
        return order[a.level] - order[b.level] || a.id.localeCompare(b.id, "ja");
      });
  }

  function render() {
    renderPriority();
    renderTable();
    renderCounts();
  }

  function renderPriority() {
    if (!els.priorityGrid) return;
    const critical = vehicles.filter((vehicle) => vehicle.level === "critical").slice(0, 2);

    if (critical.length === 0) {
      els.priorityGrid.innerHTML = `
        <div class="priority-card">
          <div class="alert-badge">✓</div>
          <div class="priority-main">
            <h3>緊急対応が必要な車両はありません</h3>
            <p>直近${FAULT_LOOKBACK_HOURS}時間の故障情報を確認しています</p>
          </div>
        </div>`;
      return;
    }

    els.priorityGrid.innerHTML = critical.map((vehicle) => `
      <article class="priority-card">
        <div class="alert-badge">!</div>
        <div class="priority-main">
          <h3>${escapeHtml(vehicle.id)}　${escapeHtml(vehicle.title)}</h3>
          <p>${escapeHtml(vehicle.code)}</p>
        </div>
        <button class="row-button" type="button" data-open="${escapeHtml(vehicle.deviceId)}">
          異常を確認 →
        </button>
      </article>
    `).join("");
  }

  function filteredVehicles() {
    const query = (els.search?.value || "").trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const filterMatch = activeFilter === "all" || vehicle.level === activeFilter;
      const text = `${vehicle.id} ${vehicle.name} ${vehicle.driver} ${vehicle.title} ${vehicle.code}`.toLowerCase();
      return filterMatch && (!query || text.includes(query));
    });
  }

  function renderTable() {
    if (!els.tableBody) return;
    const rows = filteredVehicles();

    els.tableBody.innerHTML = rows.map((vehicle) => `
      <tr>
        <td>
          <div class="vehicle-name">${escapeHtml(vehicle.id)}</div>
          <div class="vehicle-sub">${escapeHtml(vehicle.name)}</div>
        </td>
        <td>
          <span class="status-pill status-pill--${escapeHtml(vehicle.level)}">
            <span class="dot dot--${levelDot[vehicle.level]}"></span>${escapeHtml(vehicle.status)}
          </span>
        </td>
        <td>${escapeHtml(vehicle.driver)}</td>
        <td>
          <div class="detail-title">${escapeHtml(vehicle.title)}</div>
          <div class="detail-code">${escapeHtml(vehicle.code)}</div>
        </td>
        <td>${escapeHtml(vehicle.updated)}</td>
        <td>
          <button class="chevron-button" type="button" aria-label="${escapeHtml(vehicle.id)}の詳細" data-open="${escapeHtml(vehicle.deviceId)}">›</button>
        </td>
      </tr>
    `).join("");

    if (els.empty) els.empty.hidden = rows.length !== 0;
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
  }

  function renderCounts() {
    const counts = {
      critical: vehicles.filter((vehicle) => vehicle.level === "critical").length,
      warning: vehicles.filter((vehicle) => vehicle.level === "warning").length,
      normal: vehicles.filter((vehicle) => vehicle.level === "normal").length
    };

    setText("allBadge", vehicles.length);
    setText("criticalBadge", counts.critical);
    setText("warningBadge", counts.warning);
    setText("normalBadge", counts.normal);
    setText("criticalCount", counts.critical);
    setText("warningCount", counts.warning);
    setText("activeCount", vehicles.filter((vehicle) => vehicle.isCommunicating !== false).length);
  }

  function openDrawer(deviceId) {
    const vehicle = vehicles.find((item) => item.deviceId === deviceId);
    if (!vehicle || !els.drawer || !els.backdrop || !els.drawerBody) return;

    if (els.drawerTitle) els.drawerTitle.textContent = vehicle.id;
    const speed = vehicle.speed === null ? "--" : `${Math.round(vehicle.speed)} km/h`;
    const coordinates = vehicle.latitude !== null && vehicle.longitude !== null
      ? `${Number(vehicle.latitude).toFixed(5)}, ${Number(vehicle.longitude).toFixed(5)}`
      : "位置情報なし";

    els.drawerBody.innerHTML = `
      <div class="drawer-status ${escapeHtml(vehicle.level)}">
        <p>現在の状態</p>
        <strong>${escapeHtml(vehicle.status)}：${escapeHtml(vehicle.title)}</strong>
        <p>${escapeHtml(vehicle.code)}</p>
      </div>
      <div class="detail-list">
        <div class="detail-item"><span>運転者</span><strong>${escapeHtml(vehicle.driver)}</strong></div>
        <div class="detail-item"><span>最終更新</span><strong>${escapeHtml(vehicle.updated)}</strong></div>
        <div class="detail-item"><span>稼働状態</span><strong>${escapeHtml(vehicle.operation)}</strong></div>
        <div class="detail-item"><span>速度</span><strong>${escapeHtml(speed)}</strong></div>
        <div class="detail-item"><span>点検状態</span><strong>${escapeHtml(vehicle.inspection)}</strong></div>
        <div class="detail-item"><span>位置</span><strong>${escapeHtml(coordinates)}</strong></div>
      </div>
      <div class="next-action">
        <h3>推奨する次の操作</h3>
        <ol>
          <li>故障・注意内容を確認</li>
          <li>過去の同一事象を確認</li>
          <li>整備または点検の要否を判断</li>
        </ol>
        <button id="recordActionButton" class="button button--primary drawer-action" type="button">対応を記録する</button>
      </div>`;

    els.backdrop.hidden = false;
    els.drawer.classList.add("is-open");
    els.drawer.setAttribute("aria-hidden", "false");

    setTimeout(() => {
      $("recordActionButton")?.addEventListener("click", () => {
        showToast("対応記録機能は次の実装ステップです");
      });
    }, 0);
  }

  function closeDrawer() {
    if (!els.drawer || !els.backdrop) return;
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      els.backdrop.hidden = true;
    }, 240);
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 2800);
  }

  async function refreshData() {
    if (els.refresh) {
      els.refresh.disabled = true;
      els.refresh.classList.add("is-spinning");
    }

    try {
      if (!api) {
        throw new Error("MyGeotab内からAdd-Inを開いてください。");
      }

      const now = new Date();
      const faultFromDate = new Date(
        now.getTime() - FAULT_LOOKBACK_HOURS * 60 * 60 * 1000
      );

      const devices = await geotabCall("Get", {
        typeName: "Device",
        search: {}
      });

      const deviceIds = (devices || []).map((device) => device.id).filter(Boolean);

      if (deviceIds.length === 0) {
        vehicles = [];
        render();
        if (els.updatedAt) els.updatedAt.textContent = formatTime(now);
        showToast("アクセス可能な車両がありません");
        return;
      }

      const [statusInfos, rawFaultData] = await Promise.all([
        geotabCall("Get", {
          typeName: "DeviceStatusInfo",
          search: {}
        }),
        geotabCall("Get", {
          typeName: "FaultData",
          search: {
            deviceSearch: { deviceIds },
            fromDate: faultFromDate.toISOString(),
            toDate: now.toISOString()
          }
        })
      ]);

      const faultData = await enrichFaultDetails(rawFaultData);
      vehicles = buildVehicles(devices, statusInfos, faultData);

      render();
      if (els.updatedAt) els.updatedAt.textContent = formatTime(now);
      showToast(`MyGeotabから${vehicles.length}台の車両を取得しました`);
    } catch (error) {
      console.error("MyGeotab data loading failed:", error);
      vehicles = [];
      render();
      showToast(error?.message || "MyGeotabのデータを取得できませんでした");
    } finally {
      if (els.refresh) {
        els.refresh.disabled = false;
        els.refresh.classList.remove("is-spinning");
      }
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const opener = event.target.closest("[data-open]");
      if (opener) openDrawer(opener.dataset.open);
    });

    els.search?.addEventListener("input", renderTable);

    document.querySelectorAll(".filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".filter-chip").forEach((item) => {
          item.classList.remove("is-active");
        });
        button.classList.add("is-active");
        activeFilter = button.dataset.filter || "all";
        renderTable();
      });
    });

    $("showCriticalButton")?.addEventListener("click", () => {
      document.querySelector('[data-filter="critical"]')?.click();
      document.querySelector(".fleet-panel")?.scrollIntoView({ behavior: "smooth" });
    });

    $("closeDrawerButton")?.addEventListener("click", closeDrawer);
    els.backdrop?.addEventListener("click", closeDrawer);
    els.refresh?.addEventListener("click", refreshData);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
    });
  }

  bindEvents();
  if (els.updatedAt) els.updatedAt.textContent = "--:--";
  render();

  window.geotab = window.geotab || {};
  window.geotab.addin = window.geotab.addin || {};
  window.geotab.addin.fleetDashboard = function () {
    return {
      initialize(freshApi, state, callback) {
        api = freshApi;
        callback();
      },
      focus(freshApi) {
        api = freshApi;
        refreshData();
      },
      blur() {
        closeDrawer();
      }
    };
  };
})();
