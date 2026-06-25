/**
 * renderer.js
 * - Loads a PDF with pdf.js
 * - Renders each page to a <canvas>
 * - Builds an interactive <svg> annotation overlay per page (viewBox = unscaled
 *   page size, so all zoom is handled by CSS sizing)
 * - Draws annotations + selection adornments as SVG
 */
window.App = window.App || {};

(function (App) {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var store = App.store;

  // Configure pdf.js worker (served from the same CDN version)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  var pagesEl = null;
  var pageRecords = []; // [{ pageNum, wrapper, canvas, svg, width, height }]

  function el(id) { return document.getElementById(id); }

  function svgEl(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  // ---- Load + render -------------------------------------------------------

  async function loadPdf(arrayBuffer, fileName) {
    showLoading("Rendering PDF…");
    try {
      // Keep an untouched copy of the bytes for export (pdf.js transfers/detaches the buffer).
      store.doc.pdfBytes = arrayBuffer.slice(0);

      var task = pdfjsLib.getDocument({ data: arrayBuffer });
      var pdf = await task.promise;

      store.doc.pdfDoc = pdf;
      store.doc.numPages = pdf.numPages;
      store.doc.fileName = fileName;
      store.doc.zoom = 1;
      store.doc.pageSizes = [];
      store.resetDocument();

      // Measure all pages first (unscaled sizes)
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var vp = page.getViewport({ scale: 1 });
        store.doc.pageSizes[i - 1] = { width: vp.width, height: vp.height };
      }

      await renderAllPages();
      store.emit("document-loaded");
    } catch (err) {
      console.error(err);
      alert("Could not open this PDF: " + (err && err.message ? err.message : err));
    } finally {
      hideLoading();
    }
  }

  async function renderAllPages() {
    pagesEl = el("pages");
    pagesEl.innerHTML = "";
    pageRecords = [];

    var pdf = store.doc.pdfDoc;
    if (!pdf) return;

    el("empty-state").style.display = "none";

    for (var i = 1; i <= pdf.numPages; i++) {
      await renderPage(i);
    }
    drawAnnotations();
  }

  async function renderPage(pageNum) {
    var pdf = store.doc.pdfDoc;
    var page = await pdf.getPage(pageNum);
    var zoom = store.doc.zoom;
    var dpr = window.devicePixelRatio || 1;

    var baseVp = page.getViewport({ scale: 1 });
    var renderVp = page.getViewport({ scale: zoom * dpr });
    var cssWidth = baseVp.width * zoom;
    var cssHeight = baseVp.height * zoom;

    // Wrapper
    var wrapper = document.createElement("div");
    wrapper.className = "page";
    wrapper.dataset.page = pageNum;
    wrapper.style.width = cssWidth + "px";
    wrapper.style.height = cssHeight + "px";

    var pageLabel = document.createElement("div");
    pageLabel.className = "page-number";
    pageLabel.textContent = "Page " + pageNum + " / " + pdf.numPages;

    // Canvas (rendered at dpr for crispness, displayed at css size)
    var canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderVp.width);
    canvas.height = Math.floor(renderVp.height);
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    canvas.className = "page-canvas";

    var ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: renderVp }).promise;

    // SVG overlay (viewBox = unscaled page; CSS sized to match canvas)
    var svg = svgEl("svg", {
      class: "annot-layer",
      viewBox: "0 0 " + baseVp.width + " " + baseVp.height,
      preserveAspectRatio: "none",
    });
    svg.style.width = cssWidth + "px";
    svg.style.height = cssHeight + "px";
    svg.dataset.page = pageNum;

    wrapper.appendChild(canvas);
    wrapper.appendChild(svg);
    wrapper.appendChild(pageLabel);
    pagesEl.appendChild(wrapper);

    var record = {
      pageNum: pageNum,
      wrapper: wrapper,
      canvas: canvas,
      svg: svg,
      width: baseVp.width,
      height: baseVp.height,
    };
    pageRecords.push(record);

    // Let the tools module attach interaction handlers to this overlay.
    if (App.tools && App.tools.bindPage) {
      App.tools.bindPage(record);
    }
  }

  // Re-render at a new zoom level without re-parsing the document.
  async function setZoom(zoom) {
    store.doc.zoom = Math.max(0.25, Math.min(4, zoom));
    await renderAllPages();
    store.emit("zoom-changed");
  }

  // ---- Coordinate conversion ----------------------------------------------

  // Convert a pointer event to unscaled page coordinates for a given svg overlay.
  function clientToPage(svg, clientX, clientY) {
    var pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    var ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    var p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  // ---- Annotation drawing --------------------------------------------------

  function bbox(a) {
    if (a.type === "text") {
      var m = textMetrics(a);
      return { x: a.x1, y: a.y1, w: m.width, h: m.height };
    }
    return {
      x: Math.min(a.x1, a.x2),
      y: Math.min(a.y1, a.y2),
      w: Math.abs(a.x2 - a.x1),
      h: Math.abs(a.y2 - a.y1),
    };
  }

  function textMetrics(a) {
    var lines = (a.text || "").split("\n");
    var fs = a.fontSize || 16;
    var lineH = fs * 1.25;
    var maxLen = 0;
    lines.forEach(function (l) { maxLen = Math.max(maxLen, l.length); });
    return {
      lines: lines,
      lineHeight: lineH,
      width: Math.max(20, maxLen * fs * 0.55),
      height: Math.max(lineH, lines.length * lineH),
    };
  }

  function drawAnnotations() {
    pageRecords.forEach(function (rec) {
      var svg = rec.svg;
      // Clear everything except nothing (overlay only holds annotations)
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      // Transparent background guarantees the overlay captures clicks on empty
      // areas (for drawing new shapes / deselecting).
      svg.appendChild(svgEl("rect", {
        x: 0, y: 0, width: rec.width, height: rec.height,
        fill: "transparent", "pointer-events": "all", class: "annot-bg",
      }));

      var anns = store.getAnnotationsForPage(rec.pageNum - 1);
      anns.forEach(function (a) {
        var node = buildAnnotationNode(a);
        if (node) svg.appendChild(node);
      });

      // Selection adornment on top
      var selId = store.getSelectedId();
      var sel = anns.filter(function (a) { return a.id === selId; })[0];
      if (sel) {
        var adorn = buildSelection(sel);
        if (adorn) svg.appendChild(adorn);
      }
    });
  }

  function buildAnnotationNode(a) {
    var g = svgEl("g", { "data-id": a.id, class: "annot" });
    g.style.cursor = store.settings.tool === "select" ? "move" : "default";

    var stroke = a.color;
    var sw = a.strokeWidth || 2;
    var op = a.opacity == null ? 1 : a.opacity;

    if (a.type === "highlight") {
      var bb = bbox(a);
      g.appendChild(svgEl("rect", {
        x: bb.x, y: bb.y, width: bb.w, height: bb.h,
        fill: a.color, "fill-opacity": op, stroke: "none",
      }));
    } else if (a.type === "rect") {
      var b = bbox(a);
      g.appendChild(svgEl("rect", {
        x: b.x, y: b.y, width: b.w, height: b.h,
        fill: a.fill ? a.color : "none",
        "fill-opacity": a.fill ? op * 0.35 : 0,
        stroke: stroke, "stroke-width": sw, "stroke-opacity": op,
        "pointer-events": "all", // make hollow shape grabbable by its whole area
      }));
    } else if (a.type === "ellipse") {
      var e = bbox(a);
      g.appendChild(svgEl("ellipse", {
        cx: e.x + e.w / 2, cy: e.y + e.h / 2,
        rx: e.w / 2, ry: e.h / 2,
        fill: a.fill ? a.color : "none",
        "fill-opacity": a.fill ? op * 0.35 : 0,
        stroke: stroke, "stroke-width": sw, "stroke-opacity": op,
        "pointer-events": "all",
      }));
    } else if (a.type === "line" || a.type === "hline" || a.type === "vline") {
      // invisible wide hit area for easy selection
      g.appendChild(svgEl("line", {
        x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
        stroke: "transparent", "stroke-width": Math.max(sw + 8, 12),
        "pointer-events": "stroke",
      }));
      g.appendChild(svgEl("line", {
        x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
        stroke: stroke, "stroke-width": sw, "stroke-opacity": op,
        "stroke-linecap": "round",
      }));
    } else if (a.type === "arrow") {
      appendArrow(g, a, stroke, sw, op);
    } else if (a.type === "text") {
      appendText(g, a);
    }

    return g;
  }

  function appendArrow(g, a, stroke, sw, op) {
    g.appendChild(svgEl("line", {
      x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
      stroke: "transparent", "stroke-width": Math.max(sw + 8, 12),
      "pointer-events": "stroke",
    }));
    g.appendChild(svgEl("line", {
      x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
      stroke: stroke, "stroke-width": sw, "stroke-opacity": op,
      "stroke-linecap": "round",
    }));
    // Arrowhead
    var angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    var len = Math.max(8, sw * 4);
    var spread = Math.PI / 7;
    var p1x = a.x2 - len * Math.cos(angle - spread);
    var p1y = a.y2 - len * Math.sin(angle - spread);
    var p2x = a.x2 - len * Math.cos(angle + spread);
    var p2y = a.y2 - len * Math.sin(angle + spread);
    g.appendChild(svgEl("polygon", {
      points: a.x2 + "," + a.y2 + " " + p1x + "," + p1y + " " + p2x + "," + p2y,
      fill: stroke, "fill-opacity": op, stroke: "none",
    }));
  }

  function appendText(g, a) {
    var m = textMetrics(a);
    var fs = a.fontSize || 16;
    // invisible hit area for easy selection/move
    g.appendChild(svgEl("rect", {
      x: a.x1, y: a.y1, width: m.width, height: m.height,
      fill: "transparent", stroke: "none",
    }));
    var text = svgEl("text", {
      x: a.x1, y: a.y1,
      fill: a.color,
      "font-size": fs,
      "font-family": "Helvetica, Arial, sans-serif",
    });
    m.lines.forEach(function (line, i) {
      var tspan = svgEl("tspan", {
        x: a.x1,
        y: a.y1 + (i + 1) * m.lineHeight - m.lineHeight * 0.25,
      });
      tspan.textContent = line.length ? line : " ";
      text.appendChild(tspan);
    });
    g.appendChild(text);
  }

  function buildSelection(a) {
    var g = svgEl("g", { class: "selection-adorn", "data-id": a.id });
    var isLinear = a.type === "line" || a.type === "hline" ||
      a.type === "vline" || a.type === "arrow";

    if (isLinear) {
      // endpoint handles
      g.appendChild(handle(a.x1, a.y1, "p1"));
      g.appendChild(handle(a.x2, a.y2, "p2"));
      // faint guide line
      g.appendChild(svgEl("line", {
        x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
        stroke: "#2962ff", "stroke-width": 1, "stroke-dasharray": "4 3",
        "stroke-opacity": 0.6, "vector-effect": "non-scaling-stroke",
      }));
    } else {
      var b = bbox(a);
      g.appendChild(svgEl("rect", {
        x: b.x, y: b.y, width: b.w, height: b.h,
        fill: "none", stroke: "#2962ff", "stroke-width": 1,
        "stroke-dasharray": "5 3", "vector-effect": "non-scaling-stroke",
      }));
      // corner + edge handles (text only gets corners-less move handle box)
      if (a.type !== "text") {
        var hs = [
          ["nw", b.x, b.y], ["n", b.x + b.w / 2, b.y], ["ne", b.x + b.w, b.y],
          ["e", b.x + b.w, b.y + b.h / 2], ["se", b.x + b.w, b.y + b.h],
          ["s", b.x + b.w / 2, b.y + b.h], ["sw", b.x, b.y + b.h],
          ["w", b.x, b.y + b.h / 2],
        ];
        hs.forEach(function (h) {
          g.appendChild(handle(h[1], h[2], h[0]));
        });
      }
    }
    return g;
  }

  function handle(x, y, role) {
    var h = svgEl("rect", {
      x: x, y: y, width: 9, height: 9,
      class: "handle", "data-handle": role,
      fill: "#fff", stroke: "#2962ff", "stroke-width": 1.5,
      "vector-effect": "non-scaling-stroke",
    });
    // center the handle on the point regardless of zoom: use a transform group
    var wrap = svgEl("g", { transform: "translate(" + x + "," + y + ")" });
    h.setAttribute("x", -4.5);
    h.setAttribute("y", -4.5);
    h.setAttribute("transform", "");
    // Keep handle visually constant size via non-scaling — but width/height are in
    // user units; acceptable for typical zoom. Append directly.
    wrap.appendChild(h);
    return wrap;
  }

  // ---- Loading overlay -----------------------------------------------------

  function showLoading(msg) {
    var l = el("loading");
    el("loading-text").textContent = msg || "Loading…";
    l.classList.remove("hidden");
  }
  function hideLoading() {
    el("loading").classList.add("hidden");
  }

  // Redraw when annotations or selection change
  store.on("annotations", drawAnnotations);
  store.on("selection", drawAnnotations);

  App.renderer = {
    loadPdf: loadPdf,
    setZoom: setZoom,
    clientToPage: clientToPage,
    drawAnnotations: drawAnnotations,
    getPageRecords: function () { return pageRecords; },
    bbox: bbox,
    textMetrics: textMetrics,
    showLoading: showLoading,
    hideLoading: hideLoading,
  };
})(window.App);
