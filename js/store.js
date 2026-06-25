/**
 * store.js
 * Global application namespace + state management.
 *
 * Coordinate system note:
 *   All annotation geometry is stored in UNSCALED PDF page space (scale = 1),
 *   with the origin at the TOP-LEFT of the page (same as pdf.js viewport).
 *   The SVG overlay uses a viewBox equal to the page's unscaled size, so zoom
 *   is handled purely by CSS sizing and stored coordinates never change.
 *   On export, pdf-lib uses a BOTTOM-LEFT origin, so Y is flipped there.
 */
window.App = window.App || {};

(function (App) {
  "use strict";

  // ---- Default tool/style settings ----
  var settings = {
    tool: "select",
    color: "#e53935",
    strokeWidth: 2,
    opacity: 1, // 0..1
    fill: false,
    fontSize: 16,
  };

  // ---- Document state ----
  var doc = {
    fileName: null,
    pdfBytes: null, // ArrayBuffer of the ORIGINAL uploaded PDF (used for export)
    pdfDoc: null, // pdf.js document
    numPages: 0,
    zoom: 1, // display zoom multiplier
    pageSizes: [], // [{ width, height }] in unscaled points, index 0 = page 1
  };

  // ---- Annotations ----
  // Each annotation:
  // {
  //   id, type, page (0-based),
  //   x1, y1, x2, y2,         (top-left origin, unscaled points)
  //   color, strokeWidth, opacity, fill (bool),
  //   text, fontSize           (text only)
  // }
  var annotations = [];
  var selectedId = null;

  // ---- Undo / redo history (snapshots of annotations array) ----
  var undoStack = [];
  var redoStack = [];

  // ---- Simple event bus ----
  var listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try {
        fn(payload);
      } catch (e) {
        console.error("listener error for", evt, e);
      }
    });
  }

  function uid() {
    return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---- History helpers ----
  function snapshot() {
    undoStack.push(clone(annotations));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    emit("history");
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(clone(annotations));
    annotations = undoStack.pop();
    if (!annotations.some(function (a) { return a.id === selectedId; })) {
      selectedId = null;
    }
    emit("annotations");
    emit("history");
    emit("selection");
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(clone(annotations));
    annotations = redoStack.pop();
    emit("annotations");
    emit("history");
    emit("selection");
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  // For multi-step interactions (move/resize): snapshot the pre-change state
  // before mutating, then cancel it if nothing actually changed.
  function beginHistory() {
    snapshot();
  }
  function cancelHistory() {
    if (undoStack.length) undoStack.pop();
    emit("history");
  }

  // ---- Annotation CRUD ----
  function addAnnotation(ann) {
    snapshot();
    ann.id = ann.id || uid();
    annotations.push(ann);
    emit("annotations");
    return ann.id;
  }

  function updateAnnotation(id, patch, options) {
    options = options || {};
    var ann = getAnnotation(id);
    if (!ann) return;
    if (!options.silent) snapshot();
    Object.keys(patch).forEach(function (k) {
      ann[k] = patch[k];
    });
    emit("annotations");
  }

  // Update geometry live (no history) during a drag, then commit once.
  function liveUpdate(id, patch) {
    var ann = getAnnotation(id);
    if (!ann) return;
    Object.keys(patch).forEach(function (k) {
      ann[k] = patch[k];
    });
    emit("annotations");
  }

  function commitHistory() {
    snapshot();
  }

  function removeAnnotation(id) {
    var idx = annotations.findIndex(function (a) { return a.id === id; });
    if (idx === -1) return;
    snapshot();
    annotations.splice(idx, 1);
    if (selectedId === id) selectedId = null;
    emit("annotations");
    emit("selection");
  }

  function getAnnotation(id) {
    return annotations.find(function (a) { return a.id === id; }) || null;
  }

  function getAnnotationsForPage(page) {
    return annotations.filter(function (a) { return a.page === page; });
  }

  function setSelected(id) {
    if (selectedId === id) return;
    selectedId = id;
    emit("selection");
  }

  // ---- Settings ----
  function setSetting(key, value) {
    settings[key] = value;
    emit("settings");
    // Apply style changes live to the selected annotation
    if (selectedId && ["color", "strokeWidth", "opacity", "fill", "fontSize"].indexOf(key) !== -1) {
      updateAnnotation(selectedId, mapSettingToAnn(key, value));
    }
  }

  function mapSettingToAnn(key, value) {
    var p = {};
    p[key] = value;
    return p;
  }

  function setTool(tool) {
    settings.tool = tool;
    if (tool !== "select") setSelected(null);
    emit("settings");
    emit("tool");
  }

  // ---- Document reset ----
  function resetDocument() {
    annotations = [];
    selectedId = null;
    undoStack = [];
    redoStack = [];
  }

  // ---- Public API ----
  App.store = {
    // events
    on: on,
    emit: emit,
    // ids
    uid: uid,
    // settings
    settings: settings,
    setSetting: setSetting,
    setTool: setTool,
    // document
    doc: doc,
    resetDocument: resetDocument,
    // annotations
    annotations: function () { return annotations; },
    addAnnotation: addAnnotation,
    updateAnnotation: updateAnnotation,
    liveUpdate: liveUpdate,
    commitHistory: commitHistory,
    removeAnnotation: removeAnnotation,
    getAnnotation: getAnnotation,
    getAnnotationsForPage: getAnnotationsForPage,
    // selection
    getSelectedId: function () { return selectedId; },
    setSelected: setSelected,
    // history
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    beginHistory: beginHistory,
    cancelHistory: cancelHistory,
  };
})(window.App);
