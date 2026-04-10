const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { loadEnvFile } = require("./src/env");
loadEnvFile();
const {
  ensureDataFiles,
  listUsers,
  createUser,
  findUserByEmail,
  findUserById,
  updateUser,
  createSession,
  getSession,
  deleteSession,
  touchSession,
  listProjectsForUser,
  createProject,
  getProjectById,
  deleteProject,
  updateProject,
  storeProjectFile,
  getAdminOverview,
} = require("./src/storage");
const { hashPassword, verifyPassword, parseCookies } = require("./src/auth");
const { parseJsonBody, parseMultipartBody, sendJson, sendFile, notFound, badRequest } = require("./src/http");
const { parseWorkbook } = require("./src/xlsx");
const { getAiConfig, generateProjectDraft } = require("./src/ai");
const { repairText } = require("./src/encoding");
const { renderProjectHtml } = require("./src/export-modern");
const { renderProjectPdf } = require("./src/pdf-renderer");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DEFAULT_HMS_LOGO_PDF = "C:\\Users\\saevar.halldorsson\\OneDrive - HMS\\Documents\\MARKAÐSEFNI 2026\\HMS logopakki 0226\\PDF\\HMS stikkord horizontal\\HMS_stikkord_horizontal_blue-green.pdf";
const DEFAULT_HMS_LOGO_PNG = path.join(PUBLIC_DIR, "assets", "hms-logo-default.png");

ensureDataFiles();
ensureDefaultBrandAssets();

