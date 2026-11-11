# Product selection decision

`shop_for_items` returns eligible candidates for the calling assistant to choose; it makes no server-side model calls or list/cart writes. JEV selection and its live runners were removed. Keeping search read-only leaves product decisions with the assistant that has the shopper's requirements and separates discovery from approved mutations.

The September 2026 selector experiments do **not** establish that caller selection is more accurate than JEV. They used 42 synthetic labeled challenge cases, repeated candidate orders and unrelated filler products. The ideal-retrieval control showed JEV's net benefit came from abstention on unsuitable/ambiguous requests; it also missed a valid match. A standalone GPT-5.4 Mini selection call did not outperform JEV. This was not an end-to-end shopping comparison or representative Kroger traffic.

Preserve the useful matching policy regardless of selector: missing dietary evidence is unknown, ambiguity needs review, and more candidates do not inherently improve relevance. One invalid selector answer blocked a whole ten-item batch in the expanded experiment; validate decisions without silently converting unresolved items into purchases.

The generated reports, kept in git history rather than the working tree, preserve inputs, labels, source snapshots/hashes, outputs and measurement limitations:

- JEV: [compact](https://github.com/aranlucas/ai-shopping-mcp/blob/5c5547297d3cfa75f410857edc98f1db8047c46b/docs/jev-evaluation-comparison-compact.json), [ideal-retrieval control](https://github.com/aranlucas/ai-shopping-mcp/blob/5c5547297d3cfa75f410857edc98f1db8047c46b/docs/jev-evaluation-comparison-ranked.json), [expanded stress](https://github.com/aranlucas/ai-shopping-mcp/blob/5c5547297d3cfa75f410857edc98f1db8047c46b/docs/jev-evaluation-comparison-expanded.json).
- Caller-model comparison: [compact](https://github.com/aranlucas/ai-shopping-mcp/blob/5c5547297d3cfa75f410857edc98f1db8047c46b/docs/jev-evaluation-comparison-compact-agent.json), [expanded stress](https://github.com/aranlucas/ai-shopping-mcp/blob/5c5547297d3cfa75f410857edc98f1db8047c46b/docs/jev-evaluation-comparison-expanded-agent.json).

Any future selector decision needs the same representative retrieval inputs and independent labels for each alternative, with wrong accepted choices, abstention and whole-list failures reported separately. These historical datasets cannot establish production accuracy or current model rankings.
