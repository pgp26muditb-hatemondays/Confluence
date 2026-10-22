// Vercel serverless function: AI lead finder for the Adhik Sales CRM prototype.
// The Gemini API key lives only in Vercel's environment variables, never in the browser.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY   required  Your Google AI Studio API key.
//   GEMINI_MODEL     optional  Defaults to "gemini-3.8-flash".
//   CRM_PASSCODE     optional  If set, the chat asks for this passcode before answering.
//   DEMO_FALLBACK    optional  Set to "off" to show Gemini's real error instead of the demo answer.
//   ALLOWED_ORIGIN   optional  e.g. "https://confluence-snowy-kappa.vercel.app". Blocks calls from other sites.

const SYSTEM = `You are a B2B lead researcher for the catering division of Adhik Group, based at Khalumbre near Chakan, Pune, Maharashtra.
Adhik has run industrial and corporate canteens since 2000, serves over 1,00,000 meals a day and has about 60 business clients.
Ideal customers: manufacturing plants, warehouses, offices, colleges and hospitals in Maharashtra, ideally within about 35 km of Chakan
(Chakan MIDC, Talegaon, Bhosari, Pimpri-Chinchwad, Khed City, Sanaswadi, Ranjangaon, Hinjewadi), with 200 or more people eating on site daily.
Useful buying signals: a new plant, an expansion, a large hiring drive, shift operations, or a contract renewal.

Rules:
- Use Google Search to find real, currently operating organisations. Never invent companies, numbers or contacts.
- If you are not sure about a fact, say so. Give approximate employee counts only when a source supports them.
- Do not provide personal phone numbers or personal emails of individuals. Suggest roles to approach (HR head, admin manager, plant head).
- Answer in short, plain English: two or three sentences of context, then the leads.
- End every answer that names organisations with a fenced JSON block, exactly like:
\`\`\`json
{"leads":[{"name":"Company name","location":"Area, city","sector":"Industrial|Corporate|Institutional","employees":"approx number or empty","why":"one sentence on why it fits","source":"https://..."}]}
\`\`\`
- List at most 8 leads. Exclude Adhik's existing clients if the user names them.`;

// Demo answer used when Gemini is unavailable (quota, billing, outage). Companies are fictional.
const DEMO = {
  text: "Live AI search is unavailable right now, so this is a demo answer with fictional sample companies. It shows the kind of results the lead finder returns.\n```json\n" + JSON.stringify({ leads: [
    { name: "Sample: Kaveri Drivetrain Pvt Ltd", location: "Chakan MIDC Phase II, Pune", sector: "Industrial", employees: "1200", why: "Two-shift auto-component plant that recently added a second assembly line.", source: "" },
    { name: "Sample: Sahyadri Polymers Ltd", location: "Talegaon MIDC, Pune", sector: "Industrial", employees: "650", why: "New moulding unit with round-the-clock shifts and no on-site canteen yet.", source: "" },
    { name: "Sample: Indrayani Logistics Park", location: "Chakan, Pune", sector: "Industrial", employees: "400", why: "Large warehouse campus whose catering contract is due for renewal.", source: "" },
    { name: "Sample: Westline Software Campus", location: "Hinjewadi Phase II, Pune", sector: "Corporate", employees: "2500", why: "Office campus looking for daily buffet lunches with rotating menus.", source: "" },
    { name: "Sample: Deccan Institute of Engineering", location: "Talegaon Dabhade, Pune", sector: "Institutional", employees: "1800", why: "Residential college with hostel mess requirements.", source: "" }
  ] }) + "\n```",
  sources: []
};
const demoFallback = process.env.DEMO_FALLBACK !== "off";

const hits = new Map(); // best-effort, per-instance rate limit
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 20;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  return list.length > max;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.origin || "";
  if (allowed && origin && origin !== allowed) return res.status(403).json({ error: "This endpoint only serves the Adhik website." });

  const pass = process.env.CRM_PASSCODE;
  if (pass && req.headers["x-crm-passcode"] !== pass) return res.status(401).json({ error: "Passcode required." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many questions in a short time. Please wait a few minutes." });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "The Gemini API key is not configured on the server yet." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const messages = Array.isArray(body && body.messages) ? body.messages.slice(-8) : [];
  const contents = messages
    .filter(m => m && typeof m.text === "string" && m.text.trim())
    .map(m => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 2000) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user") return res.status(400).json({ error: "Ask a question first." });

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || `Gemini returned ${r.status}.`;
      console.error("Gemini error", r.status, msg);
      if (demoFallback) return res.status(200).json({ ...DEMO, demo: true, reason: r.status === 429 ? "quota" : "unavailable" });
      return res.status(502).json({ error: `Gemini could not answer: ${msg}` });
    }
    const cand = (data.candidates || [])[0] || {};
    const text = ((cand.content && cand.content.parts) || []).map(p => p.text || "").join("").trim();
    const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    const seen = new Set();
    const sources = chunks.map(c => c.web).filter(w => w && w.uri && !seen.has(w.uri) && seen.add(w.uri)).map(w => ({ uri: w.uri, title: w.title || w.uri }));
    return res.status(200).json({ text: text || "I could not find anything useful. Try a more specific question.", sources });
  } catch (e) {
    console.error("Gemini unreachable", e && e.message);
    if (demoFallback) return res.status(200).json({ ...DEMO, demo: true, reason: "unavailable" });
    return res.status(502).json({ error: "Could not reach Gemini. Please try again." });
  }
};
