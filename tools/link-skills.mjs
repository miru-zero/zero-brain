// v5: hub ใช้ชื่อ stub แบบ deterministic เดียวกับ v3 (daimon ก่อน แล้ว plugin ตามตัวอักษร, first-wins)
// + ล้างส่วน "แผนที่ย่อย" ที่ใส่ผิดใน Zero.md → เหลือแค่ Today/Template Index
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { homedir } from 'node:os';

// portable: zone/daimon derive จาก homedir (override ด้วย ZERO_HOME / ZERO_BRAIN_ROOT / DAIMON_ROOT)
// HACK_SRC = argv[2] หรือ HACK_SKILLS_SRC (บังคับ — ที่เก็บ hack-skills ของแต่ละเครื่องไม่เหมือนกัน)
const ZERO = process.env.ZERO_HOME ?? path.join(homedir(), '.zero');
const BRAIN = process.env.ZERO_BRAIN_ROOT ?? path.join(ZERO, 'brain');
const DAIMON = process.env.DAIMON_ROOT ?? path.join(ZERO, 'share', 'daimon-share', 'daimon');
const DAIMON_SKILLS = path.join(DAIMON, 'skills');
const PLUGINS = path.join(DAIMON, 'runtime', 'kimi-code', 'home', 'plugins', 'managed');
const HACK_SRC = process.argv[2] ?? process.env.HACK_SKILLS_SRC;
if (!HACK_SRC || !fs.existsSync(HACK_SRC)) {
  console.error('usage: node tools/link-skills.mjs <hack-skills-src>  (หรือตั้ง HACK_SKILLS_SRC)');
  process.exit(1);
}
const ATLAS = path.join(BRAIN, '20_Atlas');
const STUBS_DIR = path.join(ATLAS, 'Skills');
const now = new Date().toISOString();
const today = now.slice(0, 10);
const shaFile = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function readDesc(p) {
  try {
    const t = fs.readFileSync(p, 'utf8');
    const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return '';
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const dm = lines[i].match(/^description:\s*(.*)$/);
      if (!dm) continue;
      let v = dm[1].trim();
      if (['>-', '>', '|', '|-', ''].includes(v)) {
        const buf = [];
        for (let j = i + 1; j < lines.length; j++) { if (/^\S/.test(lines[j])) break; buf.push(lines[j].trim()); }
        v = buf.join(' ');
      }
      return v.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    }
    return '';
  } catch { return ''; }
}

// --- รวบรวม + ตั้งชื่อ stub แบบ v3 เป๊ะ (ลำดับเดียวกัน) ---
const hackNames = new Set(fs.readdirSync(HACK_SRC, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name));
const groups = { 'SKILL：Hack': [], 'SKILL：Zero': [], 'SKILL：Daimon': [], 'SKILL：Plugin': [] };
const all = [];
for (const e of fs.readdirSync(DAIMON_SKILLS, { withFileTypes: true })) {
  if (!e.isDirectory() && !e.isSymbolicLink()) continue;
  const md = path.join(DAIMON_SKILLS, e.name, 'SKILL.md');
  if (!fs.existsSync(md)) continue;
  const g = e.name.startsWith('zero-') ? 'SKILL：Zero' : hackNames.has(e.name) ? 'SKILL：Hack' : 'SKILL：Daimon';
  all.push({ name: e.name, desc: readDesc(md), g, gshort: g.split('：')[1], plugin: null });
}
for (const p of fs.readdirSync(PLUGINS, { withFileTypes: true })) {
  if (!p.isDirectory()) continue;
  const sdir = path.join(PLUGINS, p.name, 'skills');
  if (!fs.existsSync(sdir)) continue;
  for (const s of fs.readdirSync(sdir, { withFileTypes: true })) {
    if (!s.isDirectory()) continue;
    const md = path.join(sdir, s.name, 'SKILL.md');
    if (!fs.existsSync(md)) continue;
    all.push({ name: s.name, desc: readDesc(md), g: 'SKILL：Plugin', gshort: 'Plugin', plugin: p.name });
  }
}
const used = new Set();
for (const s of all) {
  let stub = s.name;
  if (used.has(stub)) stub = `${s.name} (${s.plugin || s.gshort})`;
  let n = 2;
  while (used.has(stub)) stub = `${s.name} (${s.plugin || s.gshort} ${n++})`;
  used.add(stub);
  s.stub = stub;
  groups[s.g].push(s);
}
// ตรวจว่าชื่อตรงกับไฟล์บนดิสก์จริง
const onDisk = new Set(fs.readdirSync(STUBS_DIR).map(f => f.replace(/\.md$/, '')));
const mismatch = all.filter(s => !onDisk.has(s.stub)).map(s => s.stub);

