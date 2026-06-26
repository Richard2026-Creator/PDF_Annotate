/**
 * exporter.js
 * Bakes annotations into the original PDF using pdf-lib and downloads it.
 *
 * Coordinate mapping:
 *   Stored annotations use a TOP-LEFT origin in unscaled page points (matching
 *   pdf.js at scale 1). pdf-lib uses a BOTTOM-LEFT origin, so:
 *      y_pdf = pageHeight - y_top
 */
window.App = window.App || {};

(function (App) {
  "use strict";

  var store = App.store;

  function hexToRgb(hex) {
    var PDFLib = window.PDFLib;
    var h = (hex || "#000000").replace("#", "");
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var r = parseInt(h.substring(0, 2), 16) / 255;
    var g = parseInt(h.substring(2, 4), 16) / 255;
    var b = parseInt(h.substring(4, 6), 16) / 255;
    return PDFLib.rgb(r, g, b);
  }

  async function exportPdf() {
    if (!store.doc.pdfBytes) {
      alert("Open a PDF first.");
      return;
    }
    if (App.tools && App.tools.isEditing()) App.tools.commitEditor();

    App.renderer.showLoading("Generating annotated PDF…");
    try {
      var PDFLib = window.PDFLib;
      var pdfDoc = await PDFLib.PDFDocument.load(store.doc.pdfBytes.slice(0));
      var font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      var pages = pdfDoc.getPages();

      var anns = store.annotations();

      // Pre-embed all images (async) and cache by data URL.
      var imageCache = {};
      for (var k = 0; k < anns.length; k++) {
        var im = anns[k];
        if (im.type === "image" && !imageCache[im.src]) {
          imageCache[im.src] = await embedImage(pdfDoc, im.src);
        }
      }

      anns.forEach(function (a) {
        var page = pages[a.page];
        if (!page) return;
        var H = page.getSize().height;
        drawAnnotation(page, a, H, font, imageCache);
      });

      var bytes = await pdfDoc.save();
      downloadBytes(bytes, outName(store.doc.fileName));
    } catch (err) {
      console.error(err);
      alert("Export failed: " + (err && err.message ? err.message : err));
    } finally {
      App.renderer.hideLoading();
    }
  }

  function drawAnnotation(page, a, H, font, imageCache) {
    var PDFLib = window.PDFLib;
    var color = hexToRgb(a.color);
    var sw = a.strokeWidth || 2;
    var op = a.opacity == null ? 1 : a.opacity;

    if (a.type === "image") {
      var embedded = imageCache && imageCache[a.src];
      if (!embedded) return;
      var iw = Math.abs(a.x2 - a.x1);
      var ih = Math.abs(a.y2 - a.y1);
      var ix = Math.min(a.x1, a.x2);
      var iyTop = Math.min(a.y1, a.y2);
      page.drawImage(embedded, {
        x: ix, y: H - (iyTop + ih), width: iw, height: ih, opacity: op,
      });
      return;
    }

    if (a.type === "highlight") {
      var hw = Math.abs(a.x2 - a.x1);
      var hh = Math.abs(a.y2 - a.y1);
      var hx = Math.min(a.x1, a.x2);
      var hy = Math.min(a.y1, a.y2);
      page.drawRectangle({
        x: hx, y: H - (hy + hh), width: hw, height: hh,
        color: color, opacity: op,
      });
    } else if (a.type === "rect") {
      var rw = Math.abs(a.x2 - a.x1);
      var rh = Math.abs(a.y2 - a.y1);
      var rx = Math.min(a.x1, a.x2);
      var ry = Math.min(a.y1, a.y2);
      var opts = {
        x: rx, y: H - (ry + rh), width: rw, height: rh,
        borderColor: color, borderWidth: sw, borderOpacity: op,
      };
      if (a.fill) { opts.color = color; opts.opacity = op * 0.35; }
      page.drawRectangle(opts);
    } else if (a.type === "ellipse") {
      var ew = Math.abs(a.x2 - a.x1);
      var eh = Math.abs(a.y2 - a.y1);
      var ecx = Math.min(a.x1, a.x2) + ew / 2;
      var ecyTop = Math.min(a.y1, a.y2) + eh / 2;
      var eopts = {
        x: ecx, y: H - ecyTop, xScale: ew / 2, yScale: eh / 2,
        borderColor: color, borderWidth: sw, borderOpacity: op,
      };
      if (a.fill) { eopts.color = color; eopts.opacity = op * 0.35; }
      page.drawEllipse(eopts);
    } else if (a.type === "line" || a.type === "hline" || a.type === "vline") {
      page.drawLine({
        start: { x: a.x1, y: H - a.y1 },
        end: { x: a.x2, y: H - a.y2 },
        thickness: sw, color: color, opacity: op,
      });
    } else if (a.type === "arrow") {
      drawArrow(page, a, H, color, sw, op);
    } else if (a.type === "text") {
      var size = a.fontSize || 16;
      page.drawText(a.text || "", {
        x: a.x1,
        y: H - a.y1 - size,
        size: size,
        font: font,
        color: color,
        lineHeight: size * 1.25,
      });
    }
  }

  function drawArrow(page, a, H, color, sw, op) {
    page.drawLine({
      start: { x: a.x1, y: H - a.y1 },
      end: { x: a.x2, y: H - a.y2 },
      thickness: sw, color: color, opacity: op,
    });
    var angle = Math.atan2((H - a.y2) - (H - a.y1), a.x2 - a.x1);
    var len = Math.max(8, sw * 4);
    var spread = Math.PI / 7;
    var tipx = a.x2, tipy = H - a.y2;
    var p1 = { x: tipx - len * Math.cos(angle - spread), y: tipy - len * Math.sin(angle - spread) };
    var p2 = { x: tipx - len * Math.cos(angle + spread), y: tipy - len * Math.sin(angle + spread) };
    page.drawLine({ start: { x: tipx, y: tipy }, end: p1, thickness: sw, color: color, opacity: op });
    page.drawLine({ start: { x: tipx, y: tipy }, end: p2, thickness: sw, color: color, opacity: op });
  }

  // Embed a PNG/JPEG data URL into the pdf-lib document.
  async function embedImage(pdfDoc, dataUrl) {
    try {
      if (/^data:image\/png/i.test(dataUrl)) {
        return await pdfDoc.embedPng(dataUrl);
      }
      return await pdfDoc.embedJpg(dataUrl);
    } catch (e) {
      console.error("Failed to embed image", e);
      return null;
    }
  }

  function outName(name) {
    if (!name) return "annotated.pdf";
    return name.replace(/\.pdf$/i, "") + "-annotated.pdf";
  }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  App.exporter = { exportPdf: exportPdf };
})(window.App);
