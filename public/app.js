const state = {
  user: null,
  projects: [],
  currentProject: null,
  adminOverview: null,
  ai: null,
};

const views = {
  auth: document.getElementById("authView"),
  dashboard: document.getElementById("dashboardView"),
  project: document.getElementById("projectView"),
  admin: document.getElementById("adminView"),
};

const nav = document.getElementById("nav");
const toastEl = document.getElementById("toast");

function repairText(value) {
  let text = String(value ?? "");
  if (/[ÃÂÐÞ�]/.test(text)) {
    try {
      const bytes = Uint8Array.from(Array.from(text, (char) => char.charCodeAt(0) & 0xff));
      text = new TextDecoder("utf-8").decode(bytes);
    } catch {}
  }
  const replacements = [
    ["Â·", "·"],
    ["mÂ²", "m²"],
    ["â€”", "—"],
    ["M�l", "Mál"],
    ["m�l", "mál"],
    ["m�ls", "máls"],
    ["M�n", "Mín"],
    ["Skr�", "Skrá"],
    ["Skr�ning", "Skráning"],
    ["Fors��", "Forsíð"],
    ["Fors�", "Forsí"],
    ["Innskr�ning", "Innskráning"],
    ["N�skráning", "Nýskráning"],
    ["lykilor�", "lykilorð"],
    ["Lykilor�", "Lykilorð"],
    ["a�", "að"],
    ["A�", "Að"],
    ["�", "ð"],
    ["s�", "sé"],
    ["S�", "Sé"],
    ["Sveitarf�lag", "Sveitarfélag"],
    ["Landeignan�mer", "Landeignanúmer"],
    ["Fasteignan�mer", "Fasteignanúmer"],
    ["Yfirl�sing", "Yfirlýsing"],
    ["L�sing", "Lýsing"],
    ["Yfirfer�", "Yfirferð"],
    ["Kva�ir", "Kvaðir"],
    ["r�ttindi", "réttindi"],
    ["rafmagnskostna�", "rafmagnskostnað"],
    ["fylgiskj�l", "fylgiskjöl"],
    ["vi�aukar", "viðaukar"],
    ["vi�auki", "viðauki"],
    ["�inglýstum", "þinglýstum"],
  ];
  for (const [from, to] of replacements) {
    text = text.split(from).join(to);
  }
  return text;
}

function repairDomText() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  for (const node of textNodes) {
    node.nodeValue = repairText(node.nodeValue);
  }
  for (const element of document.querySelectorAll("[placeholder], [title], button, label, option, h1, h2, h3, p, span, a")) {
    if (element.placeholder) {
      element.placeholder = repairText(element.placeholder);
    }
    if (element.title) {
      element.title = repairText(element.title);
    }
  }
}

function field(form, name) {
  return form.querySelector(`[name="${name}"]`);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    credentials: "same-origin",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Villa kom upp.");
  }
  return payload;
}

function showToast(message) {
  toastEl.textContent = repairText(message);
  toastEl.classList.remove("hidden");
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

function setView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("hidden", key !== name);
  });
}

function renderNav() {
  nav.classList.toggle("hidden", !state.user);
  const logoutBtn = document.getElementById("logoutBtn");
  logoutBtn.classList.toggle("hidden", !state.user);
  const badge = document.getElementById("userBadge");
  badge.classList.toggle("hidden", !state.user);
  if (state.user) {
    const initials = state.user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("");
    badge.title = `${state.user.name} | ${state.user.email} | ${state.user.role}`;
    badge.innerHTML = `<strong>${initials || "U"}</strong>`;
  }
  const iconMap = {
    dashboard: { label: "Mál", iconClass: "projects" },
    project: { label: "Vinnsla", iconClass: "project" },
    admin: { label: "Admin", iconClass: "admin" },
  };
  [...nav.querySelectorAll("button")].forEach((button) => {
    button.classList.toggle("hidden", button.dataset.view === "admin" && state.user?.role !== "admin");
    const config = iconMap[button.dataset.view];
    if (config) {
      button.title = config.label;
      button.setAttribute("aria-label", config.label);
      button.innerHTML = `<span class="nav-icon ${config.iconClass}" aria-hidden="true"></span><span class="visually-hidden">${config.label}</span>`;
    }
  });
  logoutBtn.title = "Skrá út";
  logoutBtn.setAttribute("aria-label", "Skrá út");
  logoutBtn.innerHTML = `<span class="nav-icon project" aria-hidden="true"></span><span class="visually-hidden">Skrá út</span>`;
  repairDomText();
}

