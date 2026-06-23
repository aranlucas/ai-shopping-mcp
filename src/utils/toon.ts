import { encode } from "@toon-format/toon";

export function toonResource(uri: string, data: unknown) {
  return {
    contents: [{ type: "text" as const, uri, mimeType: "text/toon", text: encode(data) }],
  };
}

export function toonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: encode(data) }],
  };
}