function ensureDefaultBrandAssets() {
  if (fs.existsSync(DEFAULT_HMS_LOGO_PNG) || !fs.existsSync(DEFAULT_HMS_LOGO_PDF)) {
    return;
  }
  const browserCandidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const browser = browserCandidates.find((candidate) => fs.existsSync(candidate));
  if (!browser) {
    return;
  }
  const assetDir = path.dirname(DEFAULT_HMS_LOGO_PNG);
  const profileDir = path.join(__dirname, "tmp_brand_profile");
  fs.mkdirSync(assetDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const result = spawnSync(browser, [
    "--headless=new",
    "--disable-gpu",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-crashpad-for-testing",
    "--no-first-run",
    "--no-default-browser-check",
    "--noerrdialogs",
    `--user-data-dir=${profileDir}`,
    `--screenshot=${DEFAULT_HMS_LOGO_PNG}`,
    "--window-size=1600,900",
    `file:///${DEFAULT_HMS_LOGO_PDF.replace(/\\/g, "/")}`,
  ], {
    encoding: "utf8",
    timeout: 45000,
  });
  if (result.status !== 0 && !fs.existsSync(DEFAULT_HMS_LOGO_PNG)) {
    console.warn("Tókst ekki að útbúa sjálfgefið HMS lógó:", result.stderr || result.stdout || result.error?.message || "óþekkt villa");
  }
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `esk_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "esk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.esk_session;
  if (!token) {
    return null;
  }
  const session = getSession(token);
  if (!session) {
    return null;
  }
  touchSession(token);
  return findUserById(session.userId) || null;
}

function canAccessProject(user, project) {
  return Boolean(user && project && (user.role === "admin" || project.ownerId === user.id));
}

function buildDocumentDraft(project) {
  const workbook = project.parsedWorkbook;
  const extracted = workbook?.extracted || {};
  const metadata = extracted.metadata || {};
  const propertyName = project.cover?.propertyName || metadata.propertyName || project.propertyInfo?.address || project.name;
  const appendices = (project.pdfUploads || []).map((pdf, index) => `Viðauki ${index + 1}: ${pdf.filename}`).join(", ") || "Engin fylgiskjöl hafa verið hlaðin inn.";
  const ownershipRows = (extracted.hlutfallstolur || []).filter((row) => row.ownership).slice(0, 20);
  const sameignRows = (extracted.sameignSumra || []).slice(0, 20);
  const lysingRows = (extracted.lysing || []).slice(0, 20);

  const ownershipText = ownershipRows.length
    ? ownershipRows
        .map((row) => {
          return `${row.ownership} - ${row.usage || "Eining"}; fasteignanr. ${row.fasteignanumer || "óskráð"}; birt flatarmál ${row.birtFlatarmal || "óskráð"} m²; hlutfall í mhl ${row.hlutfallMhl || "óskráð"}%.`;
        })
        .join(" ")
    : "Ekki tókst að draga út eignarhald og hlutfallstölur úr skráningartöflu.";

  const lysingText = lysingRows.length
    ? lysingRows
        .map((row) => {
          const items = (row.items || [])
            .filter((item) => item.usage && !/notkun/i.test(item.usage))
            .map((item) => (item.birtFlatarmal ? `${item.usage} (${item.birtFlatarmal} m²)` : item.usage))
            .join(", ");
          return `${row.ownership}: ${items || "nánari lýsing vantar"}.`;
        })
        .join(" ")
    : "Ekki tókst að draga út nánari lýsingu eignarhaldsnúmera.";

  const sameignText = sameignRows.length
    ? sameignRows
        .map((row) => `${row.code} - ${row.usage}; tengist ${row.ownerGroup || "óskráðum hópi"}; eignarhlutur ${row.share || "óskráður"}.`)
        .join(" ")
    : "Engin sameign sumra fannst í innlesnum gögnum.";

  const draft = {
    title: `Drög að eignaskiptayfirlýsingu - ${propertyName}`,
    generatedAt: new Date().toISOString(),
    sections: [
      {
        heading: "1. Almennar upplýsingar",
        body: `Eignaskiptayfirlýsing þessi tekur til ${propertyName}. Matshluti er ${project.cover?.matshluti || metadata.matshlutiNumber || "óskráður"}, landeignanúmer ${project.cover?.landeignNumber || metadata.landeignNumber || "óskráð"} og fasteignanúmer ${project.cover?.fasteignNumber || "óskráð"}. Skrásetjari samkvæmt töflu er ${metadata.registrar || "óskráður"}.`,
      },
      {
        heading: "2. Séreignir og eignarhald",
        body: ownershipText,
      },
      {
        heading: "3. Lýsing séreigna",
        body: lysingText,
      },
      {
        heading: "4. Sameign og sameign sumra",
        body: sameignText,
      },
      {
        heading: "5. Fylgiskjöl og viðaukar",
        body: `Eftirfarandi PDF skjöl eru skráð með málinu og eiga að fylgja sem viðauki við lokaskjal: ${appendices}`,
      },
    ],
  };
  return {
    ...draft,
    title: repairText(draft.title),
    sections: draft.sections.map((section) => ({
      heading: repairText(section.heading),
      body: repairText(section.body),
    })),
  };
}

function autoFillProjectFromWorkbook(project, workbook) {
  const extracted = workbook?.extracted || {};
  const metadata = extracted.metadata || {};
  return {
    propertyInfo: {
      ...project.propertyInfo,
      address: project.propertyInfo?.address || metadata.propertyName || "",
      municipality: project.propertyInfo?.municipality || "",
    },
    cover: {
      ...project.cover,
      propertyName: project.cover?.propertyName || metadata.propertyName || "",
      matshluti: project.cover?.matshluti || metadata.matshlutiNumber || "",
      landeignNumber: project.cover?.landeignNumber || metadata.landeignNumber || "",
      preparedByName: project.cover?.preparedByName || metadata.registrar || "",
    },
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  };
}

function serveApp(req, res) {
  const target = req.url === "/" ? "index.html" : req.url.replace(/^\//, "");
  const filePath = path.join(PUBLIC_DIR, target);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }
  sendFile(res, filePath);
}

async function handleRegister(req, res) {
  const body = await parseJsonBody(req);
  if (!body?.email || !body?.password || !body?.name) {
    badRequest(res, "Nafn, netfang og lykilorð eru skilyrði.");
    return;
  }
  if (findUserByEmail(body.email)) {
    badRequest(res, "Notandi með þessu netfangi er þegar til.");
    return;
  }
  const existingUsers = listUsers();
  const { salt, hash } = hashPassword(body.password);
  const user = createUser({
    email: body.email,
    name: body.name,
    passwordSalt: salt,
    passwordHash: hash,
    role: existingUsers.length === 0 ? "admin" : "user",
    active: true,
  });
  const session = createSession(user.id);
  setSessionCookie(res, session.id);
  sendJson(res, 201, { user: toPublicUser(user) });
}

async function handleLogin(req, res) {
  const body = await parseJsonBody(req);
  const user = findUserByEmail(body?.email || "");
  if (!user || !user.active) {
    badRequest(res, "Rangt netfang eða lykilorð.");
    return;
  }
  const ok = verifyPassword(body.password || "", user.passwordSalt, user.passwordHash);
  if (!ok) {
    badRequest(res, "Rangt netfang eða lykilorð.");
    return;
  }
  const session = createSession(user.id);
  setSessionCookie(res, session.id);
  sendJson(res, 200, { user: toPublicUser(user) });
}

function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (cookies.esk_session) {
    deleteSession(cookies.esk_session);
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

function handleMe(req, res) {
  const user = getCurrentUser(req);
  sendJson(res, 200, { user: user ? toPublicUser(user) : null });
}

function handleProjectsList(req, res, user) {
  sendJson(res, 200, {
    projects: listProjectsForUser(user).map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      updatedAt: project.updatedAt,
      ownerId: project.ownerId,
      address: project.propertyInfo?.address || "",
    })),
  });
}

async function handleProjectCreate(req, res, user) {
  const body = await parseJsonBody(req);
  const project = createProject({
    ownerId: user.id,
    name: body?.name || "Ónefnt mál",
    status: "draft",
    propertyInfo: {
      address: body?.address || "",
      municipality: body?.municipality || "",
    },
  });
  sendJson(res, 201, { project });
}

function handleProjectGet(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  sendJson(res, 200, { project });
}

async function handleProjectUpdate(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const body = await parseJsonBody(req);
  const updated = updateProject(projectId, {
    name: body?.name ?? project.name,
    status: body?.status ?? project.status,
    propertyInfo: {
      ...project.propertyInfo,
      ...(body?.propertyInfo || {}),
    },
    cover: {
      ...project.cover,
      ...(body?.cover || {}),
    },
    documentDraft: body?.documentDraft ?? project.documentDraft,
  });
  sendJson(res, 200, { project: updated });
}

function handleProjectDelete(req, res, user, projectId) {
  const project = listProjectsForUser(user).find((item) => item.id === projectId) || null;
  if (!project) {
    notFound(res);
    return;
  }
  deleteProject(projectId);
  sendJson(res, 200, { ok: true });
}

async function handleExcelUpload(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const { files } = await parseMultipartBody(req);
  const file = files[0];
  if (!file) {
    badRequest(res, "Excel skrá fannst ekki.");
    return;
  }
  const stored = storeProjectFile(projectId, file.filename, file.content);
  const workbook = parseWorkbook(stored.absolutePath);
  const autoFilled = autoFillProjectFromWorkbook(project, workbook);
  const draftProject = {
    ...project,
    parsedWorkbook: workbook,
    propertyInfo: autoFilled.propertyInfo,
    cover: autoFilled.cover,
    pdfUploads: project.pdfUploads || [],
  };
  const updated = updateProject(projectId, {
    excelUpload: stored.publicPath,
    parsedWorkbook: workbook,
    propertyInfo: autoFilled.propertyInfo,
    cover: autoFilled.cover,
    documentDraft: buildDocumentDraft(draftProject),
    activity: [
      ...(project.activity || []),
      { id: crypto.randomUUID(), type: "excel_upload", at: new Date().toISOString(), filename: file.filename },
    ],
  });
  sendJson(res, 200, { project: updated, workbook });
}

async function handlePdfUpload(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const { files } = await parseMultipartBody(req);
  const file = files[0];
  if (!file) {
    badRequest(res, "PDF skrá fannst ekki.");
    return;
  }
  const stored = storeProjectFile(projectId, file.filename, file.content);
  const pdfUploads = [...(project.pdfUploads || []), { filename: file.filename, path: stored.publicPath, uploadedAt: new Date().toISOString() }];
  const updated = updateProject(projectId, {
    pdfUploads,
    activity: [
      ...(project.activity || []),
      { id: crypto.randomUUID(), type: "pdf_upload", at: new Date().toISOString(), filename: file.filename },
    ],
  });
  sendJson(res, 200, { project: updated });
}

async function handleAnnotationsSave(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const body = await parseJsonBody(req);
  const updated = updateProject(projectId, {
    annotations: Array.isArray(body?.annotations) ? body.annotations : [],
  });
  sendJson(res, 200, { project: updated });
}

async function handleCoverAssetUpload(req, res, user, projectId, fieldName) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const { files } = await parseMultipartBody(req);
  const file = files[0];
  if (!file) {
    badRequest(res, "Mynd fannst ekki.");
    return;
  }
  const stored = storeProjectFile(projectId, file.filename, file.content);
  const cover = {
    ...project.cover,
    [fieldName]: stored.publicPath,
  };
  const updated = updateProject(projectId, { cover });
  sendJson(res, 200, { project: updated });
}

function handleGenerateDocument(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const draft = buildDocumentDraft(project);
  const updated = updateProject(projectId, { documentDraft: draft, status: "review" });
  sendJson(res, 200, { project: updated });
}

function handleAdminOverview(req, res, user) {
  if (user.role !== "admin") {
    notFound(res);
    return;
  }
  sendJson(res, 200, getAdminOverview());
}

function handleAiStatus(req, res) {
  sendJson(res, 200, { ai: getAiConfig() });
}

async function handleAiDocument(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const body = await parseJsonBody(req);
  try {
    const draft = await generateProjectDraft(project, body?.notes || "");
    const updated = updateProject(projectId, {
      documentDraft: draft,
      status: "review",
      activity: [
        ...(project.activity || []),
        { id: crypto.randomUUID(), type: "ai_document", at: new Date().toISOString(), model: draft.model },
      ],
    });
    sendJson(res, 200, { project: updated, ai: getAiConfig() });
  } catch (error) {
    console.error("PDF export failed:", error);
    sendJson(res, 500, { error: error.message || "AI textagerð mistókst." });
  }
}

function handleExportHtml(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  const html = renderProjectHtml(project, { assetBaseUrl: `http://${HOST}:${PORT}` });
  const body = Buffer.from(html, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

async function handleExportPdf(req, res, user, projectId) {
  const project = getProjectById(projectId);
  if (!canAccessProject(user, project)) {
    notFound(res);
    return;
  }
  try {
    const pdf = await renderProjectPdf(project, { assetBaseUrl: `http://${HOST}:${PORT}` });
    const preferredName = (project.cover?.propertyName || project.name || "eignaskiptayfirlysing").trim();
    const asciiName = preferredName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "eignaskiptayfirlysing";
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiName}.pdf"; filename*=UTF-8''${encodeURIComponent(preferredName)}.pdf`,
      "Content-Length": pdf.length,
    });
    res.end(pdf);
  } catch (error) {
    console.error("PDF export failed:", error);
    sendJson(res, 500, {
      error: repairText(error.message || "PDF útflutningur mistókst."),
      details: String(error?.stack || error || ""),
    });
  }
}

