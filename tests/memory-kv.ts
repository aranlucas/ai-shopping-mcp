import { z } from "zod";

type JsonValue = z.infer<ReturnType<typeof z.json>>;

class MemoryKv {
  readonly expirations = new Map<string, number | undefined>();
  constructor(readonly store = new Map<string, string>()) {}
  get(
    key: string,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<string | null>;
  get(key: string, type: "text"): Promise<string | null>;
  get<ExpectedValue = JsonValue>(
    key: string,
    type: "json",
  ): Promise<ExpectedValue | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  get(key: string, type: "stream"): Promise<ReadableStream | null>;
  get(
    key: string,
    options?: KVNamespaceGetOptions<"text">,
  ): Promise<string | null>;
  get<ExpectedValue = JsonValue>(
    key: string,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<ExpectedValue | null>;
  get(
    key: string,
    options?: KVNamespaceGetOptions<"arrayBuffer">,
  ): Promise<ArrayBuffer | null>;
  get(
    key: string,
    options?: KVNamespaceGetOptions<"stream">,
  ): Promise<ReadableStream | null>;
  get(key: Array<string>, type: "text"): Promise<Map<string, string | null>>;
  get<ExpectedValue = JsonValue>(
    key: Array<string>,
    type: "json",
  ): Promise<Map<string, ExpectedValue | null>>;
  get(
    key: Array<string>,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<Map<string, string | null>>;
  get(
    key: Array<string>,
    options?: KVNamespaceGetOptions<"text">,
  ): Promise<Map<string, string | null>>;
  get<ExpectedValue = JsonValue>(
    key: Array<string>,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<Map<string, ExpectedValue | null>>;
  async get<T = JsonValue>(
    key: string | string[],
    options?:
      | Partial<
          KVNamespaceGetOptions<
            undefined | "text" | "json" | "arrayBuffer" | "stream"
          >
        >
      | "json"
      | "text"
      | "arrayBuffer"
      | "stream",
  ): Promise<
    | string
    | T
    | ArrayBuffer
    | ReadableStream
    | null
    | Map<string, string | T | null>
  > {
    const kind = z.string().safeParse(options);

    const format = kind.success
      ? kind.data
      : z.object({ type: z.string().optional() }).parse(options ?? {}).type;

    const read = (name: string) => {
      const value = this.store.get(name);
      const expiration = this.expirations.get(name);

      return value === undefined ||
        (expiration && expiration <= Date.now() / 1000)
        ? null
        : value;
    };

    const json = (value: string | null): T | null => {
      if (value === null) return null;

      // SAFETY: KV's generic JSON overload delegates the serialized value contract to its caller, exactly as JSON.parse does; this fake does not claim schema validation.
      return JSON.parse(value) as T;
    };

    if (Array.isArray(key)) {
      if (format !== undefined && format !== "text" && format !== "json")
        throw new Error("Unsupported multi-key KV format");

      return new Map(
        key.map((name) => [
          name,
          format === "json" ? json(read(name)) : read(name),
        ]),
      );
    }

    const value = read(key);

    if (value === null) return null;

    if (format === "json") return json(value);

    if (format === "arrayBuffer") return new Response(value).arrayBuffer();

    if (format === "stream") {
      const stream = new Response(value).body;

      if (!stream) throw new Error("Text response unexpectedly has no body");

      return stream;
    }

    return value;
  }
  async put(
    key: string,
    input: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: KVNamespacePutOptions,
  ): Promise<void> {
    if (options?.metadata !== undefined)
      throw new Error("KV metadata is not configured in this test");
    const value = await new Response(input).text();
    this.store.set(key, value);
    this.expirations.set(
      key,
      options?.expiration ??
        (options?.expirationTtl
          ? Date.now() / 1000 + options.expirationTtl
          : undefined),
    );
  }
  getWithMetadata(): never {
    throw new Error("KV metadata is not configured in this test");
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.expirations.delete(key);
  }
  async list<Metadata = JsonValue>(
    options: KVNamespaceListOptions = {},
  ): Promise<KVNamespaceListResult<Metadata>> {
    const names = [...this.store.keys()]
      .filter((name) => name.startsWith(options.prefix ?? ""))
      .filter((name) => {
        const expiration = this.expirations.get(name);

        return !expiration || expiration > Date.now() / 1000;
      })
      .toSorted();

    const offset = Number(options.cursor ?? 0);
    const limit = options.limit ?? 1000;

    return {
      keys: names.slice(offset, offset + limit).map((name) => ({ name })),
      list_complete: offset + limit >= names.length,
      cacheStatus: null,
      cursor: offset + limit >= names.length ? "" : String(offset + limit),
    };
  }
}

export function memoryKv(store = new Map<string, string>()): KVNamespace {
  return new MemoryKv(store);
}
