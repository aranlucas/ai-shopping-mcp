After making changes, run `pnpm lint` and fix all errors.

The views use `@shadcn/lint` in `.oxlintrc.json`. Use component variants and
badge tones for appearance; keep `className` for layout. The config documents
the spacing, carousel gutter, and skeleton rounding contracts. Shared UI
implementations in `views/shared/ui/` own their styles and retain their existing
lint exclusion. Tailwind utility checks remain in `.oxlintrc.tailwind.json`.