const HACK_BUCKETS = [
  ['0 · Recon & Methodology', /^(recon-|api-recon|subdomain-takeover|injection-checking|hack$)/],
  ['1 · Web Injection', /sqli|nosql|xss|ssti|xslt|cmdi|jndi|expression-language|crlf|csv-formula|xxe|deserialization|prototype-pollution|dangling-markup|email-header|format-string/],
  ['2 · Web & HTTP Attacks', /ssrf|401-403|http|cors|csrf|clickjacking|csp|open-redirect|web-cache|request-smuggling|websocket|waf|upload-insecure|path-traversal|file-access|dns-rebinding|race-condition|type-juggling|graphql|browser-exploitation/],
  ['3 · Auth & Session', /auth|jwt|oauth|saml|idor|ntlm/],
  ['4 · API Security', /^api-(sec|auth|authorization)/],
  ['5 · Active Directory & Windows', /active-directory|windows/],
  ['6 · Linux & Kernel', /linux|kernel/],
  ['7 · macOS & Mobile', /macos|android|^ios|mobile/],
  ['8 · Cloud & Container', /kubernetes|container|sandbox-escape/],
  ['9 · Exploit Dev & Reverse', /heap|stack-overflow|arbitrary-write|binary-protection|anti-debugging|symbolic-execution|reverse-shell|code-obfuscation|vm-and-bytecode/],
  ['10 · Post-Exploitation', /lateral|tunneling|privilege-escalation|av-evasion|security-bypass|unauthorized-access/],
  ['11 · Network & Forensics', /network-protocol|traffic-analysis|memory-forensics|steganography/],
  ['12 · Crypto', /rsa|lattice|classical-cipher|symmetric-cipher|hash-attack/],
  ['13 · AI · Web3 · Logic', /ai-ml|llm|defi|smart-contract|dependency-confusion|insecure-source-code|business-logic|ghost-bits/],
];
const DAIMON_BUCKETS = [
  ['Dev & Code', /^(api-shape|architecture|automation|binding|blueprint|canvas|code-|conventional-commit|deep-module|deploy-checklist|dev-guide|dispatching|domain-glossary|executing-plans|finishing-a|freeze|unfreeze|guard$|careful$|cso$|gitlab|kubectl|pipeline|route-to|secure-code|sql-insight|subagent|system-|terraform|test-|using-|verification|webapp|widget$|widgetdesign$|daimon-widget|requesting|receiving|writing-plans|writing-skills|skill-creator|kimi-|localization|incident-r|database-scout|browse$|fast-browser|playwright|agent-discipline|code-to-diagram|systematic-debugging|tech-debt|repo-audit|syntax-guard|log-error-digest|http-load-profiler|r2-upload|landing-page|html-mailer|imap-smtp|whatsapp|design-system)/],
  ['Data & Finance', /^(auto-hypothesis|chart-image|correlation|dataset|data-viz|discounted-cashflow|financial-|fund-risk|regression-modeler|saas-metrics|stock-signal|value-investing|xlsx|daily-report|equity-research|vc-industry|memory-widget|seaborn)/],
  ['Writing & Marketing', /^(ad-creative|brand-name|campaign|competitor|content-research|copy|cross-platform|ecom|email-newsletter|humanizer|keynote|podcast|seo|social|story-map|support-response|translation|x-thread|professional-email|audience-adaptive|last30days)/],
  ['Docs & Planning', /^(docx|pdf$|md-to-pdf|pptx|cite-style|gantt|structured-minutes|work-recap|standup$|process-doc|product-spec|project-sizing|okr|sprint|mock-interview|cv-tailor|code-mentor|academic-paper|anki|scholarly|scientific|theme-factory|video-quality|edge-tts|email-to-calendar|gstack|timeline-builder)/],
  ['Business & Risk', /^(churn|legal-risk|pricing|regulatory|tos-clause|iso-27001|incident-review|weighted-scorer|investor-pitch)/],
  ['Thinking & Workflow', /^(brainstorming|cross-examine|adhd|sun-path|caveman)/],
];
function bucketize(skills, buckets) {
  const out = []; const assigned = new Set();
  for (const [label, re] of buckets) {
    const hit = skills.filter(s => !assigned.has(s.stub) && re.test(s.name));
    hit.forEach(s => assigned.add(s.stub));
    if (hit.length) out.push([label, hit]);
  }
  const others = skills.filter(s => !assigned.has(s.stub));
  if (others.length) out.push(['อื่นๆ', others.sort((a, b) => a.name.localeCompare(b.name))]);
  return out;
}
function hubBody(hub, skills) {
  const row = (s) => `- [[${s.stub}]]${s.desc ? ' — ' + s.desc : ''}`;
  if (hub === 'SKILL：Hack') return bucketize(skills, HACK_BUCKETS).map(([l, arr]) => `### ${l} (${arr.length})\n${arr.map(row).join('\n')}`).join('\n\n');
  if (hub === 'SKILL：Daimon') return bucketize(skills, DAIMON_BUCKETS).map(([l, arr]) => `### ${l} (${arr.length})\n${arr.map(row).join('\n')}`).join('\n\n');
  if (hub === 'SKILL：Plugin') {
    const byPlugin = new Map();
    for (const s of skills) { if (!byPlugin.has(s.plugin)) byPlugin.set(s.plugin, []); byPlugin.get(s.plugin).push(s); }
    return [...byPlugin.entries()].sort((a, b) => b[1].length - a[1].length).map(([p, arr]) => `### ${p} (${arr.length})\n${arr.sort((x, y) => x.name.localeCompare(y.name)).map(row).join('\n')}`).join('\n\n');
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name)).map(row).join('\n');
}
for (const [hub, skills] of Object.entries(groups)) {
  const fp = path.join(ATLAS, `${hub}.md`);
  fs.writeFileSync(fp + '.tmp', `---
title: "${hub}"
type: moc
created: 2026-07-29
updated: ${today}
---

# ${hub} — ${skills.length} สกิล

> ลำดับการเดิน: งาน → [[Agent Map by Function]] → [[Skill Index]] → **กลุ่มนี้** → สกิล → ตัวจริง (SKILL.md)
> ศูนย์กลาง: [[Zero]]

${hubBody(hub, skills)}
`);
  fs.renameSync(fp + '.tmp', fp);
}

