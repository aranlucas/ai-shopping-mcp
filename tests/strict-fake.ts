/** A callable member; the adapter only binds it, never manufactures its arguments or result. */
type Method = (...args: never[]) => void;

function isMethod(value: unknown): value is Method {
  return typeof value === "function";
}

interface FakeOptions {
  nonThenable?: boolean;
}

/** Fail closed when a test reaches a runtime capability it has not implemented. */
export function strictFake<T extends object>(
  members: Partial<T>,
  options: FakeOptions = {},
): T {
  const methods = new WeakMap<Method, Method>();

  const proxy = new Proxy(members, {
    get(target, key) {
      let descriptor: PropertyDescriptor | undefined;

      for (
        let owner = target;
        owner !== null && !descriptor;
        owner = Object.getPrototypeOf(owner)
      ) {
        descriptor = Object.getOwnPropertyDescriptor(owner, key);
      }

      // Promise resolution probes every returned object for a then method; an ordinary non-thenable must report its absence.
      if (!descriptor && key === "then" && options.nonThenable)
        return undefined;

      if (!descriptor)
        throw new Error(`Unimplemented fake member: ${String(key)}`);

      const value = descriptor.get
        ? descriptor.get.call(target)
        : descriptor.value;

      if (value === undefined)
        throw new Error(`Unimplemented fake member: ${String(key)}`);

      if (!isMethod(value) || key === "constructor") return value;
      let method = methods.get(value);

      if (!method) {
        method = value.bind(target);
        methods.set(value, method);
      }

      return method;
    },
  });

  // SAFETY: Partial<T> checks every supplied member's contract. The get trap returns an existing typed member (binding methods to its owner) or throws; missing members never become fabricated values.
  return proxy as T;
}
