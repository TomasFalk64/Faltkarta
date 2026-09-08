const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/components/biotopeTree.ts"), "utf8");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const { biotopeRows, biotopeAncestors } = context.exports;
const data = require("../src/data/biotop_artportalen.json");
const tree = [{ id: 1, label: "Mark", children: [
  { id: 2, label: "Klippa", children: [{ id: 3, label: "Kust", children: [] }] },
  { id: 4, label: "Klipphed", children: [] },
] }];
const ids = rows => Array.from(rows, row => row.node.id);

test("JSON has consistent numeric IDs, labels and children arrays at all levels", () => {
  const seen = new Map();
  function validate(nodes) {
    assert(Array.isArray(nodes));
    for (const node of nodes) {
      assert(Number.isInteger(node.id));
      if (seen.has(node.id)) assert.equal(seen.get(node.id), node.label);
      seen.set(node.id, node.label);
      assert.equal(typeof node.label, "string");
      assert(node.label.trim());
      validate(node.children);
    }
  }
  validate(data);
  assert(seen.size > 100);
});

test("collapsed roots, nested expansion and collapse", () => {
  assert.deepEqual(ids(biotopeRows(tree, "", new Set())), [1]);
  assert.deepEqual(ids(biotopeRows(tree, "", new Set(["/0"]))), [1, 2, 4]);
  const rows = biotopeRows(tree, "", new Set(["/0", "/0/0"]));
  assert.deepEqual(ids(rows), [1, 2, 3, 4]);
  assert.equal(rows[2].depth, 2);
  assert.deepEqual(ids(biotopeRows(tree, "", new Set(["/0/0"]))), [1]);
});

test("substring search finds deep matches without expanding ancestors", () => {
  assert.deepEqual(ids(biotopeRows(tree, "  LIPP  ", new Set())), [2, 4]);
  assert.deepEqual(ids(biotopeRows(tree, "not present", new Set())), []);
  assert.deepEqual(ids(biotopeRows(tree, "   ", new Set())), [1]);
});

test("search matches can expand nonmatching children and collapse again", () => {
  assert.deepEqual(ids(biotopeRows(tree, "klipp", new Set(["/0/0"]))), [2, 3, 4]);
  assert.deepEqual(ids(biotopeRows(tree, "klipp", new Set())), [2, 4]);
});

test("matching descendants do not appear twice when their parent is expanded", () => {
  const overlapping = [{ id: 1, label: "Klippa", children: [{ id: 2, label: "Klipphed", children: [] }] }];
  assert.deepEqual(ids(biotopeRows(overlapping, "klipp", new Set(["/0"]))), [1, 2]);
});

test("selected leaf and parent can both be located; unknown ID is safe", () => {
  assert.deepEqual(Array.from(biotopeAncestors(tree, 3)), ["/0", "/0/0", "/0/0/0"]);
  assert.deepEqual(Array.from(biotopeAncestors(tree, 2)), ["/0", "/0/0"]);
  assert.deepEqual(Array.from(biotopeAncestors(tree, 99)), []);
});

test("actual Artportalen data supports case-insensitive cliff search", () => {
  const rows = biotopeRows(data, "KLIPP", new Set());
  assert(rows.length > 0);
  assert(rows.every(row => row.node.label.toLocaleLowerCase("sv-SE").includes("klipp")));
  assert(rows.some(row => row.node.label === "Klippa vid havet"));
});

test("repeated IDs remain visible in each branch and expand independently", () => {
  const repeated = [tree[0], tree[0]];
  const rows = biotopeRows(repeated, "", new Set(["/0", "/1", "/0/0"]));
  assert.deepEqual(ids(rows), [1, 2, 3, 4, 1, 2, 4]);
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length);
});

test("fully expanded JSON preserves every occurrence, including repeated IDs", () => {
  const expanded = new Set();
  let count = 0;
  function visit(nodes, parentKey = "") {
    nodes.forEach((node, index) => {
      const key = `${parentKey}/${index}`;
      count++;
      expanded.add(key);
      visit(node.children, key);
    });
  }
  visit(data);
  const rows = biotopeRows(data, "", expanded);
  assert.equal(rows.length, count);
  assert.equal(new Set(rows.map(row => row.key)).size, count);
});
