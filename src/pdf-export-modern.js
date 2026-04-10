const { resolveProjectData } = require("./export-modern");

function utf16Hex(value) {
  const text = String(value || "");
  const bytes = [0xfe, 0xff];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0xffff) {
      bytes.push((code >> 8) & 0xff, code & 0xff);
    }
  }
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function createPdfDocument() {
  const objects = [];
  const pages = [];

  function addObject(content) {
    objects.push(content);
    return objects.length;
  }

  function addPage(ops) {
    const stream = ops.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pages.push({ contentId });
  }

  function finalize() {
    const fontSans = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    const fontSansBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const pageIds = pages.map((page) =>
      addObject(`<< /Type /Page /Parent PAGES_REF 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontSans} 0 R /F2 ${fontSansBold} 0 R >> >> /Contents ${page.contentId} 0 R >>`),
    );
    const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
    const pagesId = addObject(`<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`);
    const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const resolved = objects.map((object) => object.replaceAll("PAGES_REF 0 R", `${pagesId} 0 R`));

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (let i = 0; i < resolved.length; i += 1) {
      offsets.push(Buffer.byteLength(pdf, "latin1"));
      pdf += `${i + 1} 0 obj\n${resolved[i]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${resolved.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i < offsets.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${resolved.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, "latin1");
  }

  return { addPage, finalize };
}

function textOp({ x, y, text, size = 12, font = "F1" }) {
  return `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm <${utf16Hex(text)}> Tj ET`;
}

function lineOp(x1, y1, x2, y2, width = 1, color = "0 0 0") {
  return `${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function fillRectOp(x, y, width, height, color) {
  return `${color} rg ${x} ${y} ${width} ${height} re f`;
}

function strokeRectOp(x, y, width, height, color = "0.85 0.87 0.9", lineWidth = 1) {
  return `${color} RG ${lineWidth} w ${x} ${y} ${width} ${height} re S`;
}

function appendWrappedText(ops, text, { x, y, maxChars, size = 12, font = "F1", lineHeight = 16 }) {
  let cursor = y;
  for (const line of wrapText(text, maxChars)) {
    ops.push(textOp({ x, y: cursor, text: line, size, font }));
    cursor -= lineHeight;
  }
  return cursor;
}

function renderProjectPdf(project) {
  const pdf = createPdfDocument();
  const { cover, sections, units, ownershipTables, sameign, appendices, generatedDate } = resolveProjectData(project);

  const coverOps = [];
  coverOps.push(fillRectOp(0, 774, 595, 68, "0.49 0.23 0.16"));
  coverOps.push(textOp({ x: 74, y: 720, text: cover.title, size: 24, font: "F2" }));
  coverOps.push(textOp({ x: 74, y: 676, text: cover.propertyName, size: 18, font: "F1" }));
  if (cover.matshluti) {
    coverOps.push(textOp({ x: 74, y: 646, text: `Matshluti ${cover.matshluti}`, size: 14 }));
  }
  if (cover.landeignNumber) {
    coverOps.push(textOp({ x: 74, y: 620, text: `Landeignanúmer ${cover.landeignNumber}`, size: 14 }));
  }
  if (cover.fasteignNumber) {
    coverOps.push(textOp({ x: 74, y: 594, text: `Fasteignanúmer ${cover.fasteignNumber}`, size: 14 }));
  }

  coverOps.push(strokeRectOp(74, 250, 447, 210, "0.84 0.80 0.76"));
  coverOps.push(textOp({ x: 142, y: 356, text: "Forsíðumynd eða teikning getur birst hér", size: 16, font: "F1" }));

  coverOps.push(strokeRectOp(338, 96, 183, 108, "0.84 0.80 0.76"));
  let issuerY = 178;
  for (const value of [
    generatedDate,
    cover.preparedByName,
    cover.preparedByCompany,
    cover.preparedByTitle,
    cover.preparedByEmail,
    cover.preparedByPhone,
  ].filter(Boolean)) {
    coverOps.push(textOp({ x: 356, y: issuerY, text: value, size: 11 }));
    issuerY -= 16;
  }

  if (cover.footerNote) {
    coverOps.push(textOp({ x: 74, y: 92, text: cover.footerNote, size: 10 }));
  }
  pdf.addPage(coverOps);

  let ops = [];
  let y = 792;
  const left = 48;
  const right = 547;

  function newPage() {
    if (ops.length) {
      pdf.addPage(ops);
    }
    ops = [];
    y = 792;
    ops.push(textOp({ x: left, y, text: cover.title, size: 18, font: "F2" }));
    ops.push(textOp({ x: right - 120, y, text: generatedDate, size: 10 }));
    y -= 16;
    ops.push(textOp({ x: left, y, text: cover.propertyName, size: 11 }));
    y -= 10;
    ops.push(lineOp(left, y, right, y, 1.2, "0.49 0.23 0.16"));
    y -= 20;
  }

  function ensureSpace(required) {
    if (y - required < 60) {
      newPage();
    }
  }

  function metaCard(x, label, value) {
    ops.push(strokeRectOp(x, y - 42, 236, 38));
    ops.push(textOp({ x: x + 10, y: y - 14, text: label, size: 9, font: "F2" }));
    ops.push(textOp({ x: x + 10, y: y - 30, text: value || "—", size: 11, font: "F1" }));
  }

  newPage();
  ensureSpace(80);
  metaCard(left, "Heiti máls", project.name);
  metaCard(309, "Heimilisfang", cover.address);
  y -= 52;
  metaCard(left, "Sveitarfélag", cover.municipality);
  metaCard(309, "Matshluti", cover.matshluti);
  y -= 52;
  metaCard(left, "Landeignanúmer", cover.landeignNumber);
  metaCard(309, "Fasteignanúmer", cover.fasteignNumber);
  y -= 64;

  for (const section of sections) {
    ensureSpace(72);
    ops.push(fillRectOp(left, y - 18, right - left, 24, "0.97 0.95 0.92"));
    ops.push(textOp({ x: left + 10, y: y - 2, text: section.heading, size: 13, font: "F2" }));
    y -= 32;
    y = appendWrappedText(ops, section.body, { x: left, y, maxChars: 94, size: 11, lineHeight: 15 });
    y -= 14;
  }

  ensureSpace(120);
  ops.push(fillRectOp(left, y - 18, right - left, 24, "0.97 0.95 0.92"));
  ops.push(textOp({ x: left + 10, y: y - 2, text: "Yfirlit séreigna", size: 13, font: "F2" }));
  y -= 34;
  const unitRows = units.slice(0, 22);
  if (unitRows.length) {
    for (const row of unitRows) {
      ensureSpace(42);
      ops.push(strokeRectOp(left, y - 28, right - left, 30, "0.88 0.90 0.93", 0.8));
      const summary = [
        row.ownership || "",
        row.usage || "",
        row.fasteignanumer ? `fnr. ${row.fasteignanumer}` : "",
        row.birtFlatarmal ? `${row.birtFlatarmal} m²` : "",
        row.hlutfallMhl ? `${row.hlutfallMhl}%` : "",
      ].filter(Boolean).join(" • ");
      ops.push(textOp({ x: left + 10, y: y - 16, text: summary || "Óskráð séreign", size: 10.5 }));
      y -= 38;
    }
  } else {
    y = appendWrappedText(ops, "Engin tafla yfir séreignir fannst í innlesnum gögnum.", { x: left, y, maxChars: 94, size: 11, lineHeight: 15 });
    y -= 12;
  }

  ensureSpace(140);
  ops.push(fillRectOp(left, y - 18, right - left, 24, "0.97 0.95 0.92"));
  ops.push(textOp({ x: left + 10, y: y - 2, text: "Skipting hússins eftir eignarhlutum", size: 13, font: "F2" }));
  y -= 34;
  if (ownershipTables.length) {
    for (const table of ownershipTables.slice(0, 10)) {
      ensureSpace(84);
      ops.push(strokeRectOp(left, y - 62, right - left, 64, "0.82 0.85 0.89", 0.9));
      ops.push(textOp({ x: left + 10, y: y - 14, text: `Fasteignanúmer ${table.fasteignanumer || "—"}`, size: 10.5, font: "F2" }));
      ops.push(textOp({ x: 250, y: y - 14, text: `Eignarhaldsnúmer ${table.ownershipDisplay || "—"}`, size: 10.5, font: "F2" }));
      ops.push(textOp({ x: left + 10, y: y - 32, text: `Birt flatarmál ${table.birtFlatarmal || "—"} m²`, size: 10.5 }));
      ops.push(textOp({ x: 250, y: y - 32, text: `Hlutfall í mhl. ${table.hlutfallMhl || "—"}%`, size: 10.5 }));
      let itemY = y - 50;
      const itemSummary = table.items.length
        ? table.items.map((item) => `${item.usage}${item.birtFlatarmal ? ` ${item.birtFlatarmal} m²` : ""}`).join(" • ")
        : "Engin nánari upptalning fannst.";
      ops.push(textOp({ x: left + 10, y: itemY, text: itemSummary, size: 10 }));
      y -= 76;
    }
  } else {
    y = appendWrappedText(ops, "Ekki tókst að búa til skiptingartöflur fyrir eignarhluta.", { x: left, y, maxChars: 94, size: 11, lineHeight: 15 });
    y -= 12;
  }

  ensureSpace(100);
  ops.push(fillRectOp(left, y - 18, right - left, 24, "0.97 0.95 0.92"));
  ops.push(textOp({ x: left + 10, y: y - 2, text: "Viðaukar", size: 13, font: "F2" }));
  y -= 34;
  if (appendices.length) {
    appendices.forEach((pdfFile, index) => {
      ensureSpace(20);
      ops.push(textOp({ x: left, y, text: `${index + 1}. ${pdfFile.filename}`, size: 11 }));
      y -= 16;
    });
  } else {
    y = appendWrappedText(ops, "Engin PDF fylgiskjöl hafa verið skráð með málinu.", { x: left, y, maxChars: 94, size: 11, lineHeight: 15 });
    y -= 12;
  }

  if (sameign.length) {
    ensureSpace(120);
    ops.push(fillRectOp(left, y - 18, right - left, 24, "0.97 0.95 0.92"));
    ops.push(textOp({ x: left + 10, y: y - 2, text: "Sameign sumra", size: 13, font: "F2" }));
    y -= 34;
    for (const row of sameign.slice(0, 16)) {
      ensureSpace(36);
      const summary = [row.code, row.usage, row.ownerGroup, row.share].filter(Boolean).join(" • ");
      ops.push(textOp({ x: left, y, text: summary, size: 10.5 }));
      y -= 14;
    }
  }

  pdf.addPage(ops);
  return pdf.finalize();
}

module.exports = {
  renderProjectPdf,
};
