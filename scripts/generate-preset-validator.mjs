import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(projectRoot, "schemas/preset-v1.schema.json");
const outputPath = resolve(
  projectRoot,
  "src/generated/preset-v1-validator.ts"
);

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  code: { esm: true, source: true }
});
addFormats(ajv);

const validate = ajv.compile(schema);
const standalone = toBrowserEsm(standaloneCode(ajv, validate));
const generated = [
  "// @ts-nocheck",
  "// Generated from schemas/preset-v1.schema.json. Do not edit manually.",
  standalone,
  ""
].join("\n");

await mkdir(dirname(outputPath), { recursive: true });

let current;
try {
  current = await readFile(outputPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

if (current !== generated) {
  await writeFile(outputPath, generated, "utf8");
}

function toBrowserEsm(source) {
  const esm = source
    .replace(
      /const (\w+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/,
      'import $1 from "ajv/dist/runtime/ucs2length.js";'
    )
    .replace(
      /const (\w+) = require\("ajv\/dist\/runtime\/equal"\)\.default;/,
      'import $1 from "ajv/dist/runtime/equal.js";'
    )
    .replace(
      /const (\w+) = require\("ajv-formats\/dist\/formats"\)\.fullFormats\["date-time"\];/,
      'import { fullFormats as __fullFormats } from "ajv-formats/dist/formats.js";const $1 = __fullFormats["date-time"];'
    );

  if (esm.includes("require(") || esm.includes("new Function")) {
    throw new Error(
      "Generated preset validator contains code forbidden by Manifest V3."
    );
  }

  return esm;
}
