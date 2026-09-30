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
  readonly recordedAt?: string;
  readonly tabId?: number;
  readonly sessionId?: string;
  readonly action?: string;
};

export type NoticeContext = Pick<Notice, "tabId" | "sessionId" | "action">;

export type AddNotice = (
  status: Notice["status"],
  text: string,
  details?: string,
  context?: NoticeContext
) => void;

export type RefreshWorkspace = (tabId: number) => Promise<void>;

export interface OperationState {
  readonly busyAction?: string;
  readonly begin: (action: string) => void;
  readonly finish: () => void;
}
