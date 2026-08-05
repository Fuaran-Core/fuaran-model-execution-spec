// SPDX-License-Identifier: Apache-2.0
//
// The corpus's index, schema and rule checker — the layer beneath
// emit.mjs's byte comparison (§9.7). Zero dependencies.
//
//   node validate.mjs            # check the corpus
//   node validate.mjs --self-test  # prove each check goes red
//
// It answers five questions the byte comparison cannot:
//
//   1. Index integrity — does every file on disk appear in the manifest,
//      does every manifest entry point at a file that exists, and does
//      every recorded digest match the bytes? (An orphan fixture is a
//      vector nobody runs; a stale digest is an index that lies.)
//   2. Partition integrity — are the profiles cumulative, do the families
//      a profile names exist, and does every vector declare a family and
//      a profile that are registered?
//   3. Structure — does every non-reject document validate against the
//      envelope schema and its kind's body schema?
//   4. Rejection — does every `reject` vector actually FAIL, by the means
//      its `detect` field claims (schema or rule)? A reject vector that
//      quietly validates is the worst entry in a corpus: it reports a
//      check that is not happening.
//   5. Rules — the four things §5 requires that no schema can express.
//
// The JSON Schema support here is a deliberately small SUBSET (see
// `SUPPORTED` below), and the script REFUSES a schema using a keyword it
// does not implement rather than silently ignoring it — an unimplemented
// keyword is exactly the failure that makes a validator look green.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

const selfTest = process.argv.includes("--self-test");

let failures = 0;
let checks = 0;
const fail = (message) => {
  failures += 1;
  console.error(`FAIL ${message}`);
};
const pass = (message) => {
  checks += 1;
  console.log(`ok   ${message}`);
};

// ── a deliberately small JSON Schema subset ──────────────────────────

const SUPPORTED = new Set([
  "$schema",
  "$ref",
  "$comment",
  "$defs",
  "title",
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "minimum",
  "maximum",
  "minItems",
  "items",
  "properties",
  "required",
  "additionalProperties",
  "oneOf",
]);

const schemaCache = new Map();

function loadSchema(path) {
  const absolute = resolve(path);
  if (!schemaCache.has(absolute)) schemaCache.set(absolute, JSON.parse(readFileSync(absolute, "utf8")));
  return schemaCache.get(absolute);
}

/** Assert the schema set uses no keyword this validator does not implement. */
function auditKeywords(node, path, file) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => auditKeywords(item, `${path}[${i}]`, file));
    return;
  }
  if (node === null || typeof node !== "object") return;

  for (const key of Object.keys(node)) {
    // Below `properties` and `$defs`, keys are names, not keywords.
    if (path.endsWith("/properties") || path.endsWith("/$defs")) {
      auditKeywords(node[key], `${path}/${key}`, file);
      continue;
    }
    if (!SUPPORTED.has(key)) {
      fail(`schema ${file} uses unimplemented keyword '${key}' at ${path} — implement it or drop it`);
      continue;
    }
    auditKeywords(node[key], `${path}/${key}`, file);
  }
}

