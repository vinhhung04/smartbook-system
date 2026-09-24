# Annotation guide — Book Metadata Intelligence

One row is one **edition**, not one work. Use a stable `editionId`; editions of the same work share `workGroup` and must stay in the same split.

Record each source as a frozen JSON/HTML/text payload. Never relabel a changing live page during evaluation. `editionGold.fields.<field>.status` is one of:

- `known`: the adjudicated edition value; provide `value`.
- `absent`: the edition is known not to have that field.
- `unknown`: no trustworthy answer; excluded from accuracy.
- `not_applicable`: excluded from accuracy.

Document gold is stored in the source payload plus annotation notes: quote/block and role for every factual field. A quote that contains a name but labels it as translator does not support `authors`; a distributor does not support `publisher`.

Gold values preserve source precision. `2020` is year-only, and must not be annotated as `2020-01-01`. ISBN gold is canonical ISBN-13. Authors and translators are ordered display lists, but scoring also reports set precision/recall so extra persons are errors.

Protocol: collect 120 editions (60 Vietnamese, 60 international), split 40 development / 80 held-out test by work group. Annotator two independently labels at least 24 stratified editions; adjudicate every disagreement. Pilot 12 editions first and record agreement before freezing the final manifest.
