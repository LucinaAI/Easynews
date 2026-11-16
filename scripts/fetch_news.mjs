// Fetches ynet RSS, simplifies new stories into easy Hebrew with Gemini, writes data/articles.json.
// Run: GEMINI_API_KEY=... node scripts/fetch_news.mjs
// Node 20+, no dependencies.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const OUT = new URL("../data/articles.json", import.meta.url);
const UA = "Mozilla/5.0 (compatible; EasyNewsBot/1.0)";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const KEY = process.env.GEMINI_API_KEY;
const MAX_NEW_PER_RUN = Number(process.env.MAX_NEW_PER_RUN || 10);
const KEEP = 60;
const MAX_AGE_DAYS = 4;

const FEEDS = [
  { id: 2, hint: "main" },
  { id: 1854, hint: "main" },
  { id: 6, hint: "economy" },
  { id: 1208, hint: "health" },
  { id: 2142, hint: "science" },
];
const CATEGORIES = ["security", "economy", "health", "world", "science", "other"];

export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}
export function stripHtml(s) {
  return decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
}

export function parseFeed(xml, hint) {
  const items = [];
  for (const block of xml.split("<item>").slice(1)) {
    const url = tag(block, "link").split("?")[0];
    const title = tag(block, "title");
    if (!url.startsWith("https://www.ynet.co.il/") || !title) continue;
    const d = new Date(tag(block, "pubDate"));
    items.push({
      url,
      title,
      hint,
      published_at: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
      description: stripHtml(tag(block, "description")),
    });
  }
  return items;
}

export function extractArticleText(html) {
  const candidates = [];
  // 1) structured data
  const ld = html.match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (ld) {
    try {
      candidates.push(stripHtml(JSON.parse('"' + ld[1] + '"')));
    } catch {}
  }
  // 2) paragraph blocks
  const paras = [];
  const re = /class="text_editor_paragraph[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const t = stripHtml(m[1]);
    if (t.length > 20) paras.push(t);
  }
  if (paras.length) candidates.push(paras.join("\n"));
  // 3) plain <p> tags as a last resort
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((x) => stripHtml(x[1])).filter((t) => t.length > 40);
  if (ps.length) candidates.push(ps.join("\n"));
  const sub = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const body = candidates.sort((x, y) => y.length - x.length)[0] ?? "";
  return [sub ? decode(sub) : "", body].filter(Boolean).join("\n").slice(0, 12000);
}

const idFor = (url) => createHash("sha1").update(url).digest("hex").slice(0, 12);

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function fetchFeeds() {
  const map = new Map();
  for (const f of FEEDS) {
    try {
      const xml = await get(`https://www.ynet.co.il/Integration/StoryRss${f.id}.xml`);
      for (const it of parseFeed(xml, f.hint)) if (!map.has(it.url)) map.set(it.url, it);
    } catch (e) {
      console.error("feed failed", f.id, String(e));
    }
  }
  return [...map.values()].sort((a, b) => b.published_at.localeCompare(a.published_at));
}

const INSTRUCTIONS = `אתה עורך חדשות שמסביר חדשות לאנשים מבוגרים בעברית פשוטה, ברורה ומכבדת.
קבל כתבה וכתוב אותה מחדש בצורה פשוטה, כך שהיא תכסה את כל הכתבה המקורית: כל העובדות החשובות, השמות, המספרים והדברים העיקריים שנאמרו, לפי סדר הכתבה. אל תקצר את הכתבה לתקציר. הקורא צריך להבין את הסיפור המלא בלי לפתוח את הכתבה המקורית.
כללים:
- משפטים קצרים, בערך 8 עד 14 מילים. רעיון אחד בכל משפט.
- מילים יומיומיות. כל מושג קשה מוסבר מיד בסוגריים, בפעם הראשונה שהוא מופיע.
- אסור להוסיף עובדות שלא כתובות בכתבה, ואסור לנחש. אם משהו לא ברור, השמט אותו.
- טון ניטרלי ורגוע, בלי סנסציה ובלי דעה אישית.
- אסור להשתמש בראשי תיבות ובקיצורים. כתוב הכול במלואו: מנהל כללי (במקום קיצור), צבא ההגנה לישראל, שירות הביטחון הכללי, ראש הממשלה, ועדת החוץ והביטחון, וכן הלאה.
- אסור להשתמש בתו מרכאות כפולות בשום מקום בטקסט. כתוב מה שנאמר בלי מרכאות, בניסוח עקיף (למשל: השר אמר שהוא יפעל מיד).
- כתוב רק בעברית ובאותיות עבריות. שמות זרים אפשר לכתוב בעברית. מספרים בספרות.
- מספרים פשוטים (למשל: כמיליון במקום מספר ארוך).
- כל פסקה חייבת להיות שלמה ולהסתיים בנקודה.
שדות:
- simple_title: כותרת קצרה ורגועה, עד 10 מילים.
- summary: שני משפטים קצרים שמסכמים מה קרה.
- chunks: בין 4 ל-10 פסקאות, לפי אורך הכתבה. כל פסקה 2 עד 4 משפטים קצרים. heading: כותרת קטנה של 2 עד 4 מילים.
- glossary: עד 5 מושגים קשים שמופיעים בכתבה, עם הסבר פשוט. רק מושגים שמופיעים בכתבה עצמה.
- category: security (ביטחון, צבא, מלחמה, טרור), economy (כלכלה, כסף, מחירים), health (בריאות), world (חדשות מחו"ל), science (מדע וטכנולוגיה), אחרת other.`;

