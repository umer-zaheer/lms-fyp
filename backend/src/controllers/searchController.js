import asyncHandler from "express-async-handler";
import Course from "../models/Course.js";
import { embedText, cosineSimilarity } from "../utils/openrouter.js";
import {
  getActiveSponsoredRows,
  mergeSponsoredFirst,
} from "../utils/sponsor.js";

/** Hybrid search: Mongo text + RAG cosine on embeddings */
export const searchCourses = asyncHandler(async (req, res) => {
  const q = (req.query.q || req.body?.q || "").trim();
  const limit = Number(req.query.limit || req.body?.limit || 12);

  if (!q) {
    const raw = await Course.find({ status: "published" })
      .populate("instructor", "name avatar")
      .populate("category", "name slug")
      .sort({ studentsCount: -1 })
      .limit(limit);
    const sponsored = await getActiveSponsoredRows(limit);
    const data = mergeSponsoredFirst(raw, sponsored, limit);
    return res.json({ success: true, data, mode: "browse" });
  }

  let textHits = [];
  try {
    textHits = await Course.find(
      { status: "published", $text: { $search: q } },
      { score: { $meta: "textScore" } }
    )
      .populate("instructor", "name avatar")
      .populate("category", "name slug")
      .sort({ score: { $meta: "textScore" } })
      .limit(limit);
  } catch {
    textHits = await Course.find({
      status: "published",
      $or: [
        { title: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
        { tags: new RegExp(q, "i") },
      ],
    })
      .populate("instructor", "name avatar")
      .populate("category", "name slug")
      .limit(limit);
  }

  const withSponsored = async (hits, mode) => {
    const sponsored = await getActiveSponsoredRows(Math.min(6, limit));
    const data = mergeSponsoredFirst(hits, sponsored, limit);
    return res.json({ success: true, data, mode });
  };

  if (!process.env.OPENROUTER_API_KEY) {
    return withSponsored(textHits, "text");
  }

  try {
    const queryEmbedding = await embedText(q);
    const withEmbeddings = await Course.find({
      status: "published",
      embedding: { $exists: true, $ne: [] },
    })
      .select("+embedding")
      .populate("instructor", "name avatar")
      .populate("category", "name slug")
      .limit(80);

    const ranked = withEmbeddings
      .map((c) => ({
        course: c,
        sim: cosineSimilarity(queryEmbedding, c.embedding),
      }))
      .filter((x) => x.sim > 0.25)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit)
      .map((x) => {
        const obj = x.course.toObject();
        delete obj.embedding;
        obj.similarity = x.sim;
        return obj;
      });

    // Merge RAG + text, prefer RAG order then fill gaps
    const seen = new Set(ranked.map((c) => String(c._id)));
    for (const hit of textHits) {
      if (!seen.has(String(hit._id))) {
        ranked.push(hit);
        seen.add(String(hit._id));
      }
      if (ranked.length >= limit) break;
    }

    return withSponsored(ranked.slice(0, limit), "rag");
  } catch (e) {
    console.warn("RAG fallback to text:", e.message);
    return withSponsored(textHits, "text_fallback");
  }
});