/** Resolve `file#/pointer` / `#/pointer` against the schema's own location. */
function deref(ref, baseFile) {
  const [filePart, pointer] = ref.split("#");
  const file = filePart ? resolve(dirname(baseFile), filePart) : baseFile;
  let node = loadSchema(file);

  if (pointer) {
    for (const segment of pointer.split("/").slice(1)) {
      node = node[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (node === undefined) throw new Error(`unresolvable $ref '${ref}' from ${baseFile}`);
    }
  }

  return { schema: node, file };
}

const typeOf = (value) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : Number.isInteger(value)
        ? "integer"
        : typeof value === "number"
          ? "number"
          : typeof value;

/** Returns a list of violation strings; empty means valid. */
function validate(value, schema, file, at = "") {
  if (schema.$ref) {
    const target = deref(schema.$ref, file);
    return validate(value, target.schema, target.file, at);
  }

  const bad = [];
  const kind = typeOf(value);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((t) => t === kind || (t === "number" && kind === "integer"));
    if (!ok) bad.push(`${at || "/"}: expected ${types.join("|")}, got ${kind}`);
  }
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const))
    bad.push(`${at || "/"}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    bad.push(`${at || "/"}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern, "u").test(value))
    bad.push(`${at || "/"}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength)
    bad.push(`${at || "/"}: shorter than minLength ${schema.minLength}`);
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum)
    bad.push(`${at || "/"}: ${value} < minimum ${schema.minimum}`);
  if (schema.maximum !== undefined && typeof value === "number" && value > schema.maximum)
    bad.push(`${at || "/"}: ${value} > maximum ${schema.maximum}`);
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems)
    bad.push(`${at || "/"}: ${value.length} items < minItems ${schema.minItems}`);

  if (schema.items && Array.isArray(value))
    value.forEach((item, i) => bad.push(...validate(item, schema.items, file, `${at}[${i}]`)));

  if (kind === "object") {
    for (const key of schema.required ?? [])
      if (!(key in value)) bad.push(`${at || "/"}: missing required member '${key}'`);

    for (const [key, member] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) bad.push(...validate(member, property, file, `${at}.${key}`));
      else if (schema.additionalProperties === false)
        bad.push(`${at || "/"}: unexpected member '${key}'`);
      else if (typeof schema.additionalProperties === "object")
        bad.push(...validate(member, schema.additionalProperties, file, `${at}.${key}`));
    }
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s) => validate(value, s, file, at).length === 0).length;
    if (matches !== 1) bad.push(`${at || "/"}: matched ${matches} of ${schema.oneOf.length} oneOf branches`);
  }

  return bad;
}

// ── the corpus ───────────────────────────────────────────────────────

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const schemaPath = (kind) => resolve(here, manifest.schemas[kind]);

// ── the minting canonicalisation, derived a second time (§4.5) ───────
//
// Deliberately a DIFFERENT construction from emit.mjs's: rebuild the
// parsed value with every object's members in ordinal key order, then let
// the host's own JSON serialiser apply §3.1 rules 1, 6, 9 and 10 — which
// are exactly ECMAScript's, and which is why §3.1 rule 9 cites them.
// emit.mjs writes those bytes itself. Two implementations agreeing is
// evidence about the rule; one implementation agreeing with itself is a
// tautology.

const REGISTERED_SPEC_HASH_ALGORITHM = "canonical-json-sha256-v1";

const sortedDeep = (value) => {
  if (Array.isArray(value)) return value.map(sortedDeep); // order is data (§4.5)
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortedDeep(value[key]);
  return out;
};

const canonicalSpecPayload = (rendered) => JSON.stringify(sortedDeep(JSON.parse(rendered)));
const mintSpecHash = (rendered) =>
  "sha256:" + sha256Hex(Buffer.from(canonicalSpecPayload(rendered), "utf8"));

const filesOnDisk = () => {
  const out = [];
  for (const entry of readdirSync(here)) {
    if (!statSync(join(here, entry)).isDirectory()) continue;
    for (const file of readdirSync(join(here, entry))) out.push(`${entry}/${file}`);
  }
  return out.sort();
};

// 0. Every schema uses only implemented keywords.
for (const file of readdirSync(resolve(here, "../schemas/v1"))) {
  const path = resolve(here, "../schemas/v1", file);
  auditKeywords(loadSchema(path), "", file);
}
pass("every schema uses only keywords this validator implements");

// 1. Index integrity.
const disk = filesOnDisk();
const enumerated = new Set(manifest.vectors.map((v) => v.file));

for (const file of disk)
  if (!enumerated.has(file)) fail(`${file} exists on disk but is not enumerated by the manifest`);
for (const vector of manifest.vectors) {
  let bytes;
  try {
    bytes = readFileSync(join(here, vector.file));
  } catch {
    fail(`${vector.id} points at ${vector.file}, which does not exist`);
    continue;
  }
  if (sha256Hex(bytes) !== vector.sha256) fail(`${vector.id}: sha256 ${sha256Hex(bytes)} != manifest`);
  if (/\s$/.test(bytes.toString("utf8"))) fail(`${vector.id}: trailing whitespace — the file's bytes ARE the document`);
}
pass(`index integrity: ${manifest.vectors.length} vectors, ${disk.length} files, digests match`);