function renderProjects() {
  const host = document.getElementById("projectsList");
  host.innerHTML = "";
  if (!state.projects.length) {
    host.innerHTML = `<div class="project-item"><div><strong>Engin mál enn</strong><div class="muted">Stofnaðu fyrsta málið til að byrja.</div></div></div>`;
    return;
  }
  for (const project of state.projects) {
    const el = document.createElement("div");
    el.className = "project-item";
    el.innerHTML = `
      <div>
        <strong>${project.name}</strong>
        <div class="muted">${project.address || "Heimilisfang vantar"} · Uppfært ${new Date(project.updatedAt).toLocaleString("is-IS")}</div>
      </div>
      <div>
        <span class="pill">${project.status}</span>
        <button data-project-id="${project.id}">Opna mál</button>
        <button class="ghost" data-delete-project-id="${project.id}">Eyða</button>
      </div>
    `;
    el.querySelector('[data-project-id]').addEventListener("click", () => openProject(project.id));
    el.querySelector('[data-delete-project-id]').addEventListener("click", async () => {
      const ok = window.confirm(`Ertu viss um að þú viljir eyða málinu "${project.name}"?`);
      if (!ok) {
        return;
      }
      await api(`/api/projects/${project.id}/delete`, { method: "POST", body: "{}" });
      if (state.currentProject?.id === project.id) {
        state.currentProject = null;
        setView("dashboard");
      }
      await refreshProjects();
      showToast("Máli eytt.");
    });
    host.appendChild(el);
  }
  repairDomText();
}

function renderWorkbook(project) {
  const host = document.getElementById("workbookSummary");
  host.innerHTML = "";
  if (!project?.parsedWorkbook) {
    host.innerHTML = `<div class="muted">Engin Excel skrá hefur verið lesin inn enn.</div>`;
    return;
  }
  if (project.parsedWorkbook.warnings?.length) {
    for (const warning of project.parsedWorkbook.warnings) {
      const warn = document.createElement("div");
      warn.className = "sheet-card";
      warn.textContent = warning;
      host.appendChild(warn);
    }
  }
  for (const sheet of project.parsedWorkbook.sheets || []) {
    const el = document.createElement("div");
    el.className = "sheet-card";
    const rowsHtml = (sheet.preview || [])
      .map(
        (row) =>
          `<div class="preview-row">${row.cells
            .slice(0, 6)
            .map((cell) => `<span class="preview-cell"><strong>${cell.column}</strong>: ${escapeHtml(cell.value || "—")}</span>`)
            .join("")}</div>`,
      )
      .join("");
    el.innerHTML = `
      <strong>${sheet.name}</strong>
      <div class="muted">${sheet.rowCount} raðir lesnar</div>
      <div class="preview-grid">${rowsHtml || '<div class="muted">Engin forskoðun til staðar.</div>'}</div>
    `;
    host.appendChild(el);
  }
}

