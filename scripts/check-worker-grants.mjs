#!/usr/bin/env node
/**
 * Worker grant guard (issue #15, ADR-024 addendum): every table the worker's
 * SQL touches must be in the explicit ai_fsm_worker grant list in
 * scripts/db-provision-runtime.sh. The worker bypasses RLS, so its privileges
 * are the only table-level fence it has; a new worker query on an ungranted
 * table would fail at runtime, and a grant added by hand would drift from the
 * code. This check is static: it reads the worker source and the provisioner,
 * with no database.
 *
 * What it does:
 *   1. Collects table names from SQL string/template literals in services/worker/src
 *      (non-test files), using the TypeScript parser already in devDependencies.
 *   2. Fails if a referenced table has no `GRANT ... ON TABLE public.<t> TO ai_fsm_worker`.
 *   3. Fails if a granted table is not created (or renamed to) by a migration.
 *   4. Fails if a `.query(...)` call passes SQL that is not a literal, because
 *      that SQL cannot be checked statically.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseTables, readMigrationSqls } from "./check-rls-coverage.mjs";

export const WORKER_ROLE = "ai_fsm_worker";

/** Words that follow FROM/JOIN/INTO/UPDATE in SQL but are not table names. */
const NON_TABLE_WORDS = new Set(["set", "skip", "the", "lateral", "only", "values", "select", "unnest"]);

const SQL_LIKE = /\b(select|insert|update|delete|with)\b[\s\S]*\b(from|into|update|set|join|values)\b/i;
// `(?![ \t]*\()` skips function calls such as `from generate_series(`, but not
// `insert into t` followed by a column list on the next line.
const TABLE_AFTER_KEYWORD = /\b(?:from|join|into|update|using|delete\s+from)\s+([a-z_][a-z0-9_]*)\b(?![ \t]*\()/gi;

/**
 * @param {{ name: string, text: string }[]} files worker source files (non-test)
 * @returns {{ tables: Map<string, Set<string>>, dynamic: string[] }}
 */
export function extractWorkerSql(files) {
  const tables = new Map();
  const dynamic = [];
  for (const { name, text } of files) {
    const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      let literal = null;
      if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) {
        literal = node.text;
      } else if (ts.isTemplateExpression(node)) {
        literal = node.head.text + node.templateSpans.map((s) => " ? " + s.literal.text).join("");
      }
      if (literal !== null && SQL_LIKE.test(literal)) {
        const ctes = new Set([...literal.matchAll(/([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
        for (const m of literal.matchAll(TABLE_AFTER_KEYWORD)) {
          const table = m[1].toLowerCase();
          if (NON_TABLE_WORDS.has(table) || ctes.has(table)) continue;
          if (!tables.has(table)) tables.set(table, new Set());
          tables.get(table).add(name);
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "query" && node.arguments.length > 0) {
        const first = node.arguments[0];
        if (!ts.isNoSubstitutionTemplateLiteral(first) && !ts.isStringLiteral(first) && !ts.isTemplateExpression(first)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          dynamic.push(`${name}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { tables, dynamic };
}

/**
 * Reads the explicit worker grants from the provisioner text.
 * @param {string} shellText
 * @returns {Set<string>}
 */
export function parseWorkerGrants(shellText) {
  const granted = new Set();
  const re = new RegExp(
    String.raw`GRANT\s+[^;]*?\bON\s+TABLE\s+public\.([a-z_][a-z0-9_]*)\s+TO\s+${WORKER_ROLE}\b`,
    "gi",
  );
  for (const m of shellText.matchAll(re)) granted.add(m[1].toLowerCase());
  return granted;
}

/** Tables that exist after migrations: CREATE TABLE plus ALTER TABLE ... RENAME TO targets. */
export function existingTables(sqls) {
  const { created } = parseTables(sqls);
  const names = new Set(created);
  for (const sql of sqls) {
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:[a-z_][a-z0-9_]*\.)?"?[a-z_][a-z0-9_]*"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
      names.add(m[1].toLowerCase());
    }
  }
  return names;
}

/**
 * @returns {{ ok: boolean, unlisted: { table: string, files: string[] }[], ungrantedTables: string[], dynamic: string[] }}
 */
export function checkWorkerGrants({ tables, dynamic, granted, existing }) {
  const unlisted = [...tables.keys()]
    .filter((t) => !granted.has(t))
    .sort()
    .map((t) => ({ table: t, files: [...tables.get(t)].sort() }));
  const ungrantedTables = [...granted].filter((t) => !existing.has(t)).sort();
  return {
    ok: unlisted.length === 0 && ungrantedTables.length === 0 && dynamic.length === 0,
    unlisted,
    ungrantedTables,
    dynamic,
  };
}

function listWorkerSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listWorkerSources(full));
    else if (entry.name.endsWith(".ts") && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isMain() {
  const self = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return path.resolve(self) === invoked;
}

if (isMain()) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const srcDir = path.join(repoRoot, "services", "worker", "src");
  const files = listWorkerSources(srcDir).map((f) => ({
    name: path.relative(repoRoot, f),
    text: fs.readFileSync(f, "utf8"),
  }));
  const provision = fs.readFileSync(path.join(repoRoot, "scripts", "db-provision-runtime.sh"), "utf8");
  const existing = existingTables(readMigrationSqls(path.join(repoRoot, "db", "migrations")));
  const { tables, dynamic } = extractWorkerSql(files);
  const result = checkWorkerGrants({ tables, dynamic, granted: parseWorkerGrants(provision), existing });

  if (result.unlisted.length > 0) {
    console.error(`Worker SQL touches table(s) with no ${WORKER_ROLE} grant in scripts/db-provision-runtime.sh:`);
    for (const { table, files: f } of result.unlisted) console.error(`  - ${table} (${f.join(", ")})`);
    console.error(`Add an explicit GRANT ... ON TABLE public.<t> TO ${WORKER_ROLE} inside the worker block.`);
  }
  if (result.ungrantedTables.length > 0) {
    console.error("Worker grant(s) name table(s) no migration creates (typo or stale grant):");
    for (const t of result.ungrantedTables) console.error(`  - ${t}`);
  }
  if (result.dynamic.length > 0) {
    console.error(".query() called with non-literal SQL; the worker grant check cannot see it:");
    for (const site of result.dynamic) console.error(`  - ${site}`);
  }
  if (!result.ok) process.exit(1);
  console.log(`Worker grants: ok (${tables.size} tables referenced, all granted)`);
}
