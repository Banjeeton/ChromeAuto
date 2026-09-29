import { useCallback, useMemo, useState } from "react";

import type { OperationState } from "../types";

export function useOperationState(): OperationState {
  const [busyAction, setBusyAction] = useState<string>();
  const begin = useCallback((action: string) => setBusyAction(action), []);
  const finish = useCallback(() => setBusyAction(undefined), []);

  return useMemo(
    () => ({ busyAction, begin, finish }),
    [begin, busyAction, finish]
  );
}