function renderFiles(project) {
  const fileSummary = document.getElementById("fileSummary");
  const pdfList = document.getElementById("pdfList");
  fileSummary.innerHTML = `
    <div>Excel: ${project?.excelUpload ? `<a href="${project.excelUpload}" target="_blank">opna skrá</a>` : "ekki komið"}</div>
    <div>PDF skjöl: ${(project?.pdfUploads || []).length}</div>
  `;
  pdfList.innerHTML = "";
  for (const pdf of project?.pdfUploads || []) {
    const wrapper = document.createElement("div");
    wrapper.className = "sheet-card";
    wrapper.innerHTML = `
      <div><strong>${pdf.filename}</strong></div>
      <div class="muted">Viðauki · hlaðið inn ${new Date(pdf.uploadedAt).toLocaleString("is-IS")}</div>
      <iframe class="pdf-frame" src="${pdf.path}"></iframe>
    `;
    pdfList.appendChild(wrapper);
  }
  if (!(project?.pdfUploads || []).length) {
    pdfList.innerHTML = `<div class="muted">Engar teikningar komnar inn enn.</div>`;
  }
}

function renderDocument(project) {
  const editor = document.getElementById("documentEditor");
  const aiStatus = document.getElementById("aiStatus");
  if (state.ai) {
    aiStatus.textContent = state.ai.enabled
      ? `Aukaval · ${state.ai.model} · skills: ${state.ai.skills.join(", ")}`
      : "Óvirkt þar til OPENAI_API_KEY er sett í .env";
  }
  if (!project?.documentDraft) {
    editor.value = "";
    editor.placeholder = "Myndaðu drög eða skrifaðu texta hér.";
    return;
  }
  editor.value = `${project.documentDraft.title}\n\n${project.documentDraft.sections
    .map((section) => `${section.heading}\n${section.body}`)
    .join("\n\n")}`;
}

function renderCover(project) {
  const cover = project.cover || {};
  const form = document.getElementById("coverForm");
  field(form, "title").value = cover.title || "EIGNASKIPTAYFIRLÝSING";
  field(form, "propertyName").value = cover.propertyName || "";
  field(form, "matshluti").value = cover.matshluti || "";
  field(form, "landeignNumber").value = cover.landeignNumber || "";
  field(form, "fasteignNumber").value = cover.fasteignNumber || "";
  field(form, "preparedByName").value = cover.preparedByName || "";
  field(form, "preparedByCompany").value = cover.preparedByCompany || "";
  field(form, "preparedByTitle").value = cover.preparedByTitle || "";
  field(form, "preparedByLicenseNumber").value = cover.preparedByLicenseNumber || "";
  field(form, "preparedByKennitala").value = cover.preparedByKennitala || "";
  field(form, "preparedByEmail").value = cover.preparedByEmail || "";
  field(form, "preparedByPhone").value = cover.preparedByPhone || "";
  field(form, "heatingElectricityText").value = cover.heatingElectricityText || "";
  field(form, "easementsText").value = cover.easementsText || "";
  field(form, "footerNote").value = cover.footerNote || "";

  document.getElementById("coverAssetSummary").innerHTML = `
    <div>Lógó: ${cover.logoImagePath ? `<a href="${cover.logoImagePath}" target="_blank">sérsniðið lógó</a>` : "sjálfgefið HMS lógó"}</div>
    <div>Forsíðumynd: ${cover.coverImagePath ? `<a href="${cover.coverImagePath}" target="_blank">opna</a>` : "ekki komið"}</div>
  `;
  document.getElementById("downloadPdfLink").href = `/api/projects/${project.id}/export.pdf`;
  document.getElementById("previewHtmlLink").href = `/api/projects/${project.id}/export.html`;
}

function renderProject(project) {
  state.currentProject = project;
  document.getElementById("projectTitle").textContent = project.name;
  const form = document.getElementById("projectMetaForm");
  field(form, "name").value = project.name || "";
  field(form, "address").value = project.propertyInfo?.address || "";
  field(form, "municipality").value = project.propertyInfo?.municipality || "";
  field(form, "status").value = project.status || "draft";
  renderWorkbook(project);
  renderFiles(project);
  renderCover(project);
  renderDocument(project);
  repairDomText();
}

