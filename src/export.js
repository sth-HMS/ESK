const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function imageToDataUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".webp" ? "image/webp" :
    ext === ".svg" ? "image/svg+xml" :
    "";
  if (!mime) {
    return "";
  }
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function buildSections(project) {
  if (project.documentDraft?.sections?.length) {
    return project.documentDraft.sections;
  }
  const extracted = project.parsedWorkbook?.extracted || {};
  const metadata = extracted.metadata || {};
  const ownershipRows = (extracted.hlutfallstolur || []).filter((row) => row.ownership).slice(0, 20);
  const sameignRows = (extracted.sameignSumra || []).slice(0, 20);
  const lysingRows = (extracted.lysing || []).slice(0, 20);

  if (metadata.propertyName || ownershipRows.length || sameignRows.length || lysingRows.length) {
    return [
      {
        heading: "Almennar upplýsingar",
        body: `Eignaskiptayfirlýsing þessi tekur til ${metadata.propertyName || project.propertyInfo?.address || project.name}. Matshluti er ${metadata.matshlutiNumber || project.cover?.matshluti || "óskráður"} og landeignanúmer ${metadata.landeignNumber || project.cover?.landeignNumber || "óskráð"}.`,
      },
      {
        heading: "Séreignir og eignarhald",
        body: ownershipRows.length
          ? ownershipRows
              .map((row) => `${row.ownership} - ${row.usage || "Eining"}; fasteignanr. ${row.fasteignanumer || "óskráð"}; birt flatarmál ${row.birtFlatarmal || "óskráð"} m²; hlutfall í mhl ${row.hlutfallMhl || "óskráð"}%.`)
              .join(" ")
          : "Ekki tókst að draga út eignarhald og hlutfallstölur úr skráningartöflu.",
      },
      {
        heading: "Lýsing séreigna",
        body: lysingRows.length
          ? lysingRows
              .map((row) => {
                const items = (row.items || [])
                  .filter((item) => item.usage && !/notkun/i.test(item.usage))
                  .map((item) => (item.birtFlatarmal ? `${item.usage} (${item.birtFlatarmal} m²)` : item.usage))
                  .join(", ");
                return `${row.ownership}: ${items || "nánari lýsing vantar"}.`;
              })
              .join(" ")
          : "Ekki tókst að draga út nánari lýsingu eignarhaldsnúmera.",
      },
      {
        heading: "Sameign og sameign sumra",
        body: sameignRows.length
          ? sameignRows
              .map((row) => `${row.code} - ${row.usage}; tengist ${row.ownerGroup || "óskráðum hópi"}; eignarhlutur ${row.share || "óskráður"}.`)
              .join(" ")
          : "Engin sameign sumra fannst í innlesnum gögnum.",
      },
    ];
  }
  return [
    {
      heading: "Yfirlit",
      body: "Drög hafa ekki verið fullgerð. Myndaðu grunntexta eða fylltu út texta handvirkt áður en PDF er útbúið.",
    },
  ];
}

