(function () {
  "use strict";

  // Cinder Night owns one calm boot surface. Real milestones move `target`, while
  // the visible percentage advances one integer at a time and may softly drift
  // toward 96% while slow modules finish. It never moves backward and it never
  // hard-reloads the page. 100% is reserved for the real ready signal.
  var progress = 1;
  var target = 1;
  var label = "Awakening the court…";
  var firstError = "";
  var started = 0;
  var ticker = 0;
  var visualReadySent = false;
  var domPaintEnabled = false;

  try {
    started = performance.now();
  } catch {
    /* optional */
  }
  try {
    window.__CINDER_BOOT_STARTED_AT = started;
  } catch {
    /* optional */
  }

  function messageFrom(value) {
    try {
      if (!value) return "";
      if (typeof value === "string") return value;
      if (value.message) return String(value.message);
      return String(value);
    } catch {
      return "";
    }
  }

  function paint() {
    try {
      window.__CINDER_BOOT_PROGRESS = progress;
      window.__CINDER_BOOT_TARGET = target;
    } catch {
      /* instrumentation only */
    }
    if (!domPaintEnabled) return;
    var bar = document.getElementById("cinder-boot-bar");
    var percent = document.getElementById("cinder-boot-percent");
    var status = document.getElementById("cinder-boot-status");
    var meter = document.getElementById("cinder-boot-progress");
    if (bar) bar.style.width = progress + "%";
    if (percent) percent.textContent = Math.round(progress) + "%";
    if (status && label) status.textContent = label;
    if (meter) meter.setAttribute("aria-valuenow", String(Math.round(progress)));
  }

  function markVisualReady() {
    if (visualReadySent || progress < 100) return;
    visualReadySent = true;
    // Leave 100% on screen briefly so the player can actually see completion.
    window.setTimeout(function () {
      try {
        window.__CINDER_BOOT_VISUAL_READY = true;
        window.__CINDER_BOOT_READY_MS = Math.max(0, performance.now() - started);
      } catch {
        /* optional */
      }
      try {
        window.dispatchEvent(new Event("cinder-boot-visual-ready"));
      } catch {
        /* optional */
      }
    }, 120);
  }

  function nextDelay(realStep) {
    if (realStep) return 22;
    if (progress < 34) return 70;
    if (progress < 70) return 95;
    return 135;
  }

  function tick() {
    ticker = 0;
    if (!domPaintEnabled) return;

    var realStep = progress < target;
    if (realStep) {
      progress = Math.min(target, progress + 1);
      paint();
    } else if (target < 100 && progress < 96) {
      // Soft loading keeps the visible meter alive during slow network/chunk
      // work. It never claims 100%; only the actual app-ready milestone can.
      progress += 1;
      paint();
    }

    if (progress >= 100) {
      markVisualReady();
      return;
    }
    scheduleTick(nextDelay(realStep));
  }

  function scheduleTick(delay) {
    if (!domPaintEnabled || ticker) return;
    ticker = window.setTimeout(tick, typeof delay === "number" ? delay : 70);
  }

  function setProgress(value, nextLabel) {
    var next = Number(value);
    if (!isFinite(next)) return;
    next = Math.max(1, Math.min(100, Math.round(next)));
    // Both real target and visible progress are monotonic.
    if (next < target) return;
    target = next;
    if (typeof nextLabel === "string" && nextLabel) label = nextLabel;
    paint();
    scheduleTick(0);
  }

  function remember(value) {
    if (window.__CINDER_READY === true) return;
    var text = messageFrom(value).slice(0, 400);
    if (!text) return;
    firstError = firstError || text;
    try {
      window.__CINDER_BOOT_ERROR = firstError;
    } catch {
      /* diagnostics only */
    }
    // Never expose React/SSR/chunk error text to the player. The app and module
    // loaders retry internally while the boot UI stays calm and branded.
    label = "Reconnecting the court…";
    paint();
  }

  function noteSlowBoot() {
    if (window.__CINDER_READY === true || !domPaintEnabled) return;
    label = firstError ? "Reconnecting the court…" : "Still opening the court…";
    paint();
  }

  function enableDomPaint() {
    if (domPaintEnabled) return;
    domPaintEnabled = true;
    paint();
    scheduleTick(0);
  }

  function recoverVisibleBoot() {
    // iOS/webview page restoration can replay pageshow/visibility without
    // replaying the custom hydration event. The flag is authoritative, so use
    // it to reconnect the boot painter instead of leaving a restored screen at
    // the SSR 1% frame forever.
    if (window.__CINDER_BOOT_HYDRATED === true) enableDomPaint();
    if (window.__CINDER_READY === true) {
      setProgress(100, "Court ready");
      markVisualReady();
      return;
    }
    if (document.readyState !== "loading") {
      setProgress(Math.max(target, 16), firstError ? "Reconnecting the court…" : label);
    }
  }

  try {
    window.__CINDER_BOOT_PROGRESS = progress;
    window.__CINDER_BOOT_TARGET = target;
    window.__CINDER_BOOT_VISUAL_READY = false;
    window.__CINDER_SET_BOOT_PROGRESS = setProgress;
  } catch {
    /* optional */
  }

  // React owns the SSR boot DOM. Do not mutate any of its text/styles until the
  // first client effect confirms hydration, preventing server/client mismatch.
  window.addEventListener(
    "cinder-boot-hydrated",
    function () {
      enableDomPaint(); // first hydrated frame is still exactly 1%
    },
    { once: true },
  );
  // Covers the rare case where the host restores/reorders script execution and
  // the hydration flag already exists before this listener is attached.
  if (window.__CINDER_BOOT_HYDRATED === true) enableDomPaint();
  window.addEventListener("pageshow", recoverVisibleBoot);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") recoverVisibleBoot();
  });

  window.addEventListener(
    "error",
    function (event) {
      // Resource events without a JS error/message (fonts/images etc.) are not a
      // fatal game boot. Only remember actual runtime failures for diagnostics.
      if (event && (event.error || event.message)) remember(event.error || event.message);
    },
    true,
  );
  window.addEventListener("unhandledrejection", function (event) {
    remember(event.reason || "Startup promise failed");
  });

  function domReady() {
    setProgress(16, "Lighting the ash…");
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", domReady, { once: true });
  else domReady();

  window.setTimeout(noteSlowBoot, 9000);
  window.setTimeout(noteSlowBoot, 18000);
})();
