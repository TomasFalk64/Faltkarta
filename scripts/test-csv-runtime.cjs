const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function loadMobileEntry(entry) {
  const context = {
    module: { exports: {} },
    exports: {},
    require(name) {
      if (name === "stream") return {};
      throw new Error(`Unexpected native runtime dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve(entry), "utf8"), context);
  return context.module.exports;
}

test("mobile CSV source preserves the previous browser entry's Swedish export and quoting", () => {
  const source = loadMobileEntry("papaparse/papaparse.js");
  const previous = loadMobileEntry("papaparse/papaparse.min.js");
  const rows = {
    fields: ["Art", "Anteckning", "Antal"],
    data: [["Knärot", 'Skog; "norr"\r\nNästa rad', 2], ["Örn", "", 0]],
  };
  const options = { delimiter: ";", newline: "\r\n", quotes: false, skipEmptyLines: false };
  const csv = source.unparse(rows, options);
  assert.equal(csv, previous.unparse(rows, options));
  assert.equal(csv, 'Art;Anteckning;Antal\r\nKnärot;"Skog; ""norr""\r\nNästa rad";2\r\nÖrn;;0');
});