function renderAdmin() {
  const userHost = document.getElementById("adminUsersList");
  const projectHost = document.getElementById("adminProjectsList");
  userHost.innerHTML = "";
  projectHost.innerHTML = "";

  for (const user of state.adminOverview?.users || []) {
    const el = document.createElement("div");
    el.className = "admin-item";
    el.innerHTML = `
      <strong>${user.name}</strong>
      <div class="muted">${user.email} · ${user.role}</div>
      <div class="muted">${user.active ? "Virkur" : "Óvirkur"}</div>
      <div class="actions">
        <button class="ghost" data-toggle="${user.id}">${user.active ? "Óvirkja" : "Virkja"}</button>
      </div>
    `;
    el.querySelector("button").addEventListener("click", () => toggleUser(user));
    userHost.appendChild(el);
  }

  for (const project of state.adminOverview?.projects || []) {
    const el = document.createElement("div");
    el.className = "admin-item";
    el.innerHTML = `
      <strong>${project.name}</strong>
      <div class="muted">${project.status} · ${new Date(project.updatedAt).toLocaleString("is-IS")}</div>
      <div class="muted">Eigandi: ${project.ownerId}</div>
    `;
    projectHost.appendChild(el);
  }
  repairDomText();
}

async function bootstrap() {
  bindEvents();
  const me = await api("/api/auth/me");
  const aiStatus = await api("/api/ai/status");
  state.ai = aiStatus.ai;
  state.user = me.user;
  renderNav();
  if (!state.user) {
    setView("auth");
    return;
  }
  await refreshProjects();
  setView("dashboard");
}

async function refreshProjects() {
  const result = await api("/api/projects");
  state.projects = result.projects;
  renderProjects();
}

async function openProject(id) {
  const result = await api(`/api/projects/${id}`);
  renderProject(result.project);
  setView("project");
}

async function refreshAdmin() {
  if (state.user?.role !== "admin") {
    return;
  }
  state.adminOverview = await api("/api/admin/overview");
  renderAdmin();
}

