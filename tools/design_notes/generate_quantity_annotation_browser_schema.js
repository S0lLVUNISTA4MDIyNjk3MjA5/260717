'use strict';
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'quantity_annotation_schema_v1.json');
const outputPath = path.join(__dirname, '..', 'generated', 'quantity_annotation_schema_v1.browser.js');

function render(schema) {
  return `/* AUTO-GENERATED from tools/design_notes/quantity_annotation_schema_v1.json.\n * Run: node tools/design_notes/generate_quantity_annotation_browser_schema.js\n */\n(function(root, factory) {\n  const schema = factory();\n  if (typeof module === 'object' && module.exports) module.exports = schema;\n  if (root) root.QuantityAnnotationSchemaV1 = schema;\n})(typeof globalThis !== 'undefined' ? globalThis : this, function() {\n  return ${JSON.stringify(schema, null, 2)};\n});\n`;
}

function generate() {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  fs.mkdirSync(path.dirname(outputPath), { recursive:true });
  fs.writeFileSync(outputPath, render(schema), 'utf8');
  return outputPath;
}

if (require.main === module) console.log(generate());
module.exports = { render, generate, schemaPath, outputPath };
