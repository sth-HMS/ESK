const fs = require("node:fs");
const path = require("node:path");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".eot": "application/vnd.ms-fontobject",
};

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    notFound(res);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
    "Content-Length": body.length,
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: "Fannst ekki." });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseJsonBody(req) {
  const body = await parseBody(req);
  if (!body.length) {
    return {};
  }
  return JSON.parse(body.toString("utf8"));
}

async function parseMultipartBody(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) {
    throw new Error("Multipart boundary vantar.");
  }
  const boundary = `--${boundaryMatch[1]}`;
  const body = await parseBody(req);
  const raw = body.toString("latin1");
  const parts = raw.split(boundary).slice(1, -1);
  const files = [];
  const fields = {};

  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const [rawHeaders, rawValue] = trimmed.split("\r\n\r\n");
    if (!rawHeaders || rawValue === undefined) {
      continue;
    }
    const headerMatch = rawHeaders.match(/name="([^"]+)"/);
    const filenameMatch = rawHeaders.match(/filename="([^"]*)"/);
    const fieldName = headerMatch ? headerMatch[1] : "";
    const content = rawValue.endsWith("\r\n") ? rawValue.slice(0, -2) : rawValue;
    if (filenameMatch && filenameMatch[1]) {
      files.push({
        fieldName,
        filename: filenameMatch[1],
        content: Buffer.from(content, "latin1"),
      });
    } else {
      fields[fieldName] = content;
    }
  }

  return { fields, files };
}

module.exports = {
  parseJsonBody,
  parseMultipartBody,
  sendJson,
  sendFile,
  notFound,
  badRequest,
};
