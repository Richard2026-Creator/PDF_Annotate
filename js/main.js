/**
 * main.js
 * UI wiring: file open / drag-drop, tool selection, properties panel,
 * undo/redo/delete, zoom, keyboard shortcuts, and download.
 */
(function (App) {
  "use strict";

  var store = App.store;

  var PALETTE = [
    "#e53935", "#fb8c00", "#fdd835", "#43a047",
    "#1e88e5", "#3949ab", "#8e24aa", "#000000",
  ];

  // Which property controls are relevant per tool/selection type
  function relevantProps(type) {
    switch (type) {
      case "text":
        return { color: true, stroke: false, opacity: false, fill: false, font: true };
      case "highlight":
        return { color: true, stroke: false, opacity: true, fill: false, font: false };
      case "rect":
      case "ellipse":
        return { color: true, stroke: true, opacity: true, fill: true, font: false };
      case "line":
      case "hline":
      case "vline":
      case "arrow":
        return { color: true, stroke: true, opacity: true, fill: false, font: false };
      default: // select with nothing selected
        return { color: true, stroke: true, opacity: true, fill: true, font: true };
    }
  }

  function $(id) { return document.getElementById(id); }

  function init() {
    buildSwatches();
    bindFileControls();
    bindToolbar();
    bindProperties();
    bindZoom();
    bindHistoryButtons();
    bindDownload();
    bindKeyboard();
    syncPropsVisibility();
    syncControlsFromSettings();

    store.on("settings", function () {
      syncToolButtons();
      syncControlsFromSettings();
      syncPropsVisibility();
    });
    store.on("selection", function () {
      syncControlsFromSelection();
      syncPropsVisibility();
      updateDeleteButton();
    });
    store.on("history", updateHistoryButtons);
    store.on("document-loaded", onDocumentLoaded);
    store.on("annotations", updateDeleteButton);
  }

  // ---- File open + drag/drop ----------------------------------------------

  function bindFileControls() {
    $("file-input").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) openFile(file);
      e.target.value = ""; // allow re-opening same file
    });

    var viewer = $("viewer");
    ["dragenter", "dragover"].forEach(function (evt) {
      viewer.addEventListener(evt, function (e) {
        e.preventDefault();
        viewer.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      viewer.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === "dragleave" && viewer.contains(e.relatedTarget)) return;
        viewer.classList.remove("drag-over");
      });
    });
    viewer.addEventListener("drop", function (e) {
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type === "application/pdf") openFile(file);
      else if (file) alert("Please drop a PDF file.");
    });
  }

  function openFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      App.renderer.loadPdf(reader.result, file.name);
    };
    reader.onerror = function () { alert("Could not read the file."); };
    reader.readAsArrayBuffer(file);
  }

  function onDocumentLoaded() {
    $("file-name").textContent = store.doc.fileName || "";
    $("download-btn").disabled = false;
    $("zoom-in").disabled = false;
    $("zoom-out").disabled = false;
    updateZoomLabel();
  }

  // ---- Toolbar -------------------------------------------------------------

  function bindToolbar() {
    document.querySelectorAll(".tool[data-tool]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        store.setTool(btn.getAttribute("data-tool"));
      });
    });
  }

  function syncToolButtons() {
    document.querySelectorAll(".tool[data-tool]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tool") === store.settings.tool);
    });
  }

  // ---- Properties panel ----------------------------------------------------

  function buildSwatches() {
    var wrap = $("color-swatches");
    PALETTE.forEach(function (c) {
      var b = document.createElement("button");
      b.className = "swatch";
      b.style.background = c;
      b.title = c;
      b.addEventListener("click", function () {
        store.setSetting("color", c);
        $("color-input").value = c;
      });
      wrap.appendChild(b);
    });
  }

  function bindProperties() {
    $("color-input").addEventListener("input", function (e) {
      store.setSetting("color", e.target.value);
      markActiveSwatch(e.target.value);
    });

    $("stroke-input").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      $("stroke-value").textContent = v;
      store.setSetting("strokeWidth", v);
    });

    $("opacity-input").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      $("opacity-value").textContent = v;
      store.setSetting("opacity", v / 100);
    });

    $("fill-input").addEventListener("change", function (e) {
      store.setSetting("fill", e.target.checked);
    });

    $("font-input").addEventListener("input", function (e) {
      var v = parseInt(e.target.value, 10);
      $("font-value").textContent = v;
      store.setSetting("fontSize", v);
    });
  }

  function markActiveSwatch(color) {
    document.querySelectorAll(".swatch").forEach(function (s) {
      s.classList.toggle("active", s.title.toLowerCase() === String(color).toLowerCase());
    });
  }

  // Reflect store.settings into the controls
  function syncControlsFromSettings() {
    var s = store.settings;
    $("color-input").value = s.color;
    markActiveSwatch(s.color);
    $("stroke-input").value = s.strokeWidth;
    $("stroke-value").textContent = s.strokeWidth;
    $("opacity-input").value = Math.round(s.opacity * 100);
    $("opacity-value").textContent = Math.round(s.opacity * 100);
    $("fill-input").checked = !!s.fill;
    $("font-input").value = s.fontSize;
    $("font-value").textContent = s.fontSize;
  }

  // When an annotation is selected, show ITS properties
  function syncControlsFromSelection() {
    var id = store.getSelectedId();
    if (!id) return;
    var a = store.getAnnotation(id);
    if (!a) return;
    if (a.color != null) { $("color-input").value = a.color; markActiveSwatch(a.color); }
    if (a.strokeWidth != null) { $("stroke-input").value = a.strokeWidth; $("stroke-value").textContent = a.strokeWidth; }
    if (a.opacity != null) {
      var pct = Math.round(a.opacity * 100);
      $("opacity-input").value = pct; $("opacity-value").textContent = pct;
    }
    if (a.fill != null) $("fill-input").checked = !!a.fill;
    if (a.fontSize != null) { $("font-input").value = a.fontSize; $("font-value").textContent = a.fontSize; }
  }

  // Show only the property groups relevant to the current tool / selection
  function syncPropsVisibility() {
    var id = store.getSelectedId();
    var type;
    if (id) {
      var a = store.getAnnotation(id);
      type = a ? a.type : store.settings.tool;
    } else {
      type = store.settings.tool;
    }
    var r = relevantProps(type);
    $("stroke-group").style.display = r.stroke ? "" : "none";
    $("opacity-group").style.display = r.opacity ? "" : "none";
    $("fill-group").style.display = r.fill ? "" : "none";
    $("font-group").style.display = r.font ? "" : "none";

    var hint = $("prop-hint");
    if (id) {
      hint.innerHTML = "Editing selected <strong>" + escapeHtml(labelFor(type)) +
        "</strong>. Drag handles to resize, or press <strong>Delete</strong>.";
    } else if (store.settings.tool === "select") {
      hint.innerHTML = "Click an item to select it, then move, resize, or restyle it.";
    } else {
      hint.innerHTML = "Drag on the page to draw a <strong>" +
        escapeHtml(labelFor(store.settings.tool)) + "</strong>." +
        (store.settings.tool === "line" || store.settings.tool === "arrow"
          ? " Hold <strong>Shift</strong> to snap angles." : "") +
        (store.settings.tool === "text" ? " Click to place a text box." : "");
    }
  }

  function labelFor(type) {
    var map = {
      select: "selection", text: "text box", highlight: "highlight",
      rect: "rectangle", ellipse: "circle", line: "line",
      hline: "horizontal line", vline: "vertical line", arrow: "arrow",
    };
    return map[type] || type;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---- Zoom ----------------------------------------------------------------

  function bindZoom() {
    $("zoom-in").addEventListener("click", function () {
      App.renderer.setZoom(store.doc.zoom + 0.2);
    });
    $("zoom-out").addEventListener("click", function () {
      App.renderer.setZoom(store.doc.zoom - 0.2);
    });
    store.on("zoom-changed", updateZoomLabel);
  }

  function updateZoomLabel() {
    $("zoom-level").textContent = Math.round(store.doc.zoom * 100) + "%";
  }

  // ---- History + delete ----------------------------------------------------

  function bindHistoryButtons() {
    $("undo-btn").addEventListener("click", function () { store.undo(); });
    $("redo-btn").addEventListener("click", function () { store.redo(); });
    $("delete-btn").addEventListener("click", deleteSelected);
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $("undo-btn").disabled = !store.canUndo();
    $("redo-btn").disabled = !store.canRedo();
  }

  function updateDeleteButton() {
    $("delete-btn").disabled = !store.getSelectedId();
  }

  function deleteSelected() {
    var id = store.getSelectedId();
    if (id) store.removeAnnotation(id);
  }

  // ---- Download ------------------------------------------------------------

  function bindDownload() {
    $("download-btn").addEventListener("click", function () {
      App.exporter.exportPdf();
    });
  }

  // ---- Keyboard shortcuts --------------------------------------------------

  var SHORTCUTS = {
    v: "select", t: "text", h: "highlight", r: "rect",
    c: "ellipse", l: "line", a: "arrow",
  };

  function bindKeyboard() {
    document.addEventListener("keydown", function (e) {
      // ignore when typing in an input/textarea
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || App.tools.isEditing()) return;

      var key = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
        e.preventDefault(); store.undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault(); store.redo(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (key === "delete" || key === "backspace") {
        if (store.getSelectedId()) { e.preventDefault(); deleteSelected(); }
        return;
      }
      if (key === "escape") { store.setSelected(null); return; }

      if (SHORTCUTS[key]) {
        e.preventDefault();
        store.setTool(SHORTCUTS[key]);
      }
    });
  }

  // ---- Boot ----------------------------------------------------------------

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window.App);
