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
  const paras = [];
  const re = /class="text_editor_paragraph[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const t = stripHtml(m[1]);
    if (t.length > 20) paras.push(t);
  }
  const sub = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  return [sub ? decode(sub) : "", ...paras].filter(Boolean).join("\n").slice(0, 9000);
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

const INSTRUCTIONS = `אתה עורך חדשות שכותב לאנשים מבוגרים בעברית פשוטה וברורה.
קבל כתבה חדשותית וכתוב גרסה פשוטה שלה.
כללים:
- מילים יומיומיות ומשפטים קצרים.
- הסבר כל מושג קשה בסוגריים בתוך הטקסט, או במילון (glossary).
- אל תוסיף שום עובדה שלא מופיעה במקור. שמור על המשמעות המקורית ועל טון ניטרלי ורגוע.
- בלי סלנג ובלי ראשי תיבות. אם יש ראשי תיבות, כתוב אותם במלואם (למשל: צה"ל = צבא ההגנה לישראל).
- מספרים פשוטים (למשל "כמיליון" במקום "1,023,512").
- simple_title: כותרת קצרה, רגועה, בלי סנסציה.
- summary: משפט אחד או שניים קצרים מאוד.
- chunks: בין 3 ל-6 פסקאות קצרות, כל אחת 1 עד 3 משפטים קצרים. heading: כותרת קטנה של 2-4 מילים, או מחרוזת ריקה.
- glossary: מילים או מושגים קשים מהכתבה עם הסבר פשוט (0 עד 5 פריטים).
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

async function simplify(title, text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ text: `כותרת: ${title}\n\nטקסט הכתבה:\n${text}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.3 },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const out = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const s = JSON.parse(out);
    if (!s.simple_title || !Array.isArray(s.chunks) || s.chunks.length === 0) throw new Error("bad AI output");
    return s;
  }
  throw new Error("gemini: rate limited");
}

async function main() {
  if (!KEY) throw new Error("GEMINI_API_KEY is not set");
  let existing = [];
  try {
    existing = JSON.parse(await readFile(OUT, "utf8")).articles ?? [];
  } catch {}
  const seen = new Set(existing.map((a) => a.source_url));

  const items = (await fetchFeeds()).filter((i) => !seen.has(i.url)).slice(0, MAX_NEW_PER_RUN);
  console.log(`new items to process: ${items.length}`);

  const added = [];
  for (const it of items) {
    try {
      let text = await get(it.url).then(extractArticleText).catch(() => "");
      if (text.length < 80) text = it.description;
      if (text.length < 40) continue;
      const s = await simplify(it.title, text);
      added.push({
        id: idFor(it.url),
        source_url: it.url,
        published_at: it.published_at,
        category: CATEGORIES.includes(s.category) ? s.category : it.hint,
        simple_title: s.simple_title,
        summary: s.summary,
        chunks: s.chunks.slice(0, 6),
        glossary: (s.glossary ?? []).slice(0, 5),
      });
      console.log("ok:", s.simple_title);
      await new Promise((r) => setTimeout(r, 4000)); // stay under free-tier rate limits
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
