/**
 * tools.js
 * Pointer interaction layer: creating, selecting, moving, and resizing
 * annotations on the SVG overlays, plus inline text editing.
 */
window.App = window.App || {};

(function (App) {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var store = App.store;

  var drag = null;        // active drag state
  var preview = null;     // transient SVG element while creating
  var activeEditor = null;// inline <textarea> for text
  var activeCapture = null;// { svg, pointerId } during a move/resize gesture

  var MIN_SIZE = 3;       // ignore accidental micro-shapes (page units)

  function svgEl(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    return node;
  }

  // Attach interaction handlers to one page overlay.
  function bindPage(record) {
    record.svg.addEventListener("pointerdown", function (e) {
      onPointerDown(e, record);
    });
    // Double-click to edit text under cursor
    record.svg.addEventListener("dblclick", function (e) {
      onDoubleClick(e, record);
    });
  }

  function onPointerDown(e, record) {
    if (e.button !== 0) return;
    if (activeEditor) { commitEditor(); }

    // Prevent the browser's default mousedown behaviour. Without this, the
    // default action (a) steals focus from the inline text editor we are about
    // to create — instantly blurring/destroying it — and (b) starts a native
    // text/drag selection that interferes with click-to-select and drag-to-move.
    e.preventDefault();

    var tool = store.settings.tool;
    var pt = App.renderer.clientToPage(record.svg, e.clientX, e.clientY);

    if (tool === "select") {
      handleSelectDown(e, record, pt);
    } else if (tool === "text") {
      startTextCreate(record, pt);
    } else {
      startShapeCreate(tool, record, pt);
    }
  }

  // ---- Creating shapes -----------------------------------------------------

  function startShapeCreate(tool, record, pt) {
    var start = { x: pt.x, y: pt.y };

    // Pressing on the canvas to start a new shape deselects any current item.
    store.setSelected(null);

    drag = {
      mode: "create",
      tool: tool,
      record: record,
      start: start,
      cur: { x: pt.x, y: pt.y },
    };

    preview = svgEl("g", { class: "preview" });
    record.svg.appendChild(preview);
    updatePreview(false);

    window.addEventListener("pointermove", onCreateMove);
    window.addEventListener("pointerup", onCreateUp);
  }

  function onCreateMove(e) {
    if (!drag || drag.mode !== "create") return;
    var pt = App.renderer.clientToPage(drag.record.svg, e.clientX, e.clientY);
    drag.cur = { x: pt.x, y: pt.y };
    drag.shift = e.shiftKey;
    updatePreview(e.shiftKey);
  }

  function computeCreateGeom(shift) {
    var t = drag.tool;
    var x1 = drag.start.x, y1 = drag.start.y;
    var x2 = drag.cur.x, y2 = drag.cur.y;

    if (t === "hline") { y2 = y1; }
    else if (t === "vline") { x2 = x1; }
    else if ((t === "line" || t === "arrow") && shift) {
      // snap to 0 / 45 / 90 degrees
      var dx = x2 - x1, dy = y2 - y1;
      var ang = Math.atan2(dy, dx);
      var step = Math.PI / 4;
      var snapped = Math.round(ang / step) * step;
      var len = Math.sqrt(dx * dx + dy * dy);
      x2 = x1 + len * Math.cos(snapped);
      y2 = y1 + len * Math.sin(snapped);
    } else if ((t === "rect" || t === "ellipse" || t === "highlight") && shift) {
      // square / circle
      var w = x2 - x1, h = y2 - y1;
      var side = Math.max(Math.abs(w), Math.abs(h));
      x2 = x1 + (w < 0 ? -side : side);
      y2 = y1 + (h < 0 ? -side : side);
    }
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  function updatePreview(shift) {
    if (!preview) return;
    while (preview.firstChild) preview.removeChild(preview.firstChild);

    var g = computeCreateGeom(shift);
    var s = store.settings;
    var t = drag.tool;
    var stroke = s.color;
    var sw = s.strokeWidth;
    var op = t === "highlight" ? 0.4 : s.opacity;

    if (t === "highlight" || t === "rect") {
      var x = Math.min(g.x1, g.x2), y = Math.min(g.y1, g.y2);
      var w = Math.abs(g.x2 - g.x1), h = Math.abs(g.y2 - g.y1);
      preview.appendChild(svgEl("rect", {
        x: x, y: y, width: w, height: h,
        fill: t === "highlight" ? s.color : (s.fill ? s.color : "none"),
        "fill-opacity": t === "highlight" ? op : (s.fill ? op * 0.35 : 0),
        stroke: t === "highlight" ? "none" : stroke,
        "stroke-width": sw, "stroke-opacity": op,
      }));
    } else if (t === "ellipse") {
      var ex = Math.min(g.x1, g.x2), ey = Math.min(g.y1, g.y2);
      var ew = Math.abs(g.x2 - g.x1), eh = Math.abs(g.y2 - g.y1);
      preview.appendChild(svgEl("ellipse", {
        cx: ex + ew / 2, cy: ey + eh / 2, rx: ew / 2, ry: eh / 2,
        fill: s.fill ? s.color : "none",
        "fill-opacity": s.fill ? op * 0.35 : 0,
        stroke: stroke, "stroke-width": sw, "stroke-opacity": op,
      }));
    } else if (t === "line" || t === "hline" || t === "vline") {
      preview.appendChild(svgEl("line", {
        x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
        stroke: stroke, "stroke-width": sw, "stroke-opacity": op,
        "stroke-linecap": "round",
      }));
    } else if (t === "arrow") {
      preview.appendChild(svgEl("line", {
        x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
        stroke: stroke, "stroke-width": sw, "stroke-opacity": op,
        "stroke-linecap": "round",
      }));
    }
  }

  function onCreateUp() {
    window.removeEventListener("pointermove", onCreateMove);
    window.removeEventListener("pointerup", onCreateUp);
    if (!drag || drag.mode !== "create") { cleanupPreview(); return; }

    var g = computeCreateGeom(drag.shift);
    var t = drag.tool;
    var record = drag.record;
    cleanupPreview();

    var w = Math.abs(g.x2 - g.x1), h = Math.abs(g.y2 - g.y1);
    var len = Math.sqrt(w * w + h * h);
    var isLinear = (t === "line" || t === "hline" || t === "vline" || t === "arrow");

    if (isLinear ? len < MIN_SIZE : (w < MIN_SIZE && h < MIN_SIZE)) {
      drag = null;
      return; // ignore accidental click
    }

    var s = store.settings;
    var ann = {
      type: t,
      page: record.pageNum - 1,
      x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
      color: s.color,
      strokeWidth: s.strokeWidth,
      opacity: t === "highlight" ? 0.4 : s.opacity,
      fill: t === "highlight" ? true : s.fill,
    };
    // normalize box shapes so x1,y1 = top-left
    if (!isLinear) {
      ann.x1 = Math.min(g.x1, g.x2); ann.y1 = Math.min(g.y1, g.y2);
      ann.x2 = Math.max(g.x1, g.x2); ann.y2 = Math.max(g.y1, g.y2);
    }
    var id = store.addAnnotation(ann);
    store.setSelected(id);
    drag = null;
  }

  function cleanupPreview() {
    if (preview && preview.parentNode) preview.parentNode.removeChild(preview);
    preview = null;
  }

  // ---- Select / move / resize ---------------------------------------------

  function handleSelectDown(e, record, pt) {
    var handleNode = e.target.closest ? e.target.closest("[data-handle]") : null;
    var selId = store.getSelectedId();

    if (handleNode && selId) {
      var ann = store.getAnnotation(selId);
      if (ann) {
        capturePointer(e, record);
        startResize(ann, record, pt, handleNode.getAttribute("data-handle"));
        return;
      }
    }

    var annNode = e.target.closest ? e.target.closest("g.annot") : null;
    if (annNode) {
      var id = annNode.getAttribute("data-id");
      // Capture the pointer on the stable <svg> BEFORE re-rendering. Selecting
      // rebuilds the overlay's children (removing the element we pressed on),
      // which would otherwise strand the drag gesture on touch/pen devices.
      capturePointer(e, record);
      store.setSelected(id);
      var a = store.getAnnotation(id);
      startMove(a, record, pt);
    } else {
      store.setSelected(null);
    }
  }

  // Capture the active pointer on the page's SVG overlay so move/resize keep
  // receiving events even as annotation nodes are re-rendered mid-drag.
  function capturePointer(e, record) {
    try {
      if (e.pointerId != null && record.svg.setPointerCapture) {
        record.svg.setPointerCapture(e.pointerId);
      }
      activeCapture = { svg: record.svg, pointerId: e.pointerId };
    } catch (_) {
      activeCapture = null;
    }
  }

  function releasePointer() {
    if (activeCapture) {
      try {
        activeCapture.svg.releasePointerCapture(activeCapture.pointerId);
      } catch (_) {}
      activeCapture = null;
    }
  }

  function startMove(ann, record, pt) {
    store.beginHistory();
    drag = {
      mode: "move",
      id: ann.id,
      start: pt,
      orig: { x1: ann.x1, y1: ann.y1, x2: ann.x2, y2: ann.y2 },
      changed: false,
    };
    window.addEventListener("pointermove", onSelectMove);
    window.addEventListener("pointerup", onSelectUp);
  }

  function startResize(ann, record, pt, role) {
    store.beginHistory();
    drag = {
      mode: "resize",
      id: ann.id,
      role: role,
      record: record,
      orig: { x1: ann.x1, y1: ann.y1, x2: ann.x2, y2: ann.y2 },
      changed: false,
    };
    window.addEventListener("pointermove", onSelectMove);
    window.addEventListener("pointerup", onSelectUp);
  }

  function onSelectMove(e) {
    if (!drag) return;
    var ann = store.getAnnotation(drag.id);
    if (!ann) return;

    if (drag.mode === "move") {
      var rec = App.renderer.getPageRecords().filter(function (r) {
        return r.pageNum - 1 === ann.page;
      })[0];
      if (!rec) return;
      var pt = App.renderer.clientToPage(rec.svg, e.clientX, e.clientY);
      var dx = pt.x - drag.start.x;
      var dy = pt.y - drag.start.y;
      store.liveUpdate(ann.id, {
        x1: drag.orig.x1 + dx, y1: drag.orig.y1 + dy,
        x2: drag.orig.x2 + dx, y2: drag.orig.y2 + dy,
      });
      drag.changed = true;
    } else if (drag.mode === "resize") {
      var pt2 = App.renderer.clientToPage(drag.record.svg, e.clientX, e.clientY);
      applyResize(ann, drag.role, pt2, e.shiftKey);
      drag.changed = true;
    }
  }

  function applyResize(ann, role, pt, shift) {
    var isLinear = (ann.type === "line" || ann.type === "hline" ||
      ann.type === "vline" || ann.type === "arrow");

    if (isLinear) {
      if (role === "p1") {
        var nx1 = pt.x, ny1 = pt.y;
        if (ann.type === "hline") ny1 = ann.y2;
        if (ann.type === "vline") nx1 = ann.x2;
        store.liveUpdate(ann.id, { x1: nx1, y1: ny1 });
      } else {
        var nx2 = pt.x, ny2 = pt.y;
        if (ann.type === "hline") ny2 = ann.y1;
        if (ann.type === "vline") nx2 = ann.x1;
        store.liveUpdate(ann.id, { x2: nx2, y2: ny2 });
      }
      return;
    }

    // Box shapes: role is one of nw,n,ne,e,se,s,sw,w
    var x1 = ann.x1, y1 = ann.y1, x2 = ann.x2, y2 = ann.y2;
    if (role.indexOf("w") !== -1) x1 = pt.x;
    if (role.indexOf("e") !== -1) x2 = pt.x;
    if (role.indexOf("n") !== -1) y1 = pt.y;
    if (role.indexOf("s") !== -1) y2 = pt.y;

    // normalize
    var nx1 = Math.min(x1, x2), ny1 = Math.min(y1, y2);
    var nx2 = Math.max(x1, x2), ny2 = Math.max(y1, y2);
    store.liveUpdate(ann.id, { x1: nx1, y1: ny1, x2: nx2, y2: ny2 });
  }

  function onSelectUp() {
    window.removeEventListener("pointermove", onSelectMove);
    window.removeEventListener("pointerup", onSelectUp);
    releasePointer();
    if (drag && !drag.changed) {
      store.cancelHistory(); // nothing moved; drop the snapshot
    }
    drag = null;
  }

  // ---- Text ----------------------------------------------------------------

  function startTextCreate(record, pt) {
    store.setSelected(null);
    var ann = {
      id: store.uid(),
      type: "text",
      page: record.pageNum - 1,
      x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y,
      color: store.settings.color,
      fontSize: store.settings.fontSize,
      text: "",
    };
    openTextEditor(record, ann, true);
  }

  function onDoubleClick(e, record) {
    var annNode = e.target.closest ? e.target.closest("g.annot") : null;
    if (!annNode) return;
    var id = annNode.getAttribute("data-id");
    var ann = store.getAnnotation(id);
    if (ann && ann.type === "text") {
      openTextEditor(record, ann, false);
    }
  }

  function openTextEditor(record, ann, isNew) {
    if (activeEditor) commitEditor();

    var zoom = store.doc.zoom;
    var ta = document.createElement("textarea");
    ta.className = "text-editor";
    ta.value = ann.text || "";
    ta.style.left = (ann.x1 * zoom) + "px";
    ta.style.top = (ann.y1 * zoom) + "px";
    ta.style.color = ann.color;
    ta.style.fontSize = (ann.fontSize * zoom) + "px";
    ta.style.lineHeight = "1.25";

    record.wrapper.appendChild(ta);

    activeEditor = {
      ta: ta,
      ann: ann,
      record: record,
      isNew: isNew,
    };

    // Focus on the next tick so the browser's default focus handling for the
    // originating click can't immediately blur the editor.
    setTimeout(function () {
      ta.focus();
      ta.select();
    }, 0);

    autoSize(ta);
    ta.addEventListener("input", function () { autoSize(ta); });
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancelEditor();
      } else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        commitEditor();
      }
    });
    ta.addEventListener("blur", function () {
      // slight delay so toolbar clicks can run first
      setTimeout(commitEditor, 50);
    });
  }

  function autoSize(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    ta.style.width = "auto";
    ta.style.width = Math.max(60, ta.scrollWidth + 4) + "px";
  }

  function commitEditor() {
    if (!activeEditor) return;
    var ed = activeEditor;
    activeEditor = null;
    var value = ed.ta.value;
    if (ed.ta.parentNode) ed.ta.parentNode.removeChild(ed.ta);

    if (!value.trim()) {
      // empty -> remove if it already existed
      if (!ed.isNew) store.removeAnnotation(ed.ann.id);
      return;
    }

    if (ed.isNew) {
      store.addAnnotation({
        id: ed.ann.id,
        type: "text",
        page: ed.ann.page,
        x1: ed.ann.x1, y1: ed.ann.y1, x2: ed.ann.x1, y2: ed.ann.y1,
        color: ed.ann.color,
        fontSize: ed.ann.fontSize,
        text: value,
      });
      store.setSelected(ed.ann.id);
    } else {
      store.updateAnnotation(ed.ann.id, { text: value });
    }
  }

  function cancelEditor() {
    if (!activeEditor) return;
    var ed = activeEditor;
    activeEditor = null;
    if (ed.ta.parentNode) ed.ta.parentNode.removeChild(ed.ta);
  }

  App.tools = {
    bindPage: bindPage,
    commitEditor: commitEditor,
    isEditing: function () { return !!activeEditor; },
    addImageFromFile: addImageFromFile,
  };

  // ---- Images --------------------------------------------------------------

  // Load a PNG/JPEG file, place it centered on the page the user is viewing,
  // scaled to fit, and select it so it can be moved/resized immediately.
  function addImageFromFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      alert("Please choose a PNG or JPEG image.");
      return;
    }
    if (!store.doc.pdfDoc) {
      alert("Open a PDF first, then add an image onto it.");
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var src = reader.result; // data URL
      var probe = new Image();
      probe.onload = function () {
        placeImage(src, probe.naturalWidth, probe.naturalHeight);
      };
      probe.onerror = function () { alert("That image could not be loaded."); };
      probe.src = src;
    };
    reader.onerror = function () { alert("Could not read the image file."); };
    reader.readAsDataURL(file);
  }

  function placeImage(src, natW, natH) {
    var rec = App.renderer.getCurrentPageRecord();
    if (!rec) return;

    var pageW = rec.width, pageH = rec.height;
    // Fit within ~60% of the page while preserving aspect ratio.
    var maxW = pageW * 0.6, maxH = pageH * 0.6;
    var ratio = Math.min(maxW / natW, maxH / natH, 1);
    var w = Math.max(20, natW * ratio);
    var h = Math.max(20, natH * ratio);
    var x = (pageW - w) / 2;
    var y = (pageH - h) / 2;

    var id = store.addAnnotation({
      type: "image",
      page: rec.pageNum - 1,
      x1: x, y1: y, x2: x + w, y2: y + h,
      src: src,
      opacity: 1,
    });
    store.setTool("select");
    store.setSelected(id);
  }
})(window.App);
