const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function getDataDir() {
  return process.env.DATA_DIR || path.join(__dirname, "..", "data");
}

function getUploadsDir() {
  return path.join(getDataDir(), "uploads");
}

function getUsersFile() {
  return path.join(getDataDir(), "users.json");
}

function getSessionsFile() {
  return path.join(getDataDir(), "sessions.json");
}

function getProjectsFile() {
  return path.join(getDataDir(), "projects.json");
}

function ensureDataFiles() {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.mkdirSync(getUploadsDir(), { recursive: true });
  for (const file of [getUsersFile(), getSessionsFile(), getProjectsFile()]) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "[]\n", "utf8");
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listUsers() {
  return readJson(getUsersFile());
}

function createUser(input) {
  const users = listUsers();
  const user = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };
  users.push(user);
  writeJson(getUsersFile(), users);
  return user;
}

function findUserByEmail(email) {
  return listUsers().find((user) => user.email.toLowerCase() === String(email).toLowerCase()) || null;
}

function findUserById(userId) {
  return listUsers().find((user) => user.id === userId) || null;
}

function updateUser(userId, changes) {
  const users = listUsers();
  const index = users.findIndex((user) => user.id === userId);
  if (index === -1) {
    return null;
  }
  users[index] = { ...users[index], ...changes };
  writeJson(getUsersFile(), users);
  return users[index];
}

function listSessions() {
  return readJson(getSessionsFile());
}

function createSession(userId) {
  const sessions = listSessions();
  const session = {
    id: crypto.randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  sessions.push(session);
  writeJson(getSessionsFile(), sessions);
  return session;
}

function getSession(id) {
  return listSessions().find((session) => session.id === id) || null;
}

function deleteSession(id) {
  writeJson(getSessionsFile(), listSessions().filter((session) => session.id !== id));
}

function touchSession(id) {
  const sessions = listSessions();
  const index = sessions.findIndex((session) => session.id === id);
  if (index !== -1) {
    sessions[index].lastSeenAt = new Date().toISOString();
    writeJson(getSessionsFile(), sessions);
  }
}

function listProjects() {
  return readJson(getProjectsFile());
}

function listProjectsForUser(user) {
  const projects = listProjects();
  return user.role === "admin" ? projects : projects.filter((project) => project.ownerId === user.id);
}

function createProject(input) {
  const projects = listProjects();
  const project = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    excelUpload: "",
    parsedWorkbook: null,
    pdfUploads: [],
    annotations: [],
    documentDraft: null,
    activity: [],
    cover: {
      title: "EIGNASKIPTAYFIRLÝSING",
      propertyName: "",
      matshluti: "",
      landeignNumber: "",
      fasteignNumber: "",
      preparedByName: "",
      preparedByCompany: "",
      preparedByTitle: "",
      preparedByEmail: "",
      preparedByPhone: "",
      preparedByLicenseNumber: "",
      preparedByKennitala: "",
      coverImagePath: "",
      logoImagePath: "",
      footerNote: "",
    },
    ...input,
  };
  projects.push(project);
  writeJson(getProjectsFile(), projects);
  fs.mkdirSync(path.join(getUploadsDir(), project.id), { recursive: true });
  return project;
}

function getProjectById(id) {
  return listProjects().find((project) => project.id === id) || null;
}

function deleteProject(id) {
  const projects = listProjects();
  const project = projects.find((item) => item.id === id) || null;
  if (!project) {
    return null;
  }
  const next = projects.filter((item) => item.id !== id);
  writeJson(getProjectsFile(), next);
  return project;
}

function updateProject(id, changes) {
  const projects = listProjects();
  const index = projects.findIndex((project) => project.id === id);
  if (index === -1) {
    return null;
  }
  projects[index] = {
    ...projects[index],
    ...changes,
    updatedAt: new Date().toISOString(),
  };
  writeJson(getProjectsFile(), projects);
  return projects[index];
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function storeProjectFile(projectId, filename, content) {
  const safeName = `${Date.now()}_${sanitizeFilename(filename)}`;
  const absolutePath = path.join(getUploadsDir(), projectId, safeName);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return {
    absolutePath,
    publicPath: `/uploads/${projectId}/${safeName}`,
    filename: safeName,
  };
}

function getAdminOverview() {
  const users = listUsers();
  const projects = listProjects();
  return {
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
    })),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      ownerId: project.ownerId,
      updatedAt: project.updatedAt,
    })),
  };
}

module.exports = {
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
};
