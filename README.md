# Model-execution wire specification

A language-neutral, versioned wire specification for **model execution**: how a party that decides
*what to fit* and a party that *runs the fit* exchange work without either seeing inside the other.
Six shape families, a canonical encoding, one identity rule that joins two independent records of
the same fit, and an executable conformance corpus.

```
MODEL_EXECUTION_WIRE.md   the specification. §1–§9 are normative.
schemas/v1/               one JSON Schema per document kind — structural, subordinate to §5.
wire-fixtures/            the conformance corpus. manifest.json is the authoritative enumeration.
run.ps1                   verify the corpus: independent emitter, schema and rule checks, self-tests.
LICENSE / NOTICE          Apache-2.0.
```

## Start here

- Implementing? Read §2 (pick a profile), §3 (canonical encoding — this is where the cost is), §4
  (identity), then your profile's families in §5. Appendix A is the checklist, ordered by how often
  each item is the thing that is wrong.
- Certifying? [`wire-fixtures/README.md`](wire-fixtures/README.md).
- Wondering why a shape is the way it is? Appendix B, which is non-normative.

## Verify

```powershell
pwsh ./run.ps1
```

Requires Node.js and PowerShell 7; nothing else, and no build step. The corpus verifies itself three
ways: an independent emitter reproduces every document byte-for-byte, a schema and rule pass checks
what the bytes cannot, and both checkers prove they go red on a mutation.

## Status

**Version 1.** The specification is self-contained: §1–§9 and Appendix A reference nothing outside
this directory, name no implementation, no product and no language, and carry no vendor identifiers.

Two things are deliberately incomplete and are marked as such in the text rather than left to be
discovered:

- **The `specHash` minting canonicalisation** (§4.2). Its *contract* is normative — submitter-minted,
  opaque to the executor, algorithm-pinned. The byte-level rule for computing it, and its
  `spec-hash/` fixture family, are reserved as an additive extension. `manifest.json` reserves the
  family name so that adding it enumerates rather than renumbers.
- **`specHashAlgorithm` has no registered value yet** (§7.4). Until the rule above lands, a
  submitter emits its own identifier and interoperates only with submitters that share it.

Nothing else is deferred: every other shape, encoding rule, registry and refusal class is specified
and certifiable today.

## Contributing changes

A change to any specified field, ordering, encoding or digest updates **the specification, the
schemas, the emitter and the corpus in the same commit** (§9.5). Run `pwsh ./run.ps1` before
committing; a corpus that lags its emitter certifies nothing.
