const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { resolveProjectData } = require("./export-modern");
const { repairText } = require("./encoding");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;

function resolveUploadPath(publicPath) {
  if (!publicPath) {
    return "";
  }
  return path.join(__dirname, "..", "data", publicPath.replace(/^\//, "").replace(/\//g, path.sep));
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = String(value).replace(/\s/g, "").replace(/,/g, ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function formatNumber(value) {
  const num = parseNumber(value);
  if (num === null) {
    return repairText(String(value || ""));
  }
  return new Intl.NumberFormat("is-IS", { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(num);
}

function cleanText(value) {
  return repairText(String(value ?? "")).normalize("NFC").replace(/\r/g, "").trim();
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of cleanText(text).split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) {
      lines.push(current);
    }
    if (!words.length) {
      lines.push("");
    }
  }
  return lines.length ? lines : [""];
}

async function embedImage(document, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  const bytes = fs.readFileSync(filePath);
  if (ext === ".png") {
    return document.embedPng(bytes);
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return document.embedJpg(bytes);
  }
  return null;
}

function drawWrapped(page, text, x, y, maxWidth, font, size, color = rgb(0.09, 0.19, 0.33), lineHeight = size * 1.35) {
  let cursor = y;
  for (const line of wrapText(text, font, size, maxWidth)) {
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= lineHeight;
  }
  return cursor;
}

function drawMetaCard(page, x, y, width, height, label, value, boldFont, regularFont) {
  page.drawRectangle({ x, y: y - height, width, height, borderWidth: 1, borderColor: rgb(0.85, 0.9, 0.95), color: rgb(0.98, 0.99, 1) });
  page.drawText(label, { x: x + 10, y: y - 14, size: 9, font: boldFont, color: rgb(0.36, 0.45, 0.57) });
  page.drawText(cleanText(value || "—"), { x: x + 10, y: y - 32, size: 11, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
}

function addContentPage(document, cover, generatedDate, regularFont, boldFont) {
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawText(cleanText(cover.title || "Eignaskiptayfirlýsing"), { x: MARGIN, y: PAGE_HEIGHT - 48, size: 18, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
  page.drawText(cleanText(cover.propertyName || ""), { x: MARGIN, y: PAGE_HEIGHT - 68, size: 10.5, font: regularFont, color: rgb(0.36, 0.45, 0.57) });
  page.drawText(cleanText(generatedDate), { x: PAGE_WIDTH - MARGIN - 80, y: PAGE_HEIGHT - 48, size: 10, font: regularFont, color: rgb(0.36, 0.45, 0.57) });
  page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 76 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 76 }, thickness: 1.6, color: rgb(0.14, 0.34, 0.62) });
  return { page, y: PAGE_HEIGHT - 96 };
}

async function renderProjectPdf(project) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);

  const regularFontPath = fs.existsSync("C:\\Windows\\Fonts\\Setimo_Rg.ttf")
    ? "C:\\Windows\\Fonts\\Setimo_Rg.ttf"
    : "C:\\Windows\\Fonts\\arial.ttf";
  const boldFontPath = fs.existsSync("C:\\Windows\\Fonts\\Setimo_Bd.ttf")
    ? "C:\\Windows\\Fonts\\Setimo_Bd.ttf"
    : "C:\\Windows\\Fonts\\arialbd.ttf";
  const regularFont = await document.embedFont(fs.readFileSync(regularFontPath), { subset: false });
  const boldFont = await document.embedFont(fs.readFileSync(boldFontPath), { subset: false });

  const { cover, sections, ownershipTables, sameign, appendices, generatedDate } = resolveProjectData(project);
  const defaultLogoPath = path.join(__dirname, "..", "public", "assets", "hms-logo-default.png");
  const logoPath = cover.logoImagePath ? resolveUploadPath(cover.logoImagePath) : defaultLogoPath;
  const coverImagePath = resolveUploadPath(cover.coverImagePath);
  const logoImage = await embedImage(document, fs.existsSync(logoPath) ? logoPath : defaultLogoPath);
  const coverImage = await embedImage(document, coverImagePath);

  const coverPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  coverPage.drawRectangle({ x: 0, y: PAGE_HEIGHT - 54, width: PAGE_WIDTH, height: 54, color: rgb(0.14, 0.34, 0.62) });
  coverPage.drawText(cleanText(cover.title || "Eignaskiptayfirlýsing"), { x: 60, y: PAGE_HEIGHT - 120, size: 26, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
  let metaY = PAGE_HEIGHT - 168;
  for (const line of [
    cleanText(cover.propertyName),
    cover.matshluti ? `Matshluti ${cleanText(cover.matshluti)}` : "",
    cover.landeignNumber ? `Landeignanúmer ${cleanText(cover.landeignNumber)}` : "",
    cover.fasteignNumber ? `Fasteignanúmer ${cleanText(cover.fasteignNumber)}` : "",
  ].filter(Boolean)) {
    coverPage.drawText(line, { x: 60, y: metaY, size: 16, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
    metaY -= 24;
  }

  coverPage.drawRectangle({ x: 60, y: 260, width: 475, height: 260, borderWidth: 1, borderColor: rgb(0.84, 0.88, 0.93), color: rgb(0.98, 0.99, 1) });
  if (coverImage) {
    const dims = coverImage.scale(1);
    const ratio = Math.min(455 / dims.width, 240 / dims.height);
    coverPage.drawImage(coverImage, { x: 70, y: 270, width: dims.width * ratio, height: dims.height * ratio });
  } else {
    coverPage.drawText("Forsíðumynd eða uppdráttur getur birst hér", { x: 120, y: 388, size: 15, font: regularFont, color: rgb(0.4, 0.45, 0.52) });
  }

  if (logoImage) {
    const dims = logoImage.scale(1);
    const ratio = Math.min(180 / dims.width, 60 / dims.height);
    coverPage.drawImage(logoImage, { x: 60, y: 88, width: dims.width * ratio, height: dims.height * ratio });
  }

  coverPage.drawRectangle({ x: 335, y: 78, width: 200, height: 110, borderWidth: 1, borderColor: rgb(0.84, 0.88, 0.93), color: rgb(1, 1, 1) });
  let issuerY = 166;
  for (const line of [
    cleanText(generatedDate),
    cleanText(cover.preparedByName),
    cleanText(cover.preparedByCompany),
    cleanText(cover.preparedByTitle),
    cover.preparedByLicenseNumber ? `Leyfisnúmer: ${cleanText(cover.preparedByLicenseNumber)}` : "",
    cover.preparedByKennitala ? `Kennitala: ${cleanText(cover.preparedByKennitala)}` : "",
    cleanText(cover.preparedByEmail),
    cleanText(cover.preparedByPhone),
  ].filter(Boolean)) {
    coverPage.drawText(line, { x: 348, y: issuerY, size: 10.5, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
    issuerY -= 13;
  }

  let ctx = addContentPage(document, cover, generatedDate, regularFont, boldFont);
  let { page, y } = ctx;

  const cardWidth = (PAGE_WIDTH - MARGIN * 2 - 14) / 2;
  const metaRows = [
    ["Heiti máls", project.name],
    ["Heimilisfang", cover.address],
    ["Sveitarfélag", cover.municipality],
    ["Matshluti", cover.matshluti],
    ["Landeignanúmer", cover.landeignNumber],
    ["Fasteignanúmer", cover.fasteignNumber],
    ["Leyfisnúmer", cover.preparedByLicenseNumber],
    ["Kennitala leyfishafa", cover.preparedByKennitala],
  ];
  for (let i = 0; i < metaRows.length; i += 2) {
    drawMetaCard(page, MARGIN, y, cardWidth, 42, metaRows[i][0], metaRows[i][1], boldFont, regularFont);
    if (metaRows[i + 1]) {
      drawMetaCard(page, MARGIN + cardWidth + 14, y, cardWidth, 42, metaRows[i + 1][0], metaRows[i + 1][1], boldFont, regularFont);
    }
    y -= 54;
  }

  const ensureSpace = (need) => {
    if (y - need < 50) {
      ctx = addContentPage(document, cover, generatedDate, regularFont, boldFont);
      page = ctx.page;
      y = ctx.y;
    }
  };

  for (const section of sections) {
    ensureSpace(90);
    page.drawRectangle({ x: MARGIN, y: y - 20, width: PAGE_WIDTH - MARGIN * 2, height: 24, color: rgb(0.97, 0.98, 1) });
    page.drawText(cleanText(section.heading), { x: MARGIN + 10, y: y - 4, size: 13, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
    y -= 30;
    y = drawWrapped(page, section.body, MARGIN, y, PAGE_WIDTH - MARGIN * 2, regularFont, 10.8, rgb(0.09, 0.19, 0.33), 14.5) - 10;
  }

  ensureSpace(120);
  page.drawText("Skipting hússins er eftirfarandi:", { x: MARGIN, y, size: 13, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
  y -= 20;
  for (const table of ownershipTables) {
    const rows = Math.max(table.items.length, 1);
    const boxHeight = 56 + rows * 18;
    ensureSpace(boxHeight + 12);
    page.drawRectangle({ x: MARGIN, y: y - boxHeight, width: PAGE_WIDTH - MARGIN * 2, height: boxHeight, borderWidth: 1, borderColor: rgb(0.78, 0.84, 0.9) });
    page.drawText(`Fasteignanúmer ${cleanText(table.fasteignanumer)}`, { x: MARGIN + 10, y: y - 18, size: 10.2, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
    page.drawText(`Eignarhaldsnúmer ${cleanText(table.ownershipDisplay)}`, { x: MARGIN + 205, y: y - 18, size: 10.2, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
    page.drawText(`Birt flatarmál ${formatNumber(table.birtFlatarmal)} m²`, { x: MARGIN + 10, y: y - 35, size: 9.8, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
    page.drawText(`Hlutfall í mhl. ${formatNumber(table.hlutfallMhl)}%`, { x: MARGIN + 205, y: y - 35, size: 9.8, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
    page.drawText(`Hlutfall í lóð ${formatNumber(table.hlutfallLod || table.hlutfallHus)}%`, { x: MARGIN + 360, y: y - 35, size: 9.8, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
    let rowY = y - 58;
    for (const item of (table.items.length ? table.items : [{ usage: table.usage || "Séreign", birtFlatarmal: table.birtFlatarmal }])) {
      page.drawText(cleanText(table.ownershipDisplay.replace(/^[^-]+-/, "")), { x: MARGIN + 10, y: rowY, size: 9.7, font: regularFont });
      page.drawText(cleanText(item.usage), { x: MARGIN + 90, y: rowY, size: 9.7, font: regularFont });
      page.drawText(item.birtFlatarmal ? `${formatNumber(item.birtFlatarmal)} m²` : "", { x: MARGIN + 360, y: rowY, size: 9.7, font: regularFont });
      rowY -= 18;
    }
    y -= boxHeight + 12;
  }

  if (sameign.length) {
    ensureSpace(60);
    page.drawText("Sameign sumra", { x: MARGIN, y, size: 13, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
    y -= 18;
    for (const row of sameign) {
      ensureSpace(18);
      const line = [row.code, row.usage, row.ownerGroup ? `hópur ${row.ownerGroup}` : "", row.share ? `hlutur ${formatNumber(row.share)}` : ""].filter(Boolean).join(" | ");
      page.drawText(cleanText(line), { x: MARGIN, y, size: 9.8, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
      y -= 14;
    }
  }

  ensureSpace(40);
  page.drawText("Viðaukar", { x: MARGIN, y, size: 13, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
  y -= 18;
  if (appendices.length) {
    appendices.forEach((appendix, index) => {
      page.drawText(`${index + 1}. ${cleanText(appendix.filename)}`, { x: MARGIN, y, size: 10.2, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
      y -= 14;
    });
  } else {
    page.drawText("Engin viðhengi hafa verið skráð með málinu.", { x: MARGIN, y, size: 10.2, font: regularFont, color: rgb(0.09, 0.19, 0.33) });
  }

  for (const appendix of appendices) {
    const appendixPath = resolveUploadPath(appendix.path);
    if (!appendixPath || !fs.existsSync(appendixPath)) {
      continue;
    }
    const separator = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    separator.drawText("Viðaukar", { x: MARGIN, y: PAGE_HEIGHT - 100, size: 22, font: boldFont, color: rgb(0.09, 0.19, 0.33) });
    try {
      const source = await PDFDocument.load(fs.readFileSync(appendixPath), { ignoreEncryption: true });
      const copiedPages = await document.copyPages(source, source.getPageIndices());
      copiedPages.forEach((copiedPage) => document.addPage(copiedPage));
    } catch (error) {
      const errorPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      errorPage.drawText(`Ekki tókst að lesa viðaukann ${cleanText(appendix.filename)}.`, { x: MARGIN, y: PAGE_HEIGHT - 100, size: 16, font: boldFont, color: rgb(0.65, 0.17, 0.17) });
      drawWrapped(errorPage, error.message || "Óþekkt villa.", MARGIN, PAGE_HEIGHT - 132, PAGE_WIDTH - MARGIN * 2, regularFont, 11);
    }
  }

  return Buffer.from(await document.save());
}

module.exports = {
  renderProjectPdf,
};
