#!/usr/bin/env node
// Site monitor for the five family sites + the TM CRM intake (dry run only).
// No secrets. Exit code 1 on any failure, so a scheduled GitHub Actions run fails and GitHub emails the owner.
// Usage: node scripts/monitor.mjs        (Node 18+)
import tls from "node:tls";

const UA = "temerarii-site-monitor/1.0 (+github actions)";
const TIMEOUT_MS = 15000;
const MAX_HOME_MS = 5000;
const MIN_CERT_DAYS = 14;

// h1: substring expected in the first <h1>, compared with all whitespace removed (animated headings split letters into spans).
const SITES = [
  { url: "https://www.temerarii.com", h1: "Omni-ChannelDigitalMarketing", inner: ["/case-studies", "/academy", "/careers"] },
  { url: "https://temerarii.xyz", h1: "TheopenmachineforAI", inner: ["/workflows", "/skills", "/about"] },
  { url: "https://domdavis.network", h1: "DomDavis", inner: ["/about", "/work-with-dom", "/receipts"] },
  { url: "https://www.cominc.org", h1: "digitalpathwaysforunderservedtalent", inner: ["/academy", "/about", "/funders"] },
  { url: "https://learn.cominc.org", h1: "buildjudgment", inner: ["/live", "/privacy", "/courses/after-school-facilitator-kit"] },
];

const INTAKE_URL = "https://temerarii-office-app.vercel.app/api/intake";
// Valid lead payload, but dry: true -> the endpoint validates and routes, writes nothing, mints nothing.
const INTAKE_PROBE = {
  form: "lead",
  dry: true,
  answers: { first_name: "Monitor", email: "monitor@example.com", consent: true },
  hidden: { source_site: "temerarii.com", source_form: "contact", source_page: "/__monitor" },
  website_url: "",
};

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); };

async function get(url, opts = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
  const body = await res.text();
  return { status: res.status, body, ms: Date.now() - t0 };
}

const norm = (s) => s
  .replace(/&amp;/g, "&").replace(/&#x27;|&#39;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/gi, "")
  .replace(/\s+/g, "").toLowerCase();

function certDays(host) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: TIMEOUT_MS }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      if (!cert || !cert.valid_to) return reject(new Error("no certificate"));
      resolve((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
    });
    sock.on("timeout", () => { sock.destroy(); reject(new Error("timeout")); });
    sock.on("error", reject);
  });
}

async function check(name, fn) {
  try { await fn(); } catch (e) { record(name, false, e?.message ?? String(e)); }
}

async function checkSite(site) {
  const host = new URL(site.url).host;
  await check(`${host} home`, async () => {
    const r = await get(site.url + "/");
    const h1m = r.body.match(/<h1[\s\S]*?<\/h1>/i);
    const h1 = h1m ? norm(h1m[0].replace(/<[^>]+>/g, "")) : "";
    const problems = [];
    if (r.status !== 200) problems.push(`status ${r.status}`);
    if (!h1.includes(site.h1.toLowerCase())) problems.push(`H1 missing "${site.h1}"`);
    if (r.ms > MAX_HOME_MS) problems.push(`slow ${r.ms}ms`);
    record(`${host} home`, problems.length === 0, problems.join(", ") || `200, H1 ok, ${r.ms}ms`);
  });
  for (const p of [...site.inner, "/favicon.ico", "/sitemap.xml"]) {
    await check(`${host}${p}`, async () => {
      const r = await get(site.url + p);
      const ok = r.status === 200 && r.ms <= MAX_HOME_MS && (p !== "/sitemap.xml" || r.body.includes("<urlset") || r.body.includes("<sitemapindex"));
      record(`${host}${p}`, ok, `${r.status}, ${r.ms}ms`);
    });
  }
  await check(`${host} tls`, async () => {
    const d = await certDays(host);
    record(`${host} tls`, d > MIN_CERT_DAYS, `${Math.floor(d)} days left`);
  });
}

async function checkIntake() {
  await check("crm intake (dry run)", async () => {
    const r = await get(INTAKE_URL, { method: "POST", headers: { "content-type": "application/json", "user-agent": UA }, body: JSON.stringify(INTAKE_PROBE) });
    let j = {};
    try { j = JSON.parse(r.body); } catch { /* not json */ }
    const ok = r.status >= 200 && r.status < 300 && j.ok === true && j.dry === true;
    record("crm intake (dry run)", ok, `${r.status}${j.dry === true ? ", dry ack" : ", no dry ack"}`);
  });
}

await Promise.all([...SITES.map(checkSite), checkIntake()]);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Site monitor\n\n${results.length - failed.length}/${results.length} passed\n\n| | check | detail |\n|---|---|---|\n` +
    results.map((r) => `| ${r.ok ? "PASS" : "FAIL"} | ${r.name} | ${r.detail ?? ""} |`).join("\n") + "\n");
}
process.exit(failed.length ? 1 : 0);