async function handleAdminUserUpdate(req, res, user, targetUserId) {
  if (user.role !== "admin") {
    notFound(res);
    return;
  }
  const target = findUserById(targetUserId);
  if (!target) {
    notFound(res);
    return;
  }
  const body = await parseJsonBody(req);
  const updated = updateUser(targetUserId, {
    active: typeof body?.active === "boolean" ? body.active : target.active,
    role: body?.role || target.role,
  });
  sendJson(res, 200, { user: toPublicUser(updated) });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/uploads/")) {
    const filePath = path.join(UPLOADS_DIR, pathname.replace(/^\/uploads\//, ""));
    if (!filePath.startsWith(UPLOADS_DIR)) {
      notFound(res);
      return;
    }
    sendFile(res, filePath);
    return;
  }

  if (pathname === "/api/auth/register" && req.method === "POST") return void (await handleRegister(req, res));
  if (pathname === "/api/auth/login" && req.method === "POST") return void (await handleLogin(req, res));
  if (pathname === "/api/auth/logout" && req.method === "POST") return void handleLogout(req, res);
  if (pathname === "/api/auth/me" && req.method === "GET") return void handleMe(req, res);
  if (pathname === "/api/ai/status" && req.method === "GET") return void handleAiStatus(req, res);

  const user = getCurrentUser(req);
  if (pathname.startsWith("/api/") && !user) {
    sendJson(res, 401, { error: "Innskráning krafist." });
    return;
  }

  if (pathname === "/api/projects" && req.method === "GET") return void handleProjectsList(req, res, user);
  if (pathname === "/api/projects" && req.method === "POST") return void (await handleProjectCreate(req, res, user));
  if (/^\/api\/projects\/[^/]+$/.test(pathname) && req.method === "GET") return void handleProjectGet(req, res, user, pathname.split("/")[3]);
  if (/^\/api\/projects\/[^/]+$/.test(pathname) && req.method === "PUT") return void (await handleProjectUpdate(req, res, user, pathname.split("/")[3]));
  if (/^\/api\/projects\/[^/]+$/.test(pathname) && req.method === "DELETE") return void handleProjectDelete(req, res, user, pathname.split("/")[3]);
  if (/^\/api\/projects\/[^/]+\/delete$/.test(pathname) && req.method === "POST") return void handleProjectDelete(req, res, user, pathname.split("/")[3]);
  if (/^\/api\/projects\/[^/]+\/upload\/excel$/.test(pathname) && req.method === "POST") return void (await handleExcelUpload(req, res, user, pathname.split("/")[3]));
  if (/^\/api\/projects\/[^/]+\/upload\/pdf$/.test(pathname) && req.method === "POST") return void (await handlePdfUpload(req, res, user, pathname.split("/")[3]));
  if (/^\/api\/projects\/[^/]+\/upload\/logo$/.test(pathname) && req.method === "POST") return void (await handleCoverAssetUpload(req, res, user, pathname.split("/")[3], "logoImagePath"));
  if (/^\/api\/projects\/[^/]+\/upload\/cover-image$/.test(pathname) && req.method === "POST") return void (await handleCoverAssetUpload(req, res, user, pathname.split("/")[3], "coverImagePath"));
  if (/^\/api\/projects\/[^/]+\/annotations$/.test(pathname) && req.method === "POST") return void (await handleAnnotationsSave(req, res, user, pathname.split("/")[3]));
  if (/^\/api\/projects\/[^/]+\/generate-document$/.test(pathname) && req.method === "POST") return void handleGenerateDocument(req, res, user, pathname.split("/")[3]);
  if (/^\/api\/projects\/[^/]+\/generate-ai-document$/.test(pathname) && req.method === "POST") return void (await handleAiDocument(req, res, user, pathname.split("/")[3]));
  if (/^\/api\/projects\/[^/]+\/export\.html$/.test(pathname) && req.method === "GET") return void handleExportHtml(req, res, user, pathname.split("/")[3]);
  if (/^\/api\/projects\/[^/]+\/export\.pdf$/.test(pathname) && req.method === "GET") return void (await handleExportPdf(req, res, user, pathname.split("/")[3]));
  if (pathname === "/api/admin/overview" && req.method === "GET") return void handleAdminOverview(req, res, user);
  if (/^\/api\/admin\/users\/[^/]+$/.test(pathname) && req.method === "PUT") return void (await handleAdminUserUpdate(req, res, user, pathname.split("/")[4]));

  if (
    pathname === "/" ||
    pathname.startsWith("/app") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".eot")
  ) {
    serveApp(req, res);
    return;
  }

  notFound(res);
});

server.listen(PORT, HOST, () => {
  console.log(`ESK prototype running at http://${HOST}:${PORT}`);
});
