export type ActiveTab = {
  readonly id: number;
  readonly title: string;
  readonly url?: string;
};

export type Notice = {
  readonly id: number;
  readonly status: "error" | "success";
  readonly text: string;
  readonly details?: string;
};

export type AddNotice = (
  status: Notice["status"],
  text: string,
  details?: string
) => void;

export type RefreshWorkspace = (tabId: number) => Promise<void>;

export interface OperationState {
  readonly busyAction?: string;
  readonly begin: (action: string) => void;
  readonly finish: () => void;
}
