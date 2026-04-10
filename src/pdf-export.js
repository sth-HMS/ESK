function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, " ");
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

  function addPage(lines) {
    const content = [];
    for (const line of lines) {
      if (line.type === "text") {
        content.push(`BT /${line.font} ${line.size} Tf ${line.x} ${line.y} Td (${escapePdfText(line.text)}) Tj ET`);
      } else if (line.type === "line") {
        content.push(`${line.x1} ${line.y1} m ${line.x2} ${line.y2} l S`);
      }
    }
    const stream = content.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pages.push({ contentId });
  }

  function finalize() {
    const fontBody = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
    const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>");
    const pageIds = pages.map((page) =>
      addObject(`<< /Type /Page /Parent PAGES_REF 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontBody} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${page.contentId} 0 R >>`),
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

function buildPdfSections(project) {
  if (project.documentDraft?.sections?.length) {
    return project.documentDraft.sections;
  }
  const extracted = project.parsedWorkbook?.extracted || {};
  const metadata = extracted.metadata || {};
  const ownershipRows = (extracted.hlutfallstolur || []).filter((row) => row.ownership).slice(0, 20);
  const sameignRows = (extracted.sameignSumra || []).slice(0, 20);
  const lysingRows = (extracted.lysing || []).slice(0, 20);

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
        ? sameignRows.map((row) => `${row.code} - ${row.usage}; tengist ${row.ownerGroup || "óskráðum hópi"}; eignarhlutur ${row.share || "óskráður"}.`).join(" ")
        : "Engin sameign sumra fannst í innlesnum gögnum.",
    },
  ];
}

function renderProjectPdf(project) {
  const pdf = createPdfDocument();
  const cover = project.cover || {};
  const sections = buildPdfSections(project);
  const appendices = project.pdfUploads || [];
  const generatedDate = new Date().toLocaleDateString("is-IS");

  const coverLines = [];
  let y = 760;
  coverLines.push({ type: "text", font: "F2", size: 24, x: 80, y, text: cover.title || "EIGNASKIPTAYFIRLÝSING" });
  y -= 40;
  for (const text of [
    cover.propertyName || project.propertyInfo?.address || project.name,
    cover.matshluti ? `Matshluti ${cover.matshluti}` : "",
    cover.landeignNumber ? `Landeignanúmer ${cover.landeignNumber}` : "",
    cover.fasteignNumber ? `Fasteignanúmer ${cover.fasteignNumber}` : "",
  ].filter(Boolean)) {
    coverLines.push({ type: "text", font: "F1", size: 16, x: 120, y, text });
    y -= 28;
  }
  y = 180;
  for (const text of [
    generatedDate,
    cover.preparedByName,
    cover.preparedByCompany,
    cover.preparedByTitle,
    cover.preparedByEmail,
    cover.preparedByPhone,
  ].filter(Boolean)) {
    coverLines.push({ type: "text", font: "F1", size: 11, x: 380, y, text });
    y -= 16;
  }
  pdf.addPage(coverLines);

  let pageLines = [];
  y = 790;
  const left = 50;
  const right = 545;
  const lineHeight = 16;

  function ensureSpace(needed = 24) {
    if (y < 70 + needed) {
      pdf.addPage(pageLines);
      pageLines = [];
      y = 790;
    }
  }

  function addWrapped(text, font = "F1", size = 12) {
    const lines = wrapText(text, 92);
    for (const line of lines) {
      ensureSpace(lineHeight);
      pageLines.push({ type: "text", font, size, x: left, y, text: line });
      y -= lineHeight;
    }
  }

  pageLines.push({ type: "text", font: "F2", size: 18, x: left, y, text: cover.title || "EIGNASKIPTAYFIRLÝSING" });
  y -= 20;
  pageLines.push({ type: "text", font: "F1", size: 12, x: left, y, text: cover.propertyName || project.propertyInfo?.address || project.name });
  y -= 16;
  pageLines.push({ type: "line", x1: left, y1: y, x2: right, y2: y });
  y -= 24;

  const metaRows = [
    ["Heiti máls", project.name],
    ["Heimilisfang", project.propertyInfo?.address || ""],
    ["Sveitarfélag", project.propertyInfo?.municipality || ""],
    ["Matshluti", cover.matshluti || ""],
    ["Landeignanúmer", cover.landeignNumber || ""],
    ["Fasteignanúmer", cover.fasteignNumber || ""],
    ["Staða máls", project.status || ""],
  ];

  for (const [label, value] of metaRows) {
    ensureSpace(18);
    pageLines.push({ type: "text", font: "F2", size: 12, x: left, y, text: label });
    pageLines.push({ type: "text", font: "F1", size: 12, x: 220, y, text: String(value || "") });
    y -= 22;
  }

  y -= 8;
  for (const section of sections) {
    ensureSpace(30);
    pageLines.push({ type: "text", font: "F2", size: 14, x: left, y, text: section.heading });
    y -= 20;
    addWrapped(section.body, "F1", 12);
    y -= 10;
  }

  ensureSpace(30);
  pageLines.push({ type: "text", font: "F2", size: 14, x: left, y, text: "Viðaukar" });
  y -= 20;
  if (appendices.length) {
    for (const [index, pdfFile] of appendices.entries()) {
      addWrapped(`${index + 1}. ${pdfFile.filename}`, "F1", 12);
    }
  } else {
    addWrapped("Engin PDF fylgiskjöl hafa verið skráð með málinu.", "F1", 12);
  }

  pdf.addPage(pageLines);
  return pdf.finalize();
}

module.exports = {
  renderProjectPdf,
};
