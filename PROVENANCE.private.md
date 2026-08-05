# Private-side provenance — NOT PART OF THE SPECIFICATION

**This file does not travel.** It is the one artefact in this directory that names private-estate
context, and it is **deleted at any public cut** — it exists so that the cross-references the estate
needs live somewhere other than in the specification, whose Appendix B deliberately cites no private
planning artefact.

Everything else here (`MODEL_EXECUTION_WIRE.md`, `schemas/`, `wire-fixtures/`, `README.md`,
`run.ps1`, `LICENSE`, `NOTICE`) is authored to public-publication standard and moves unchanged.
Confirm that with the neutrality sweep before any cut:

```powershell
Get-ChildItem -Recurse -File |
    Where-Object { $_.FullName -notmatch 'LICENSE|NOTICE|PROVENANCE' } |
    Select-String -Pattern 'toolup|forge|fuaran|mmm|diametrical|roadmap|orchestrat|cookbook' -CaseSensitive:$false
```

_(`Select-String` has no `-Recurse`; the earlier form of this command errored rather than sweeping,
which is the worst way for a check to be wrong — it looks like it ran. Verified clean at `fuaran#635`.)_

## Where this came from

| | |
|---|---|
| **Design plan** | `Diametrical/application-plans/model-execution-interface.md` — the two-layer cut. This directory is **Layer 1**. |
| **Roadmap phase** | `fuaran#634` (the spec home) · `fuaran#635` (the minting rule §4.5 + the `spec-hash` family) |
| **Pattern precedent** | `fuaran#595` + `Fuaran/Fuaran-UI/wire-format-fixtures/` — spec + schemas + executable corpus + an independent emitter in one citable home. |

## Which locked decision landed where

| Decision | Where it is in the specification |
|---|---|
| D1 — language-neutral, versioned, estate-sovereign wire spec | the whole document; §5.1 for the envelope |
| D3 — the rendered projection crosses opaque; the executor never sees structure | §3.1 rule 13, §5.3 `specPayload`, §6.1 |
| D4 — the composite key is the join; `specHash` minted over canonical bytes | §4.2 (contract), §4.3 (the key), §4.5 (the minting rule) |
| D5 — `submitterClass` on the wire from v1 | §5.3, §7.6 |
| D6 — refusals are typed, enumerable data | §5.7 and its extension rule §5.7.2 |
| D7 — outcome snapshots are self-contained; no live query in an analysis path | §6.4 |
| D8 — assembly authoring does not cross | §1 out-of-scope, §5.2 ("referenced, never constructed") |
| D11 — batch and pagination from v1; single-item is the degenerate case | §5.3, §5.5, Appendix B |
| D12 — spec-home sequencing follows the federation precedent | this directory's existence; the cut itself is an operator step (below) |

## Deliberate deviations from the phase's letter

- **No vendor format identifier is enumerated in §7.2.** The phase text names one as a seed registry
  entry; enumerating a real product's container in a language-neutral specification would privilege
  an implementation the document is otherwise written not to name, and the OSS-boundary sweep is an
  explicit acceptance criterion of the same phase. §7.2 instead specifies the **registration
  procedure** for a vendor format (`{vendor}-{name}-v{n}`) with a fictional worked example, seeds the
  registry with the open formats, and states that an unregistered identifier is not an error. A
  certifying implementation registers its own identifier at certification time.
- **The `specHash` canonicalisation was reserved by `fuaran#634` and specified by `fuaran#635`**
  (§4.5, registered in §7.4 as `canonical-json-sha256-v1`; `reservedFamilies` is now empty and the
  `spec-hash` family is registered). The reservation mechanism worked exactly as intended — the
  family enumerated rather than renumbered — which is the argument for using it again on the next
  extension rather than leaving a gap.

## `fuaran#635` — decisions taken at implementation

- **§4.5 sits after §4.4, not beside §4.2 where it belongs by subject.** Inserting it as a new §4.3
  would have renumbered `compositeKeyHash`, which is cited by section number in the schemas, the
  corpus descriptions and the design plan. The specification's own §8/§9.4 ethic — enumerate, never
  renumber — applied to itself.
- **The family's vectors are `fitSubmission` documents, not a new document kind.** Minting only ever
  happens inside a submission, and §5.1 admits no bare-body form, so a family of naked
  payload/hash pairs would have certified something no participant can send. It also means the
  family added no registry entry, no schema and no envelope change.
- **The rejection is a SUBMITTER's obligation** (`submission-spec-hash-non-canonical`), the only one
  in the corpus that is not an executor's. §4.2 rule 2 forbids the executor from checking it, so it
  could not have been an executor's; §2 gained a paragraph saying so, because "reject vectors carry
  `profile: executor`" had been stated as a flat rule.
- **Every existing submission fixture moved to the registered algorithm**, which cascaded through
  `specHash` → `compositeKey` → `compositeKeyHash` → the outcome, page, score and `notFound`
  vectors. No digest in the corpus is now a constant the emitter was handed. The hand-authored
  `fit-submission/reject-*` vectors were deliberately left on `unregistered-submitter-rule-v0`:
  they keep demonstrating that §7.4's open path is legal, and the new minting rule only bites where
  a document *claims* a registered algorithm.
- **`emit.mjs --write` now also refreshes the index's derived fields.** The cascade above moves
  ~20 digests at once, and the previous ritual ("update manifest.json's digests, then re-run") is
  the step that goes wrong. The verification pass still recomputes everything independently, so a
  rewrite is not self-certifying.
- **Deferred: the F# and TypeScript minting helpers** (the phase's tasks 3–5, its
  `fuaran-dotnet` / `fuaran-ts` key files). Two reasons, both worth re-reading before someone
  files them again as written. First, this corpus is a tracked folder in a private workspace repo
  with no remote (operator step 2 below), and both those tiers are OSS-public with CI that cannot
  check it out — a fixture-driven gate there would either break their build or be written to skip
  when the corpus is absent, which is the "passes by doing nothing" shape §9.3 exists to forbid.
  Second, the phase names `Fuaran.UI.JsonEncode` (a project that does not exist) inside the UI
  language tier, and a model-execution minting helper does not belong in the UI domain's public
  surface at all; the model-manager substrate is the plausible home. The two-host agreement the
  phase asks for is meanwhile discharged *within* this corpus, by two independent implementations
  of §4.5 that agree vector-for-vector — which is the same evidence in a smaller box.

## Operator steps this phase deliberately did not take

1. **Confirm the home and the name.** The directory sits beside `wire-format-fixtures/` in the
   Fuaran-UI sub-estate because that is where the estate's other spec home lives and where
   `fuaran#635`'s sibling key files resolve. Moving it is a `git mv`; nothing references it by path
   yet.
2. **Cut it public, or fold it into an existing spec home.** No remote was created and nothing was
   published. At cut: add `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` (the Fuaran-Core
   cut-prep boilerplate), delete this file, run the sweep above, and update `LICENSING.md` +
   `init.ps1` + the estate hub tables.
3. **Decide on a certified-implementations registry.** Per the 595 precedent, default to omitting
   it: naming a certified implementation inside the spec home is a positioning act, not a technical
   one.
