// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

// ---- Section 3: a file as lines ----
interface FileLines {
  br: '\r\n' | '\n';
  lines: string[];
  final: boolean;
}

function parseFile(text: string): FileLines {
  if (text === '') return { br: '\n', lines: [], final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const final = text.endsWith(br);
  if (final) parts.pop();
  return { br, lines: parts, final };
}

function renderFile(f: FileLines): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.final ? f.br : '');
}

const trimEndWs = (s: string): string => s.replace(/[ \t]+$/, '');
const trimWs = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const leadWs = (s: string): string => {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0] : '';
};
const isBlankWs = (s: string): boolean => /^[ \t]*$/.test(s);

// ---- Section 5: matching lines ----
function lineEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return trimEndWs(a) === trimEndWs(b);
  return trimWs(a) === trimWs(b);
}

function occurrences(O: string[], F: string[], tier: number): number[] {
  const out: number[] = [];
  if (O.length === 0 || O.length > F.length) return out;
  for (let i = 0; i + O.length <= F.length; i++) {
    let ok = true;
    for (let j = 0; j < O.length; j++) {
      if (!lineEq(O[j]!, F[i + j]!, tier)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

function findTier(O: string[], F: string[], strict: boolean): { tier: number; pos: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const pos = occurrences(O, F, t);
    if (pos.length > 0) return { tier: t, pos };
  }
  return null;
}

/** The lines N writes in place of O at position pos of F. ctx maps an index of N to the index of the same context line in O. */
function buildNew(O: string[], N: string[], ctx: Map<number, number>, tier: number, F: string[], pos: number): string[] {
  const matched = F.slice(pos, pos + O.length);
  const out: string[] = [];
  const P = O.length > 0 ? leadWs(O[0]!) : '';
  const F0 = matched.length > 0 ? leadWs(matched[0]!) : '';
  for (let j = 0; j < N.length; j++) {
    const oi = ctx.get(j);
    if (oi !== undefined) {
      out.push(matched[oi]!);
      continue;
    }
    const line = N[j]!;
    if (tier === 2 && !isBlankWs(line) && line.startsWith(P)) out.push(F0 + line.slice(P.length));
    else out.push(line);
  }
  return out;
}

interface ParseCtx {
  strict: boolean;
  moves: Array<[string, string]>;
}

// ---- Section 6: unified diffs ----
interface Hunk {
  A: number;
  O: string[];
  N: string[];
  ctx: Map<number, number>;
  plus: string[];
  noEol: boolean;
  noEolPlus: boolean;
}

interface RawUniSection {
  diffOld?: string;
  diffNew?: string;
  pairOld?: string | null;
  pairNew?: string | null;
  pairSeen: boolean;
  renameFrom?: string;
  renameTo?: string;
  create: boolean;
  del: boolean;
  hunks: Hunk[];
}

function parseUniPath(raw: string): string | null {
  const t = raw.split('\t')[0]!.trim();
  if (t === '/dev/null') return null;
  if (t.startsWith('a/')) return t.slice(2);
  if (t.startsWith('b/')) return t.slice(2);
  return t;
}

function parseHunk(lines: string[], start: number, A: number): [Hunk, number] {
  let j = start + 1;
  const body: { kind: ' ' | '-' | '+' | '\\'; text: string; rawEmpty: boolean }[] = [];
  while (j < lines.length) {
    const l = lines[j]!;
    if (l.startsWith('diff --git ')) break;
    if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
    if (l.startsWith('@@')) break;
    if (l === '') {
      body.push({ kind: ' ', text: '', rawEmpty: true });
      j++;
      continue;
    }
    const c = l[0]!;
    if (c === ' ' || c === '-' || c === '+' || c === '\\') {
      body.push({ kind: c, text: l.slice(1), rawEmpty: false });
      j++;
      continue;
    }
    break;
  }
  while (body.length > 0 && body[body.length - 1]!.rawEmpty) body.pop();
  const O: string[] = [];
  const N: string[] = [];
  const ctx = new Map<number, number>();
  const plus: string[] = [];
  for (const b of body) {
    if (b.kind === ' ') {
      ctx.set(N.length, O.length);
      O.push(b.text);
      N.push(b.text);
    } else if (b.kind === '-') O.push(b.text);
    else if (b.kind === '+') {
      N.push(b.text);
      plus.push(b.text);
    }
  }
  let noEol = false;
  let noEolPlus = false;
  for (let k = body.length - 1; k >= 0; k--) {
    if (body[k]!.kind === ' ' || body[k]!.kind === '+') {
      noEol = body[k + 1] !== undefined && body[k + 1]!.kind === '\\';
      break;
    }
  }
  for (let k = body.length - 1; k >= 0; k--) {
    if (body[k]!.kind === '+') {
      noEolPlus = body[k + 1] !== undefined && body[k + 1]!.kind === '\\';
      break;
    }
  }
  return [{ A, O, N, ctx, plus, noEol, noEolPlus }, j];
}

function applyHunk(f: FileLines, h: Hunk, d: number, strict: boolean, path: string): FileLines {
  const { O, N } = h;
  if (O.length === 0) {
    const at = Math.min(Math.max(h.A + d, 0), f.lines.length);
    const lines = [...f.lines.slice(0, at), ...N, ...f.lines.slice(at)];
    let fin = f.final;
    if (at === f.lines.length) fin = !h.noEol;
    return { br: f.br, lines, final: fin };
  }
  const found = findTier(O, f.lines, strict);
  if (!found) throw new Fail('no-match', path);
  const target = h.A - 1 + d;
  let pos = found.pos[0]!;
  let best = Math.abs(pos - target);
  for (const p of found.pos) {
    const dist = Math.abs(p - target);
    if (dist < best) {
      best = dist;
      pos = p;
    }
  }
  const newLines = buildNew(O, N, h.ctx, found.tier, f.lines, pos);
  const lines = [...f.lines.slice(0, pos), ...newLines, ...f.lines.slice(pos + O.length)];
  let fin = f.final;
  if (pos + O.length === f.lines.length) fin = !h.noEol;
  return { br: f.br, lines, final: fin };
}

function applyHunks(text: string, hunks: Hunk[], strict: boolean, path: string): string {
  let f = parseFile(text);
  let d = 0;
  for (const h of hunks) {
    f = applyHunk(f, h, d, strict, path);
    d += h.N.length - h.O.length;
  }
  return renderFile(f);
}

function uniSectionEdit(sec: RawUniSection, ctx: ParseCtx): Edit | null {
  let old = sec.pairOld !== undefined ? sec.pairOld : (sec.renameFrom ?? sec.diffOld);
  let nw = sec.pairNew !== undefined ? sec.pairNew : (sec.renameTo ?? sec.diffNew);
  if (old === undefined && nw !== undefined) old = nw;
  if (nw === undefined && old !== undefined) nw = old;
  if (old === undefined || nw === undefined) return null;
  const isCreate = sec.create || old === null;
  const isDelete = !isCreate && (sec.del || nw === null);
  const isMove = !isCreate && !isDelete && old !== nw;
  return (tree) => {
    if (old !== null && !safe(old)) throw new Fail('unsafe', old);
    if (nw !== null && !safe(nw)) throw new Fail('unsafe', nw);
    if (isCreate) {
      if (nw === null) return;
      if (tree.get(nw) !== null) throw new Fail('exists', nw);
      const plus: string[] = [];
      let final = false;
      for (let k = sec.hunks.length - 1; k >= 0; k--) {
        const h = sec.hunks[k]!;
        if (h.plus.length > 0) {
          final = !h.noEolPlus;
          break;
        }
      }
      for (const h of sec.hunks) plus.push(...h.plus);
      tree.now.set(nw, plus.length === 0 ? '' : plus.join('\n') + (final ? '\n' : ''));
      return;
    }
    if (isDelete) {
      if (tree.get(old!) === null) throw new Fail('missing', old!);
      tree.now.set(old!, null);
      return;
    }
    if (isMove) {
      if (tree.get(old!) === null) throw new Fail('missing', old!);
      if (tree.get(nw!) !== null) throw new Fail('exists', nw!);
      const out = applyHunks(tree.get(old!)!, sec.hunks, ctx.strict, old!);
      tree.now.set(nw!, out);
      tree.now.set(old!, null);
      ctx.moves.push([old!, nw!]);
      return;
    }
    if (tree.get(old!) === null) throw new Fail('missing', old!);
    tree.now.set(old!, applyHunks(tree.get(old!)!, sec.hunks, ctx.strict, old!));
  };
}

function parseUnified(lines: string[], ctx: ParseCtx): Edit[] {
  const sections: RawUniSection[] = [];
  let cur: RawUniSection | null = null;
  let state: 'outside' | 'header' | 'between' = 'outside';
  const newSection = (diffOld?: string, diffNew?: string): void => {
    if (cur !== null) sections.push(cur);
    cur = { diffOld, diffNew, pairSeen: false, create: false, del: false, hunks: [] };
    state = 'header';
  };
  const isDiffGit = (l: string): boolean => l.startsWith('diff --git ');
  const parseDiffGit = (l: string): [string, string] | null => {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(l);
    return m ? [m[1]!, m[2]!] : null;
  };
  const parseHunkHeader = (l: string): number | null => {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    return m ? parseInt(m[1]!, 10) : null;
  };
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const l = lines[i]!;
    if (state === 'outside') {
      if (isDiffGit(l)) {
        const d = parseDiffGit(l);
        if (!d) throw new Exit2(`error: parse ${i + 1}`);
        newSection(d[0], d[1]);
        i++;
        continue;
      }
      if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
        newSection();
        continue;
      }
      if (l.startsWith('@@')) throw new Exit2(`error: parse ${i + 1}`);
      i++;
      continue;
    }
    if (state === 'header') {
      if (isDiffGit(l)) {
        const d = parseDiffGit(l);
        if (!d) throw new Exit2(`error: parse ${i + 1}`);
        newSection(d[0], d[1]);
        i++;
        continue;
      }
      if (l.startsWith('--- ')) {
        if ((lines[i + 1] ?? '').startsWith('+++ ')) {
          if (cur!.pairSeen) {
            newSection();
            continue;
          }
          cur!.pairOld = parseUniPath(l.slice(4));
          cur!.pairNew = parseUniPath(lines[i + 1]!.slice(4));
          cur!.pairSeen = true;
          i += 2;
          continue;
        }
        throw new Exit2(`error: parse ${i + 2}`);
      }
      if (l.startsWith('+++ ')) {
        i++;
        continue;
      }
      if (l.startsWith('rename from ')) {
        if (cur!.renameFrom === undefined) cur!.renameFrom = l.slice(12).trim();
        i++;
        continue;
      }
      if (l.startsWith('rename to ')) {
        if (cur!.renameTo === undefined) cur!.renameTo = l.slice(10).trim();
        i++;
        continue;
      }
      if (l === 'new file mode' || l.startsWith('new file mode ')) {
        cur!.create = true;
        i++;
        continue;
      }
      if (l === 'deleted file mode' || l.startsWith('deleted file mode ')) {
        cur!.del = true;
        i++;
        continue;
      }
      if (l.startsWith('@@')) {
        const A = parseHunkHeader(l);
        if (A === null) throw new Exit2(`error: parse ${i + 1}`);
        const [hunk, next] = parseHunk(lines, i, A);
        cur!.hunks.push(hunk);
        i = next;
        state = 'between';
        continue;
      }
      i++;
      continue;
    }
    if (isDiffGit(l)) {
      const d = parseDiffGit(l);
      if (!d) throw new Exit2(`error: parse ${i + 1}`);
      newSection(d[0], d[1]);
      i++;
      continue;
    }
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      newSection();
      continue;
    }
    if (l.startsWith('@@')) {
      const A = parseHunkHeader(l);
      if (A === null) throw new Exit2(`error: parse ${i + 1}`);
      const [hunk, next] = parseHunk(lines, i, A);
      cur!.hunks.push(hunk);
      i = next;
      continue;
    }
    i++;
  }
  if (cur !== null) sections.push(cur);
  const edits: Edit[] = [];
  for (const s of sections) {
    const e = uniSectionEdit(s, ctx);
    if (e !== null) edits.push(e);
  }
  return edits;
}

