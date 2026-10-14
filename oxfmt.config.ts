import type { OxfmtConfig } from "oxfmt";
import base from "@aranlucas/oxforge/format-tailwind";

const config: OxfmtConfig = {
  ...base,
  sortTailwindcss: { ...base.sortTailwindcss, stylesheet: "views/styles.css" },
};

export default config;