// 2. Partition integrity.
const families = new Set(manifest.families);
const profileNames = ["observer", "submitter", "executor"];
for (let i = 1; i < profileNames.length; i += 1) {
  const narrower = new Set(manifest.profiles[profileNames[i - 1]]);
  const wider = new Set(manifest.profiles[profileNames[i]]);
  for (const family of narrower)
    if (!wider.has(family))
      fail(`profile '${profileNames[i]}' does not include '${family}' from '${profileNames[i - 1]}' — profiles are cumulative`);
}
for (const [profile, list] of Object.entries(manifest.profiles))
  for (const family of list)
    if (!families.has(family)) fail(`profile '${profile}' names unregistered family '${family}'`);
for (const vector of manifest.vectors) {
  if (!families.has(vector.family)) fail(`${vector.id} declares unregistered family '${vector.family}'`);
  if (!manifest.profiles[vector.profile]) fail(`${vector.id} declares unknown profile '${vector.profile}'`);
  if (!vector.file.startsWith(`${vector.family}/`))
    fail(`${vector.id} declares family '${vector.family}' but lives at ${vector.file}`);
  if (!["round-trip", "hash", "reject", "accept"].includes(vector.kind))
    fail(`${vector.id} declares unknown vector kind '${vector.kind}'`);
  if (vector.kind === "reject" && !["schema", "rule"].includes(vector.detect))
    fail(`${vector.id} is a reject vector with no usable 'detect' field`);
  if (vector.kind === "accept" && !vector.interpretation)
    fail(`${vector.id} is an accept vector with no 'interpretation'`);
}
for (const family of manifest.reservedFamilies ?? [])
  if (families.has(family)) fail(`'${family}' is both registered and reserved`);
pass("partition integrity: profiles cumulative, families and kinds registered, vectors correctly located");

// 2b. The minting family's intermediate and digest, re-derived (§4.5, §9.4).
//     A vector that records canonical bytes is claiming a specific
//     intermediate, and a claim nothing recomputes is decoration.
let mintingVectors = 0;
for (const vector of manifest.vectors) {
  if (vector.canonicalPayload === undefined) continue;
  mintingVectors += 1;
  const document = JSON.parse(readFileSync(join(here, vector.file), "utf8"));
  const canonical = canonicalSpecPayload(document.body.specPayload);
  if (canonical !== vector.canonicalPayload)
    fail(`${vector.id} canonical bytes\n  manifest: ${vector.canonicalPayload}\n  derived : ${canonical}`);
  const minted = "sha256:" + sha256Hex(Buffer.from(canonical, "utf8"));
  if (minted !== vector.digest) fail(`${vector.id} digest ${vector.digest} != minting ${minted}`);
  if (minted !== document.body.specHash)
    fail(`${vector.id}: the document's own specHash ${document.body.specHash} != minting ${minted}`);
}
if (mintingVectors === 0)
  fail("no vector records canonical bytes — the minting rule of §4.5 is enumerated but unexercised");
pass(`minting: ${mintingVectors} vectors' canonical bytes and digests re-derived independently of the emitter`);

// 3 + 4. Structure, and that rejects actually reject.
const REGISTERED_REFUSALS = new Set([
  "envelopeVersionMismatch",
  "unknownDocumentKind",
  "invalidSubmission",
  "invalidQuery",
  "unknownProvider",
  "budgetDenied",
  "gateFailed",
  "policyRefused",
  "scopeUnavailable",
  "forbidden",
  "notFound",
  "substrateUnavailable",
  "scoreRefused",
  "storageFailure",
  "unspecified",
]);

/** Structural violations of a whole document: envelope, then body. */
function structuralViolations(document) {
  const envelopeSchema = schemaPath("envelope");
  const bad = validate(document, loadSchema(envelopeSchema), envelopeSchema);
  if (bad.length > 0) return bad;

  const bodySchema = manifest.schemas[document.kind] && schemaPath(document.kind);
  if (!bodySchema) return [`kind '${document.kind}' has no registered body schema`];
  return validate(document.body, loadSchema(bodySchema), bodySchema, ".body").map((v) => v);
}