// ---- Section 7: SEARCH/REPLACE blocks ----
function srEdit(path: string, old: string[], nw: string[], ctx: ParseCtx): Edit {
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (old.length === 0) {
      if (tree.get(path) !== null) throw new Fail('exists', path);
      tree.now.set(path, nw.length === 0 ? '' : nw.join('\n') + '\n');
      return;
    }
    const before = tree.get(path);
    if (before === null) throw new Fail('missing', path);
    const f = parseFile(before);
    const found = findTier(old, f.lines, ctx.strict);
    if (!found) throw new Fail('no-match', path);
    if (found.pos.length > 1) throw new Fail('ambiguous', path);
    const pos = found.pos[0]!;
    const newLines = buildNew(old, nw, new Map(), found.tier, f.lines, pos);
    const lines = [...f.lines.slice(0, pos), ...newLines, ...f.lines.slice(pos + old.length)];
    tree.now.set(path, renderFile({ br: f.br, lines, final: f.final }));
  };
}

function parseSearchReplace(lines: string[], ctx: ParseCtx): Edit[] {
  const edits: Edit[] = [];
  let prevEnd = -1;
  let prevPath: string | null = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i++;
      continue;
    }
    const s = i;
    let path: string | null = null;
    for (let k = s - 1; k > prevEnd; k--) {
      const l = lines[k]!;
      if (blank(l)) continue;
      if (l.trim().startsWith('```')) continue;
      path = l.trim();
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw new Exit2(`error: parse ${s + 1}`);
    let sep = -1;
    for (let k = s + 1; k < n; k++) {
      const l = lines[k]!;
      if (l.trimEnd() === '=======') {
        sep = k;
        break;
      }
      if (l.trimEnd() === '>>>>>>> REPLACE' || l.trimEnd() === '<<<<<<< SEARCH') break;
    }
    if (sep === -1) throw new Exit2(`error: parse ${s + 1}`);
    let end = -1;
    for (let k = sep + 1; k < n; k++) {
      const l = lines[k]!;
      if (l.trimEnd() === '>>>>>>> REPLACE') {
        end = k;
        break;
      }
      if (l.trimEnd() === '<<<<<<< SEARCH') break;
    }
    if (end === -1) throw new Exit2(`error: parse ${s + 1}`);
    edits.push(srEdit(path, lines.slice(s + 1, sep), lines.slice(sep + 1, end), ctx));
    prevEnd = end;
    prevPath = path;
    i = end + 1;
  }
  return edits;
}