// --- ล้าง Zero.md ส่วนแผนที่ย่อยที่ใส่ผิด → เก็บแค่ Today + Template Index ---
const zeroPath = path.join(ATLAS, 'Zero.md');
let z = fs.readFileSync(zeroPath, 'utf8');
z = z.replace(/\n## แผนที่ย่อย \(เชื่อมอัตโนมัติ [^)]+\)[\s\S]*$/, '\n');
z = z.replace('3. **ระบบ/แผนที่** — [[Home]] · [[Hotcache]] · [[Memory Placement Rules]] · [[Brain Operating Model]] · [[AGENTS]]',
  '3. **ระบบ/แผนที่** — [[Home]] · [[Hotcache]] · [[Memory Placement Rules]] · [[Brain Operating Model]] · [[AGENTS]] · [[Template Index]] · [[Today]]');
fs.writeFileSync(zeroPath + '.tmp', z);
fs.renameSync(zeroPath + '.tmp', zeroPath);

// --- นับ orphan ซ้ำ ---
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p, out); }
    else if (e.name.endsWith('.md')) out.push(path.relative(BRAIN, p).replace(/\\/g, '/'));
  }
  return out;
}
const files = walk(BRAIN);
const stemOf = (rel) => path.basename(rel, '.md');
const stems = new Map();
for (const f of files) { const s = stemOf(f); if (!stems.has(s)) stems.set(s, []); stems.get(s).push(f); }
const LINK_RE = /\[\[([^\]]+)\]\]/g;
const inbound = new Map(files.map(f => [f, 0]));
for (const f of files) {
  const txt = fs.readFileSync(path.join(BRAIN, f), 'utf8');
  for (const m of txt.matchAll(LINK_RE)) {
    const inner = m[1].split('|')[0].split('#')[0].trim();
    if (!inner) continue;
    let targets = [];
    if (inner.endsWith('.md') && inner.includes('/')) {
      const rel = inner.replace(/^\.\//, '');
      if (inbound.has(rel)) targets = [rel];
    } else {
      const stem = inner.includes('/') ? inner.split('/').pop() : inner;
      targets = stems.get(stem) || [];
    }
    for (const t of targets) if (t !== f) inbound.set(t, inbound.get(t) + 1);
  }
}
const orphans = files.filter(f => inbound.get(f) === 0);

// manifest + audit
const KB = path.join(BRAIN, '.kb');
const mpath = path.join(KB, 'manifest.jsonl');
const hubPaths = new Set(Object.keys(groups).map(h => `20_Atlas/${h}.md`));
hubPaths.add('20_Atlas/Zero.md');
const lines = fs.readFileSync(mpath, 'utf8').split('\n').filter(Boolean);
const outLines = lines.map(l => {
  const rec = JSON.parse(l);
  if (hubPaths.has(rec.path)) return JSON.stringify({ ...rec, sha256: shaFile(path.join(BRAIN, rec.path)), updated: now });
  return l;
});
fs.writeFileSync(mpath + '.tmp', outLines.join('\n') + '\n');
fs.renameSync(mpath + '.tmp', mpath);
fs.appendFileSync(path.join(KB, 'audit.jsonl'), JSON.stringify({
  ts: now, actor: 'miru-kimi-work', action: 'brain_link_skills_v5', target: 'vault',
  detail: `deterministic stub names in hubs (v4 guessed wrong for 32 collision stubs); cleaned Zero.md; orphans now=${orphans.length}`
}) + '\n');

console.log(JSON.stringify({ stub_name_mismatch_vs_disk: mismatch, orphans_after: orphans.length, orphan_list: orphans }, null, 2));