/** Rule violations — the things §5 requires that no schema can express. */
function ruleViolations(document) {
  const bad = [];
  const body = document.body;

  // §4.3 — an outcome's stated identity must equal a recomputation.
  const checkOutcome = (outcome, at) => {
    const recomputed = "sha256:" + sha256Hex(Buffer.from(canonicalCompositeKey(outcome.compositeKey), "utf8"));
    if (outcome.compositeKeyHash !== recomputed)
      bad.push(`${at}: compositeKeyHash ${outcome.compositeKeyHash} != recomputation ${recomputed}`);
  };
  if (document.kind === "fitOutcome") checkOutcome(body, ".body");
  if (document.kind === "outcomePage") body.outcomes.forEach((o, i) => checkOutcome(o, `.body.outcomes[${i}]`));

  // §4.2 rule 5 / §4.5 — a submission that NAMES the registered minting
  // rule must actually have minted under it. §4.2 rule 2 forbids every
  // party downstream from making this check, which is exactly why the
  // corpus is where it gets made.
  const checkMinting = (submission, at) => {
    if (submission.specHashAlgorithm !== REGISTERED_SPEC_HASH_ALGORITHM) return;
    let minted;
    try {
      minted = mintSpecHash(submission.specPayload);
    } catch {
      bad.push(`${at}: specPayload is outside '${REGISTERED_SPEC_HASH_ALGORITHM}''s domain, so it cannot have minted this hash`);
      return;
    }
    if (submission.specHash !== minted)
      bad.push(`${at}: specHash ${submission.specHash} != the minting ${minted} of its own specPayload`);
  };
  if (document.kind === "fitSubmission") checkMinting(body, ".body");
  if (document.kind === "fitSubmissionBatch")
    body.submissions.forEach((s, i) => checkMinting(s, `.body.submissions[${i}]`));

  // §5.6 — predictions may not land in the dataset they came from.
  if (document.kind === "scoreRequest" && body.outputDatasetId === body.input.datasetId)
    bad.push(".body: outputDatasetId equals input.datasetId");

  // §5.3 — accepted and rejected partition the submitted indices exactly.
  if (document.kind === "submissionReceipt") {
    const indices = [...body.accepted, ...body.rejected].map((i) => i.index).sort((a, b) => a - b);
    const expected = [...Array(body.itemCount).keys()];
    if (JSON.stringify(indices) !== JSON.stringify(expected))
      bad.push(`.body: accepted+rejected indices ${JSON.stringify(indices)} do not partition 0..${body.itemCount - 1}`);
  }

  // §5.7.1 — a refusal a v1 emitter produces names a registered class.
  // (An `accept` vector deliberately does not; the caller exempts it.)
  if (document.kind === "refusal" && !REGISTERED_REFUSALS.has(body.class))
    bad.push(`.body: refusal class '${body.class}' is not in the closed vocabulary`);

  return bad;
}

/** The composite key's canonical bytes, re-derived from a PARSED document
 *  — deliberately a second implementation of §3, independent of emit.mjs,
 *  so agreement between them is evidence rather than a shared bug. */
function canonicalCompositeKey(key) {
  const s = JSON.stringify;
  const contentRef = (c) =>
    c === null ? "null" : `{"format":${s(c.format)},"hash":${s(c.hash)},"rowCount":${c.rowCount === null ? "null" : s(c.rowCount)}}`;
  const vintage = (v) => `{"datasetId":${s(v.datasetId)},"version":${v.version},"contentRef":${contentRef(v.contentRef)}}`;
  return `{"specHash":${s(key.specHash)},"vintage":${vintage(key.vintage)},"seed":${s(key.seed)},"providerId":${s(key.providerId)},"providerVersion":${s(key.providerVersion)}}`;
}

for (const vector of manifest.vectors) {
  let document;
  try {
    document = JSON.parse(readFileSync(join(here, vector.file), "utf8"));
  } catch (error) {
    if (vector.kind === "reject") continue; // unparseable is a valid refusal
    fail(`${vector.id}: ${error.message}`);
    continue;
  }

  const structural = structuralViolations(document);
  const rules = vector.kind === "accept" ? [] : ruleViolations(document);

  if (vector.kind === "reject") {
    const caught = vector.detect === "schema" ? structural : rules;
    const other = vector.detect === "schema" ? rules : structural;
    if (caught.length === 0)
      fail(`${vector.id} is a reject vector that ${vector.detect} validation ACCEPTED — the check is not happening`);
    if (vector.detect === "rule" && structural.length > 0)
      fail(`${vector.id} claims detect:"rule" but the schema already rejects it — mislabelled, and the rule is untested`);
    void other;
  } else if (structural.length > 0 || rules.length > 0) {
    fail(`${vector.id}\n  ${[...structural, ...rules].join("\n  ")}`);
  }
}
pass("structure and rules: every accepted vector validates, every reject vector is caught by the means it declares");

