/**
 * schema.ts — frontmatter parse/serialize (YAML แบบจำกัด ที่ parse เองได้)
 * + slugify + wikilink extraction + ค่าคงที่ของ schema โน้ต
 * ใช้ subset ของ YAML เพื่อเลี่ยง dependency (offline เท่านั้น)
 */

export const NOTE_TYPES = ["fleeting", "atomic", "entity", "moc", "log", "source", "lesson"] as const;
export const PRIVACY_LEVELS = ["T0", "T1", "T2"] as const;
export const NOTE_STATES = ["active", "supporting", "archive"] as const;

export type NoteType = (typeof NOTE_TYPES)[number];
export type Privacy = (typeof PRIVACY_LEVELS)[number];
export type NoteState = (typeof NOTE_STATES)[number];

export interface NoteLink {
  to: string;
  rel: string;
}

export interface NoteMeta {
  id: string;
  type: (typeof NOTE_TYPES)[number];
  title: string;
  created: string;
  updated: string;
  aliases: string[];
  tags: string[];
  domain: string;
  privacy: (typeof PRIVACY_LEVELS)[number];
  state: (typeof NOTE_STATES)[number];
  links: NoteLink[];
  evidence: string[];
}

export interface ParsedNote {
  meta: NoteMeta;
  body: string;
  relPath: string;
}

/** parse frontmatter แบบจำกัด: key: value / key: [a, b] / key:\n  - item */
export function parseNoteFile(text: string): ParsedNote {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("ไม่พบ frontmatter (---)");
  const [, fm, body] = m;
  const meta = parseFrontmatter(fm!);
  return { meta, body: body!.replace(/^\n+/, ""), relPath: "" };
}

function parseFrontmatter(fm: string): NoteMeta {
  const lines = fm.split("\n");
  const out: Record<string, unknown> = {};
  let curKey = "";
  let curList: string[] | null = null;
  let curLinks: NoteLink[] | null = null;
  const flush = () => {
    if (curList && curKey) out[curKey] = curList;
    if (curLinks && curKey) out[curKey] = curLinks;
    curList = null;
    curLinks = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const listM = /^\s+-\s+(.*)$/.exec(line);
    if (listM) {
      const item = listM[1]!.trim();
      if (curKey === "links") {
        if (!curLinks) curLinks = [];
        const lm = /^to:\s*"?([^"]+?"?)\s*(?:,\s*rel:\s*"?([^"]+?"?))?$/.exec(item);
        if (lm) curLinks.push({ to: lm[1]!.replace(/"$/, ""), rel: (lm[2] ?? "related").replace(/"$/, "") });
      } else {
        if (!curList) curList = [];
        curList.push(item.replace(/^"|"$/g, ""));
      }
      continue;
    }
    flush();
    const kvM = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kvM) {
      curKey = kvM[1]!;
      const v = kvM[2]!.trim();
      if (v === "" || v === "[]") {
        if (v === "[]") out[curKey] = [];
        continue; // รอ list หรือ links ด้านล่าง
      }
      const arrM = /^\[(.*)\]$/.exec(v);
      if (arrM) {
        out[curKey] = arrM[1]!.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
      } else {
        out[curKey] = v.replace(/^"|"$/g, "");
      }
    }
  }
  flush();
  return {
    id: String(out.id ?? ""),
    type: (out.type as NoteMeta["type"]) ?? "fleeting",
    title: String(out.title ?? ""),
    created: String(out.created ?? ""),
    updated: String(out.updated ?? ""),
    aliases: (out.aliases as string[]) ?? [],
    tags: (out.tags as string[]) ?? [],
    domain: String(out.domain ?? "general"),
    privacy: (out.privacy as NoteMeta["privacy"]) ?? "T0",
    state: (out.state as NoteMeta["state"]) ?? "active",
    links: (out.links as NoteLink[]) ?? [],
    evidence: (out.evidence as string[]) ?? [],
  };
}

function yamlEscape(s: string): string {
  return /[:#\[\]{},"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

export function serializeFrontmatter(meta: NoteMeta): string {
  const list = (key: string, items: string[]): string =>
    items.length === 0 ? `${key}: []` : `${key}:\n${items.map((i) => `  - ${yamlEscape(i)}`).join("\n")}`;
  const links =
    meta.links.length === 0
      ? "links: []"
      : `links:\n${meta.links.map((l) => `  - to: ${yamlEscape(l.to)}, rel: ${yamlEscape(l.rel)}`).join("\n")}`;
  return [
    "---",
    `id: ${meta.id}`,
    `type: ${meta.type}`,
    `title: ${yamlEscape(meta.title)}`,
    `created: ${meta.created}`,
    `updated: ${meta.updated}`,
    list("aliases", meta.aliases),
    list("tags", meta.tags),
    `domain: ${yamlEscape(meta.domain)}`,
    `privacy: ${meta.privacy}`,
    `state: ${meta.state}`,
    links,
    list("evidence", meta.evidence),
    "---",
  ].join("\n");
}

export function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return ascii || "note";
}

/** ดึง target ของ [[wikilinks]] จาก body (ไม่เอา alias หลัง |) */
export function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = m[1]!.split("|")[0]!.trim();
    if (target) out.add(target);
  }
  return [...out];
}

/** วันที่ท้องถิ่นรูปแบบ YYYY-MM-DD */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, "0");
}

/** id โน้ตรูปแบบ YYYYMMDD-HHMMSS-xxxx (เวลาท้องถิ่น + suffix สุ่ม) */
export function genId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomSuffix()}`;
}

/** slug สำหรับชื่อไฟล์โน้ต (alias ของ slugify เดิม) */
export function sanitizeSlug(title: string): string {
  return slugify(title);
}

/** serialize โน้ตทั้งไฟล์: frontmatter + body (normalize newline ท้าย body) */
export function serializeNote(note: { meta: NoteMeta; body: string }): string {
  return serializeFrontmatter(note.meta) + "\n" + note.body.replace(/\n+$/, "") + "\n";
}
