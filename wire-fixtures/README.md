# Model-execution conformance corpus

The executable half of [`../MODEL_EXECUTION_WIRE.md`](../MODEL_EXECUTION_WIRE.md). An
implementation in any language certifies against a named conformance profile by running the vectors
this corpus lists for it.

## Layout

```
manifest.json            the authoritative enumeration: families, the reserved family, the
                         profile partition, the kind → schema map, and every vector with its
                         kind and digest
emit.mjs                 an independent, dependency-free emitter (see below)
validate.mjs             index, schema and rule checks — the layer beneath the byte comparison
envelope/                the versioned wrapper and its negotiation failures
vintage-ref/             which exact body of data a fit is about
fit-submission/          what was asked for, and what came back before anything ran
fit-outcome/             what came out, and the identity that names it forever
registry-query/          asking for many outcomes, a deterministic page at a time
score-request/           applying a registered artifact to new data
refusal/                 one document per refusal class, plus the forward-compatibility vector
spec-hash/               the minting rule: payload → canonical bytes → hash, and the one way
                         of getting it wrong that nothing downstream can detect
```

**Counts are not written here.** `manifest.json` is the enumeration; a number in prose drifts from
the directory beside it, and the manifest cannot.

## Reading a fixture

**A fixture file's bytes are the document.** No trailing newline, no framing, no wrapper — so the
`sha256` the manifest records is a digest of the file itself, with no convention to interpret first.
The documents are canonical JSON per §3 of the specification: minified, record members in
declaration order, map keys sorted, optionals present as `null`, 64-bit integers as sign-prefixed
strings.

**Every fixture is a complete envelope.** There are no bare bodies, because there is no bare-body
form on the wire (§5.1): a corpus of unversioned bodies would certify something an implementation
cannot actually send.

`manifest.json` is the exception: it is a hand-formatted index for humans, LF-terminated, and is not
itself a specified wire shape.

## Certifying

1. Pick a profile — `observer`, `submitter` or `executor` — and read the families `manifest.json`
   maps it to.
2. For every vector in those families, do what its `kind` says:
   - `round-trip` — decode and re-encode; the bytes must be identical.
   - `hash` — round-trip, **and** reproduce the manifest's `digest` by recomputation. Which
     recomputation depends on the family, and §9.4 is the table that says: in `fit-outcome` the
     digest is a composite-key content address (§4.3), recomputed from the document's own
     `compositeKey`; in `spec-hash` it is a minted `specHash` (§4.5), recomputed from the
     document's own `specPayload`. Between them they are the numbers two parties sharing no type
     must independently agree on.
   - `reject` — your reader must refuse it, with the reject class the manifest names.
   - `accept` — your reader must **not** refuse it, and must interpret it as the manifest's
     `interpretation` states. These are the forward-compatibility vectors.
3. Report the profile. A conformance claim without one is unfalsifiable.

Certifying a subset is not certifying. Assert that the number of vectors you ran equals the number
the manifest enumerates, and prove once that a mutated fixture makes your harness go red — a
conformance suite is exactly the kind of code that passes by doing nothing.

## Running the corpus's own checks

```powershell
pwsh ../run.ps1              # everything, including both self-tests
```

or directly:

```
node emit.mjs                # byte-compare every round-trip and hash document
node emit.mjs --write        # rewrite them after a deliberate spec change
node emit.mjs --self-test    # prove the emitter goes red
node validate.mjs            # index, schema and rule checks
node validate.mjs --self-test
```

## The independent emitter

`emit.mjs` is written against the specification alone and reproduces every round-trip and hash
document from unsorted, unstamped input models by applying the ordering, encoding and identity rules
as stated. It exists because one emitter cannot tell the protocol from its own accidents — whatever
it does becomes "the format" by default. **A divergence between an independent emitter and the
committed corpus is a specification defect**, not a bug in either.

It deliberately does not emit the `reject` or `accept` vectors: those are documents an
implementation must *refuse* or *tolerate*, so reproducing their bytes would prove nothing about
either.

`validate.mjs` re-derives the composite key's canonical bytes **a second time**, from the parsed
document rather than from the emitter's input model, and re-derives the minting canonicalisation of
§4.5 a second time as well — in a different construction, letting the host's own JSON serialiser
apply the escaping and number rules that emit.mjs writes by hand. The derivations are independent, so
their agreement on every vector is evidence about §3 and §4.5 rather than a shared assumption.

## What `canonicalPayload` means

A `spec-hash` vector carries the intermediate of §4.5 step 2 — the bytes the payload canonicalises
to, before they are hashed. It is written out so that an implementation minting the wrong digest can
see **where** it diverged rather than only that it did, and it is derived rather than authoritative:
the rule is authoritative, and both scripts recompute the field rather than trusting it.

Two vectors carry the same `canonicalPayload` and `digest` while differing in their own `sha256` —
one specification, two authoring orders, one identity. An implementation that reproduces every other
vector but not that pair has a canonicalisation that depends on authoring order, which is the exact
failure the family exists to catch.

## What `detect` means on a reject vector

`"detect": "schema"` — the document violates a structural rule a JSON Schema can express, and
`validate.mjs` requires the schema layer to catch it.
`"detect": "rule"` — the document is schema-valid and is caught only by a rule from §5.
`validate.mjs` requires the rule layer to catch it *and* requires the schema layer **not** to, so a
mislabelled vector cannot leave its rule untested.

## Regenerating

The corpus is emitted from running code and is never hand-edited (the `reject` and `accept` vectors
excepted — nothing emits those). A change to any specified field, ordering, encoding or digest
updates the specification, the schemas, the emitter and this corpus **in the same commit** — see
§9.5.

`node emit.mjs --write` rewrites the documents **and** refreshes the index's derived fields — every
vector's `sha256`, and each hash vector's `digest` and `canonicalPayload` — because a specification
change moves them all at once and hand-transcribing them is the step that goes wrong. Nothing there
is a judgement: every value it writes is recomputed and re-checked on the ordinary run, by the
emitter against its own output and by `validate.mjs` against the bytes on disk. Read the diff before
committing.
