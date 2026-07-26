import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import JSZip from "jszip";

const MAX_CHARS = Number(process.env.DOC_EXTRACT_MAX_CHARS) || 50000;

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    return normalizeText(textResult?.text || "");
  } finally {
    if (typeof parser.destroy === "function") {
      await parser.destroy().catch(() => {});
    }
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result?.value || "");
}

/** PPTX is a zip of XML slides — pull text from a:t nodes */
async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] || 0);
      return na - nb;
    });

  const parts = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
    const slideText = matches
      .map((m) => m.replace(/<[^>]+>/g, ""))
      .join(" ")
      .trim();
    if (slideText) parts.push(slideText);
  }
  return normalizeText(parts.join("\n\n"));
}

/**
 * Extract readable text from pdf / docx / pptx buffers.
 * Old binary .ppt is not supported — ask for .pptx.
 */
export async function extractDocumentText(buffer, { originalname = "", mimetype = "" } = {}) {
  const name = String(originalname).toLowerCase();
  const mime = String(mimetype).toLowerCase();

  if (name.endsWith(".pdf") || mime === "application/pdf") {
    return { text: await extractPdf(buffer), fileType: "pdf" };
  }
  if (
    name.endsWith(".docx") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return { text: await extractDocx(buffer), fileType: "docx" };
  }
  if (
    name.endsWith(".pptx") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return { text: await extractPptx(buffer), fileType: "pptx" };
  }
  if (name.endsWith(".ppt") || mime === "application/vnd.ms-powerpoint") {
    const err = new Error("Please upload .pptx (not legacy .ppt)");
    err.statusCode = 400;
    throw err;
  }
  if (name.endsWith(".doc") || mime === "application/msword") {
    const err = new Error("Please upload .docx (not legacy .doc)");
    err.statusCode = 400;
    throw err;
  }

  const err = new Error("Unsupported document type. Use PDF, DOCX, or PPTX.");
  err.statusCode = 400;
  throw err;
}

export function detectFileType(originalname = "", mimetype = "") {
  const name = String(originalname).toLowerCase();
  if (name.endsWith(".pdf") || mimetype === "application/pdf") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".ppt")) return "ppt";
  if (name.endsWith(".doc")) return "doc";
  return "file";
}
