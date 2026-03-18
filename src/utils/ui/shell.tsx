import type { ReactNode } from "react";
import { ACTION_SCRIPT, BASE_STYLES } from "./styles.js";

/** Wraps component tree in a full HTML document with shared styles and action scripts. */
export function Shell({
  children,
  extraStyles,
}: {
  children: ReactNode;
  extraStyles?: string;
}) {
  return (
    // biome-ignore lint/a11y/useHtmlLang: server-rendered static HTML for MCP UI iframe
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: injecting our own static CSS
          dangerouslySetInnerHTML={{
            __html: BASE_STYLES + (extraStyles ?? ""),
          }}
        />
      </head>
      <body>
        {children}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: injecting our own static action scripts
          dangerouslySetInnerHTML={{ __html: ACTION_SCRIPT }}
        />
      </body>
    </html>
  );
}