// ---- Section 8: V4A patches ----
interface VChunk {
  anchor: string | null;
  O: string[];
  N: string[];
  ctx: Map<number, number>;
  eof: boolean;
}

interface VSection {
  kind: 'add' | 'delete' | 'update';
  path: string;
  moveTo: string | null;
  lines: string[];
  chunks: VChunk[];
  line: number;
}

function vEdit(sec: VSection, ctx: ParseCtx): Edit {
  return (tree) => {
    if (!safe(sec.path)) throw new Fail('unsafe', sec.path);
    if (sec.kind === 'add') {
      if (tree.get(sec.path) !== null) throw new Fail('exists', sec.path);
      tree.now.set(sec.path, sec.lines.length === 0 ? '' : sec.lines.join('\n') + '\n');
      return;
    }
    if (sec.kind === 'delete') {
      if (tree.get(sec.path) === null) throw new Fail('missing', sec.path);
      tree.now.set(sec.path, null);
      return;
    }
    if (sec.moveTo !== null && !safe(sec.moveTo)) throw new Fail('unsafe', sec.moveTo);
    const before = tree.get(sec.path);
    if (before === null) throw new Fail('missing', sec.path);
    if (sec.moveTo !== null && tree.get(sec.moveTo) !== null) throw new Fail('exists', sec.moveTo);
    let f = parseFile(before);
    let cursor = 0;
    for (const ch of sec.chunks) {
      if (ch.anchor !== null) {
        let at: number | null = null;
        for (const t of ctx.strict ? [0] : [0, 1, 2]) {
          for (let k = cursor; k < f.lines.length; k++) {
            if (lineEq(ch.anchor, f.lines[k]!, t)) {
              at = k;
              break;
            }
          }
          if (at !== null) break;
        }
        if (at === null) throw new Fail('no-match', sec.path);
        cursor = at + 1;
      }
      if (ch.O.length === 0) {
        const at = ch.eof ? f.lines.length : cursor;
        const lines = [...f.lines.slice(0, at), ...ch.N, ...f.lines.slice(at)];
        f = { br: f.br, lines, final: f.final };
        cursor = at + ch.N.length;
        continue;
      }
      const tiers = ctx.strict ? [0] : [0, 1, 2];
      let found: { tier: number; pos: number[] } | null = null;
      for (const t of tiers) {
        const pos = occurrences(ch.O, f.lines, t).filter((p) => p >= cursor);
        if (pos.length > 0) {
          found = { tier: t, pos };
          break;
        }
      }
      if (!found) throw new Fail('no-match', sec.path);
      const pos = found.pos[0]!;
      if (ch.eof && pos + ch.O.length !== f.lines.length) throw new Fail('no-match', sec.path);
      const newLines = buildNew(ch.O, ch.N, ch.ctx, found.tier, f.lines, pos);
      const lines = [...f.lines.slice(0, pos), ...newLines, ...f.lines.slice(pos + ch.O.length)];
      f = { br: f.br, lines, final: f.final };
      cursor = pos + newLines.length;
    }
    const out = renderFile(f);
    if (sec.moveTo !== null) {
      tree.now.set(sec.moveTo, out);
      tree.now.set(sec.path, null);
      ctx.moves.push([sec.path, sec.moveTo]);
    } else {
      tree.now.set(sec.path, out);
    }
  };
}

