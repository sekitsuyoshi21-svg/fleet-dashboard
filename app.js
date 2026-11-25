(() => {
  "use strict";

  let api = null;
  let vehicles = [];        // 画面に表示する車両（選んだグループの車両だけ）
  let allVehicles = [];     // 読み込んだすべての車両
  let activeFilter = "all";

  // ---------- グループ（企業）の選択 ----------
  // MyGeotabのグループ。上位のグループを選ぶと、その下のグループの車両も含める。
  // 「GroupCompanyId」などGeotab標準の仕組み用グループは選択肢に出さない。
  const GROUP_STORAGE_KEY = "fleetGroup";
  let groupOptions = [];            // [{ id, name, depth, count }]
  let deviceGroups = new Map();     // deviceId → Set(所属グループと、その上位グループのID)
  let selectedGroup = "";
  try { selectedGroup = localStorage.getItem(GROUP_STORAGE_KEY) || ""; } catch (error) { /* 保存できない環境 */ }

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
    inspection: "要点検",
    warning: "要注意",
    review: "要確認",
    normal: "正常"
  };

  const levelDot = {
    critical: "red",
    inspection: "violet",
    warning: "amber",
    review: "blue",
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
　function formatElapsedTime(value) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();

  if (diffMs < 0) return "たった今";

  const minutes = Math.floor(diffMs / (60 * 1000));

  if (minutes < 1) {
    return "たった今";
  }

  if (minutes < 60) {
    return `${minutes}分前`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}時間前`;
  }

  const days = Math.floor(hours / 24);

  return `${days}日前`;
}
  function getCommunicationAgeLevel(value) {
  if (!value) return "unknown";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";

  const diffMs = Date.now() - date.getTime();
  const hours = diffMs / (60 * 60 * 1000);

  if (hours < 6) {
    return "recent";
  }

  if (hours < 24) {
    return "warning";
  }

  if (hours < 24 * 7) {
    return "stale";
  }

  return "critical";
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
　function getGeotabSession() {
  return new Promise((resolve, reject) => {
    if (!api || typeof api.getSession !== "function") {
      reject(new Error("MyGeotabセッションを取得できません。"));
      return;
    }

    api.getSession((session, server) => {
      if (!session?.database || !session?.userName || !session?.sessionId) {
        reject(new Error("MyGeotabセッション情報が不足しています。"));
        return;
      }

      resolve({
        session,
        server
      });
    });
  });
}

async function videoApiGet(typeName, search = {}) {
  const { session, server } = await getGeotabSession();

  const serverUrl = /^https?:\/\//i.test(server)
    ? server
    : `https://${server}`;
  
　console.warn("Video API params:", {
  typeName,
  ...search
});
  const response = await fetch(
    `${serverUrl.replace(/\/$/, "")}/apiv1`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        method: "Get",
       params: {
  typeName,
  credentials: {
    database: session.database,
    userName: session.userName,
    sessionId: session.sessionId
  },
  ...search
}
})
});
    
  if (!response.ok) {
    throw new Error(`Video API HTTPエラー: ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(
      result.error.message || "Video APIの呼び出しに失敗しました。"
    );
  }

  return result.result || [];
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
   function controllerText(diagnostic) {
    const controller = diagnostic?.controller;
    return [referenceId(controller), referenceName(controller)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  const KNOWN_DIAGNOSTICS = {
    "287": {
      category: "telematics",
      categoryLabel: "Geotab/テレマティクス",
      title: "テレマティクスデバイスの障害",
      detail: "エンジンとの通信に問題があります"
    },
    "292": {
      category: "telematics",
      categoryLabel: "Geotab/テレマティクス",
      title: "テレマティクスデバイスの障害",
      detail: "内部リセットが開始されました"
    },
    "678": {
      category: "camera",
      categoryLabel: "カメラ",
      title: "カメラが取り外されています",
      detail: "カメラの取り付け状態を確認してください"
    }
  };

  function getDiagnostic(fault) {
    return fault?.resolvedDiagnostic || fault?.diagnostic || null;
  }

  function getFailureMode(fault) {
    return fault?.resolvedFailureMode || fault?.failureMode || null;
  }

  function getDiagnosticCodeValue(fault) {
    const diagnostic = getDiagnostic(fault);

    if (
      diagnostic?.code !== undefined &&
      diagnostic?.code !== null &&
      diagnostic?.code !== ""
    ) {
      return String(diagnostic.code);
    }

    return "";
  }

  function getKnownDiagnostic(fault) {
    const code = getDiagnosticCodeValue(fault);
    return code ? KNOWN_DIAGNOSTICS[code] || null : null;
  }

  function isUnknownDiagnosticName(value) {
    if (!value) return true;

    const normalized = String(value).trim().toLowerCase();

    return (
      normalized === "unknown" ||
      normalized.includes("unknown diagnostic") ||
      normalized.includes("no diagnostic information") ||
      normalized.includes("no subtype information") ||
      normalized.includes("no sub type information") ||
      normalized.includes("詳細不明")
    );
  }

  function cleanDiagnosticName(value) {
    if (!value || isUnknownDiagnosticName(value)) return "";

    return String(value)
      .replace(/^\*+/, "")
      .replace(/\(no sub type information\)/gi, "")
      .replace(/\(no subtype information\)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
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
    function getDiagnosticCategory(fault) {
    if (!fault) {
      return {
        key: "none",
        label: "異常なし"
      };
    }

    const diagnostic = getDiagnostic(fault);
    const knownDiagnostic = getKnownDiagnostic(fault);
    const source = sourceText(diagnostic);
    const controller = controllerText(diagnostic);

    const description = [
      referenceId(diagnostic),
      referenceName(diagnostic),
      fault.faultDescription || "",
      fault.effectOnComponent || "",
      fault.recommendation || ""
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // OBD-II
    if (
      source.includes("sourceobdid") ||
      source.includes("sourceobdsaid") ||
      source.includes("obd") ||
      controller.includes("powertrain") ||
      controller.includes("body") ||
      controller.includes("chassis") ||
      controller.includes("network")
    ) {
      return {
        key: "obd",
        label: "OBD-II"
      };
    }

    // J1939
    if (
      source.includes("sourcej1939id") ||
      source.includes("j1939") ||
      description.includes("spn ") ||
      description.includes("fmi ")
    ) {
      return {
        key: "j1939",
        label: "J1939"
      };
    }

    // 287・292・678など、先ほど登録した既知コード
    if (knownDiagnostic) {
      return {
        key: knownDiagnostic.category,
        label: knownDiagnostic.categoryLabel
      };
    }

    // カメラ関連
    if (
      description.includes("camera") ||
      description.includes("video") ||
      description.includes("dismount") ||
      description.includes("dismounted") ||
      description.includes("lens") ||
      description.includes("dashcam") ||
      description.includes("カメラ") ||
      description.includes("映像")
    ) {
      return {
        key: "camera",
        label: "カメラ"
      };
    }

    // Geotab・テレマティクス関連
    if (
      description.includes("telematics") ||
      description.includes("テレマティクス") ||
      description.includes("firmware") ||
      description.includes("ファームウェア") ||
      description.includes("internal reset") ||
      description.includes("内部リセット") ||
      description.includes("can bus") ||
      description.includes("device reset") ||
      description.includes("go device")
    ) {
      return {
        key: "telematics",
        label: "Geotab/テレマティクス"
      };
    }

    // どれにも該当しない場合
    return {
      key: "other",
      label: "その他"
    };
  }
    function getFaultCode(fault) {
    if (!fault) return "";

    const diagnostic = getDiagnostic(fault);
    const failureMode = getFailureMode(fault);

    const obdCode = formatObdCode(diagnostic);
    if (obdCode) return obdCode;

    const j1939Code = formatJ1939Code(diagnostic, failureMode);
    if (j1939Code) return j1939Code;

    const diagnosticCode = getDiagnosticCodeValue(fault);

    if (diagnosticCode) {
      return `診断コード ${diagnosticCode}`;
    }

    const diagnosticId = referenceId(fault.diagnostic);

    return diagnosticId
      ? `Diagnostic ID: ${diagnosticId}`
      : "";
  }

    function getFaultDescription(fault) {
    if (!fault) {
      return "現在確認できる故障はありません";
    }

    const diagnostic = getDiagnostic(fault);
    const failureMode = getFailureMode(fault);
    const knownDiagnostic = getKnownDiagnostic(fault);

    const diagnosticName = cleanDiagnosticName(
      referenceName(diagnostic)
    );

    const failureModeName = cleanDiagnosticName(
      referenceName(failureMode)
    );

    const faultDescription = cleanDiagnosticName(
      fault.faultDescription
    );

    const effectOnComponent = cleanDiagnosticName(
      fault.effectOnComponent
    );

    const recommendation = cleanDiagnosticName(
      fault.recommendation
    );

    // MyGeotabから有効な故障説明が返っている場合
    if (faultDescription) {
      return faultDescription;
    }

    // 287、292、678など登録済みの診断コード
    if (knownDiagnostic) {
      return knownDiagnostic.detail
        ? `${knownDiagnostic.title}: ${knownDiagnostic.detail}`
        : knownDiagnostic.title;
    }

    if (diagnosticName && failureModeName) {
      return `${diagnosticName}（${failureModeName}）`;
    }

    if (diagnosticName) {
      return diagnosticName;
    }

    if (effectOnComponent) {
      return effectOnComponent;
    }

    if (failureModeName) {
      return `故障モード：${failureModeName}`;
    }

    if (recommendation) {
      return recommendation;
    }

    // Unknown Diagnosticだった場合の表示
    const category = getDiagnosticCategory(fault);
    const faultCode = getFaultCode(fault);

    if (category.key === "obd") {
      return faultCode
        ? `OBD-II診断コード ${faultCode}を検出しました`
        : "OBD-II診断情報を検出しました";
    }

    if (category.key === "j1939") {
      return faultCode
        ? `J1939診断コード ${faultCode}を検出しました`
        : "J1939診断情報を検出しました";
    }

    if (category.key === "camera") {
      return "カメラに関する診断情報を検出しました";
    }

    if (category.key === "telematics") {
      return "テレマティクスデバイスの診断情報を検出しました";
    }

    const diagnosticId = referenceId(fault.diagnostic);

    return diagnosticId
      ? `診断情報を検出しました（${diagnosticId}）`
      : "詳細を確認できない診断情報があります";
  }
  
  // =====================================================================
  // 故障の説明と対応の目安（v1.2.0）
  //   now   : すぐ点検（安全や走行に関わる可能性）
  //   soon  : 近いうちに点検（数日〜1週間以内に整備工場で確認）
  //   watch : 様子見でよい（走行に影響しないことが多い。続く場合だけ確認）
  // =====================================================================
  const ADVICE_LABEL = { now: "すぐ点検", soon: "近いうちに点検", watch: "様子見でよい" };

  // Geotab独自の診断コード（GOデバイス・カメラ）の説明
  const KNOWN_ADVICE = {
    "292": {
      level: "watch",
      explain: "テレマティクス機器（GOデバイス）が自動で再起動したという記録です。車両の走行や安全には影響ありません。",
      action: "対応は不要です。毎日何度も続く場合は、機器の電源や取り付けを販売店に確認してもらってください。"
    },
    "287": {
      level: "watch",
      explain: "GOデバイスが車両のコンピューターとうまく通信できていません。走行には影響ありませんが、故障コードや燃費などのデータが取れなくなります。",
      action: "数日続く場合は、機器の取り付け（車両側のコネクターとの接続）を販売店に点検してもらってください。",
      escalateDays: 3
    },
    "678": {
      level: "soon",
      explain: "カメラが外れているか、取り付け位置がずれています。この状態では映像が正しく記録されません。",
      action: "カメラの取り付け状態を確認し、外れていれば取り付け直してください。"
    }
  };

  // OBD-II（乗用車・小型車）の故障コードの系統
  function obdAdvice(code) {
    const letter = code.charAt(0);
    const group = code.slice(1, 3);
    if (letter === "P") {
      if (group === "03") return { level: "soon", explain: `エンジンの失火（点火の異常）を示すコード（${code}）です。エンジンの不調や触媒の損傷につながることがあります。` };
      if (["07", "08", "09"].includes(group)) return { level: "soon", explain: `変速機（トランスミッション）に関するコード（${code}）です。` };
      if (["01", "02"].includes(group)) return { level: "soon", explain: `燃料や吸気（空気の量）の制御に関するコード（${code}）です。燃費の悪化やエンジン不調の原因になることがあります。` };
      if (group === "04") return { level: "soon", explain: `排気ガスの浄化装置に関するコード（${code}）です。` };
      if (group === "05") return { level: "watch", explain: `車速・アイドリング制御に関するコード（${code}）です。` };
      if (group === "06") return { level: "soon", explain: `エンジン制御コンピューター（ECU）に関するコード（${code}）です。` };
      return { level: "soon", explain: `エンジン・駆動系に関する故障コード（${code}）です。` };
    }
    if (letter === "C") return { level: "soon", explain: `ブレーキ・ABS・足まわりなど車体の制御に関するコード（${code}）です。` };
    if (letter === "B") return { level: "watch", explain: `エアバッグ・エアコン・ドアなど車内の装備に関するコード（${code}）です。エアバッグに関係する場合は早めに点検してください。` };
    if (letter === "U") return { level: "watch", explain: `車両の中のコンピューター同士の通信に関するコード（${code}）です。ほかのコードと一緒に出ている場合は点検してください。` };
    return null;
  }

  // J1939（トラック・バス）の故障モード（FMI）の意味
  const FMI_TEXT = {
    0: "値が高すぎる（重度）", 1: "値が低すぎる（重度）", 2: "データが不安定・不正確", 3: "電圧が高い（配線の短絡の可能性）",
    4: "電圧が低い（配線の断線の可能性）", 5: "電流が少ない・断線", 6: "電流が多い・短絡", 7: "機械が正しく動いていない",
    8: "信号の周期が異常", 9: "データの更新が遅い", 10: "値の変化が急すぎる", 11: "原因不明の故障", 12: "部品や装置の故障",
    13: "調整（キャリブレーション）が必要", 14: "特殊な指示", 15: "値がやや高い（軽度）", 16: "値がやや高い（中度）",
    17: "値がやや低い（軽度）", 18: "値がやや低い（中度）", 19: "通信データの異常", 31: "条件が発生中"
  };

  function getAdvice(fault, history, statusInfo) {
    // 故障情報はないが通信していない車両
    if (!fault) {
      if (statusInfo?.isDeviceCommunicating === false) {
        return {
          level: "watch",
          explain: "車両と通信できていません。車両が長く止まっている、またはGOデバイスの電源・電波の状態に問題がある可能性があります。",
          action: "車両を使っているのに数日通信がない場合は、GOデバイスの取り付けを販売店に確認してもらってください。"
        };
      }
      return null;
    }

    const diagnostic = getDiagnostic(fault);
    const failureMode = getFailureMode(fault);
    const code = getDiagnosticCodeValue(fault);
    const category = getDiagnosticCategory(fault);
    const days = history?.consecutiveDays || 1;
    let advice = null;

    // 1. 警告灯（いちばん優先）
    if (fault.redStopLamp === true) {
      advice = { level: "now", explain: "赤色の停止警告灯が点灯しています。重大な故障の可能性があります。", action: "安全な場所に停車し、すぐに整備工場へ連絡してください。" };
    } else if (fault.malfunctionLamp === true) {
      advice = { level: "now", explain: "エンジン警告灯（チェックランプ）が点灯しています。エンジンや排気ガス制御の異常の可能性があります。", action: "できるだけ早く（当日〜数日以内に）整備工場で点検してください。" };
    }

    // 2. Geotab独自のコード（GOデバイス・カメラ）
    if (!advice && category.key !== "obd" && category.key !== "j1939" && KNOWN_ADVICE[code]) {
      const known = KNOWN_ADVICE[code];
      advice = { level: known.level, explain: known.explain, action: known.action };
      if (known.escalateDays && days >= known.escalateDays) advice.level = "soon";
    }

    // 3. 排気ガス浄化装置（尿素SCR・AdBlue）
    if (!advice && classifyVehicle(fault, statusInfo) === "inspection") {
      advice = { level: "soon", explain: "排気ガスを浄化する装置（尿素SCR・AdBlue）の異常の可能性があります。放置すると、エンジンの出力が制限されることがあります。", action: "AdBlue（尿素水）の残量を確認し、近いうちに整備工場で点検してください。" };
    }

    // 4. エンジンの故障コード（OBD-II / J1939）
    if (!advice && category.key === "obd") {
      const obdCode = formatObdCode(diagnostic);
      const obd = obdCode ? obdAdvice(obdCode) : null;
      advice = obd
        ? { level: obd.level, explain: obd.explain, action: obd.level === "soon" ? "近いうちに整備工場で故障コードを読み取り、点検してください。" : "走行に影響がなければ様子見でかまいません。続く場合は次の点検時に確認してください。" }
        : { level: "soon", explain: "エンジン・車両の故障コード（OBD-II）が記録されています。", action: "近いうちに整備工場で故障コードを読み取り、点検してください。" };
    }
    if (!advice && category.key === "j1939") {
      const fmi = Number(failureMode?.code);
      const fmiText = Number.isFinite(fmi) && FMI_TEXT[fmi] ? `故障の内容は「${FMI_TEXT[fmi]}」です。` : "";
      const level = [15, 17, 31].includes(fmi) ? "watch" : "soon";
      advice = {
        level,
        explain: `トラック・バスの車両コンピューター（J1939）が故障を記録しています。${fmiText}`,
        action: level === "soon" ? "近いうちに整備工場で故障コード（SPN・FMI）を伝えて点検してください。" : "軽度の異常です。続く場合は次の点検時に確認してください。"
      };
    }

    // 5. 黄色の警告灯
    if (!advice && (fault.amberWarningLamp === true || fault.protectWarningLamp === true)) {
      advice = { level: "soon", explain: "黄色の警告灯が点灯しています。", action: "近いうちに整備工場で点検してください。" };
    }

    // 6. カメラ・テレマティクス・その他
    if (!advice && category.key === "camera") {
      advice = { level: "soon", explain: "カメラ（ドライブレコーダー）の異常が記録されています。映像が正しく記録されていない可能性があります。", action: "カメラの取り付けや配線の状態を確認してください。" };
    }
    if (!advice && category.key === "telematics") {
      advice = { level: "watch", explain: "テレマティクス機器（GOデバイス）の状態に関する記録です。走行には影響しないことがほとんどです。", action: "続く場合は販売店に確認してください。" };
    }
    if (!advice) {
      advice = { level: "watch", explain: "車両の診断情報が記録されています。", action: "続く場合や、ほかの警告と一緒に出ている場合は点検してください。" };
    }

    // 7. 長く続いている場合は目安を1段階上げる（内部リセット292は除く）
    if (advice.level === "watch" && days >= 7 && code !== "292") {
      advice.level = "soon";
      advice.action = `${days}日続いているため、一度点検してください。` + (advice.action ? " " + advice.action : "");
    }
    return advice;
  }

  // ---------- 故障の継続日数（直近30日） ----------
  const HISTORY_DAYS = 30;
  const JST_MS = 9 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  function jstDayIndex(value) { return Math.floor((new Date(value).getTime() + JST_MS) / DAY_MS); }
  function formatMonthDay(dayIndex) { const d = new Date(dayIndex * DAY_MS); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; }
  function faultKey(fault) { return `${referenceId(fault.device)}|${referenceId(fault.diagnostic)}|${referenceId(fault.failureMode)}`; }

  // 車両×故障の種類ごとに、記録された日・回数をまとめる
  function buildFaultHistory(faults) {
    const map = new Map();
    for (const fault of faults || []) {
      if (!fault.dateTime) continue;
      const key = faultKey(fault);
      const day = jstDayIndex(fault.dateTime);
      const item = map.get(key) || { days: new Set(), count: 0, first: Infinity, last: -Infinity };
      item.days.add(day);
      item.count += 1;
      item.first = Math.min(item.first, new Date(fault.dateTime).getTime());
      item.last = Math.max(item.last, new Date(fault.dateTime).getTime());
      map.set(key, item);
    }
    for (const item of map.values()) {
      // 最後に記録された日から、さかのぼって毎日続いている日数
      const lastDay = jstDayIndex(item.last);
      let consecutive = 0;
      while (item.days.has(lastDay - consecutive)) consecutive += 1;
      item.consecutiveDays = consecutive;
      item.startDay = lastDay - consecutive + 1;
      item.totalDays = item.days.size;
    }
    return map;
  }

  function historyText(history) {
    if (!history) return "";
    const run = history.consecutiveDays >= 2 ? `${history.consecutiveDays}日連続（${formatMonthDay(history.startDay)}〜）` : "今日（または直近）だけ";
    return `${run}・${HISTORY_DAYS}日間で${history.totalDays}日／${history.count}回`;
  }

  // ---------- 走行距離・エンジン稼働時間 ----------
  // 補正後の値（Adjustment）を優先し、なければ車両から読み取った値を使う
  const METER_DIAGNOSTICS = {
    odometer: ["DiagnosticOdometerAdjustmentId", "DiagnosticOdometerId"],
    engineHours: ["DiagnosticEngineHoursAdjustmentId", "DiagnosticEngineHoursId"]
  };
  function geotabMultiCall(calls) {
    return new Promise((resolve, reject) => {
      if (!api || typeof api.multiCall !== "function") { reject(new Error("multiCallが使えません")); return; }
      api.multiCall(calls, resolve, reject);
    });
  }
  async function loadMeters(deviceIds) {
    const nowIso = new Date().toISOString();
    const keys = [];
    const calls = [];
    for (const deviceId of deviceIds) {
      for (const [kind, ids] of Object.entries(METER_DIAGNOSTICS)) {
        ids.forEach((diagnosticId) => {
          keys.push({ deviceId, kind, diagnosticId });
          // fromDate と toDate を同じにすると、その時点の最新の値が返る
          calls.push(["Get", { typeName: "StatusData", search: { deviceSearch: { id: deviceId }, diagnosticSearch: { id: diagnosticId }, fromDate: nowIso, toDate: nowIso } }]);
        });
      }
    }
    const meters = new Map();
    const CHUNK = 100;
    for (let i = 0; i < calls.length; i += CHUNK) {
      let results = [];
      try { results = await geotabMultiCall(calls.slice(i, i + CHUNK)); } catch (error) { console.warn("走行距離・稼働時間を取得できませんでした。", error); continue; }
      results.forEach((list, j) => {
        const { deviceId, kind, diagnosticId } = keys[i + j];
        const value = (list || []).map((s) => s.data).find((v) => Number.isFinite(v));
        if (!Number.isFinite(value)) return;
        const entry = meters.get(deviceId) || {};
        const priority = METER_DIAGNOSTICS[kind].indexOf(diagnosticId);
        if (entry[kind] === undefined || priority < entry[kind + "Priority"]) {
          entry[kind] = value; entry[kind + "Priority"] = priority;
        }
        meters.set(deviceId, entry);
      });
    }
    return meters;
  }
  function formatOdometer(meters) { return Number.isFinite(meters) ? `${Math.round(meters / 1000).toLocaleString("ja-JP")} km` : ""; }
  function formatEngineHours(seconds) { return Number.isFinite(seconds) ? `${Math.round(seconds / 3600).toLocaleString("ja-JP")} 時間` : ""; }

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
// 通信していない車両は「要注意」
if (!fault && statusInfo?.isDeviceCommunicating === false) {
return "warning";
}
 
if (!fault) {
return "normal";
}
 
const diagnostic = getDiagnostic(fault);
const category = getDiagnosticCategory(fault);
const code = String(diagnostic?.code ?? "");
const severity = severityText(fault);
 
const severeLamp =
fault.redStopLamp === true ||
fault.malfunctionLamp === true;
 
const warningLamp =
fault.amberWarningLamp === true ||
fault.protectWarningLamp === true;
 
// 🔴 重大故障
if (
severeLamp ||
severity.includes("critical") ||
severity.includes("severe") ||
severity.includes("high")
) {
return "critical";
}

// 🟣 要点検：SCR / NOx / 排気後処理系
    const diagnosticText = [
      referenceName(diagnostic),
      fault.faultDescription || "",
      fault.effectOnComponent || "",
      fault.recommendation || ""
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (
      diagnosticText.includes("scr nox") ||
      diagnosticText.includes("catalyst efficiency") ||
      diagnosticText.includes("触媒効率") ||
      diagnosticText.includes("nox触媒") ||
      diagnosticText.includes("nox catalyst") ||
      diagnosticText.includes("def system") ||
      diagnosticText.includes("adblue")
    ) {
      return "inspection";
    }

// 🔵 カメラ関連
if (category.key === "camera") {
return "review";
}
 
// 🔵 Geotab / テレマティクスの情報系
if (
category.key === "telematics" &&
["132", "287", "292"].includes(code)
) {
return "review";
}
 
// 🟠 警告ランプ
if (warningLamp) {
return "warning";
}
 
// 🟠 OBD-II / J1939故障
if (
category.key === "obd" ||
category.key === "j1939"
) {
return "warning";
}
 
// 🟠 その他の故障
return "warning";
}
  
  function operationLabel(statusInfo) {
    if (!statusInfo) return "状態不明";
    if (statusInfo.isDeviceCommunicating === false) return "通信なし";
    return statusInfo.isDriving === true ? "走行中" : "停止中";
  }

  // faultData：直近24時間の故障（状態の判定用） / faultHistory：直近30日の故障のまとめ / meters：走行距離・稼働時間
  function buildVehicles(devices, statusInfos, faultData, faultHistory, meters) {
    const statusByDevice = new Map();
    const latestFaultByDevice = new Map();
    const faultCountByDevice = new Map();

    for (const statusInfo of statusInfos || []) {
      const deviceId = referenceId(statusInfo.device);
      if (deviceId) statusByDevice.set(deviceId, statusInfo);
    }

    const sortedFaults = [...(faultData || [])].sort(
      (a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0)
    );

    for (const fault of sortedFaults) {
  const deviceId = referenceId(fault.device);

  if (!deviceId) continue;

  // 車両ごとの過去24時間の故障件数をカウント
  faultCountByDevice.set(
    deviceId,
    (faultCountByDevice.get(deviceId) || 0) + 1
  );

  // 各車両の最新の故障を保存
  if (!latestFaultByDevice.has(deviceId)) {
    latestFaultByDevice.set(deviceId, fault);
  }
}

    return (devices || [])
      .filter((device) => device && device.id)
      .map((device) => {
        const statusInfo = statusByDevice.get(device.id) || null;
        const fault = latestFaultByDevice.get(device.id) || null;
        const faultCount = faultCountByDevice.get(device.id) || 0;
        let actionRecord = null;

try {
  const savedAction = localStorage.getItem(
    `fleetAction_${device.id}`
  );

  if (savedAction) {
    actionRecord = JSON.parse(savedAction);
  }
} catch (error) {
  console.warn("対応記録の読み込みに失敗しました。", error);
}
        const actionStatus = actionRecord?.status || "未対応";
        const level = classifyVehicle(fault, statusInfo);
        const history = fault && faultHistory ? faultHistory.get(faultKey(fault)) || null : null;
        const advice = getAdvice(fault, history, statusInfo);
        const meter = meters?.get(device.id) || {};
        
        const diagnosticCategory =
          !fault && statusInfo?.isDeviceCommunicating === false
            ? {
              key: "communication",
              label: "通信異常"
              }
            : getDiagnosticCategory(fault);
        
        const description =
          getFaultDescription(fault);
        
        const faultCode =
          getFaultCode(fault);

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
          faultCount,
          actionStatus,
         status: levelLabel[level],
          
         diagnosticCategory:
          diagnosticCategory.key,
         
         diagnosticCategoryLabel:
           diagnosticCategory.label,

            title,
            code,
         updated: formatTime(fault?.dateTime || statusInfo?.dateTime),
elapsed: formatElapsedTime(fault?.dateTime || statusInfo?.dateTime),
communicationAgeLevel: getCommunicationAgeLevel(
  statusInfo?.dateTime
),
operation: operationLabel(statusInfo),
          inspection: fault ? "確認が必要" : "異常なし",
          advice,                                   // 説明と対応の目安 { level, explain, action }
          history,                                  // 継続日数 { consecutiveDays, totalDays, count, startDay }
          odometer: meter.odometer ?? null,         // 走行距離（メートル）
          engineHours: meter.engineHours ?? null,   // エンジン稼働時間（秒）
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
        const order = { critical: 0, inspection: 1, warning: 2, review: 3, normal: 4 };
        return order[a.level] - order[b.level] || a.id.localeCompare(b.id, "ja");
      });
  }

  function render() {
    renderPriority();
    renderTable();
    renderCounts();
  }

  // グループの一覧と、車両ごとの所属グループ（上位グループも含む）を作る
  function buildGroups(groupList, devices) {
    const byId = new Map();
    const parent = new Map();
    (groupList || []).forEach((group) => {
      byId.set(group.id, {
        id: group.id,
        name: group.name || group.id,
        children: (group.children || []).map(referenceId).filter(Boolean)
      });
    });
    byId.forEach((group) => group.children.forEach((childId) => parent.set(childId, group.id)));

    deviceGroups = new Map();
    const count = new Map();
    (devices || []).forEach((device) => {
      const set = new Set();
      (device.groups || []).map(referenceId).forEach((groupId) => {
        for (let id = groupId, guard = 0; id && guard < 30; id = parent.get(id), guard++) set.add(id);
      });
      deviceGroups.set(device.id, set);
      set.forEach((id) => count.set(id, (count.get(id) || 0) + 1));
    });

    const isBuiltin = (id) => /^Group\w*Id$/.test(id);
    groupOptions = [];
    const walk = (id, depth) => {
      const group = byId.get(id);
      if (!group) return;
      const show = !isBuiltin(id) && count.get(id) > 0;
      if (show) groupOptions.push({ id, name: group.name, depth, count: count.get(id) });
      group.children
        .map((childId) => byId.get(childId))
        .filter(Boolean)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"))
        .forEach((child) => walk(child.id, show ? depth + 1 : depth));
    };
    [...byId.values()].filter((group) => !parent.has(group.id)).forEach((group) => walk(group.id, 0));
  }

  function inSelectedGroup(deviceId) {
    return !selectedGroup || Boolean(deviceGroups.get(deviceId)?.has(selectedGroup));
  }

  function applyGroupFilter() {
    // 選んでいたグループがなくなっていたら「すべて」に戻す
    if (selectedGroup && !groupOptions.some((group) => group.id === selectedGroup)) selectedGroup = "";
    vehicles = allVehicles.filter((vehicle) => inSelectedGroup(vehicle.deviceId));
  }

  function renderGroupSelect() {
    const select = $("groupSelect");
    if (!select) return;
    select.innerHTML = `<option value="">すべてのグループ（${allVehicles.length}台）</option>` +
      groupOptions.map((group) =>
        `<option value="${escapeHtml(group.id)}">${"　".repeat(group.depth)}${escapeHtml(group.name)}（${group.count}台）</option>`
      ).join("");
    select.value = selectedGroup;
    select.disabled = groupOptions.length === 0;
    select.closest(".group-select")?.classList.toggle("is-active", Boolean(selectedGroup));
  }

  function selectedGroupName() {
    return groupOptions.find((group) => group.id === selectedGroup)?.name || "";
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
      const filterMatch =
  　　　activeFilter === "all"
    　　　? true
    　　　: activeFilter === "pending"
      　　　? vehicle.actionStatus === "未対応" &&
  vehicle.level !== "normal" &&
  getDiagnosticCodeValue(vehicle.rawFault) !== "292"
     　　　 : vehicle.level === activeFilter;
      
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
          ${meterText(vehicle) ? `<div class="vehicle-meter">${escapeHtml(meterText(vehicle))}</div>` : ""}
        </td>
        <td>
          <span class="status-pill status-pill--${escapeHtml(vehicle.level)}">
            <span class="dot dot--${levelDot[vehicle.level]}"></span>${escapeHtml(vehicle.status)}
          </span>
          ${vehicle.level !== "normal" &&
  getDiagnosticCodeValue(vehicle.rawFault) !== "292" ? `
  <span class="action-status action-status--${vehicle.actionStatus === "対応済み" ? "done" : vehicle.actionStatus === "対応中" ? "progress" : "pending"}">
    ${vehicle.actionStatus === "対応済み" ? "✓ " : vehicle.actionStatus === "対応中" ? "● " : "○ "}
    ${escapeHtml(vehicle.actionStatus)}
  </span>
` : ""}
        </td>
        <td>${escapeHtml(vehicle.driver)}</td>
        <td>
          <div class="detail-title">${escapeHtml(vehicle.title)}</div>
         <div class="detail-code">
  [${escapeHtml(vehicle.diagnosticCategoryLabel)}]
  ${escapeHtml(vehicle.code)}
</div>
${vehicle.faultCount > 0
  ? `<div class="fault-frequency ${
      vehicle.faultCount >= 10
        ? "fault-frequency--high"
        : vehicle.faultCount >= 3
          ? "fault-frequency--medium"
          : "fault-frequency--low"
    }">⚠ ${FAULT_LOOKBACK_HOURS}時間で${vehicle.faultCount}回発生</div>`
  : ""}
