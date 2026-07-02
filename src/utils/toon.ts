import { encode } from "@toon-format/toon";

/**
 * Encodes data as a TOON MCP resource. Used only by read-only resources
 * (`src/tools/resources.ts`) — tool `content[0].text` uses the markdown
 * formatters in `src/utils/format-response.ts` instead, since small models
 * can't reliably parse TOON.
 */
export function toonResource(uri: string, data: unknown) {
  return {
    contents: [{ type: "text" as const, uri, mimeType: "text/toon", text: encode(data) }],
  };
}
