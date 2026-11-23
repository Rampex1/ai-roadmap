import { useEffect, useState } from 'react';
import { progress, type State } from '@/lib/progress';

/** Subscribe a React island to the shared progress store. */
export function useProgress(): [State, ReturnType<typeof progress>] {
  const store = progress();
  const [state, setState] = useState(store.get());
  useEffect(() => store.subscribe(setState), [store]);
  return [state, store];
}
