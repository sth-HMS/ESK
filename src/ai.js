const fs = require("node:fs");
const path = require("node:path");

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_SKILLS = ["legal-writer", "esk-structure"];

function getAiConfig() {
  return {
    enabled: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || "low",
    skills: DEFAULT_SKILLS,
  };
}

function loadSkill(skillName) {
  const skillPath = path.join(__dirname, "..", "skills", `${skillName}.md`);
  if (!fs.existsSync(skillPath)) {
    return `Skill vantar: ${skillName}`;
  }
  return fs.readFileSync(skillPath, "utf8");
}

function summariseWorkbook(project) {
  if (!project.parsedWorkbook?.sheets?.length) {
    return "Engin Excel gögn hafa verið lesin inn enn.";
  }
  return project.parsedWorkbook.sheets
    .map((sheet) => {
      const preview = (sheet.preview || [])
        .slice(0, 5)
        .map((row) => `${row.rowNumber}: ${row.cells.map((cell) => `${cell.column}=${cell.value || ""}`).join(", ")}`)
        .join(" | ");
      return `${sheet.name} (${sheet.rowCount} raðir) -> ${preview}`;
    })
    .join("\n");
}

function summariseAnnotations(project) {
  if (!project.annotations?.length) {
    return "Engar teiknimerkingar skráðar enn.";
  }
  return project.annotations
    .map((annotation) => {
      return `${annotation.label} | flokkur=${annotation.category} | bls=${annotation.page} | eining=${annotation.unit || "óskráð"} | ath=${annotation.notes || ""}`;
    })
    .join("\n");
}

function buildMessages(project, userNotes = "") {
  const config = getAiConfig();
  const skills = config.skills.map((skill) => `# Skill: ${skill}\n${loadSkill(skill)}`).join("\n\n");
  const system = [
    "Þú ert íslenskur sérfræðiaðstoðarmaður sem skrifar drög að eignaskiptayfirlýsingu/eignaskiptasamningi.",
    "Notaðu skýrt, formlegt og rekjanlegt íslenskt mál.",
    "Gerðu skýrt grein fyrir því hvar gögn vantar eða þarfnast handvirkrar staðfestingar.",
    "Ekki skálda staðreyndir sem ekki eru studdar af innlesnum gögnum.",
    "Settu athugasemdamerkingar eins og [YFIRFARA] þar sem mannleg staðfesting er nauðsynleg.",
    "",
    skills,
  ].join("\n");

  const user = [
    `Málsheiti: ${project.name}`,
    `Heimilisfang: ${project.propertyInfo?.address || "óskráð"}`,
    `Sveitarfélag: ${project.propertyInfo?.municipality || "óskráð"}`,
    "",
    "Excel samantekt:",
    summariseWorkbook(project),
    "",
    "Teiknimerkingar:",
    summariseAnnotations(project),
    "",
    "PDF viðaukar:",
    (project.pdfUploads || []).length
      ? project.pdfUploads.map((pdf, index) => `${index + 1}. ${pdf.filename}`).join("\n")
      : "Engin PDF fylgiskjöl skráð.",
    "",
    "Verkbeiðni:",
    "Bættu eða betrumbættu vinnudrög að eignaskiptaskjali út frá innlesnum gögnum. Hafðu textann hnitmiðaðan, formlegan og nothæfan sem vinnuskjal fyrir sérfræðing.",
    userNotes ? `Viðbótarleiðbeiningar frá notanda:\n${userNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system,
    user,
  };
}

function extractTextFromResponse(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function generateProjectDraft(project, userNotes = "") {
  const config = getAiConfig();
  if (!config.enabled) {
    throw new Error("OPENAI_API_KEY vantar. Settu lykil í .env til að virkja AI textagerð.");
  }

  const { system, user } = buildMessages(project, userNotes);
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.model,
      reasoning: { effort: config.reasoningEffort },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: user }],
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const errorMessage = payload?.error?.message || "OpenAI beiðni mistókst.";
    throw new Error(errorMessage);
  }
  const text = extractTextFromResponse(payload);
  if (!text) {
    throw new Error("OpenAI skilaði engu textaefni.");
  }
  return {
    title: `AI drög - ${project.propertyInfo?.address || project.name}`,
    generatedAt: new Date().toISOString(),
    model: config.model,
    skills: config.skills,
    rawText: text,
    sections: text.split(/\n\n+/).map((block, index) => {
      const [heading, ...rest] = block.split("\n");
      return {
        heading: heading || `Kafli ${index + 1}`,
        body: rest.join("\n") || heading,
      };
    }),
  };
}

module.exports = {
  getAiConfig,
  generateProjectDraft,
};