const SCHEMA = {
  type: "OBJECT",
  required: ["simple_title", "summary", "category", "chunks", "glossary"],
  properties: {
    simple_title: { type: "STRING" },
    summary: { type: "STRING" },
    category: { type: "STRING", enum: CATEGORIES },
    chunks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["heading", "text"],
        properties: { heading: { type: "STRING" }, text: { type: "STRING" } },
      },
    },
    glossary: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["term", "plain_explanation"],
        properties: { term: { type: "STRING" }, plain_explanation: { type: "STRING" } },
      },
    },
  },
};

function problems(s, sourceLen) {
  const strs = [s.simple_title, s.summary, ...s.chunks.flatMap((c) => [c.heading, c.text]), ...(s.glossary ?? []).flatMap((g) => [g.term, g.plain_explanation])];
  if (!s.simple_title || !s.summary) return "missing title or summary";
  if (strs.some((t) => /[\u0600-\u06FF]/.test(t ?? ""))) return "contains non-Hebrew letters";
  if (strs.some((t) => /["\u05F4]/.test(t ?? ""))) return "contains double quotation marks";
  if (!Array.isArray(s.chunks) || s.chunks.length < (sourceLen > 1200 ? 4 : 2)) return "too few paragraphs";
  for (const c of s.chunks) {
    const t = (c.text ?? "").trim().replace(/[)\s]+$/, "");
    if (!/[.?!:]$/.test(t)) return "a paragraph is cut off: " + t.slice(-30);
  }
  const words = s.chunks.reduce((n, c) => n + (c.text ?? "").split(/\s+/).length, 0);
  if (sourceLen > 1500 && words < 120) return "too short";
  return null;
}

async function callGemini(userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.3, maxOutputTokens: 8192 },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }
  throw new Error("gemini: rate limited");
}

export async function simplify(title, text) {
  let hint = "";
  let last = "no output";
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await callGemini(`כותרת: ${title}\n\nטקסט הכתבה:\n${text}${hint}`);
    try {
      const s = JSON.parse(out);
      const p = problems(s, text.length);
      if (!p) return s;
      last = p;
    } catch {
      last = "invalid JSON";
    }
    hint = `\n\nהניסיון הקודם נפסל כי: ${last}. תקן זאת: כתוב פסקאות שלמות שמסתיימות בנקודה, בלי מרכאות כפולות, בלי ראשי תיבות, בעברית בלבד.`;
  }
  throw new Error("quality check failed: " + last);
}

async function main() {
  if (!KEY) throw new Error("GEMINI_API_KEY is not set");
  let existing = [];
  try {
    existing = (JSON.parse(await readFile(OUT, "utf8")).articles ?? []).filter((a) => a.v === 2); // older versions are re-processed
  } catch {}
  const seen = new Set(existing.map((a) => a.source_url));

  const items = (await fetchFeeds()).filter((i) => !seen.has(i.url)).slice(0, MAX_NEW_PER_RUN);
  console.log(`new items to process: ${items.length}`);

  const added = [];
  for (const it of items) {
    try {
      let text = await get(it.url).then(extractArticleText).catch(() => "");
      if (text.length < 80) text = it.description;
      console.log(`text length ${text.length}:`, it.url);
      if (text.length < 40) continue;
      const s = await simplify(it.title, text);
      added.push({
        v: 2,
        id: idFor(it.url),
        source_url: it.url,
        published_at: it.published_at,
        category: CATEGORIES.includes(s.category) ? s.category : it.hint,
        simple_title: s.simple_title,
        summary: s.summary,
        chunks: s.chunks.slice(0, 10),
        glossary: (s.glossary ?? []).slice(0, 5),
      });
      console.log("ok:", s.simple_title);
      await new Promise((r) => setTimeout(r, 5000)); // stay under free-tier rate limits
    } catch (e) {
      console.error("failed:", it.url, String(e));
    }
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const all = [...added, ...existing]
    .filter((a) => new Date(a.published_at).getTime() >= cutoff)
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, KEEP);
  await writeFile(OUT, JSON.stringify({ updated_at: new Date().toISOString(), articles: all }, null, 1) + "\n");
  console.log(`saved ${all.length} articles (${added.length} new)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