function renderProjectHtml(project) {
  const cover = project.cover || {};
  const uploadsRoot = path.join(__dirname, "..", "data", "uploads");
  const logoData = imageToDataUrl(cover.logoImagePath ? path.join(uploadsRoot, cover.logoImagePath.replace(/^\/uploads\//, "")) : "");
  const coverImageData = imageToDataUrl(cover.coverImagePath ? path.join(uploadsRoot, cover.coverImagePath.replace(/^\/uploads\//, "")) : "");
  const sections = buildSections(project);
  const appendices = project.pdfUploads || [];
  const generatedDate = new Date().toLocaleDateString("is-IS");

  return `<!doctype html>
<html lang="is">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(cover.title || "Eignaskiptayfirlýsing")}</title>
  <style>
    @page { size: A4; margin: 20mm 16mm 18mm 16mm; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 0; }
    .page-break { page-break-before: always; }
    .cover { min-height: 257mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 10mm 0 4mm; text-align: center; }
    .cover h1 { font-size: 22pt; letter-spacing: 0.04em; margin: 0 0 16pt; font-weight: 500; }
    .cover .meta { font-size: 14pt; line-height: 1.7; }
    .cover .visual { margin: 18pt 0; }
    .cover .visual img { max-width: 120mm; max-height: 85mm; object-fit: contain; }
    .logo img { max-width: 70mm; max-height: 24mm; object-fit: contain; }
    .prepared-by { align-self: flex-end; text-align: right; font-size: 10.5pt; line-height: 1.45; margin-top: 10mm; }
    .doc-header { border-bottom: 1px solid #b8b8b8; padding-bottom: 8pt; margin-bottom: 18pt; }
    .doc-header h2 { margin: 0; font-size: 16pt; }
    .doc-header .sub { margin-top: 5pt; font-size: 10.5pt; color: #444; }
    .section { margin-bottom: 18pt; }
    .section h3 { font-size: 13pt; margin: 0 0 7pt; }
    .section p { margin: 0; line-height: 1.55; white-space: pre-wrap; }
    table.meta-table { width: 100%; border-collapse: collapse; margin-bottom: 18pt; }
    .meta-table td { padding: 6pt 4pt; border-bottom: 1px solid #ddd; vertical-align: top; }
    .meta-table td:first-child { width: 32%; font-weight: 600; }
    .appendix-list li { margin: 0 0 6pt; }
    .footer-note { margin-top: 24pt; font-size: 10pt; color: #555; }
  </style>
</head>
<body>
  <section class="cover">
    <div style="width:100%;">
      <h1>${escapeHtml(cover.title || "EIGNASKIPTAYFIRLÝSING")}</h1>
      <div class="meta">
        <div>${escapeHtml(cover.propertyName || project.propertyInfo?.address || project.name)}</div>
        ${cover.matshluti ? `<div>Matshluti ${escapeHtml(cover.matshluti)}</div>` : ""}
        ${cover.landeignNumber ? `<div>Landeignanúmer ${escapeHtml(cover.landeignNumber)}</div>` : ""}
        ${cover.fasteignNumber ? `<div>Fasteignanúmer ${escapeHtml(cover.fasteignNumber)}</div>` : ""}
      </div>
    </div>
    ${coverImageData ? `<div class="visual"><img src="${coverImageData}" alt="Forsíðumynd" /></div>` : `<div style="flex:1;"></div>`}
    <div style="width:100%;">
      <div class="prepared-by">
        ${escapeHtml(generatedDate)}<br />
        ${escapeHtml(cover.preparedByName)}<br />
        ${escapeHtml(cover.preparedByCompany)}<br />
        ${escapeHtml(cover.preparedByTitle)}<br />
        ${escapeHtml(cover.preparedByEmail)}<br />
        ${escapeHtml(cover.preparedByPhone)}
      </div>
      ${logoData ? `<div class="logo"><img src="${logoData}" alt="Lógó" /></div>` : ""}
    </div>
  </section>

  <section class="page-break">
    <div class="doc-header">
      <h2>${escapeHtml(cover.title || "Eignaskiptayfirlýsing")}</h2>
      <div class="sub">${escapeHtml(cover.propertyName || project.propertyInfo?.address || project.name)}</div>
    </div>

    <table class="meta-table">
      <tr><td>Heiti máls</td><td>${escapeHtml(project.name)}</td></tr>
      <tr><td>Heimilisfang</td><td>${escapeHtml(project.propertyInfo?.address || "")}</td></tr>
      <tr><td>Sveitarfélag</td><td>${escapeHtml(project.propertyInfo?.municipality || "")}</td></tr>
      <tr><td>Matshluti</td><td>${escapeHtml(cover.matshluti || "")}</td></tr>
      <tr><td>Landeignanúmer</td><td>${escapeHtml(cover.landeignNumber || "")}</td></tr>
      <tr><td>Fasteignanúmer</td><td>${escapeHtml(cover.fasteignNumber || "")}</td></tr>
      <tr><td>Staða máls</td><td>${escapeHtml(project.status || "")}</td></tr>
    </table>

    ${sections
      .map(
        (section) => `<div class="section"><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p></div>`,
      )
      .join("\n")}

    <div class="section">
      <h3>Viðaukar</h3>
      ${
        appendices.length
          ? `<ol class="appendix-list">${appendices.map((pdf) => `<li>${escapeHtml(pdf.filename)}</li>`).join("")}</ol>`
          : `<p>Engin PDF fylgiskjöl hafa verið skráð með málinu.</p>`
      }
    </div>

    ${cover.footerNote ? `<div class="footer-note">${escapeHtml(cover.footerNote)}</div>` : ""}
  </section>
</body>
</html>`;
}

function resolveBrowserPath() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function renderPdfFromHtml(html) {
  const browser = resolveBrowserPath();
  if (!browser) {
    throw new Error("Fann hvorki Microsoft Edge né Google Chrome til að búa til PDF.");
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "esk-export-"));
  const htmlPath = path.join(tempDir, "document.html");
  const pdfPath = path.join(tempDir, `${crypto.randomUUID()}.pdf`);
  const profileDir = path.join(tempDir, "browser-profile");
  fs.writeFileSync(htmlPath, html, "utf8");

  const sharedArgs = [
    "--disable-gpu",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-crashpad-for-testing",
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    "--noerrdialogs",
    `--user-data-dir=${profileDir}`,
    "--print-to-pdf-no-header",
    `--print-to-pdf=${pdfPath}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ];

  const attempts = [
    ["--headless=new", ...sharedArgs],
    ["--headless", ...sharedArgs],
  ];

  let lastError = "PDF útflutningur mistókst.";
  for (const args of attempts) {
    const result = spawnSync(browser, args, { encoding: "utf8", timeout: 120000 });
    if (result.status === 0 && fs.existsSync(pdfPath)) {
      return {
        pdfPath,
        cleanup() {
          fs.rmSync(tempDir, { recursive: true, force: true });
        },
      };
    }
    lastError = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join(" | ") || lastError;
  }
  throw new Error(lastError.trim());
}

module.exports = {
  renderProjectHtml,
  renderPdfFromHtml,
};
