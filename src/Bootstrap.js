/** file:// disallows ES-module requests. Keep a zero-server fallback. */
(async function () {
  const base = new URL(".", document.currentScript.src);
  try {
    if (location.protocol !== "file:") {
      await import(new URL("main.js", base).href);
      return;
    }
    const files = [
      "Geometry.js",
      "vendor/polygon-clipping.umd.js",
      "Boolean.js",
      "Materials.js",
      "Model.js",
      "GeometryEngine.js",
      "Hatching.js",
      "Markings.js",
      "vendor/LiberationSansData.js",
      "PdfFont.js",
      "PdfPreview.js",
      "Tooltips.js",
      "Dropdowns.js",
      "Scene.js",
      "Woodworking.js",
      "CanvasManager.js",
      "Tools.js",
      "BOMManager.js",
      "PDFExporter.js",
      "SheetComposer.js",
      "PropertyPanel.js",
      "ToolSystem.js",
      "Errors.js",
      "App.js",
    ];
    for (const file of files)
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = new URL(file, base).href;
        script.onload = resolve;
        script.onerror = () =>
          reject(new Error("Nepodařilo se načíst " + file));
        document.head.append(script);
      });
  } catch (error) {
    console.error(error);
    const message = document.createElement("p");
    message.textContent = "Aplikaci nelze načíst: " + error.message;
    document.body.append(message);
  }
})();