// 5. Self-test — prove each layer goes red (§9.3).
if (selfTest) {
  const outcome = JSON.parse(readFileSync(join(here, "fit-outcome/outcome.json"), "utf8"));
  const probes = [
    [
      "a missing required member",
      () => structuralViolations({ envelopeVersion: 1, kind: "vintageRef" }).length > 0,
    ],
    [
      "an unexpected member",
      () =>
        structuralViolations({ envelopeVersion: 1, kind: "vintageRef", body: { datasetId: "d", version: 1, contentRef: null }, extra: 1 })
          .length > 0,
    ],
    [
      "a 64-bit integer without its sign prefix",
      () => {
        const mutated = structuredClone(outcome);
        mutated.body.compositeKey.seed = "20260720";
        return structuralViolations(mutated).length > 0;
      },
    ],
    [
      "a bare hex string where a content address is declared",
      () => {
        const mutated = structuredClone(outcome);
        mutated.body.compositeKeyHash = "4c12ef9952b7c0b39deca890926521a046c22871ae6fe01021a5faebfa28ec39";
        return structuralViolations(mutated).length > 0;
      },
    ],
    [
      "a composite-key hash that does not match its own key",
      () => {
        const mutated = structuredClone(outcome);
        mutated.body.compositeKey.providerVersion = "9.9.9";
        return ruleViolations(mutated).length > 0;
      },
    ],
    [
      "a specHash minted over the payload as rendered rather than canonicalised",
      () => {
        const rendered = '{ "b": 1, "a": 2 }';
        return (
          ruleViolations({
            kind: "fitSubmission",
            body: {
              specPayload: rendered,
              specHash: "sha256:" + sha256Hex(Buffer.from(rendered, "utf8")),
              specHashAlgorithm: REGISTERED_SPEC_HASH_ALGORITHM,
            },
          }).length > 0
        );
      },
    ],
    [
      "one badly-minted submission inside an otherwise sound batch",
      () => {
        const sound = JSON.parse(readFileSync(join(here, "spec-hash/canonical-form.json"), "utf8")).body;
        return (
          ruleViolations({
            kind: "fitSubmissionBatch",
            body: { batchId: "b", submissions: [sound, { ...sound, specPayload: '{"a":1}' }] },
          }).length > 0
        );
      },
    ],
    [
      "an unregistered refusal class on a non-accept vector",
      () => ruleViolations({ kind: "refusal", body: { class: "notAClass" } }).length > 0,
    ],
    [
      "a receipt whose lists do not partition its indices",
      () =>
        ruleViolations({
          kind: "submissionReceipt",
          body: { batchId: "b", itemCount: 3, accepted: [{ index: 0, jobId: "j" }], rejected: [] },
        }).length > 0,
    ],
    [
      "predictions landing in the dataset they came from",
      () =>
        ruleViolations({
          kind: "scoreRequest",
          body: { artifactKeyHash: "sha256:" + "0".repeat(64), input: { datasetId: "d", version: 1, contentRef: null }, outputDatasetId: "d" },
        }).length > 0,
    ],
    [
      "a schema keyword this validator does not implement",
      () => {
        const before = failures;
        const report = console.error;
        console.error = () => {}; // the probe's own FAIL line is expected, not news
        auditKeywords({ type: "string", format: "email" }, "", "<probe>");
        console.error = report;
        const detected = failures > before;
        failures = before;
        return detected;
      },
    ],
  ];

  for (const [name, detected] of probes) {
    if (detected()) console.log(`ok   self-test detects ${name}`);
    else fail(`self-test: NOT detected — ${name}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} corpus defect(s).`);
  process.exit(1);
} else if (checks === 0) {
  console.error("no checks ran");
  process.exit(1);
} else {
  console.log(
    `\n${manifest.vectors.length} vectors validated across ${manifest.families.length} families and ${Object.keys(manifest.profiles).length} profiles (${relative(here, resolve(here, "../schemas/v1"))}).`,
  );
}