${vehicle.advice && vehicle.rawFault ? `
          <div class="advice-line">
            <span class="advice-badge advice-badge--${vehicle.advice.level}">${ADVICE_LABEL[vehicle.advice.level]}</span>
            ${vehicle.history ? `<span class="advice-history${vehicle.history.consecutiveDays >= 3 ? " is-long" : ""}">${escapeHtml(historyText(vehicle.history))}</span>` : ""}
          </div>` : ""}
        </td>
        <td>
 <div>${escapeHtml(vehicle.updated)}</div>
<div class="vehicle-sub ${
  vehicle.isCommunicating === false
    ? `communication-age communication-age--${vehicle.communicationAgeLevel}`
    : ""
}">
  ${escapeHtml(
    vehicle.isCommunicating === false
      ? `最終通信 ${vehicle.elapsed}`
      : vehicle.elapsed
  )}
</div>
</td>
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
      inspection: vehicles.filter((vehicle) => vehicle.level === "inspection").length,
      warning: vehicles.filter((vehicle) => vehicle.level === "warning").length,
      review: vehicles.filter((vehicle) => vehicle.level === "review").length,
      normal: vehicles.filter((vehicle) => vehicle.level === "normal").length
    };

    setText("allBadge", vehicles.length);
    setText("criticalBadge", counts.critical);
    setText("inspectionBadge", counts.inspection);
    setText("warningBadge", counts.warning);
    setText("reviewBadge", counts.review);
    setText("normalBadge", counts.normal);
    setText("criticalCount", counts.critical);
    setText("warningCount", counts.warning);
    setText("activeCount", vehicles.filter((vehicle) => vehicle.isCommunicating !== false).length);
    setText("totalCount", vehicles.length);
    // 故障が3日以上続いている車両（「様子見でよい」の故障は除く）
    setText("inspectionCount", vehicles.filter(isLongFault).length);
  }

  function isLongFault(vehicle) {
    return Boolean(vehicle.rawFault && vehicle.history && vehicle.history.consecutiveDays >= 3 &&
      vehicle.advice && vehicle.advice.level !== "watch");
  }

  function meterText(vehicle) {
    return [formatOdometer(vehicle.odometer), vehicle.engineHours !== null ? "稼働 " + formatEngineHours(vehicle.engineHours) : ""]
      .filter(Boolean).join("・");
  }
