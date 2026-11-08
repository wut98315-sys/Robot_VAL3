
// keyboard.js (最终版 v2：修复 prompt 背景关闭不取消 + 普通输入框提交可用)
// ✅ 贴底显示键盘 iframe
// ✅ 默认系统输入法（首次进入不隐藏 fosk）
// ✅ 支持 userPagePrompt：#sp2up-modal-osk / #sp2up-modal-ok / #sp2up-modal-cancel
// ✅ 点击遮罩空白仅隐藏输入法，不取消 prompt
// ✅ 普通输入框提交：既写 DOM（可见）也可写绑定（由 keyboard.html putValue 负责）

(() => {
  "use strict";

  /* =========================
   * 可配置项
   * ========================= */
  const IFRAME_PAGE = "./keyboard.html";
  const POS_KEY = "__ime_toggle_pos__";
  const MODE_KEY = "__ime_mode__";
  const DEFAULT_MODE = "native";

  const TOGGLE_SELECTORS = ["[data-ime-toggle]", ".ime-toggle", "#toggleButton"];
  const CANCEL_BTN_CLASS = "input-group-addon btn cancel-button cancel-button-inner";
  const KEYBOARD_HEIGHT = "40vh";

  // userPagePrompt DOM
  const PROMPT_INPUT_ID = "sp2up-modal-osk";
  const PROMPT_OK_ID = "sp2up-modal-ok";
  const PROMPT_CANCEL_ID = "sp2up-modal-cancel";

  /* =========================
   * 向上逐层查找 prompt 所在 document（避免层级不同找不到）
   * ========================= */
  function findDocWithElementId(id, maxHops = 8) {
    let w = window;
    for (let i = 0; i < maxHops; i++) {
      try {
        const d = w.document;
        if (d && d.getElementById(id)) return d;
      } catch (e) {
        break; // 跨域/不可访问
      }
      if (!w.parent || w.parent === w) break;
      w = w.parent;
    }
    return null;
  }

  function getPromptDoc() {
    return (
      findDocWithElementId(PROMPT_INPUT_ID) ||
      findDocWithElementId(PROMPT_OK_ID) ||
      findDocWithElementId(PROMPT_CANCEL_ID) ||
      null
    );
  }

  function isPromptOpen() {
    return !!getPromptDoc();
  }

  function getPromptInput() {
    const doc = getPromptDoc();
    return doc ? doc.getElementById(PROMPT_INPUT_ID) : null;
  }

  function clickPromptOk() {
    const doc = getPromptDoc();
    const ok = doc ? doc.getElementById(PROMPT_OK_ID) : null;
    if (ok) ok.click();
  }

  function clickPromptCancel() {
    const doc = getPromptDoc();
    const cancel = doc ? doc.getElementById(PROMPT_CANCEL_ID) : null;
    if (cancel) cancel.click();
  }

  /* =========================
   * 用原生 setter 写值（保证触发监听）
   * ========================= */
  function setNativeValue(el, value) {
    if (!el) return;

    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const proto = (el.tagName === "TEXTAREA")
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const setter = desc && desc.set;
    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* =========================
   * Prompt 消息桥：写入 prompt 输入框（可选点 OK）
   * ========================= */
  function installPromptMessageBridge() {
    window.addEventListener("message", (ev) => {
      const data = ev.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "IME_PROMPT_CANCEL") {
        if (isPromptOpen()) clickPromptCancel();
        return;
      }

      if (data.type !== "IME_PROMPT_COMMIT") return;
      if (!isPromptOpen()) return;

      const text = (data.text ?? "").toString();
      const submit = !!data.submit;

      const input = getPromptInput();
      if (!input) return;

      setNativeValue(input, text);

      // ✅ 你现在的需求：默认不OK；只有 submit=true 才OK
      if (submit) clickPromptOk();
    });
  }

  /* =========================
   * 普通输入框桥：写入指定 id 或当前 activeElement（保证“提交可见有效”）
   * ========================= */
  function installGeneralCommitBridge() {
    window.addEventListener("message", (ev) => {
      const data = ev.data;
      if (!data || typeof data !== "object") return;

      // ✅ 收到隐藏指令：只隐藏输入法，不取消 prompt
      if (data.type === "IME_HIDE_OVERLAY") {
        closeOverlay(false);
        return;
      }

      // 指定 id 写回
      if (data.type === "IME_COMMIT_ID") {
        const id = (data.id ?? "").toString();
        const text = (data.text ?? "").toString();

        // 尽量在 parent 中找（你的输入框通常在 parent）
        let doc = null;
        try { doc = window.parent?.document || document; } catch { doc = document; }

        const el = id ? doc.getElementById(id) : null;
        if (el) setNativeValue(el, text);
        return;
      }

      // 写回当前焦点输入框（fallback）
      if (data.type === "IME_COMMIT_ACTIVE") {
        const text = (data.text ?? "").toString();
        let target = null;
        try { target = window.parent?.document?.activeElement || document.activeElement; } catch { target = document.activeElement; }
        if (!target) return;

        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
          setNativeValue(target, text);
        }
      }
    });
  }

  /* =========================
   * DOM 注入：样式 + overlay/iframe
   * ========================= */
  function injectStyleOnce() {
    if (document.getElementById("__ime_style__")) return;

    const styleElement = document.createElement("style");
    styleElement.id = "__ime_style__";
    styleElement.textContent = `
      #__ime_toggle_btn__{
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 56px;
        height: 56px;
        border-radius: 12px;
        border: 1px solid rgba(0,0,0,.18);
        background: rgba(255,255,255,.92);
        color: #111;
        font: 700 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        user-select: none;
        -webkit-user-select: none;
        cursor: pointer;
        z-index: 2147483647;
        touch-action: none;
      }
      #__ime_toggle_btn__.ime-on{
        background: rgba(37,99,235,.12);
        border-color: rgba(37,99,235,.35);
        color: #2563eb;
      }
      #__ime_toggle_btn__ .col{
        display:flex;
        flex-direction:column;
        align-items:center;
        gap: 2px;
      }
      #__ime_toggle_btn__ .sub{
        font-size: 10px;
        opacity: .75;
        font-weight: 800;
      }

      #__ime_overlay__{
        position: fixed;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.45);
        display: none;
        z-index: 2147483000;
      }

      #__ime_iframe_container__{
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        height: ${KEYBOARD_HEIGHT};
        background-color: #fff;
        border-top-left-radius: 10px;
        border-top-right-radius: 10px;
        overflow: hidden;
      }

      #__ime_page_iframe__{
        width: 100%;
        height: 100%;
        border: none;
        display: block;
      }
    `;
    document.head.appendChild(styleElement);
  }

  function ensureOverlayDOM() {
    let overlay = document.getElementById("__ime_overlay__");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "__ime_overlay__";

    const container = document.createElement("div");
    container.id = "__ime_iframe_container__";

    const iframe = document.createElement("iframe");
    iframe.id = "__ime_page_iframe__";
    iframe.setAttribute("title", "Chinese IME");
    iframe.src = "";

    container.appendChild(iframe);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // ✅ 修复：点击遮罩空白只隐藏输入法，不取消 prompt、不点 cancel
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeOverlay(false);
      }
    });

    return overlay;
  }

  function openOverlayWithInputId(inputId) {
    ensureOverlayDOM();
    const overlay = document.getElementById("__ime_overlay__");
    const iframe = document.getElementById("__ime_page_iframe__");

    const pageUrl = `${IFRAME_PAGE}?id=${encodeURIComponent(inputId || "")}`;
    iframe.src = pageUrl;
    overlay.style.display = "block";
  }

  function closeOverlay(triggerCancelButton) {
    const overlay = document.getElementById("__ime_overlay__");
    const iframe = document.getElementById("__ime_page_iframe__");
    if (overlay) overlay.style.display = "none";
    if (iframe) iframe.src = "";

    // ❗ 注意：不再因为关闭输入法而取消 prompt
    if (triggerCancelButton) {
      try {
        const elements = window.parent?.document?.getElementsByClassName(CANCEL_BTN_CLASS);
        if (elements && elements.length > 0) elements[0].click();
      } catch (e) { }
    }
  }

  /* =========================
   * fosk 控制（系统输入法显示/隐藏）
   * ========================= */
  function getFosk() {
    try {
      return window.parent?.document?.getElementById("fosk") || null;
    } catch (e) {
      return null;
    }
  }

  function setFoskVisible(visible) {
    const fosk = getFosk();
    if (!fosk) return false;
    fosk.style.display = visible ? "" : "none";
    return true;
  }

  /* =========================
   * 模式：native / chinese
   * ========================= */
  function getMode() {
    return localStorage.getItem(MODE_KEY) || DEFAULT_MODE;
  }

  function setMode(mode) {
    localStorage.setItem(MODE_KEY, mode);
  }

  function applyMode(mode) {
    const btn = ensureToggleButton().el;

    if (mode === "chinese") {
      setFoskVisible(false);
      btn.classList.add("ime-on");
      btn.title = "当前：中文输入法（点击切换系统）";
      btn.dataset.mode = "chinese";
      btn.innerHTML = `<div class="col"><div>系统</div><div class="sub">拖动</div></div>`;
    } else {
      setFoskVisible(true);
      btn.classList.remove("ime-on");
      btn.title = "当前：系统输入法（点击切换中文）";
      btn.dataset.mode = "native";
      btn.innerHTML = `<div class="col"><div>中文</div><div class="sub">拖动</div></div>`;
      closeOverlay(false);
    }
  }

  function toggleMode() {
    const cur = getMode();
    const next = (cur === "chinese") ? "native" : "chinese";
    setMode(next);
    applyMode(next);
  }

  /* =========================
   * Toggle Button：复用已有 or 自动生成（可拖动）
   * ========================= */
  function findExistingToggle() {
    for (const sel of TOGGLE_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function ensureToggleButton() {
    const existing = findExistingToggle();
    if (existing) return { el: existing, injected: false };

    let btn = document.getElementById("__ime_toggle_btn__");
    if (btn) return { el: btn, injected: true };

    btn = document.createElement("div");
    btn.id = "__ime_toggle_btn__";
    btn.innerHTML = `<div class="col"><div>中文</div><div class="sub">拖动</div></div>`;
    document.body.appendChild(btn);

    makeDraggable(btn);
    return { el: btn, injected: true };
  }

  function safeJSONParse(v) {
    try { return JSON.parse(v); } catch { return null; }
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function restoreBtnPos(btn) {
    const saved = safeJSONParse(localStorage.getItem(POS_KEY));
    if (!saved) return;

    const w = btn.getBoundingClientRect().width || 56;
    const h = btn.getBoundingClientRect().height || 56;
    const left = clamp(saved.left, 6, window.innerWidth - w - 6);
    const top = clamp(saved.top, 6, window.innerHeight - h - 6);

    btn.style.left = left + "px";
    btn.style.top = top + "px";
    btn.style.right = "auto";
    btn.style.bottom = "auto";
  }

  function saveBtnPos(btn) {
    const r = btn.getBoundingClientRect();
    localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
  }

  function makeDraggable(btn) {
    const r = btn.getBoundingClientRect();
    btn.style.left = (window.innerWidth - r.width - 16) + "px";
    btn.style.top = (window.innerHeight - r.height - 16) + "px";
    btn.style.right = "auto";
    btn.style.bottom = "auto";

    restoreBtnPos(btn);

    let dragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;
    let moved = 0;
    const TH = 6;

    btn.addEventListener("pointerdown", (e) => {
      btn.setPointerCapture(e.pointerId);
      dragging = true;
      moved = 0;

      const rect = btn.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    btn.addEventListener("pointermove", (e) => {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      moved = Math.max(moved, Math.hypot(dx, dy));

      const rect = btn.getBoundingClientRect();
      const w = rect.width, h = rect.height;

      const newLeft = clamp(startLeft + dx, 6, window.innerWidth - w - 6);
      const newTop = clamp(startTop + dy, 6, window.innerHeight - h - 6);

      btn.style.left = newLeft + "px";
      btn.style.top = newTop + "px";
      e.preventDefault();
    });

    btn.addEventListener("pointerup", (e) => {
      try { btn.releasePointerCapture(e.pointerId); } catch { }
      dragging = false;

      const rect = btn.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      const stickRight = mid > window.innerWidth / 2;
      btn.style.left = (stickRight ? (window.innerWidth - rect.width - 6) : 6) + "px";

      saveBtnPos(btn);
      if (moved > TH) btn.__skipClickOnce = true;
    });

    btn.addEventListener("click", (e) => {
      if (btn.__skipClickOnce) {
        btn.__skipClickOnce = false;
        e.preventDefault();
        e.stopPropagation();
      }
    });

    window.addEventListener("resize", () => {
      const rect = btn.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      const left = clamp(rect.left, 6, window.innerWidth - w - 6);
      const top = clamp(rect.top, 6, window.innerHeight - h - 6);
      btn.style.left = left + "px";
      btn.style.top = top + "px";
      saveBtnPos(btn);
    });
  }

  /* =========================
   * 输入框触发：事件委托（支持动态新增 input）
   * ========================= */
  function isAllowedInput(el) {
    return !!el && el.tagName === "INPUT";
  }

  function handleInputEvent(e) {
    if (getMode() !== "chinese") return;

    const target = e.target;
    if (!isAllowedInput(target)) return;

    const fosk = getFosk();
    if (fosk && fosk.style.display === "none") {
      const inputId = target.id || target.getAttribute("id") || "";
      openOverlayWithInputId(inputId);
    }
  }

  /* =========================
   * prompt 输入框点击：唤醒输入法
   * ========================= */
  function installPromptClickHook() {
    try {
      window.parent.document.addEventListener("click", (e) => {
        if (getMode() !== "chinese") return;
        if (e.target && e.target.id === PROMPT_INPUT_ID) {
          openOverlayWithInputId(PROMPT_INPUT_ID);
        }
      }, true);
    } catch { }
  }

  /* =========================
   * 退出/切后台兜底：自动切回系统输入法（不取消 prompt）
   * ========================= */
  function installAutoRestore() {
    const restoreToNative = () => {
      setMode("native");
      setFoskVisible(true);
      closeOverlay(false);   // ✅ 不再 true，避免误取消弹窗
      applyMode("native");
      const elements = window.parent.document.getElementsByClassName('input-group-addon btn cancel-button cancel-button-inner');
      if (elements.length > 0) {
        elements[0].click();
      }
    };

    window.addEventListener("pagehide", restoreToNative);
    window.addEventListener("beforeunload", restoreToNative);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") restoreToNative();
    });
  }

  /* =========================
   * 初始化
   * ========================= */
  function init() {
    injectStyleOnce();
    ensureOverlayDOM();

    const { el: toggleEl } = ensureToggleButton();
    toggleEl.addEventListener("click", () => toggleMode());

    document.addEventListener("click", handleInputEvent, true);

    installPromptClickHook();
    installPromptMessageBridge();
    installGeneralCommitBridge();

    if (!localStorage.getItem(MODE_KEY)) setMode(DEFAULT_MODE);
    applyMode(getMode());

    installAutoRestore();
    console.log("[IME] keyboard.js initialized (fix prompt-close + normal submit)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