function parseV4a(lines: string[], ctx: ParseCtx): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = lines.length - 1;
  while (last >= 0 && blank(lines[last]!)) last--;
  if (last < 0 || lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const isSectionStart = (l: string): boolean =>
    l.startsWith('*** Add File:') || l.startsWith('*** Delete File:') || l.startsWith('*** Update File:');
  const sections: VSection[] = [];
  let i = first + 1;
  while (i < last) {
    const l = lines[i]!;
    if (blank(l)) {
      i++;
      continue;
    }
    if (!isSectionStart(l)) throw new Exit2(`error: parse ${i + 1}`);
    const kind = l.startsWith('*** Add File:') ? 'add' : l.startsWith('*** Delete File:') ? 'delete' : 'update';
    const path = l.slice(kind === 'add' ? 13 : 16).trim();
    const sec: VSection = { kind, path, moveTo: null, lines: [], chunks: [], line: i + 1 };
    i++;
    if (kind === 'add') {
      const raw: string[] = [];
      while (i < last) {
        const b = lines[i]!;
        if (isSectionStart(b)) break;
        if (b.startsWith('+')) {
          raw.push(b.slice(1));
          i++;
          continue;
        }
        if (b === '') {
          raw.push('');
          i++;
          continue;
        }
        if (blank(b)) {
          i++;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
      sec.lines = raw;
    } else if (kind === 'delete') {
      while (i < last) {
        const b = lines[i]!;
        if (isSectionStart(b)) break;
        if (blank(b)) {
          i++;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
    } else {
      // Blank lines at the end of a section are not part of it: find where this
      // section ends and strip its trailing blank lines before parsing chunks.
      let secEnd = i;
      while (secEnd < last && !isSectionStart(lines[secEnd]!)) secEnd++;
      while (secEnd > i && blank(lines[secEnd - 1]!)) secEnd--;
      let sawFirst = false;
      let afterEof = false;
      let cur: { anchor: string | null; items: { kind: ' ' | '-' | '+'; text: string }[] } | null = null;
      const closeChunk = (eof: boolean): void => {
        if (cur === null) return;
        const O: string[] = [];
        const N: string[] = [];
        const c = new Map<number, number>();
        for (const it of cur.items) {
          if (it.kind === ' ') {
            c.set(N.length, O.length);
            O.push(it.text);
            N.push(it.text);
          } else if (it.kind === '-') O.push(it.text);
          else N.push(it.text);
        }
        sec.chunks.push({ anchor: cur.anchor, O, N, ctx: c, eof });
        cur = null;
      };
      while (i < secEnd) {
        const b = lines[i]!;
        if (isSectionStart(b)) break;
        if (b.startsWith('*** Move to:')) {
          if (!sawFirst && cur === null) {
            sec.moveTo = b.slice(12).trim();
            sawFirst = true;
            i++;
            continue;
          }
          throw new Exit2(`error: parse ${i + 1}`);
        }
        if (b === '*** End of File') {
          if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
          closeChunk(true);
          afterEof = true;
          sawFirst = true;
          i++;
          continue;
        }
        if (b.startsWith('@@')) {
          closeChunk(false);
          cur = { anchor: b.slice(2).trim(), items: [] };
          afterEof = false;
          sawFirst = true;
          i++;
          continue;
        }
        if (b === '' || b[0] === ' ' || b[0] === '-' || b[0] === '+') {
          if (cur === null) {
            if (afterEof) {
              if (blank(b)) {
                i++;
                continue;
              }
              throw new Exit2(`error: parse ${i + 1}`);
            }
            cur = { anchor: null, items: [] };
          }
          const kind2 = b === '' ? ' ' : (b[0] as ' ' | '-' | '+');
          cur.items.push({ kind: kind2, text: b === '' ? '' : b.slice(1) });
          sawFirst = true;
          i++;
          continue;
        }
        if (blank(b)) {
          i++;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      closeChunk(false);
      if (sec.chunks.length === 0 && sec.moveTo === null) throw new Exit2(`error: parse ${sec.line}`);
    }
    sections.push(sec);
  }
  return sections.map((s) => vEdit(s, ctx));
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  const moves: Array<[string, string]> = [];
  const pctx: ParseCtx = { strict, moves };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = parseUnified(lines, pctx);
    else if (kind === 'search-replace') edits = parseSearchReplace(lines, pctx);
    else edits = parseV4a(lines, pctx);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const changed = [...tree.now.keys()].filter((p) => tree.original(p) !== tree.now.get(p));
  if (!check) {
    for (const p of changed) {
      const now = tree.now.get(p)!;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  const suppressed = new Set<string>();
  const rows: { key: string; text: string }[] = [];
  for (const [old, nw] of moves) {
    if (tree.original(old) !== null && tree.get(old) === null && tree.original(nw) === null && tree.get(nw) !== null) {
      rows.push({ key: nw, text: `R ${old} -> ${nw}` });
      suppressed.add(old);
      suppressed.add(nw);
    }
  }
  for (const p of changed) {
    if (suppressed.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    rows.push({ key: p, text: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const out = rows.map((r) => r.text);
  return { code: 0, out: [...out, `ok: ${out.length} ${out.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