　async function getApproximateLocation(latitude, longitude, isMoving = false) {
  if (latitude === null || longitude === null) {
    return "位置情報なし";
  }

  try {
    const addresses = await geotabCall("GetAddresses", {
      coordinates: [
        {
          x: Number(longitude),
          y: Number(latitude)
        }
      ],
      movingAddresses: isMoving
    });

    if (!addresses || !addresses.length) {
      return "地域情報を取得できません";
    }

    const address = addresses[0];

   if (address.formattedAddress) {
  const formatted = address.formattedAddress
    .replace(/^日本、?\s*/, "")
    .replace(/〒\s*\d{3}-\d{4}\s*/, "")
    .trim();

  const match = formatted.match(
    /^(.+?[都道府県])(.+?市)?(.+?区)?/
  );

  if (match) {
    const prefecture = match[1] || "";
    const city = match[2] || "";
    const ward = match[3] || "";

    return `${prefecture}${city}${ward}付近`;
  }

  return `${formatted}付近`;
}

return (
  address.city
    ? `${address.city}付近`
    : address.street || "地域情報を取得できません"
);
    
  } catch (error) {
    console.warn("住所情報の取得に失敗しました。", error);
    return "地域情報を取得できません";
  }
}

function openVehicleOnMap(deviceId) {
  if (!deviceId) return;

  const baseUrl = window.location.href.split("#")[0];
  const mapUrl = `${baseUrl}#map,liveVehicleIds:!(${deviceId})`;

  window.top.location.href = mapUrl;
}
  
  async function openDrawer(deviceId) {
    const vehicle = vehicles.find((item) => item.deviceId === deviceId);
    if (!vehicle || !els.drawer || !els.backdrop || !els.drawerBody) return;

  let actionRecord = null;

  try {
    const savedAction = localStorage.getItem(
      `fleetAction_${vehicle.deviceId}`
    );

    if (savedAction) {
      actionRecord = JSON.parse(savedAction);
    }
  } catch (error) {
    console.warn("対応記録の読み込みに失敗しました。", error);
  }

    if (els.drawerTitle) els.drawerTitle.textContent = vehicle.id;
    const speed = vehicle.speed === null ? "--" : `${Math.round(vehicle.speed)} km/h`;
    const approximateLocation = await getApproximateLocation(
    vehicle.latitude,
    vehicle.longitude,
    vehicle.speed !== null && vehicle.speed > 0
  );

    els.drawerBody.innerHTML = `
      <div class="drawer-status ${escapeHtml(vehicle.level)}">
        <p>現在の状態</p>
        <strong>${escapeHtml(vehicle.status)}：${escapeHtml(vehicle.title)}</strong>
        <p>${escapeHtml(vehicle.code)}</p>
      </div>
      ${vehicle.advice ? `
      <div class="advice-box advice-box--${vehicle.advice.level}">
        <div class="advice-box-head">
          <span class="advice-badge advice-badge--${vehicle.advice.level}">${ADVICE_LABEL[vehicle.advice.level]}</span>
          <h3>${vehicle.rawFault ? "この故障について" : "この車両について"}</h3>
        </div>
        <p class="advice-explain">${escapeHtml(vehicle.advice.explain)}</p>
        ${vehicle.advice.action ? `<p class="advice-action"><b>対応の目安：</b>${escapeHtml(vehicle.advice.action)}</p>` : ""}
        ${vehicle.history ? `<p class="advice-history-detail">続いている期間：${escapeHtml(historyText(vehicle.history))}</p>` : ""}
        <p class="advice-note">※ 目安は故障コードの種類と警告灯の状態から判断したものです。最終的な判断は整備工場にご相談ください。</p>
      </div>` : ""}
      <div class="detail-list">
      <div class="detail-item">
      <span>診断分類</span>
      <strong>${escapeHtml(vehicle.diagnosticCategoryLabel)}</strong>
      </div>
      
      　<div class="detail-item"><span>発生回数</span><strong>${vehicle.faultCount}回 / 過去${FAULT_LOOKBACK_HOURS}時間</strong></div>
        <div class="detail-item"><span>運転者</span><strong>${escapeHtml(vehicle.driver)}</strong></div>
        <div class="detail-item"><span>最終更新</span><strong>${escapeHtml(vehicle.updated)}</strong></div>
        <div class="detail-item"><span>稼働状態</span><strong>${escapeHtml(vehicle.operation)}</strong></div>
        <div class="detail-item"><span>速度</span><strong>${escapeHtml(speed)}</strong></div>
        <div class="detail-item"><span>点検状態</span><strong>${escapeHtml(vehicle.inspection)}</strong></div>
        <div class="detail-item"><span>走行距離</span><strong>${escapeHtml(formatOdometer(vehicle.odometer) || "データなし")}</strong></div>
        <div class="detail-item"><span>エンジン稼働時間</span><strong>${escapeHtml(formatEngineHours(vehicle.engineHours) || "データなし")}</strong></div>
        <div class="detail-item">
  <span>位置</span>
  <button
    id="openMapButton"
    class="location-link"
    type="button"
  >
    📍 ${escapeHtml(approximateLocation)} ＞
  </button>
</div>
      </div>
      ${actionRecord ? `
  <div class="action-record">
    <h3>対応記録</h3>
    <div class="detail-list">
      <div class="detail-item"><span>対応状況</span><strong>${escapeHtml(actionRecord.status)}</strong></div>
      <div class="detail-item"><span>担当者</span><strong>${escapeHtml(actionRecord.person)}</strong></div>
      <div class="detail-item"><span>対応内容</span><strong>${escapeHtml(actionRecord.content)}</strong></div>
      ${actionRecord.memo
        ? `<div class="detail-item"><span>メモ</span><strong>${escapeHtml(actionRecord.memo)}</strong></div>`
        : ""}
      <div class="detail-item"><span>記録日時</span><strong>${escapeHtml(new Date(actionRecord.recordedAt).toLocaleString("ja-JP"))}</strong></div>
    </div>
  </div>
` : ""}
      <div class="next-action">
        <h3>推奨する次の操作</h3>
        <ol>
          <li>故障・注意内容を確認</li>
          <li>過去の同一事象を確認</li>
          <li>整備または点検の要否を判断</li>
        </ol>
        <button id="recordActionButton" class="button button--primary drawer-action" type="button">${actionRecord ? "対応内容を編集する" : "対応を記録する"}</button>
      </div>`;

    els.backdrop.hidden = false;
    els.drawer.classList.add("is-open");
    els.drawer.setAttribute("aria-hidden", "false");

    $("openMapButton")?.addEventListener("click", () => {
  openVehicleOnMap(vehicle.deviceId);
});
    
    setTimeout(() => {
      $("recordActionButton")?.addEventListener("click", () => {
        openActionForm(vehicle);
      });
    }, 0);
  }
