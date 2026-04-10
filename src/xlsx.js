const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { repairText } = require("./encoding");

function decodeXml(input) {
  return repairText(String(input || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'"));
}

function stripTags(input) {
  return decodeXml(String(input || "").replace(/<[^>]+>/g, ""));
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("ZIP endaskrá fannst ekki.");
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let cursor = centralDirectoryOffset;
  const limit = centralDirectoryOffset + centralDirectorySize;

  while (cursor < limit) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Ógild ZIP central directory færsla.");
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.toString("utf8", cursor + 46, cursor + 46 + fileNameLength);
    entries.set(fileName, {
      fileName,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return {
    getText(entryName) {
      const entry = entries.get(entryName);
      if (!entry) {
        return null;
      }
      const localHeader = entry.localHeaderOffset;
      if (buffer.readUInt32LE(localHeader) !== 0x04034b50) {
        throw new Error(`Ógild local header fyrir ${entryName}.`);
      }
      const fileNameLength = buffer.readUInt16LE(localHeader + 26);
      const extraLength = buffer.readUInt16LE(localHeader + 28);
      const dataStart = localHeader + 30 + fileNameLength + extraLength;
      const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
      if (entry.compressionMethod === 0) {
        return compressed.toString("utf8");
      }
      if (entry.compressionMethod === 8) {
        return zlib.inflateRawSync(compressed).toString("utf8");
      }
      throw new Error(`Óstudd ZIP þjöppun: ${entry.compressionMethod}`);
    },
  };
}

function loadSharedStrings(zip) {
  const xml = zip.getText("xl/sharedStrings.xml");
  if (!xml) {
    return [];
  }
  return [...xml.matchAll(/<si[\s\S]*?>([\s\S]*?)<\/si>/g)].map((match) => stripTags(match[1]));
}

function parseWorkbookRelationships(zip) {
  const xml = zip.getText("xl/_rels/workbook.xml.rels");
  if (!xml) {
    return {};
  }
  const map = {};
  for (const match of xml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
    map[match[1]] = match[2];
  }
  return map;
}

function parseSheet(name, xml, sharedStrings) {
  const rows = [...xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  const allRows = [];
  const preview = [];

  for (const rowMatch of rows) {
    const rowNumber = Number(rowMatch[1]);
    const cells = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c[^>]*r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const column = cellMatch[1];
      const attrs = cellMatch[3] || "";
      const body = cellMatch[4] || "";
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : "";
      let value = "";

      if (cellType === "s") {
        const sharedIndex = Number((body.match(/<v>(.*?)<\/v>/) || [])[1] || 0);
        value = sharedStrings[sharedIndex] || "";
      } else if (cellType === "inlineStr") {
        value = stripTags((body.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || "");
      } else {
        value = decodeXml((body.match(/<v>(.*?)<\/v>/) || [])[1] || "");
      }

      cells.push({ column, value });
    }
    const row = { rowNumber, cells };
    allRows.push(row);
    if (preview.length < 12) {
      preview.push(row);
    }
  }

  return {
    name,
    rowCount: rows.length,
    preview,
    rows: allRows,
  };
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getCell(row, column) {
  return row?.cells?.find((cell) => cell.column === column)?.value ?? "";
}

function getSheetByName(sheets, expected) {
  const target = normalizeText(expected);
  return sheets.find((sheet) => normalizeText(sheet.name) === target) || null;
}

function extractHeaderMetadata(sheet) {
  if (!sheet) {
    return {};
  }
  const metadata = {};
  for (const row of sheet.rows.slice(0, 20)) {
    for (let index = 0; index < row.cells.length; index += 1) {
      const current = String(row.cells[index].value || "").trim();
      const next = String(row.cells[index + 1]?.value || "").trim();
      if (!current.endsWith(":") || !next) {
        continue;
      }
      metadata[normalizeText(current.slice(0, -1))] = next;
    }
  }
  return metadata;
}

function extractFrontPageMetadata(sheet) {
  if (!sheet) {
    return {};
  }
  const metadata = extractHeaderMetadata(sheet);
  for (const row of sheet.rows.slice(0, 20)) {
    const values = row.cells.map((cell) => String(cell.value || "").trim()).filter(Boolean);
    if (!metadata.kennitala) {
      const kennitala = values.find((value) => /^\d{10}$/.test(value));
      if (kennitala) {
        metadata.kennitala = kennitala;
      }
    }
  }
  return metadata;
}

function mapMetadataFields(metadata) {
  return {
    propertyName: metadata.skraningartafla || "",
    landeignNumber: metadata.landeignanumer || "",
    matshlutiNumber: metadata.matshlutanumer || "",
    registrar: metadata.skrasetjari || "",
    kennitala: metadata.kennitala || "",
    version: metadata.utgafa || "",
    dateSerial: metadata["dags."] || "",
    propertyCount: metadata["fjoldi matshluta a landeign"] || "",
  };
}

function extractMatshluti(sheet) {
  if (!sheet) {
    return [];
  }
  return sheet.rows
    .filter((row) => getCell(row, "A") === "Matshluti")
    .map((row) => ({
      label: getCell(row, "A"),
      bruttoFlatarmal: getCell(row, "D"),
    }));
}

function extractUnits(sheet) {
  if (!sheet) {
    return [];
  }
  return sheet.rows
    .filter((row) => /^[A-Z]$/.test(String(getCell(row, "A") || "")) && /^\d{4}$/.test(String(getCell(row, "B") || "")))
    .map((row) => ({
      lokun: getCell(row, "A"),
      code: getCell(row, "B"),
      usage: getCell(row, "C"),
      category: getCell(row, "D"),
      ownership: getCell(row, "E"),
      bruttoFlatarmal: getCell(row, "J"),
      nettoFlatarmal: getCell(row, "O"),
      birtFlatarmal: getCell(row, "P"),
      splitVolume: getCell(row, "R"),
      heated: getCell(row, "S"),
    }));
}

function extractSameignSumra(sheet) {
  if (!sheet) {
    return [];
  }
  return sheet.rows
    .filter((row) => /^[A-Z0-9]+$/.test(String(getCell(row, "B") || "")))
    .map((row) => ({
      code: getCell(row, "B"),
      usage: getCell(row, "C"),
      ownershipType: getCell(row, "D"),
      ownerGroup: getCell(row, "E"),
      rule: getCell(row, "F"),
      share: getCell(row, "G"),
    }));
}

function extractHlutfallstolur(sheet) {
  if (!sheet) {
    return [];
  }
  let tableStart = -1;
  for (let i = 0; i < sheet.rows.length; i += 1) {
    if (normalizeText(getCell(sheet.rows[i], "A")) === "fasteignanr.") {
      tableStart = i;
      break;
    }
  }
  if (tableStart === -1) {
    return [];
  }
  return sheet.rows
    .slice(tableStart + 1)
    .filter((row) => String(getCell(row, "A") || "").trim() || String(getCell(row, "B") || "").trim())
    .map((row) => ({
      fasteignanumer: getCell(row, "A"),
      ownership: getCell(row, "B"),
      usage: getCell(row, "C"),
      birtFlatarmal: getCell(row, "D"),
      sereignVolume: getCell(row, "E"),
      totalVolume: getCell(row, "F"),
      hlutfallMhl: getCell(row, "G"),
      hlutfallLod: getCell(row, "H"),
      hlutfallHus: getCell(row, "I"),
      sameignSumraShare: getCell(row, "J"),
    }))
    .filter((row) => row.ownership || row.fasteignanumer);
}

function extractLysing(sheet) {
  if (!sheet) {
    return [];
  }
  const groups = [];
  let current = null;
  for (const row of sheet.rows) {
    const ownership = String(getCell(row, "C") || "").trim();
    const usage = String(getCell(row, "E") || "").trim();
    if (/^\d{2}-\d{4}$/.test(ownership)) {
      current = {
        ownership,
        birtFlatarmal: getCell(row, "D"),
        hlutfallMhl: getCell(row, "G"),
        hlutfallLod: getCell(row, "H"),
        hlutfallHus: getCell(row, "I"),
        sameignSumraShare: getCell(row, "J"),
        items: [],
      };
      groups.push(current);
      continue;
    }
    if (current && usage) {
      current.items.push({
        usage,
        birtFlatarmal: getCell(row, "F"),
      });
    }
  }
  return groups;
}

function extractHlutfallHita(sheet) {
  if (!sheet) {
    return [];
  }
  return sheet.rows
    .map((row) => ({
      ownership: getCell(row, "A") || getCell(row, "B"),
      usage: getCell(row, "C"),
      heatShare: getCell(row, "D") || getCell(row, "E"),
      electricShare: getCell(row, "F") || getCell(row, "G"),
      notes: [getCell(row, "H"), getCell(row, "I"), getCell(row, "J")].filter(Boolean).join(" ").trim(),
    }))
    .filter((row) => row.ownership || row.heatShare || row.electricShare || row.notes);
}

function extractSimpleRows(sheet) {
  if (!sheet) {
    return [];
  }
  return sheet.rows
    .map((row) => row.cells.map((cell) => String(cell.value || "").trim()).filter(Boolean))
    .filter((cells) => cells.length);
}

function extractWorkbookModel(sheets) {
  const metadataSource = getSheetByName(sheets, "Forsíða") || getSheetByName(sheets, "Matshluti") || getSheetByName(sheets, "Einingar") || sheets[0] || null;
  const headerMetadata = mapMetadataFields(extractFrontPageMetadata(metadataSource));
  return {
    metadata: headerMetadata,
    matshlutar: extractMatshluti(getSheetByName(sheets, "Matshluti")),
    units: extractUnits(getSheetByName(sheets, "Einingar")),
    sameignSumra: extractSameignSumra(getSheetByName(sheets, "Sameign_sumra")),
    hlutfallstolur: extractHlutfallstolur(getSheetByName(sheets, "Hlutfallstölur")),
    lysing: extractLysing(getSheetByName(sheets, "Lýsing")),
    hlutfallHita: extractHlutfallHita(getSheetByName(sheets, "Hlutfall_hita")),
  };
}

function parseWorkbook(filePath) {
  try {
    const zip = readZipEntries(filePath);
    const xml = zip.getText("xl/workbook.xml");
    if (!xml) {
      throw new Error("xl/workbook.xml fannst ekki.");
    }
    const relationships = parseWorkbookRelationships(zip);
    const sharedStrings = loadSharedStrings(zip);
    const sheets = [];

    for (const match of xml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
      const sheetName = decodeXml(match[1]);
      const relId = match[2];
      const target = relationships[relId];
      if (!target) {
        continue;
      }
      const normalizedTarget = path.posix.normalize(path.posix.join("xl", target));
      const sheetXml = zip.getText(normalizedTarget);
      if (!sheetXml) {
        continue;
      }
      sheets.push(parseSheet(sheetName, sheetXml, sharedStrings));
    }

    return {
      parsedAt: new Date().toISOString(),
      sheets,
      extracted: extractWorkbookModel(sheets),
      warnings: sheets.length ? [] : ["Engin vinnublöð fundust við innlestur."],
    };
  } catch (error) {
    return {
      parsedAt: new Date().toISOString(),
      sheets: [],
      extracted: null,
      warnings: [`Ekki tókst að lesa Excel skrá: ${error.message}`],
    };
  }
}

module.exports = {
  parseWorkbook,
};
