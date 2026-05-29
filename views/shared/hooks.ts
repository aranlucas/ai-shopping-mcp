import { type Dispatch, type SetStateAction, useState } from "react";

/**
 * State that is seeded from `source` but can be overridden locally, and that
 * re-seeds whenever `source` changes identity (compared with `Object.is`).
 *
 * This is React's recommended render-phase alternative to an Effect that
 * re-synchronizes state when a prop/value changes — it adjusts during render
 * instead of after paint, so there's no extra render and no stale flash:
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 *
 * Use it for "derived but editable" state: values computed from upstream data
 * that the user (or child components) may mutate locally, yet which should
 * reset when fresh upstream data arrives.
 *
 * @param source  Upstream value the state is derived from.
 * @param derive  Pure function mapping `source` to the initial/reset state.
 * @returns A `[state, setState]` tuple, exactly like `useState`.
 *
 * @example
 * const [data, setData] = useResettableState(toolResult, (r) =>
 *   parseStructuredContent(r?.structuredContent),
 * );
 */
export function useResettableState<S, T>(
  source: S,
  derive: (source: S) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => derive(source));
  const [seenSource, setSeenSource] = useState(source);

  if (!Object.is(source, seenSource)) {
    setSeenSource(source);
    setValue(derive(source));
  }

  return [value, setValue];
}
