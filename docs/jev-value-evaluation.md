# Product selection decision

`shop_for_items` returns eligible candidates for the calling assistant to choose; it makes no server-side model calls or list/cart writes. JEV selection and its live runners were removed. Keeping search read-only leaves product decisions with the assistant that has the shopper's requirements and separates discovery from approved mutations.

The September 2026 selector experiments do **not** establish that caller selection is more accurate than JEV. They used 42 synthetic labeled challenge cases, repeated candidate orders and unrelated filler products. The ideal-retrieval control showed JEV's net benefit came from abstention on unsuitable/ambiguous requests; it also missed a valid match. A standalone GPT-5.4 Mini selection call did not outperform JEV. This was not an end-to-end shopping comparison or representative Kroger traffic.

Preserve the useful matching policy regardless of selector: missing dietary evidence is unknown, ambiguity needs review, and more candidates do not inherently improve relevance. One invalid selector answer blocked a whole ten-item batch in the expanded experiment; validate decisions without silently converting unresolved items into purchases.

The generated reports preserve inputs, labels, source snapshots/hashes, outputs and measurement limitations:

- JEV: [compact](jev-evaluation-comparison-compact.json), [ideal-retrieval control](jev-evaluation-comparison-ranked.json), [expanded stress](jev-evaluation-comparison-expanded.json).
- Caller-model comparison: [compact](jev-evaluation-comparison-compact-agent.json), [expanded stress](jev-evaluation-comparison-expanded-agent.json).

Any future selector decision needs the same representative retrieval inputs and independent labels for each alternative, with wrong accepted choices, abstention and whole-list failures reported separately. These historical datasets cannot establish production accuracy or current model rankings.