　function openActionForm(vehicle) {
  if (!els.drawerBody) return;
　let savedRecord = null;

  try {
    const savedAction = localStorage.getItem(
      `fleetAction_${vehicle.deviceId}`
    );

    if (savedAction) {
      savedRecord = JSON.parse(savedAction);
    }
  } catch (error) {
    console.warn("対応記録の読み込みに失敗しました。", error);
  }
  const now = new Date();
  const recordedAt = now.toLocaleString("ja-JP");
  
　const previousRecordedAt = savedRecord?.recordedAt
  ? new Date(savedRecord.recordedAt).toLocaleString("ja-JP")
  : "";
   
  els.drawerBody.innerHTML = `
    <div class="action-form">
      <h3>対応を記録する</h3>

      <div class="action-form-item">
        <label for="actionStatus">対応状況</label>
        <select id="actionStatus">
          <option value="対応中" ${!savedRecord || savedRecord.status === "対応中" ? "selected" : ""}>対応中</option>
          <option value="対応済み" ${savedRecord?.status === "対応済み" ? "selected" : ""}>対応済み</option>
        </select>
      </div>

      <div class="action-form-item">
        <label for="actionPerson">担当者</label>
        <input
  id="actionPerson"
  type="text"
  value="${escapeHtml(savedRecord?.person || "")}"
  placeholder="担当者名を入力"
　>
      </div>

      <div class="action-form-item">
        <label for="actionContent">対応内容</label>
        <input
          id="actionContent"
          type="text"
          value="${escapeHtml(savedRecord?.content || "")}"
          placeholder="例：整備工場へ点検を依頼"
        >
      </div>

      <div class="action-form-item">
        <label for="actionMemo">メモ</label>
        <textarea
          id="actionMemo"
          rows="4"
          placeholder="対応内容や確認事項を入力"
        >${escapeHtml(savedRecord?.memo || "")}</textarea>
      </div>

      ${savedRecord ? `
  <div class="action-form-item">
    <span>前回記録日時</span>
    <strong>${escapeHtml(previousRecordedAt)}</strong>
  </div>
  <div class="action-form-item">
    <span>今回更新日時</span>
    <strong>${escapeHtml(recordedAt)}</strong>
  </div>
` : `
  <div class="action-form-item">
    <span>記録日時</span>
    <strong>${escapeHtml(recordedAt)}</strong>
  </div>
`}

      <button
        id="saveActionButton"
        class="button button--primary drawer-action"
        type="button"
      >
        保存する
      </button>

      <button
        id="cancelActionButton"
        class="button drawer-action"
        type="button"
      >
        キャンセル
      </button>
    </div>
  `;

  $("cancelActionButton")?.addEventListener("click", () => {
    openDrawer(vehicle.deviceId);
  });

  $("saveActionButton")?.addEventListener("click", () => {
  const status = $("actionStatus")?.value || "対応中";
  const person = $("actionPerson")?.value.trim() || "";
  const content = $("actionContent")?.value.trim() || "";
  const memo = $("actionMemo")?.value.trim() || "";

  if (!person) {
    showToast("担当者を入力してください");
    return;
  }

  if (!content) {
    showToast("対応内容を入力してください");
    return;
  }

  const record = {
    vehicleId: vehicle.deviceId,
    status,
    person,
    content,
    memo,
    recordedAt: new Date().toISOString()
  };

  const storageKey = `fleetAction_${vehicle.deviceId}`;

  localStorage.setItem(
    storageKey,
    JSON.stringify(record)
  );

  showToast("対応内容を保存しました");

  openDrawer(vehicle.deviceId);
});
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
    console.warn("refreshData START");
    
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
      // 故障の継続日数を出すため、故障情報は直近30日分を読み込む（状態の判定には直近24時間分だけを使う）
      const historyFromDate = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);

      const devices = await geotabCall("Get", {
        typeName: "Device",
        search: {}
      });
      let cameras = [];

