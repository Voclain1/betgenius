/** Inspect authored visitor copy, not internal identifiers, test text or documentation. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
export const PUBLIC_PERFORMANCE_FILES = [
  "src/components/PerformanceDashboard.tsx",
  "src/app/(public)/track-record/page.tsx",
  "src/app/(public)/track-record/prediction/[id]/page.tsx",
  "src/lib/performanceCopy.ts",
  "src/lib/performanceLabels.ts",
];
const prohibited =
  /\b(?:immutable|cohort|resolver|ledger|database|queries|query|prospective|indicative|eligible|ROI|settlement)\b|\bstructured selection\b|\bpublication[- ](?:selection|price|version)\b|\bobservations?\b|\bflat[- ]stake\b|\bverified samples?\b|\bAI(?:[- ]assisted|[- ]powered)?\b|artificial intelligence/i;
export function copyIssues(file: string, source: string) {
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const issues: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isJsxText(node) ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const parent = node.parent;
      const internalAttribute =
        ts.isJsxAttribute(parent) &&
        !["title", "placeholder", "aria-label", "alt"].includes(
          parent.name.getText(ast),
        );
      const internalImport =
        ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
      if (!internalAttribute && !internalImport && prohibited.test(node.text))
        issues.push(
          `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${node.text.trim()}`,
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return issues;
}
const forbiddenExamples = [
  "Immutable publication evidence",
  "Verified cohort",
  "Settlement resolver",
  "Publication-selection observation",
  "Structured selection",
  "Original-version ledger",
  "Flat-stake illustration",
  "Historical correction ledger",
  "database query",
  "AI-assisted",
];
for (const text of forbiddenExamples)
  assert.ok(
    copyIssues("example.tsx", `export const View=()=> <p>${text}</p>`).length,
    `Must catch ${text}`,
  );
assert.equal(
  copyIssues(
    "example.tsx",
    '// Immutable ledger stays internal\nconst verifiedCohort = 1; export const View=()=> <p id="indicative-returns">Win Rate</p>',
  ).length,
  0,
);
const issues = PUBLIC_PERFORMANCE_FILES.flatMap((file) =>
  copyIssues(file, readFileSync(file, "utf8")),
);
assert.deepEqual(issues, [], issues.join("\n"));
console.log(
  `Sprint 09 production copy: ${PUBLIC_PERFORMANCE_FILES.length} visitor sources checked; ${forbiddenExamples.length} prohibited-copy detection tests and internal-code allowance passed`,
);