async function toggleUser(user) {
  await api(`/api/admin/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({ active: !user.active, role: user.role }),
  });
  showToast("Notanda uppfært.");
  await refreshAdmin();
}

async function uploadSelectedFile(formId, endpoint, successMessage) {
  if (!state.currentProject) {
    return;
  }
  const form = document.getElementById(formId);
  const formData = new FormData(form);
  const selected = formData.get("file");
  if (!(selected instanceof File) || !selected.name) {
    return;
  }
  const result = await api(`/api/projects/${state.currentProject.id}/${endpoint}`, {
    method: "POST",
    body: formData,
  });
  renderProject(result.project);
  form.reset();
  await refreshProjects();
  showToast(successMessage);
}

function bindEvents() {
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    state.user = result.user;
    renderNav();
    await refreshProjects();
    setView("dashboard");
    showToast("Skráning tókst.");
  });

  document.getElementById("registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    state.user = result.user;
    renderNav();
    await refreshProjects();
    setView("dashboard");
    showToast("Aðgangur stofnaður.");
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    state.user = null;
    state.projects = [];
    state.currentProject = null;
    renderNav();
    setView("auth");
  });

  nav.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) {
      return;
    }
    const nextView = button.dataset.view;
    if (nextView === "dashboard") await refreshProjects();
    if (nextView === "admin") await refreshAdmin();
    setView(nextView);
  });

  document.getElementById("projectCreateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    event.currentTarget.reset();
    state.projects = [
      {
        id: result.project.id,
        name: result.project.name,
        status: result.project.status,
        updatedAt: result.project.updatedAt,
        ownerId: result.project.ownerId,
        address: result.project.propertyInfo?.address || "",
      },
      ...state.projects,
    ];
    renderProjects();
    await refreshProjects();
    showToast("Mál stofnað.");
  });

  document.getElementById("refreshProjectsBtn").addEventListener("click", refreshProjects);
  document.getElementById("refreshAdminBtn").addEventListener("click", refreshAdmin);

  document.getElementById("projectMetaForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.currentProject) return;
    const form = event.currentTarget;
    const payload = {
      name: field(form, "name").value,
      status: field(form, "status").value,
      propertyInfo: {
        address: field(form, "address").value,
        municipality: field(form, "municipality").value,
      },
    };
    const result = await api(`/api/projects/${state.currentProject.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    renderProject(result.project);
    await refreshProjects();
    showToast("Mál vistað.");
  });

  document.getElementById("coverForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.currentProject) return;
    const form = event.currentTarget;
    const cover = {
      title: field(form, "title").value,
      propertyName: field(form, "propertyName").value,
      matshluti: field(form, "matshluti").value,
      landeignNumber: field(form, "landeignNumber").value,
      fasteignNumber: field(form, "fasteignNumber").value,
      preparedByName: field(form, "preparedByName").value,
      preparedByCompany: field(form, "preparedByCompany").value,
      preparedByTitle: field(form, "preparedByTitle").value,
      preparedByLicenseNumber: field(form, "preparedByLicenseNumber").value,
      preparedByKennitala: field(form, "preparedByKennitala").value,
      preparedByEmail: field(form, "preparedByEmail").value,
      preparedByPhone: field(form, "preparedByPhone").value,
      heatingElectricityText: field(form, "heatingElectricityText").value,
      easementsText: field(form, "easementsText").value,
      footerNote: field(form, "footerNote").value,
    };
    const result = await api(`/api/projects/${state.currentProject.id}`, {
      method: "PUT",
      body: JSON.stringify({ cover }),
    });
    renderProject(result.project);
    showToast("Forsíðuupplýsingar vistaðar.");
  });

  for (const id of ["excelUploadForm", "pdfUploadForm", "logoUploadForm", "coverImageUploadForm"]) {
    document.getElementById(id).addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  document.getElementById("excelFileInput").addEventListener("change", async () => {
    await uploadSelectedFile("excelUploadForm", "upload/excel", "Excel skrá lesin inn.");
  });

  document.getElementById("pdfFileInput").addEventListener("change", async () => {
    await uploadSelectedFile("pdfUploadForm", "upload/pdf", "PDF skjal vistað.");
  });

  document.getElementById("logoFileInput").addEventListener("change", async () => {
    await uploadSelectedFile("logoUploadForm", "upload/logo", "Lógó vistað.");
  });

  document.getElementById("coverImageFileInput").addEventListener("change", async () => {
    await uploadSelectedFile("coverImageUploadForm", "upload/cover-image", "Forsíðumynd vistuð.");
  });

  document.getElementById("generateDocumentBtn").addEventListener("click", async () => {
    if (!state.currentProject) return;
    const result = await api(`/api/projects/${state.currentProject.id}/generate-document`, {
      method: "POST",
      body: "{}",
    });
    renderProject(result.project);
    await refreshProjects();
    showToast("Drög mynduð.");
  });

  document.getElementById("generateAiBtn").addEventListener("click", async () => {
    if (!state.currentProject) return;
    const notes = document.getElementById("aiNotes").value.trim();
    const result = await api(`/api/projects/${state.currentProject.id}/generate-ai-document`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
    state.ai = result.ai || state.ai;
    renderProject(result.project);
    await refreshProjects();
    showToast("AI bætti við textadrög.");
  });

  document.getElementById("saveDocumentBtn").addEventListener("click", async () => {
    if (!state.currentProject) return;
    const text = document.getElementById("documentEditor").value.trim();
    const sections = text
      ? text.split(/\n\n+/).map((block, index) => {
          const [heading, ...rest] = block.split("\n");
          return { heading: heading || `Kafli ${index + 1}`, body: rest.join("\n") };
        })
      : [];
    const result = await api(`/api/projects/${state.currentProject.id}`, {
      method: "PUT",
      body: JSON.stringify({
        documentDraft: {
          title: state.currentProject.documentDraft?.title || state.currentProject.name,
          sections,
        },
      }),
    });
    renderProject(result.project);
    showToast("Texti vistaður.");
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

bootstrap().catch((error) => {
  console.error(error);
  showToast(error.message);
});

repairDomText();
