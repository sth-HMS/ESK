const fs = require("node:fs");
const path = require("node:path");
const { repairText } = require("./encoding");

function escapeHtml(value) {
  return repairText(String(value || ""))
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

function formatDate(value = new Date()) {
  return new Intl.DateTimeFormat("is-IS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function uniqueRows(rows, keyBuilder) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyBuilder(row);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeOwnership(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const num = Number(String(value).replace(",", "."));
  if (!Number.isFinite(num)) {
    return String(value);
  }
  return new Intl.NumberFormat("is-IS", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(num);
}

function sortByOwnership(rows, getter) {
  return [...rows].sort((a, b) => {
    const aRaw = String(getter(a) || "");
    const bRaw = String(getter(b) || "");
    const aDigits = aRaw.replace(/[^\d]/g, "");
    const bDigits = bRaw.replace(/[^\d]/g, "");
    if (!aDigits && !bDigits) {
      return aRaw.localeCompare(bRaw, "is");
    }
    if (!aDigits) {
      return 1;
    }
    if (!bDigits) {
      return -1;
    }
    return aDigits.localeCompare(bDigits, "en", { numeric: true });
  });
}

function ownershipDisplay(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}$/.test(raw)) {
    return `${raw.slice(0, 2)}-${raw}`;
  }
  return raw;
}

function buildOwnershipTables(units, descriptions) {
  return sortByOwnership(units.filter((unit) => unit.ownership), (unit) => unit.ownership).map((unit) => {
    const normalizedUnit = normalizeOwnership(unit.ownership);
    const description = descriptions.find((row) => normalizeOwnership(row.ownership).endsWith(normalizedUnit));
    const items = (description?.items || [])
      .filter((item) => item.usage && !/notkun/i.test(item.usage))
      .map((item) => ({
        usage: item.usage,
        birtFlatarmal: formatNumber(item.birtFlatarmal),
      }))
      .filter((item, index, array) => array.findIndex((candidate) => candidate.usage === item.usage && candidate.birtFlatarmal === item.birtFlatarmal) === index);

    return {
      fasteignanumer: unit.fasteignanumer || "",
      ownershipDisplay: ownershipDisplay(description?.ownership || unit.ownership || ""),
      birtFlatarmal: formatNumber(description?.birtFlatarmal || unit.birtFlatarmal),
      hlutfallMhl: formatNumber(description?.hlutfallMhl || unit.hlutfallMhl),
      hlutfallHus: formatNumber(description?.hlutfallHus || unit.hlutfallHus || unit.hlutfallLod),
      hlutfallLod: formatNumber(description?.hlutfallLod || unit.hlutfallLod),
      sameignSumraShare: formatNumber(description?.sameignSumraShare || unit.sameignSumraShare),
      usage: unit.usage || "",
      items,
    };
  });
}

function upsertSections(existingSections, generatedSections) {
  if (!existingSections?.length) {
    return generatedSections;
  }
  const preserved = existingSections.filter((section) => !generatedSections.some((generated) => generated.heading === section.heading));
  return [...generatedSections, ...preserved];
}

function resolveProjectData(project) {
  const extracted = project.parsedWorkbook?.extracted || {};
  const metadata = extracted.metadata || {};
  const cover = project.cover || {};
  const propertyInfo = project.propertyInfo || {};

  const units = sortByOwnership(uniqueRows(
    (extracted.hlutfallstolur || []).filter((row) => row.ownership),
    (row) => row.ownership,
  ), (row) => row.ownership).slice(0, 120);

  const descriptions = sortByOwnership(uniqueRows(
    (extracted.lysing || []).filter((row) => row.ownership),
    (row) => row.ownership,
  ), (row) => row.ownership).slice(0, 120);

  const sameign = sortByOwnership((extracted.sameignSumra || []), (row) => row.code).slice(0, 120);
  const ownershipTables = buildOwnershipTables(units, descriptions);

  const resolvedCover = {
    title: cover.title || "EIGNASKIPTAYFIRLÝSING",
    propertyName: cover.propertyName || metadata.propertyName || propertyInfo.address || project.name,
    address: propertyInfo.address || metadata.propertyName || cover.propertyName || "",
    municipality: propertyInfo.municipality || metadata.municipality || "",
    matshluti: cover.matshluti || metadata.matshlutiNumber || "",
    landeignNumber: cover.landeignNumber || metadata.landeignNumber || "",
    fasteignNumber: cover.fasteignNumber || metadata.fasteignNumber || "",
    preparedByName: cover.preparedByName || "",
    preparedByCompany: cover.preparedByCompany || "",
    preparedByTitle: cover.preparedByTitle || "",
    preparedByEmail: cover.preparedByEmail || "",
    preparedByPhone: cover.preparedByPhone || "",
    preparedByLicenseNumber: cover.preparedByLicenseNumber || "",
    preparedByKennitala: cover.preparedByKennitala || metadata.kennitala || "",
    heatingElectricityText: cover.heatingElectricityText || "",
    easementsText: cover.easementsText || "",
    footerNote: cover.footerNote || "",
    logoImagePath: cover.logoImagePath || "",
    coverImagePath: cover.coverImagePath || "",
  };

  const generatedSections = buildSections(project, { extracted, metadata, units, descriptions, sameign, cover: resolvedCover });
  const sections = project.documentDraft?.sections?.length
    ? upsertSections(project.documentDraft.sections, generatedSections)
    : generatedSections;

  return {
    cover: resolvedCover,
    sections,
    units,
    descriptions,
    ownershipTables,
    sameign,
    appendices: project.pdfUploads || [],
    generatedDate: formatDate(),
  };
}

function buildSections(project, resolved = resolveProjectData(project)) {
  return buildSectionsV2(project, resolved);
}

function buildSectionsV2(project, resolved = resolveProjectData(project)) {
  const { cover, units, descriptions, sameign } = resolved;
  return buildSectionList(project, { cover, units, descriptions, sameign });

  const intro = [
    `Yfirlýsing þessi tekur til eignarinnar ${cover.propertyName || project.name}.`,
    cover.matshluti ? `Um er að ræða matshluta ${cover.matshluti}.` : "",
    cover.landeignNumber ? `Landeignanúmer er ${cover.landeignNumber}.` : "",
    cover.fasteignNumber ? `Fasteignanúmer er ${cover.fasteignNumber}.` : "",
    units.length ? `Alls fundust ${units.length} séreignir eða eignarhlutir í innlesnum gögnum.` : "",
  ].filter(Boolean).join(" ");

  const unitSummary = units.length
    ? units.map((row) => {
        const parts = [
          row.ownership,
          row.usage || "séreign",
          row.fasteignanumer ? `fasteignanúmer ${row.fasteignanumer}` : "",
          row.birtFlatarmal ? `birt flatarmál ${row.birtFlatarmal} m²` : "",
          row.hlutfallMhl ? `hlutfall í mhl. ${row.hlutfallMhl}%` : "",
        ].filter(Boolean);
        return parts.join(", ") + ".";
      }).join(" ")
    : "Ekki tókst að lesa út fullnægjandi upplýsingar um séreignir úr skráningartöflu.";

  const descriptionSummary = descriptions.length
    ? descriptions.map((row) => {
        const items = (row.items || [])
          .filter((item) => item.usage && !/notkun/i.test(item.usage))
          .map((item) => item.birtFlatarmal ? `${item.usage} (${item.birtFlatarmal} m²)` : item.usage)
          .join(", ");
        return `${row.ownership}: ${items || "nánari lýsing vantar"}.`;
      }).join(" ")
    : "Nánari lýsing séreigna fannst ekki í innlesnum gögnum.";

  const sameignSummary = sameign.length
    ? sameign.map((row) => {
        const parts = [
          row.code,
          row.usage,
          row.ownerGroup ? `tilheyrir hópi ${row.ownerGroup}` : "",
          row.share ? `hlutur ${row.share}` : "",
        ].filter(Boolean);
        return parts.join(", ") + ".";
      }).join(" ")
    : "Engar færslur fundust um sameign sumra í innlesnum gögnum.";

  return [
    { heading: "1. Almennar upplýsingar", body: intro || `Drög að eignaskiptayfirlýsingu fyrir ${cover.propertyName || project.name}.` },
    { heading: "2. Séreignir og eignarhlutir", body: unitSummary },
    { heading: "3. Lýsing séreigna", body: descriptionSummary },
    { heading: "4. Sameign og sameign sumra", body: sameignSummary },
    {
      heading: "5. Yfirferð og staðfesting",
      body: "Yfirlýsingin byggir á innlesnum gögnum úr skráningartöflu og þeim upplýsingum sem vistaðar hafa verið með málinu. Fara þarf sérstaklega yfir auðkenni eigna, hlutfallstölur, sameign og fylgiskjöl áður en skjalið er fullgilt og afhent til undirritunar.",
    },
    {
      heading: "6. Hita- og rafmagnskostnaður",
      body: cover.heatingElectricityText || "Rafmagn og hiti eru aðgreind með mælum sem eru staðsettir innan þeirra eigna sem þeir tilheyra. Þar sem sameiginlegur kostnaður kann að falla til skal honum skipt samkvæmt samþykktum húsfélags og þeim gögnum sem fram koma í skráningartöflu og fylgiskjölum.",
    },
    {
      heading: "7. Kvaðir og réttindi",
      body: cover.easementsText || "Lóðarréttindi og hlutdeild vegna baklóða, aðkomu, bílastæða, lagnaleiða og annarra sameiginlegra réttinda skulu fylgja þeirri skipan sem kemur fram í lóðarskjölum, aðaluppdráttum, skráningartöflu og öðrum fylgiskjölum málsins. Ekki er vitað um aðrar kvaðir eða réttindi en þær sem þar eru tilgreindar nema annað sé sérstaklega skráð í þinglýstum gögnum eða lóðarleigusamningi.",
    },
  ];
}

function buildSectionList(project, { cover, units, descriptions, sameign }) {
  const intro = [
    `Yfirlýsing þessi tekur til eignarinnar ${cover.propertyName || project.name}.`,
    cover.matshluti ? `Um er að ræða matshluta ${cover.matshluti}.` : "",
    cover.landeignNumber ? `Landeignanúmer er ${cover.landeignNumber}.` : "",
    cover.fasteignNumber ? `Fasteignanúmer er ${cover.fasteignNumber}.` : "",
    units.length ? `Alls fundust ${units.length} séreignir eða eignarhlutir í innlesnum gögnum.` : "",
  ].filter(Boolean).join(" ");

  const ownershipLines = units.length
    ? sortByOwnership(units, (row) => row.ownership).map((row) => [
        ownershipDisplay(row.ownership),
        row.usage || "séreign",
        row.fasteignanumer ? `fasteignanúmer ${row.fasteignanumer}` : "",
        row.birtFlatarmal ? `birt flatarmál ${formatNumber(row.birtFlatarmal)} m²` : "",
        row.hlutfallMhl ? `hlutfall í mhl. ${formatNumber(row.hlutfallMhl)}%` : "",
      ].filter(Boolean).join(" | "))
    : ["Ekki tókst að lesa út fullnægjandi upplýsingar um séreignir úr skráningartöflu."];

  const descriptionLines = descriptions.length
    ? sortByOwnership(descriptions, (row) => row.ownership).map((row) => {
        const items = (row.items || [])
          .filter((item) => item.usage && !/notkun/i.test(item.usage))
          .map((item) => item.birtFlatarmal ? `${item.usage} (${formatNumber(item.birtFlatarmal)} m²)` : item.usage)
          .join(", ");
        return `${ownershipDisplay(row.ownership)}: ${items || "nánari lýsing vantar"}`;
      })
    : ["Nánari lýsing séreigna fannst ekki í innlesnum gögnum."];

  const sameignLines = sameign.length
    ? sortByOwnership(sameign, (row) => row.code).map((row) => [
        row.code,
        row.usage,
        row.ownerGroup ? `tilheyrir hópi ${row.ownerGroup}` : "",
        row.share ? `hlutur ${formatNumber(row.share)}` : "",
      ].filter(Boolean).join(" | "))
    : ["Engar færslur fundust um sameign sumra í innlesnum gögnum."];

  return [
    { heading: "1. Almennar upplýsingar", body: intro || `Drög að eignaskiptayfirlýsingu fyrir ${cover.propertyName || project.name}.` },
    { heading: "2. Séreignir og eignarhald", body: ownershipLines.join("\n") },
    { heading: "3. Lýsing séreigna", body: descriptionLines.join("\n") },
    { heading: "4. Sameign og sameign sumra", body: sameignLines.join("\n") },
    {
      heading: "5. Yfirferð og staðfesting",
      body: "Yfirlýsingin byggir á innlesnum gögnum úr skráningartöflu og þeim upplýsingum sem vistaðar hafa verið með málinu. Fara þarf sérstaklega yfir auðkenni eigna, hlutfallstölur, sameign og fylgiskjöl áður en skjalið er fullgilt og afhent til undirritunar.",
    },
    {
      heading: "6. Hita- og rafmagnskostnaður",
      body: cover.heatingElectricityText || "Rafmagn og hiti eru aðgreind með mælum sem eru staðsettir innan þeirra eigna sem þeir tilheyra. Þar sem sameiginlegur kostnaður kann að falla til skal honum skipt samkvæmt samþykktum húsfélags og þeim gögnum sem fram koma í skráningartöflu og fylgiskjölum.",
    },
    {
      heading: "7. Kvaðir og réttindi",
      body: cover.easementsText || "Lóðarréttindi og hlutdeild vegna baklóða, aðkomu, bílastæða, lagnaleiða og annarra sameiginlegra réttinda skulu fylgja þeirri skipan sem kemur fram í lóðarskjölum, aðaluppdráttum, skráningartöflu og öðrum fylgiskjölum málsins. Ekki er vitað um aðrar kvaðir eða réttindi en þær sem þar eru tilgreindar nema annað sé sérstaklega skráð í þinglýstum gögnum eða lóðarleigusamningi.",
    },
  ];
}

function renderProjectHtml(project, options = {}) {
  const resolved = resolveProjectData(project);
  const { cover, sections, units, ownershipTables, sameign, appendices, generatedDate } = resolved;
  const uploadsRoot = path.join(__dirname, "..", "data", "uploads");
  const assetBaseUrl = options.assetBaseUrl || "";
  const defaultLogoPath = path.join(__dirname, "..", "public", "assets", "hms-logo-default.png");
  const logoData = imageToDataUrl(cover.logoImagePath ? path.join(uploadsRoot, cover.logoImagePath.replace(/^\/uploads\//, "")) : "");
  const brandLogoData = logoData || imageToDataUrl(defaultLogoPath);
  const coverImageData = imageToDataUrl(cover.coverImagePath ? path.join(uploadsRoot, cover.coverImagePath.replace(/^\/uploads\//, "")) : "");

  const html = `<!doctype html>
<html lang="is">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(cover.title)}</title>
  <style>
    @font-face {
      font-family: "Setimo";
      src:
        url("${assetBaseUrl}/fonts/Setimo_W_Rg.woff2") format("woff2"),
        url("${assetBaseUrl}/fonts/Setimo_W_Rg.woff") format("woff");
      font-style: normal;
      font-weight: 400;
      font-display: swap;
    }
    @font-face {
      font-family: "Setimo";
      src:
        url("${assetBaseUrl}/fonts/Setimo_W_It.woff2") format("woff2"),
        url("${assetBaseUrl}/fonts/Setimo_W_It.woff") format("woff");
      font-style: italic;
      font-weight: 400;
      font-display: swap;
    }
    @font-face {
      font-family: "Setimo";
      src:
        url("${assetBaseUrl}/fonts/Setimo_W_Bd.woff2") format("woff2"),
        url("${assetBaseUrl}/fonts/Setimo_W_Bd.woff") format("woff");
      font-style: normal;
      font-weight: 700;
      font-display: swap;
    }
    @font-face {
      font-family: "Setimo";
      src:
        url("${assetBaseUrl}/fonts/Setimo_W_BdIt.woff2") format("woff2"),
        url("${assetBaseUrl}/fonts/Setimo_W_BdIt.woff") format("woff");
      font-style: italic;
      font-weight: 700;
      font-display: swap;
    }
    @page { size: A4; margin: 14mm 15mm 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #183153; font-family: "Setimo", Georgia, "Times New Roman", serif; background: #fff; }
    .cover-page { min-height: 262mm; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; padding: 16mm 12mm 14mm; background: linear-gradient(180deg, #f6f9fd, #eef4fa 58%, #f6fbf1); }
    .cover-page::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 18mm; background: linear-gradient(90deg, #183153 0%, #24579d 64%, #7da13a 100%); }
    .cover-inner { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 14mm; padding-top: 18mm; }
    .doc-label { font-size: 10pt; letter-spacing: 0.35em; text-transform: uppercase; color: #24579d; margin: 0; }
    .cover-title { margin: 0; font-size: 26pt; letter-spacing: 0.04em; line-height: 1.05; }
    .cover-meta { display: grid; gap: 4mm; font-size: 15pt; line-height: 1.5; }
    .cover-visual { width: 122mm; max-width: 100%; min-height: 72mm; border: 1px solid #d5dfec; border-radius: 18mm; display: flex; align-items: center; justify-content: center; overflow: hidden; background: linear-gradient(180deg, #ffffff, #eef4fa); box-shadow: inset 0 1px 0 rgba(255,255,255,0.8); }
    .cover-visual img { max-width: 100%; max-height: 72mm; object-fit: contain; }
    .cover-issuer { width: 100%; display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; }
    .issuer-box { margin-left: auto; padding: 5mm 6mm; border: 1px solid #cddbed; border-radius: 6mm; min-width: 58mm; text-align: right; font-size: 10.5pt; line-height: 1.55; background: rgba(255,255,255,0.84); }
    .cover-logo img { max-width: 70mm; max-height: 24mm; object-fit: contain; }
    .page-break { break-before: page; page-break-before: always; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #24579d; padding-bottom: 5mm; margin-bottom: 7mm; }
    .page-header h2 { margin: 0; font-size: 18pt; }
    .page-header .sub { margin-top: 2mm; font-size: 10pt; color: #5d7391; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4mm; margin-bottom: 8mm; }
    .meta-card { border: 1px solid #d9e3f0; border-radius: 5mm; padding: 4mm 4.5mm; background: #f9fbfe; }
    .meta-label { display: block; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.08em; color: #5d7391; margin-bottom: 1.5mm; }
    .meta-value { font-size: 12pt; min-height: 16px; }
    .section { margin-bottom: 8mm; padding: 5mm 5.5mm; border: 1px solid #dde5ef; border-radius: 5mm; background: #fff; }
    .section h3 { margin: 0 0 3mm; color: #183153; font-size: 13.5pt; }
    .section p { margin: 0; white-space: pre-wrap; line-height: 1.62; font-size: 11.3pt; }
    .table-wrap { margin: 8mm 0; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
    th, td { border-bottom: 1px solid #dde5ef; text-align: left; vertical-align: top; padding: 3mm 2.5mm; }
    th { color: #24579d; font-weight: 700; background: #f3f7fc; }
    .appendix-list { margin: 0; padding-left: 18px; line-height: 1.6; }
    .ownership-card {
      border: 1px solid #d6dfec;
      border-radius: 4mm;
      margin: 0 0 7mm;
      overflow: hidden;
      background: #fff;
    }
    .ownership-card .title {
      padding: 3.5mm 4mm;
      font-size: 11pt;
      font-weight: 700;
      color: #183153;
      background: linear-gradient(180deg, #f5f9fe, #eef4fa);
      border-bottom: 1px solid #dde5ef;
    }
    .ownership-card table { font-size: 10pt; }
    .ownership-card thead th { background: #fff; color: #5d7391; font-size: 8.8pt; }
    .ownership-card tbody td strong { font-size: 12pt; }
    .declaration-block { margin: 0 0 8mm; padding: 6mm 7mm; border: 1px solid #d6dfec; border-radius: 5mm; background: linear-gradient(180deg, #fbfdff, #f4f8fd); text-align: center; }
    .declaration-block h3 { margin: 0 0 4mm; font-size: 13pt; text-decoration: underline; color: #183153; }
    .declaration-block p { margin: 0 0 3mm; line-height: 1.65; font-size: 11.2pt; }
    .footer-note { margin-top: 10mm; font-size: 10pt; color: #5d7391; border-top: 1px solid #d9e3f0; padding-top: 4mm; }
  </style>
</head>
<body>
  <section class="cover-page">
    <div class="cover-inner">
      <div>
        <p class="doc-label">Eignaskipti</p>
        <h1 class="cover-title">${escapeHtml(cover.title)}</h1>
      </div>
      <div class="cover-meta">
        <div>${escapeHtml(cover.propertyName)}</div>
        ${cover.matshluti ? `<div>Matshluti ${escapeHtml(cover.matshluti)}</div>` : ""}
        ${cover.landeignNumber ? `<div>Landeignanúmer ${escapeHtml(cover.landeignNumber)}</div>` : ""}
        ${cover.fasteignNumber ? `<div>Fasteignanúmer ${escapeHtml(cover.fasteignNumber)}</div>` : ""}
      </div>
      <div class="cover-visual">
        ${coverImageData ? `<img src="${coverImageData}" alt="Forsíðumynd" />` : `<div style="padding:0 12mm;font-size:13pt;color:#6b7280;">Forsíðumynd eða teikning getur birst hér</div>`}
      </div>
    </div>
    <div class="cover-issuer">
      ${brandLogoData ? `<div class="cover-logo"><img src="${brandLogoData}" alt="HMS lógó" /></div>` : `<div></div>`}
      <div class="issuer-box">
        <div>${escapeHtml(generatedDate)}</div>
        ${cover.preparedByName ? `<div>${escapeHtml(cover.preparedByName)}</div>` : ""}
        ${cover.preparedByCompany ? `<div>${escapeHtml(cover.preparedByCompany)}</div>` : ""}
        ${cover.preparedByTitle ? `<div>${escapeHtml(cover.preparedByTitle)}</div>` : ""}
        ${cover.preparedByLicenseNumber ? `<div>Leyfisnúmer: ${escapeHtml(cover.preparedByLicenseNumber)}</div>` : ""}
        ${cover.preparedByKennitala ? `<div>Kennitala: ${escapeHtml(cover.preparedByKennitala)}</div>` : ""}
        ${cover.preparedByEmail ? `<div>${escapeHtml(cover.preparedByEmail)}</div>` : ""}
        ${cover.preparedByPhone ? `<div>${escapeHtml(cover.preparedByPhone)}</div>` : ""}
      </div>
    </div>
  </section>
  <section class="page-break">
    <div class="page-header">
      <div>
        <h2>${escapeHtml(cover.title)}</h2>
        <div class="sub">${escapeHtml(cover.propertyName)}</div>
      </div>
      <div class="sub">Drög dagsett ${escapeHtml(generatedDate)}</div>
    </div>
    <div class="meta-grid">
      <div class="meta-card"><span class="meta-label">Heiti máls</span><div class="meta-value">${escapeHtml(project.name)}</div></div>
      <div class="meta-card"><span class="meta-label">Heimilisfang</span><div class="meta-value">${escapeHtml(cover.address)}</div></div>
      <div class="meta-card"><span class="meta-label">Sveitarfélag</span><div class="meta-value">${escapeHtml(cover.municipality)}</div></div>
      <div class="meta-card"><span class="meta-label">Matshluti</span><div class="meta-value">${escapeHtml(cover.matshluti)}</div></div>
      <div class="meta-card"><span class="meta-label">Landeignanúmer</span><div class="meta-value">${escapeHtml(cover.landeignNumber)}</div></div>
      <div class="meta-card"><span class="meta-label">Fasteignanúmer</span><div class="meta-value">${escapeHtml(cover.fasteignNumber)}</div></div>
      <div class="meta-card"><span class="meta-label">Leyfisnúmer</span><div class="meta-value">${escapeHtml(cover.preparedByLicenseNumber)}</div></div>
      <div class="meta-card"><span class="meta-label">Kennitala leyfishafa</span><div class="meta-value">${escapeHtml(cover.preparedByKennitala)}</div></div>
    </div>
    ${sections.map((section) => `<div class="section"><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p></div>`).join("\n")}
    <div class="table-wrap">
      <div class="section">
        <h3>Yfirlit séreigna</h3>
        ${units.length ? `<table><thead><tr><th>Eignarhluti</th><th>Notkun</th><th>Fasteignanúmer</th><th>Flatarmál</th><th>Hlutfall í mhl.</th></tr></thead><tbody>${units.map((row) => `<tr><td>${escapeHtml(ownershipDisplay(row.ownership || ""))}</td><td>${escapeHtml(row.usage || "")}</td><td>${escapeHtml(row.fasteignanumer || "")}</td><td>${escapeHtml(formatNumber(row.birtFlatarmal || ""))}</td><td>${escapeHtml(formatNumber(row.hlutfallMhl || ""))}</td></tr>`).join("")}</tbody></table>` : `<p>Engin tafla yfir séreignir fannst í innlesnum gögnum.</p>`}
      </div>
    </div>
    <div class="table-wrap">
      <div class="section">
        <h3>Skipting hússins eftir eignarhlutum</h3>
        ${
          ownershipTables.length
            ? ownershipTables.map((table) => `
              <div class="ownership-card">
                <div class="title">Eignarhluti ${escapeHtml(table.ownershipDisplay || table.fasteignanumer || "")}</div>
                <table>
                  <thead>
                    <tr>
                      <th>Fasteignanúmer</th>
                      <th>Eignarhaldsnúmer</th>
                      <th>Eigninni tilheyrir</th>
                      <th>Notkun texti</th>
                      <th>Birt flatarmál m²</th>
                      <th>Hlutfall í mhl %</th>
                      <th>Hlutfall í lóð %</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>${escapeHtml(table.fasteignanumer)}</strong></td>
                      <td><strong>${escapeHtml(table.ownershipDisplay)}</strong></td>
                      <td>${escapeHtml(table.ownershipDisplay.replace(/^[^-]+-/, ""))}</td>
                      <td>${escapeHtml(table.usage || table.items[0]?.usage || "")}</td>
                      <td><strong>${escapeHtml(table.birtFlatarmal)}</strong></td>
                      <td><strong>${escapeHtml(table.hlutfallMhl)}</strong></td>
                      <td><strong>${escapeHtml(table.hlutfallLod || table.hlutfallHus)}</strong></td>
                    </tr>
                    ${table.items.map((item) => `
                      <tr>
                        <td></td>
                        <td></td>
                        <td>${escapeHtml(table.ownershipDisplay.replace(/^[^-]+-/, ""))}</td>
                        <td>${escapeHtml(item.usage)}</td>
                        <td>${escapeHtml(item.birtFlatarmal)}</td>
                        <td></td>
                        <td></td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            `).join("")
            : `<p>Ekki tókst að búa til skiptingartöflur fyrir eignarhluta.</p>`
        }
      </div>
    </div>
    <div class="table-wrap">
      <div class="section">
        <h3>Sameign sumra</h3>
        ${sameign.length ? `<table><thead><tr><th>Kóði</th><th>Notkun</th><th>Hópur</th><th>Hlutur</th></tr></thead><tbody>${sameign.map((row) => `<tr><td>${escapeHtml(row.code || "")}</td><td>${escapeHtml(row.usage || "")}</td><td>${escapeHtml(row.ownerGroup || "")}</td><td>${escapeHtml(formatNumber(row.share || ""))}</td></tr>`).join("")}</tbody></table>` : `<p>Engin skráð sameign sumra fannst.</p>`}
      </div>
    </div>
    <div class="section">
      <h3>Viðaukar</h3>
      ${appendices.length ? `<ol class="appendix-list">${appendices.map((pdf) => `<li>${escapeHtml(pdf.filename)}</li>`).join("")}</ol>` : `<p>Engin PDF fylgiskjöl hafa verið skráð með málinu.</p>`}
    </div>
    ${cover.footerNote ? `<div class="footer-note">${escapeHtml(cover.footerNote)}</div>` : ""}
  </section>
</body>
</html>`;
  return repairText(html);
}

module.exports = {
  buildSections,
  renderProjectHtml,
  resolveProjectData,
};
