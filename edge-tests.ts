// edge-tests.ts — mend's own edge-case suite (not the kit's practice set).
//
// Run: `node edge-tests.ts [fuzzIterations]` — prints each failure with what
// differed, then a score for the hand-written cases and one for the fuzz run.
// Every case states what SPEC.md requires; runner.ts runs main.ts in a fresh
// directory and compares exit code, stdout and the files afterwards, exactly
// as a check does. Expectations here are derived from SPEC.md by hand, never
// from running main.ts — a mismatch is a bug to fix, not a test to adjust.
//
// Uncertain corners are marked UNCERTAIN in a comment next to the case: the
// spec's letter is followed there, and the note says so.

import { runCheck } from './runner.ts';

interface Expect {
  exit: number;
  stdout: string;
  changes: Record<string, string | null>;
}
interface Case {
  name: string;
  argv: string[];
  stdin: string | null;
  files: Record<string, string>;
  expect: Expect;
}

const F5 = 'alpha\nbeta\ngamma\ndelta\nepsilon\n';
const F2 = 'alpha\nbeta\n';

const cases: Case[] = [
  // ---- CLI / invocation (section 1, 2, 4) ----
  { name: 'c-empty-auto', argv: ['-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: format\n', changes: {} } },
  { name: 'c-empty-json', argv: ['--format=json', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'c-empty-unified', argv: ['--format=unified', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'c-empty-sr', argv: ['--format=search-replace', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'c-empty-v4a', argv: ['--format=v4a', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'c-blank-auto', argv: ['-'], stdin: '\n  \n\t\n', files: {}, expect: { exit: 2, stdout: 'error: format\n', changes: {} } },
  { name: 'c-no-patch', argv: ['missing.patch'], stdin: null, files: {}, expect: { exit: 2, stdout: 'error: no-patch\n', changes: {} } },
  { name: 'c-usage-double-format', argv: ['--format=json', '--format=unified', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: usage\n', changes: {} } },
  { name: 'c-usage-empty-format', argv: ['--format=', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: usage\n', changes: {} } },
  { name: 'c-usage-bad-flag', argv: ['--bogus', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: usage\n', changes: {} } },
  { name: 'c-usage-two-pos', argv: ['a.patch', 'b.patch'], stdin: null, files: {}, expect: { exit: 2, stdout: 'error: usage\n', changes: {} } },
  { name: 'c-usage-check-twice', argv: ['--check', '--check', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: usage\n', changes: {} } },
  { name: 'c-usage-strict-twice', argv: ['--strict', '--strict', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: usage\n', changes: {} } },
  { name: 'c-usage-format-alone', argv: ['--format', '-'], stdin: '', files: {}, expect: { exit: 2, stdout: 'error: usage\n', changes: {} } },
  {
    name: 'c-dashdash-patch', argv: ['--', 'p.diff'], stdin: null,
    files: { 'p.diff': '--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n', f: 'alpha\nbeta\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'ALPHA\nbeta\n' } },
  },
  { name: 'c-dashdash-is-patch', argv: ['--', '--check'], stdin: null, files: {}, expect: { exit: 2, stdout: 'error: no-patch\n', changes: {} } },
  {
    name: 'c-format-named-wrong', argv: ['--format=unified', '-'],
    stdin: '{"command":"create","path":"x","file_text":"hi"}\n', files: {},
    expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} },
  },
  {
    name: 'c-detect-json-ws', argv: ['-'],
    stdin: '  \n  [{"command":"create","path":"x","file_text":"hi"}]\n', files: {},
    expect: { exit: 0, stdout: 'A x\nok: 1 file\n', changes: { x: 'hi' } },
  },
  {
    name: 'c-detect-v4a-blanks', argv: ['-'],
    stdin: '\n\n*** Begin Patch\n*** Add File: y\n+hello\n*** End Patch\n', files: {},
    expect: { exit: 0, stdout: 'A y\nok: 1 file\n', changes: { y: 'hello\n' } },
  },
  {
    // Section 4 tries search-replace before unified, so a `<<<<<<< SEARCH`
    // line anywhere in the patch makes it search-replace; the nearest
    // non-blank, non-fence line above it (+ALPHA) is then the block's path.
    name: 'c-detect-sr-beats-unified', argv: ['-'],
    stdin: 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n<<<<<<< SEARCH\nbeta\n=======\nBETA\n>>>>>>> REPLACE\n',
    files: { f: 'alpha\nbeta\n' },
    expect: { exit: 1, stdout: 'error: missing +ALPHA\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'c-check-output-same', argv: ['--check', '-'],
    stdin: 'f\n<<<<<<< SEARCH\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: {} },
  },

  // ---- Unified diffs (section 6) ----
  {
    // A lone `--- ` line is not inside a section's header, so it is prose;
    // with --format=unified there is no edit at all: parse 1.
    name: 'u-lone-triple-dash', argv: ['--format=unified', '-'], stdin: '--- a/f\n', files: {},
    expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} },
  },
  { name: 'u-lone-triple-dash-auto', argv: ['-'], stdin: '--- a/f\n', files: {}, expect: { exit: 2, stdout: 'error: format\n', changes: {} } },
  {
    // Inside a section's header, a `--- ` line not followed by `+++ ` is
    // parse <the line after it>.
    name: 'u-truncated-header', argv: ['-'],
    stdin: 'diff --git a/f b/f\n--- a/f\n', files: {},
    expect: { exit: 2, stdout: 'error: parse 3\n', changes: {} },
  },
  {
    // A second ---/+++ pair is not part of the first section's header, so
    // it starts a new section; the first section has no hunks and changes
    // nothing.
    name: 'u-second-pair-new-section', argv: ['-'],
    stdin: '--- a/x\n+++ b/x\n--- a/y\n+++ b/y\n@@ -1,1 +1,1 @@\n-a\n+b\n',
    files: { x: 'a\n', y: 'a\n' },
    expect: { exit: 0, stdout: 'M y\nok: 1 file\n', changes: { y: 'b\n' } },
  },
  {
    name: 'u-rename-no-hunks', argv: ['-'],
    stdin: 'diff --git a/old.txt b/new.txt\nrename from old.txt\nrename to new.txt\n',
    files: { 'old.txt': 'hello\n' },
    expect: { exit: 0, stdout: 'R old.txt -> new.txt\nok: 1 file\n', changes: { 'old.txt': null, 'new.txt': 'hello\n' } },
  },
  {
    name: 'u-create-exists', argv: ['-'],
    stdin: 'diff --git a/f b/f\nnew file mode 100644\n--- /dev/null\n+++ b/f\n@@ -0,0 +1,1 @@\n+new\n',
    files: { f: 'old\n' },
    expect: { exit: 1, stdout: 'error: exists f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'u-delete-missing', argv: ['-'],
    stdin: 'diff --git a/g b/g\ndeleted file mode 100644\n--- a/g\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone\n',
    files: {},
    expect: { exit: 1, stdout: 'error: missing g\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'u-move-to-exists', argv: ['-'],
    stdin: 'diff --git a/o b/n\nrename from o\nrename to n\n',
    files: { o: 'x\n', n: 'y\n' },
    expect: { exit: 1, stdout: 'error: exists n\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'u-move-missing', argv: ['-'],
    stdin: 'diff --git a/o b/n\nrename from o\nrename to n\n',
    files: {},
    expect: { exit: 1, stdout: 'error: missing o\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'u-unsafe-dotdot', argv: ['-'],
    stdin: '--- a/../evil\n+++ b/../evil\n@@ -1,1 +1,1 @@\n-a\n+b\n', files: {},
    expect: { exit: 1, stdout: 'error: unsafe ../evil\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'u-unsafe-absolute', argv: ['-'],
    stdin: '--- a//etc/passwd\n+++ b//etc/passwd\n@@ -1,1 +1,1 @@\n-a\n+b\n', files: {},
    expect: { exit: 1, stdout: 'error: unsafe /etc/passwd\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'u-path-spaces', argv: ['-'],
    stdin: '--- a/my file.txt\n+++ b/my file.txt\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n',
    files: { 'my file.txt': 'alpha\nbeta\n' },
    expect: { exit: 0, stdout: 'M my file.txt\nok: 1 file\n', changes: { 'my file.txt': 'ALPHA\nbeta\n' } },
  },
  {
    name: 'u-path-chinese', argv: ['-'],
    stdin: '--- a/中文/文件.txt\n+++ b/中文/文件.txt\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n',
    files: { '中文/文件.txt': 'alpha\n' },
    expect: { exit: 0, stdout: 'M 中文/文件.txt\nok: 1 file\n', changes: { '中文/文件.txt': 'ALPHA\n' } },
  },
  {
    // The path is the text after `--- ` up to the first tab.
    name: 'u-path-tab-timestamp', argv: ['-'],
    stdin: '--- a/f.txt\t2024-01-01 10:00:00\n+++ b/f.txt\t2024-01-01 10:00:00\n@@ -1,1 +1,1 @@\n-alpha\n+ALPHA\n',
    files: { 'f.txt': 'alpha\n' },
    expect: { exit: 0, stdout: 'M f.txt\nok: 1 file\n', changes: { 'f.txt': 'ALPHA\n' } },
  },
  {
    // Matched lines run to the end of the file, so the result ends with a
    // line break even though the file had none (section 6, no `\` line).
    name: 'u-noeol-replace-last', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -2,1 +2,1 @@\n-b\n+B\n',
    files: { f: 'a\nb' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nB\n' } },
  },
  {
    name: 'u-noeol-replace-last-marker', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -2,1 +2,1 @@\n-b\n+B\n\\ No newline at end of file\n',
    files: { f: 'a\nb' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nB' } },
  },
  {
    // The hunk does not reach the end, so the file's final break stays as
    // it was (absent here).
    name: 'u-noeol-middle', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-a\n+A\n',
    files: { f: 'a\nb\nc' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'A\nb\nc' } },
  },
  {
    name: 'u-noeol-create', argv: ['-'],
    stdin: '--- /dev/null\n+++ b/f\n@@ -0,0 +1,1 @@\n+hello\n\\ No newline at end of file\n',
    files: {},
    expect: { exit: 0, stdout: 'A f\nok: 1 file\n', changes: { f: 'hello' } },
  },
  {
    name: 'u-noeol-create-with-break', argv: ['-'],
    stdin: '--- /dev/null\n+++ b/f\n@@ -0,0 +1,1 @@\n+hello\n',
    files: {},
    expect: { exit: 0, stdout: 'A f\nok: 1 file\n', changes: { f: 'hello\n' } },
  },
  {
    name: 'u-insert-top', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -0,0 +1,1 @@\n+first\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'first\nalpha\nbeta\n' } },
  },
  {
    name: 'u-insert-beyond', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -99,0 +100,1 @@\n+last\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'alpha\nbeta\nlast\n' } },
  },
  { name: 'u-hunk-bad-header', argv: ['-'], stdin: '--- a/f\n+++ b/f\n@@ -x +y @@\n-a\n+b\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 3\n', changes: {} } },
  { name: 'u-hunk-before-section', argv: ['--format=unified', '-'], stdin: '@@ -1,1 +1,1 @@\n-a\n+b\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'u-hunk-before-section-auto', argv: ['-'], stdin: '@@ -1,1 +1,1 @@\n-a\n+b\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: format\n', changes: {} } },
  { name: 'u-diff-git-bad', argv: ['-'], stdin: 'diff --git a/foo\n--- a/foo\n+++ b/foo\n@@ -1,1 +1,1 @@\n-a\n+b\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'u-diff-git-no-prefix', argv: ['-'], stdin: 'diff --git foo bar\n--- a/foo\n+++ b/foo\n@@ -1,1 +1,1 @@\n-a\n+b\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  {
    name: 'u-empty-file-insert', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -0,0 +1,1 @@\n+hello\n',
    files: { f: '' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'hello\n' } },
  },
  {
    name: 'u-empty-file-nomatch', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-x\n+y\n',
    files: { f: '' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'u-context-only', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n alpha\n beta\n',
    files: { f: F5 },
    expect: { exit: 0, stdout: 'ok: 0 files\n', changes: {} },
  },
  {
    name: 'u-delete-all-lines', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -1,2 +1,0 @@\n-a\n-b\n',
    files: { f: 'a\nb\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: '' } },
  },
  {
    // B and D in the hunk header are not used.
    name: 'u-counts-ignored', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -1,99 +1,1 @@\n-alpha\n+ALPHA\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'ALPHA\nbeta\n' } },
  },
  {
    name: 'u-newfile-mode-no-pair', argv: ['-'],
    stdin: 'diff --git a/n.txt b/n.txt\nnew file mode 100644\n@@ -0,0 +1,1 @@\n+hi\n',
    files: {},
    expect: { exit: 0, stdout: 'A n.txt\nok: 1 file\n', changes: { 'n.txt': 'hi\n' } },
  },
  {
    name: 'u-deleted-mode-no-pair', argv: ['-'],
    stdin: 'diff --git a/d.txt b/d.txt\ndeleted file mode 100644\n@@ -1,1 +0,0 @@\n-gone\n',
    files: { 'd.txt': 'gone\n' },
    expect: { exit: 0, stdout: 'D d.txt\nok: 1 file\n', changes: { 'd.txt': null } },
  },
  {
    // The second hunk's A is in the file's original numbering; d=2 from the
    // first hunk shifts the nearest occurrence to the right place.
    name: 'u-multi-hunk-offset', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -1,1 +1,3 @@\n one\n+uno\n+ONE\n@@ -4,1 +6,1 @@\n-four\n+FOUR\n',
    files: { f: 'one\ntwo\nthree\nfour\nfive\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'one\nuno\nONE\ntwo\nthree\nFOUR\nfive\n' } },
  },

  // ---- SEARCH/REPLACE blocks (section 7) ----
  { name: 's-missing-separator', argv: ['-'], stdin: 'f\n<<<<<<< SEARCH\nalpha\n>>>>>>> REPLACE\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} } },
  { name: 's-missing-end', argv: ['-'], stdin: 'f\n<<<<<<< SEARCH\nalpha\n=======\nALPHA\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} } },
  { name: 's-no-path-first', argv: ['-'], stdin: '<<<<<<< SEARCH\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  {
    // With no path line of its own, a block takes the previous block's path.
    name: 's-path-reuse', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nbeta\n=======\nBETA\n>>>>>>> REPLACE\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'ALPHA\nBETA\n' } },
  },
  {
    // The path is the nearest non-blank line above SEARCH that does not
    // start with three backticks; a fence line in between is skipped.
    name: 's-path-fence-after', argv: ['-'],
    stdin: 'f\n```\n<<<<<<< SEARCH\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'ALPHA\nbeta\n' } },
  },
  {
    name: 's-create-exists', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\n=======\nnew\n>>>>>>> REPLACE\n',
    files: { f: 'old\n' },
    expect: { exit: 1, stdout: 'error: exists f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 's-create-empty', argv: ['-'],
    stdin: 'g\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n',
    files: {},
    expect: { exit: 0, stdout: 'A g\nok: 1 file\n', changes: { g: '' } },
  },
  { name: 's-unsafe-dotdot', argv: ['-'], stdin: '../evil\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n', files: {}, expect: { exit: 1, stdout: 'error: unsafe ../evil\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 's-unsafe-absolute', argv: ['-'], stdin: '/etc/x\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n', files: {}, expect: { exit: 1, stdout: 'error: unsafe /etc/x\nfailed: 1 of 1 edits\n', changes: {} } },
  {
    name: 's-path-spaces', argv: ['-'],
    stdin: '   my file.txt   \n<<<<<<< SEARCH\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\n',
    files: { 'my file.txt': 'alpha\n' },
    expect: { exit: 0, stdout: 'M my file.txt\nok: 1 file\n', changes: { 'my file.txt': 'ALPHA\n' } },
  },
  {
    // Tier 0 finds exactly one occurrence, so the two tier-1 occurrences
    // do not make it ambiguous: the tier is the first with any occurrence.
    name: 's-tier-ambiguous-false', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nx\n=======\nX\n>>>>>>> REPLACE\n',
    files: { f: 'x\nx \n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'X\nx \n' } },
  },
  {
    // No tier-0 occurrence; at tier 1 there are two: ambiguous.
    name: 's-ambiguous-tier1', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nx\n=======\nX\n>>>>>>> REPLACE\n',
    files: { f: 'x \nx\t\n' },
    expect: { exit: 1, stdout: 'error: ambiguous f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 's-empty-file-nomatch', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n',
    files: { f: '' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    // Edits apply in order to the tree as earlier edits left it.
    name: 's-multi-block-order', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nalpha\n=======\nALPHA\n>>>>>>> REPLACE\nf\n<<<<<<< SEARCH\nALPHA\n=======\nALPHA2\n>>>>>>> REPLACE\n',
    files: { f: 'alpha\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'ALPHA2\n' } },
  },
  {
    // The first `=======` after SEARCH is the separator, even when the
    // writer meant it as content.
    name: 's-separator-in-content', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\na\n=======\n=======\nc\n=======\nd\n>>>>>>> REPLACE\n',
    files: { f: 'a\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: '=======\nc\n=======\nd\n' } },
  },
  {
    name: 's-delete-to-empty', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nx\n=======\n>>>>>>> REPLACE\n',
    files: { f: 'x\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: '' } },
  },
  {
    name: 's-crlf-keep', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nb\n=======\nB\n>>>>>>> REPLACE\n',
    files: { f: 'a\r\nb\r\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\r\nB\r\n' } },
  },

  // ---- V4A patches (section 8) ----
  { name: 'v-missing-begin', argv: ['--format=v4a', '-'], stdin: '*** Update File: f\n- a\n+ b\n*** End Patch\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'v-missing-begin-auto', argv: ['-'], stdin: '*** Update File: f\n- a\n+ b\n*** End Patch\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: format\n', changes: {} } },
  { name: 'v-missing-end', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: f\n- a\n+ b\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 5\n', changes: {} } },
  { name: 'v-blank-only', argv: ['--format=v4a', '-'], stdin: '\n\n  \n', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  {
    // After `*** End of File` a chunk is closed; a body line with no `@@`
    // before it is a parse error at that line.
    name: 'v-eof-then-body', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n a\n*** End of File\n b\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 2, stdout: 'error: parse 5\n', changes: {} },
  },
  {
    // A bare `@@` is an empty anchor text, which section 8 says is no
    // anchor: the chunk applies at the cursor (end of file here).
    name: 'v-eof-then-bare-anchor', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n beta\n*** End of File\n@@\n+gamma\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'alpha\nbeta\ngamma\n' } },
  },
  {
    // An end-of-file chunk with no old lines inserts at the end.
    name: 'v-eof-insert', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n+gamma\n*** End of File\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'alpha\nbeta\ngamma\n' } },
  },
  {
    // An end-of-file chunk only takes an occurrence ending at the last line.
    name: 'v-eof-nomatch', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n alpha\n*** End of File\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  { name: 'v-add-exists', argv: ['-'], stdin: '*** Begin Patch\n*** Add File: f\n+x\n*** End Patch\n', files: { f: 'old\n' }, expect: { exit: 1, stdout: 'error: exists f\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'v-add-empty', argv: ['-'], stdin: '*** Begin Patch\n*** Add File: g\n*** End Patch\n', files: {}, expect: { exit: 0, stdout: 'A g\nok: 1 file\n', changes: { g: '' } } },
  {
    // Blank lines at the end of a section are not part of it.
    name: 'v-add-trailing-blank', argv: ['-'],
    stdin: '*** Begin Patch\n*** Add File: g\n+a\n+b\n\n\n*** End Patch\n',
    files: {},
    expect: { exit: 0, stdout: 'A g\nok: 1 file\n', changes: { g: 'a\nb\n' } },
  },
  {
    // UNCERTAIN: a whitespace-only line in the middle of an Add section is
    // neither a `+` line nor an empty line, and it is not between sections
    // or at the end of one, so by the letter of section 8 it is a parse
    // error. (A trailing one is still ignored: see v-add-ws-only-trailing.)
    name: 'v-add-ws-only-middle', argv: ['-'],
    stdin: '*** Begin Patch\n*** Add File: g\n+a\n   \n+b\n*** End Patch\n',
    files: {},
    expect: { exit: 2, stdout: 'error: parse 4\n', changes: {} },
  },
  {
    name: 'v-add-ws-only-trailing', argv: ['-'],
    stdin: '*** Begin Patch\n*** Add File: g\n+a\n   \n*** End Patch\n',
    files: {},
    expect: { exit: 0, stdout: 'A g\nok: 1 file\n', changes: { g: 'a\n' } },
  },
  { name: 'v-update-no-chunk', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: f\n*** End Patch\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} } },
  {
    name: 'v-update-move-only', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n*** Move to: g\n*** End Patch\n',
    files: { f: 'hello\n' },
    expect: { exit: 0, stdout: 'R f -> g\nok: 1 file\n', changes: { f: null, g: 'hello\n' } },
  },
  { name: 'v-move-to-exists', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: f\n*** Move to: g\n*** End Patch\n', files: { f: 'a\n', g: 'b\n' }, expect: { exit: 1, stdout: 'error: exists g\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'v-move-missing', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: f\n*** Move to: g\n*** End Patch\n', files: {}, expect: { exit: 1, stdout: 'error: missing f\nfailed: 1 of 1 edits\n', changes: {} } },
  {
    name: 'v-anchor-not-found', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ zzz\n alpha\n+ALPHA\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    // The anchor matches only at tier 2 (leading whitespace trimmed), and
    // the chunk then applies at/after the cursor the anchor left behind.
    name: 'v-anchor-tier2', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ alpha\n beta\n+BETA\n*** End Patch\n',
    files: { f: '  alpha\nbeta\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: '  alpha\nbeta\nBETA\n' } },
  },
  {
    // The second chunk's anchor is searched at/after the cursor the first
    // chunk left behind, so it is not found.
    name: 'v-cursor-before-only', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n@@ y\n y\n+Y1\n@@ x\n x\n+X2\n*** End Patch\n',
    files: { f: 'x\ny\nx\ny\n' },
    expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  {
    name: 'v-blank-between-sections', argv: ['-'],
    stdin: '*** Begin Patch\n\n*** Add File: g\n+hi\n\n*** Delete File: h\n\n*** End Patch\n',
    files: { h: 'bye\n' },
    expect: { exit: 0, stdout: 'A g\nD h\nok: 2 files\n', changes: { g: 'hi\n', h: null } },
  },
  { name: 'v-unknown-line', argv: ['-'], stdin: '*** Begin Patch\n*** Foo: bar\n*** End Patch\n', files: {}, expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} } },
  { name: 'v-move-to-unsafe', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: f\n*** Move to: ../x\n*** End Patch\n', files: { f: 'a\n' }, expect: { exit: 1, stdout: 'error: unsafe ../x\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'v-update-unsafe', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: ../x\n alpha\n+ALPHA\n*** End Patch\n', files: {}, expect: { exit: 1, stdout: 'error: unsafe ../x\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'v-add-unsafe', argv: ['-'], stdin: '*** Begin Patch\n*** Add File: /abs\n+x\n*** End Patch\n', files: {}, expect: { exit: 1, stdout: 'error: unsafe /abs\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'v-eof-alone', argv: ['-'], stdin: '*** Begin Patch\n*** Update File: f\n*** End of File\n*** End Patch\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 3\n', changes: {} } },
  {
    name: 'v-move-to-after-chunk', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n alpha\n+ALPHA\n*** Move to: g\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 2, stdout: 'error: parse 5\n', changes: {} },
  },
  {
    name: 'v-two-move-to', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n*** Move to: g\n*** Move to: h\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 2, stdout: 'error: parse 4\n', changes: {} },
  },
  {
    // UNCERTAIN: a tab-only line is a blank line, but it is not a body line
    // (body lines start with ` `, `-` or `+`, or are empty) and it is not
    // between sections or at the end of one, so by the letter of section 8
    // it is a parse error.
    name: 'v-tab-blank-line', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n alpha\n\t\n beta\n+BETA\n*** End Patch\n',
    files: { f: F2 },
    expect: { exit: 2, stdout: 'error: parse 4\n', changes: {} },
  },
  {
    name: 'v-crlf-move', argv: ['-'],
    stdin: '*** Begin Patch\n*** Update File: f\n*** Move to: g\n-b\n+B\n*** End Patch\n',
    files: { f: 'a\r\nb\r\n' },
    expect: { exit: 0, stdout: 'R f -> g\nok: 1 file\n', changes: { f: null, g: 'a\r\nB\r\n' } },
  },

  // ---- JSON edits (section 9) ----
  { name: 'j-array-empty', argv: ['--format=json', '-'], stdin: '[]', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-array-bad', argv: ['--format=json', '-'], stdin: '[\n{"command":"create","path":"x","file_text":"hi"}\n', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-lines-bad-line', argv: ['--format=json', '-'], stdin: '{"command":"create","path":"x","file_text":"hi"}\nnot json\n', files: {}, expect: { exit: 2, stdout: 'error: parse 2\n', changes: {} } },
  { name: 'j-unknown-command', argv: ['--format=json', '-'], stdin: '{"command":"delete","path":"a"}\n', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-missing-key', argv: ['--format=json', '-'], stdin: '{"command":"str_replace","path":"f","new_str":"y"}\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-wrong-type-insert', argv: ['--format=json', '-'], stdin: '{"command":"insert","path":"f","insert_line":"1","new_str":"x"}\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  {
    name: 'j-extra-keys', argv: ['--format=json', '-'],
    stdin: '{"command":"create","path":"x","file_text":"hi","note":"extra","zzz":123}\n', files: {},
    expect: { exit: 0, stdout: 'A x\nok: 1 file\n', changes: { x: 'hi' } },
  },
  {
    // Overlapping occurrences count: `aa` occurs in `aaa` at 0 and 1.
    name: 'j-str-overlap', argv: ['--format=json', '-'],
    stdin: '{"command":"str_replace","path":"f","old_str":"aa","new_str":"b"}\n',
    files: { f: 'aaa\n' },
    expect: { exit: 1, stdout: 'error: ambiguous f\nfailed: 1 of 1 edits\n', changes: {} },
  },
  { name: 'j-insert-out-of-range', argv: ['--format=json', '-'], stdin: '{"command":"insert","path":"f","insert_line":3,"new_str":"c"}\n', files: { f: F2 }, expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'j-insert-negative', argv: ['--format=json', '-'], stdin: '{"command":"insert","path":"f","insert_line":-1,"new_str":"c"}\n', files: { f: F2 }, expect: { exit: 1, stdout: 'error: no-match f\nfailed: 1 of 1 edits\n', changes: {} } },
  {
    name: 'j-insert-at-end', argv: ['--format=json', '-'],
    stdin: '{"command":"insert","path":"f","insert_line":2,"new_str":"c"}\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'alpha\nbeta\nc\n' } },
  },
  {
    name: 'j-insert-empty', argv: ['--format=json', '-'],
    stdin: '{"command":"insert","path":"f","insert_line":1,"new_str":""}\n',
    files: { f: F2 },
    expect: { exit: 0, stdout: 'ok: 0 files\n', changes: {} },
  },
  {
    name: 'j-insert-crlf-newstr', argv: ['--format=json', '-'],
    stdin: '{"command":"insert","path":"f","insert_line":1,"new_str":"x\\r\\ny"}\n',
    files: { f: 'a\r\nb\r\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\r\nx\r\ny\r\nb\r\n' } },
  },
  {
    // A JSON create writes file_text byte for byte.
    name: 'j-create-bytes', argv: ['--format=json', '-'],
    stdin: '{"command":"create","path":"x","file_text":"a\\r\\nb"}\n', files: {},
    expect: { exit: 0, stdout: 'A x\nok: 1 file\n', changes: { x: 'a\r\nb' } },
  },
  {
    name: 'j-str-absent-newstr', argv: ['--format=json', '-'],
    stdin: '{"command":"str_replace","path":"f","old_str":"world"}\n',
    files: { f: 'hello world\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'hello \n' } },
  },
  { name: 'j-array-mixed-invalid', argv: ['--format=json', '-'], stdin: '[{"command":"create","path":"x","file_text":"hi"},{"command":"bogus","path":"y"}]', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-unsafe-create', argv: ['--format=json', '-'], stdin: '{"command":"create","path":"../x","file_text":"hi"}\n', files: {}, expect: { exit: 1, stdout: 'error: unsafe ../x\nfailed: 1 of 1 edits\n', changes: {} } },
  { name: 'j-unsafe-before-missing', argv: ['--format=json', '-'], stdin: '{"command":"str_replace","path":"../x","old_str":"a","new_str":"b"}\n', files: {}, expect: { exit: 1, stdout: 'error: unsafe ../x\nfailed: 1 of 1 edits\n', changes: {} } },
  {
    name: 'j-create-then-replace', argv: ['--format=json', '-'],
    stdin: '[{"command":"create","path":"a","file_text":"hello\\n"},{"command":"str_replace","path":"a","old_str":"hello","new_str":"bye"}]',
    files: {},
    expect: { exit: 0, stdout: 'A a\nok: 1 file\n', changes: { a: 'bye\n' } },
  },
  { name: 'j-non-object-line', argv: ['--format=json', '-'], stdin: '[]\n', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-null-line', argv: ['--format=json', '-'], stdin: 'null\n', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-number-line', argv: ['--format=json', '-'], stdin: '42\n', files: {}, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-str-empty-old', argv: ['--format=json', '-'], stdin: '{"command":"str_replace","path":"f","old_str":"","new_str":"x"}\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  { name: 'j-insert-fraction', argv: ['--format=json', '-'], stdin: '{"command":"insert","path":"f","insert_line":1.5,"new_str":"x"}\n', files: { f: F2 }, expect: { exit: 2, stdout: 'error: parse 1\n', changes: {} } },
  {
    // The second create fails, and because an edit failed nothing is
    // written at all (section 10).
    name: 'j-create-then-create-same', argv: ['--format=json', '-'],
    stdin: '[{"command":"create","path":"a","file_text":"1"},{"command":"create","path":"a","file_text":"2"}]',
    files: {},
    expect: { exit: 1, stdout: 'error: exists a\nfailed: 1 of 2 edits\n', changes: {} },
  },

  // ---- Order and atomicity (section 10) ----
  {
    name: 'a-fail-then-succeed', argv: ['--format=json', '-'],
    stdin: '{"command":"str_replace","path":"missing.js","old_str":"x","new_str":"y"}\n{"command":"str_replace","path":"f","old_str":"alpha","new_str":"ALPHA"}\n',
    files: { f: 'alpha\n' },
    expect: { exit: 1, stdout: 'error: missing missing.js\nfailed: 1 of 2 edits\n', changes: {} },
  },
  {
    name: 'a-create-then-fail', argv: ['--format=json', '-'],
    stdin: '{"command":"create","path":"new.txt","file_text":"hi\\n"}\n{"command":"str_replace","path":"missing.js","old_str":"x","new_str":"y"}\n',
    files: {},
    expect: { exit: 1, stdout: 'error: missing missing.js\nfailed: 1 of 2 edits\n', changes: {} },
  },
  {
    // Output lines sort in byte order of the paths; an R line sorts by its
    // new path.
    name: 'a-output-order', argv: ['-'],
    stdin: 'diff --git a/z.txt b/z.txt\n--- a/z.txt\n+++ b/z.txt\n@@ -1,1 +1,1 @@\n-z\n+Z\ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-a\n+A\ndiff --git a/m.txt b/n.txt\nrename from m.txt\nrename to n.txt\n',
    files: { 'z.txt': 'z\n', 'a.txt': 'a\n', 'm.txt': 'm\n' },
    expect: { exit: 0, stdout: 'M a.txt\nR m.txt -> n.txt\nM z.txt\nok: 3 files\n', changes: { 'z.txt': 'Z\n', 'a.txt': 'A\n', 'm.txt': null, 'n.txt': 'm\n' } },
  },
  {
    name: 'a-json-noop', argv: ['--format=json', '-'],
    stdin: '{"command":"str_replace","path":"f","old_str":"hello","new_str":"hello"}\n',
    files: { f: 'hello\n' },
    expect: { exit: 0, stdout: 'ok: 0 files\n', changes: {} },
  },
  {
    // A later edit sees the file the earlier edit moved.
    name: 'a-move-then-edit', argv: ['-'],
    stdin: 'diff --git a/a.txt b/b.txt\nrename from a.txt\nrename to b.txt\ndiff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-hello\n+HELLO\n',
    files: { 'a.txt': 'hello\n' },
    expect: { exit: 0, stdout: 'R a.txt -> b.txt\nok: 1 file\n', changes: { 'a.txt': null, 'b.txt': 'HELLO\n' } },
  },
  {
    name: 'a-delete-then-create', argv: ['-'],
    stdin: 'diff --git a/f b/f\ndeleted file mode 100644\n--- a/f\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-old\ndiff --git a/f b/f\nnew file mode 100644\n--- /dev/null\n+++ b/f\n@@ -0,0 +1,1 @@\n+new\n',
    files: { f: 'old\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'new\n' } },
  },
  {
    name: 'a-create-then-delete', argv: ['-'],
    stdin: 'diff --git a/g b/g\nnew file mode 100644\n--- /dev/null\n+++ b/g\n@@ -0,0 +1,1 @@\n+new\ndiff --git a/g b/g\ndeleted file mode 100644\n--- a/g\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-new\n',
    files: {},
    expect: { exit: 0, stdout: 'ok: 0 files\n', changes: {} },
  },

  // ---- Robustness: files, lines and paths (section 3) ----
  {
    name: 'f-deep-path', argv: ['--format=json', '-'],
    stdin: '{"command":"create","path":"a/b/c/d/e/f.txt","file_text":"deep\\n"}\n', files: {},
    expect: { exit: 0, stdout: 'A a/b/c/d/e/f.txt\nok: 1 file\n', changes: { 'a/b/c/d/e/f.txt': 'deep\n' } },
  },
  {
    name: 'f-unicode-content', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nsecond line\n=======\n第二行\n>>>>>>> REPLACE\n',
    files: { f: '你好世界 🌍\nsecond line\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: '你好世界 🌍\n第二行\n' } },
  },
  {
    // A file that is one empty CRLF line; the hunk inserts after it and the
    // result keeps CRLF.
    name: 'f-crlf-only', argv: ['-'],
    stdin: '--- a/f\n+++ b/f\n@@ -1,1 +1,2 @@\n \n+x\n',
    files: { f: '\r\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: '\r\nx\r\n' } },
  },
  {
    // A file with no line feed at all is one line; a CR inside it is text.
    name: 'f-cr-only', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nabc\rdef\n=======\nABC\n>>>>>>> REPLACE\n',
    files: { f: 'abc\rdef' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'ABC' } },
  },
  {
    name: 'f-null-bytes', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nc\n=======\nd\n>>>>>>> REPLACE\n',
    files: { f: 'a\0b\nc\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\0b\nd\n' } },
  },
  {
    // A BOM is part of the first line; it is kept, and other lines match.
    name: 'f-bom', argv: ['-'],
    stdin: 'f\n<<<<<<< SEARCH\nworld\n=======\nWORLD\n>>>>>>> REPLACE\n',
    files: { f: '\uFEFFhello\nworld\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: '\uFEFFhello\nWORLD\n' } },
  },
];

const longLine = 'x'.repeat(50000);
cases.push({
  name: 'f-long-line', argv: ['-'],
  stdin: 'f\n<<<<<<< SEARCH\n' + longLine + '\n=======\n' + 'y'.repeat(50000) + '\n>>>>>>> REPLACE\n',
  files: { f: longLine + '\n' },
  expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'y'.repeat(50000) + '\n' } },
});

{
  // 50 hunks on a 100-line file: every even line replaced, d stays 0.
  const lines: string[] = [];
  for (let k = 0; k < 100; k++) lines.push(`l${k}`);
  const want: string[] = [];
  let patch = '--- a/f\n+++ b/f\n';
  for (let k = 0; k < 50; k++) {
    const at = 2 * k;
    patch += `@@ -${at + 1},1 +${at + 1},1 @@\n-l${at}\n+L${at}\n`;
    want.push(`L${at}`);
    want.push(`l${at + 1}`);
  }
  cases.push({
    name: 'f-many-hunks', argv: ['-'], stdin: patch,
    files: { f: lines.join('\n') + '\n' },
    expect: { exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: want.join('\n') + '\n' } },
  });
}

{
  // A 2000-line file with a hunk at the end (also a rough timing check).
  const lines: string[] = [];
  for (let k = 0; k < 2000; k++) lines.push(`line ${k}`);
  const want = [...lines];
  want[1998] = 'LINE 1998';
  cases.push({
    name: 'u-large-file', argv: ['-'],
    stdin: '--- a/big.txt\n+++ b/big.txt\n@@ -1999,1 +1999,1 @@\n-line 1998\n+LINE 1998\n',
    files: { 'big.txt': lines.join('\n') + '\n' },
    expect: { exit: 0, stdout: 'M big.txt\nok: 1 file\n', changes: { 'big.txt': want.join('\n') + '\n' } },
  });
}

// ---- run the hand-written cases ----
function checkOne(c: Case): string[] {
  const want: Record<string, string> = { ...c.files };
  for (const [p, v] of Object.entries(c.expect.changes)) {
    if (v === null) delete want[p];
    else want[p] = v;
  }
  const got = runCheck({ id: c.name, argv: c.argv, stdin: c.stdin, files: c.files });
  const why: string[] = [];
  if (got.exit !== c.expect.exit) why.push(`exit ${got.exit}, expected ${c.expect.exit}`);
  if (got.stdout !== c.expect.stdout) why.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.expect.stdout)}`);
  for (const p of new Set([...Object.keys(want), ...Object.keys(got.files)])) {
    if (want[p] === undefined) why.push(`${p} should not exist`);
    else if (got.files[p] === undefined) why.push(`${p} is missing`);
    else if (got.files[p] !== want[p]) why.push(`${p} differs: expected ${JSON.stringify(want[p])?.slice(0, 200)}, got ${JSON.stringify(got.files[p])?.slice(0, 200)}`);
  }
  return why;
}

let passed = 0;
for (const c of cases) {
  const why = checkOne(c);
  if (why.length === 0) passed += 1;
  else process.stdout.write(`FAIL ${c.name}\n  ${why.join('\n  ')}\n`);
}
process.stdout.write(`edge cases: ${passed} of ${cases.length} passed\n`);
if (passed !== cases.length) process.exitCode = 1;

// ---- fuzzing: random inputs, spec invariants only ----
// Sections 2 and 10 state, for every run: the exit code is 0, 1 or 2; the
// stdout shape matches the exit code; and whenever any edit failed or the
// patch could not be read, no file changed. A crash (uncaught exception)
// shows up as exit 1 with empty stdout, or a timeout (exit 124).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fuzzLines = ['', ' ', '  ', 'x', '  x', 'x ', 'alpha', 'beta', 'a b', 'x\ty', '  alpha  ', '}', '{', 'def f():', '// c', 'é', 'x'.repeat(40)];
const fuzzPaths = ['f', 'a/b', 'x.txt', '../evil', '/abs', 'a//b', 'my file.txt', '中文.txt', '', '.', 'a/./b', 'a/../b', 'f\\g', 'a/b/c', 'f.txt'];
const fuzzN = Number(process.argv[2] ?? '200');
const rand = mulberry32(20261123);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

function fuzzFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const n = Math.floor(rand() * 4);
  for (let k = 0; k < n; k++) {
    const p = pick(['f', 'a/b', 'x.txt', 'src/main.py', 'docs/a.md']);
    const lines: string[] = [];
    const m = Math.floor(rand() * 9);
    for (let j = 0; j < m; j++) lines.push(pick(fuzzLines));
    const br = rand() < 0.25 ? '\r\n' : '\n';
    out[p] = lines.length === 0 ? '' : lines.join(br) + (rand() < 0.8 ? br : '');
  }
  return out;
}

function fuzzPatch(): string {
  const kind = Math.floor(rand() * 5);
  const p = pick(fuzzPaths);
  const old = Array.from({ length: Math.floor(rand() * 3) }, () => pick(fuzzLines));
  const nw = Array.from({ length: Math.floor(rand() * 3) }, () => pick(fuzzLines));
  const body = (pre: string) => old.map((l) => `${pre}${l}`).join('\n') + (old.length > 0 ? '\n' : '');
  let s = '';
  if (kind === 0) {
    s = `--- a/${p}\n+++ b/${p}\n@@ -1,${old.length} +1,${nw.length} @@\n` +
      old.map((l) => `-${l}`).join('\n') + (old.length > 0 ? '\n' : '') +
      nw.map((l) => `+${l}`).join('\n') + (nw.length > 0 ? '\n' : '');
  } else if (kind === 1) {
    s = `${p}\n<<<<<<< SEARCH\n${body('')}${old.length > 0 || true ? '=======\n' : ''}${nw.join('\n')}${nw.length > 0 ? '\n' : ''}>>>>>>> REPLACE\n`;
  } else if (kind === 2) {
    s = `*** Begin Patch\n*** Update File: ${p}\n${body(' ')}${nw.map((l) => `+${l}`).join('\n')}${nw.length > 0 ? '\n' : ''}*** End Patch\n`;
  } else if (kind === 3) {
    s = JSON.stringify({ command: pick(['create', 'str_replace', 'insert', 'bogus']), path: p, file_text: nw.join('\n'), old_str: old.join('\n'), new_str: nw.join('\n'), insert_line: Math.floor(rand() * 5) }) + '\n';
  } else {
    s = Array.from({ length: Math.floor(rand() * 12) }, () => pick([...fuzzLines, '--- a/f', '+++ b/f', '@@ -1,1 +1,1 @@', '<<<<<<< SEARCH', '=======', '>>>>>>> REPLACE', '*** Begin Patch', '*** End Patch', '*** Update File: f', '*** Add File: g', 'diff --git a/f b/f'])).join('\n') + '\n';
  }
  if (rand() < 0.25 && s.length > 1) s = s.slice(0, Math.floor(rand() * s.length)); // truncate
  if (rand() < 0.15) s = '\n' + s; // leading blank
  return s;
}

function fuzzInvariants(seed: number): string[] {
  const files = fuzzFiles();
  const patch = fuzzPatch();
  const argv: string[] = [];
  const r = rand();
  if (r < 0.2) argv.push('--check');
  else if (r < 0.3) argv.push('--strict');
  else if (r < 0.4) argv.push('--format=' + pick(['auto', 'unified', 'search-replace', 'v4a', 'json']));
  const useFile = rand() < 0.5;
  if (useFile) {
    argv.push('p.diff');
    files['p.diff'] = patch;
  } else argv.push('-');
  const got = runCheck({ id: `fuzz-${seed}`, argv, stdin: useFile ? null : patch, files });
  const canon = (o: Record<string, string>): string => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const why: string[] = [];
  if (![0, 1, 2].includes(got.exit)) {
    why.push(`exit ${got.exit} (crash/timeout) argv=${JSON.stringify(argv)}`);
  } else if (got.exit === 2) {
    if (!/^error: (usage|no-patch|format|parse \d+)\n$/.test(got.stdout)) why.push(`exit 2 stdout ${JSON.stringify(got.stdout)}`);
    if (canon(got.files) !== canon(files)) why.push('exit 2 changed files');
  } else if (got.exit === 1) {
    const lines = got.stdout.split('\n');
    if (lines[lines.length - 1] !== '') why.push('exit 1 stdout lacks trailing newline');
    const body = lines.slice(0, -1);
    const last = body[body.length - 1] ?? '';
    const m = /^failed: (\d+) of (\d+) edits$/.exec(last);
    if (!m) why.push(`exit 1 last line ${JSON.stringify(last)}`);
    else {
      if (Number(m[1]) !== body.length - 1) why.push(`exit 1 failed count ${m[1]} vs ${body.length - 1} error lines`);
      for (const l of body.slice(0, -1)) {
        if (!/^error: (no-match|ambiguous|missing|exists|unsafe) /.test(l) && !/^error: (no-match|ambiguous|missing|exists|unsafe)$/.test(l)) why.push(`exit 1 bad error line ${JSON.stringify(l)}`);
      }
    }
    if (canon(got.files) !== canon(files)) why.push('exit 1 changed files (atomicity)');
  } else {
    const lines = got.stdout.split('\n');
    if (lines[lines.length - 1] !== '') why.push('exit 0 stdout lacks trailing newline');
    const body = lines.slice(0, -1);
    const last = body[body.length - 1] ?? '';
    const m = /^ok: (\d+) files?$/.exec(last);
    if (!m) why.push(`exit 0 last line ${JSON.stringify(last)}`);
    else if (Number(m[1]) !== body.length - 1) why.push(`exit 0 ok count ${m[1]} vs ${body.length - 1} change lines`);
    const keys: string[] = [];
    for (const l of body.slice(0, -1)) {
      const rm = /^R (.+) -> (.+)$/.exec(l);
      if (rm) keys.push(rm[2]!);
      else {
        const cm = /^[ADM] (.+)$/.exec(l);
        if (!cm) why.push(`exit 0 bad change line ${JSON.stringify(l)}`);
        else keys.push(cm[1]!);
      }
    }
    for (let k = 1; k < keys.length; k++) {
      if (Buffer.compare(Buffer.from(keys[k - 1]!), Buffer.from(keys[k]!)) > 0) why.push(`exit 0 output not sorted: ${JSON.stringify(keys)}`);
    }
  }
  if (why.length > 0) {
    return [...why, `argv=${JSON.stringify(argv)} stdin=${JSON.stringify(useFile ? null : patch)} files=${JSON.stringify(files)}`];
  }
  return [];
}

let fuzzBad = 0;
for (let s = 0; s < fuzzN; s++) {
  const why = fuzzInvariants(s);
  if (why.length > 0) {
    fuzzBad += 1;
    if (fuzzBad <= 5) process.stdout.write(`FUZZ ${s}:\n  ${why.join('\n  ')}\n`);
  }
}
process.stdout.write(`fuzz: ${fuzzN - fuzzBad} of ${fuzzN} passed (seed 20261123)\n`);
if (fuzzBad > 0) process.exitCode = 1;


