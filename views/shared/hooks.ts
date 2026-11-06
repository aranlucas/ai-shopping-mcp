import { type Dispatch, type SetStateAction, useState } from "react";

type ResettableState<T> = [T, Dispatch<SetStateAction<T>>];

/**
 * Render-phase reset avoids a stale frame after upstream data changes.
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 */
export function useResettableState<S, T>(source: S, derive: (source: S) => T): ResettableState<T> {
  const [value, setValue] = useState<T>(() => derive(source));
  const [seenSource, setSeenSource] = useState(source);

  if (!Object.is(source, seenSource)) {
    setSeenSource(source);
    setValue(derive(source));
  }

  return [value, setValue];
}