try {
  cameras = await geotabCall("Get", {
    typeName: "Camera",
    search: {}
  });

  console.table(cameras);
} catch (error) {
  console.warn("Camera情報を取得できませんでした。", error);
}
    let cameraEvents = [];

try {
  const videoEventFromDate = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  );

  const videoEventToDate = new Date();
  const currentPage = await videoApiGet("CameraEvent", {
  fromDate: videoEventFromDate.toISOString(),
  toDate: videoEventToDate.toISOString(),
  page: 0,
  size: 100
});

cameraEvents.push(...currentPage);

console.log(
  `CameraEventを${cameraEvents.length}件取得しました`
);

  console.log(
    `過去7日間のCameraEventを${cameraEvents.length}件取得しました`
  );
　} catch (error) {
  console.warn(
    "Video APIからCameraEventを取得できませんでした。",
    error
  　);
　} 
  
  const filteredDevices = (devices || []).filter((device, index, array) => {
  // アセット画面に存在しないことを確認したDeviceを除外
  if (device.name === "D71-1903") {
    return false;
  }

  // 同じ名前のDeviceが複数ある場合は最初の1件だけ残す
  const firstIndex = array.findIndex((item) => item.name === device.name);

  if (firstIndex !== index) {
    return false;
  }

  return true;
});
      const deviceIds = filteredDevices
  .map((device) => device.id)
  .filter(Boolean);

      if (deviceIds.length === 0) {
        vehicles = [];
        allVehicles = [];
        render();
        if (els.updatedAt) els.updatedAt.textContent = formatTime(now);
        showToast("アクセス可能な車両がありません");
        return;
      }

      const [statusInfos, rawFaultData, groupList, meters] = await Promise.all([
        geotabCall("Get", {
          typeName: "DeviceStatusInfo",
          search: {}
        }),
        geotabCall("Get", {
          typeName: "FaultData",
          search: {
            deviceSearch: { deviceIds },
            fromDate: historyFromDate.toISOString(),
            toDate: now.toISOString()
          }
        }),
        // グループ（企業）の一覧。取得できなくても、ほかの表示は続ける
        geotabCall("Get", { typeName: "Group" }).catch((error) => {
          console.warn("グループを取得できませんでした。", error);
          return [];
        }),
        // 走行距離・エンジン稼働時間。取得できなくても、ほかの表示は続ける
        loadMeters(deviceIds).catch((error) => {
          console.warn("走行距離・稼働時間を取得できませんでした。", error);
          return new Map();
        })
      ]);

      const allFaults = await enrichFaultDetails(rawFaultData);
      const faultHistory = buildFaultHistory(allFaults);
      const faultData = allFaults.filter((fault) => new Date(fault.dateTime || 0) >= faultFromDate);
      allVehicles = buildVehicles(filteredDevices, statusInfos, faultData, faultHistory, meters);
      buildGroups(groupList, filteredDevices);
      applyGroupFilter();
      renderGroupSelect();

      render();
      if (els.updatedAt) els.updatedAt.textContent = formatTime(now);
      showToast(selectedGroup
        ? `${selectedGroupName()}の車両${vehicles.length}台を表示しています（全${allVehicles.length}台）`
        : `MyGeotabから${vehicles.length}台の車両を取得しました`);
    } catch (error) {
      console.error("MyGeotab data loading failed:", error);
      vehicles = [];
      allVehicles = [];
      render();
      showToast(error?.message || "MyGeotabのデータを取得できませんでした");
    } finally {
      console.warn("refreshData FINALLY");
      
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

    // グループ（企業）を変えたら、読み込み直さずに表示だけ切り替える
    $("groupSelect")?.addEventListener("change", (event) => {
      selectedGroup = event.target.value || "";
      try { localStorage.setItem(GROUP_STORAGE_KEY, selectedGroup); } catch (error) { /* 保存できない環境 */ }
      applyGroupFilter();
      renderGroupSelect();
      render();
      showToast(selectedGroup
        ? `${selectedGroupName()}の車両${vehicles.length}台を表示しています`
        : `すべての車両${vehicles.length}台を表示しています`);
    });

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
