import type { RecorderLogEntry } from "../../../core/domain/recorder-log-entry";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import type { Notice } from "../../types";
import { formatStepLogDetails } from "../logs/step-log-format";

export type RunLogFilter = "all" | "success" | "warning" | "error";
export type RunLogSeverity = Exclude<RunLogFilter, "all">;
export type RunLogSource = "automation" | "repeat" | "recorder" | "interface";

export interface RunLogItem {
  readonly id: string;
  readonly tabId?: number;
  readonly runKey: string;
  readonly runLabel: string;
  readonly recordedAt: string;
  readonly severity: RunLogSeverity;
  readonly state: string;
  readonly action: string;
  readonly message: string;
  readonly source: RunLogSource;
  readonly technicalDetails?: string;
}

export interface RunLogRunGroup {
  readonly key: string;
  readonly label: string;
  readonly source: RunLogSource;
  readonly items: readonly RunLogItem[];
}

export interface RunLogTabGroup {
  readonly key: string;
  readonly tabId?: number;
  readonly label: string;
  readonly runs: readonly RunLogRunGroup[];
}

export interface BuildRunLogGroupsInput {
  readonly currentTabId?: number;
  readonly notices: readonly Notice[];
  readonly stepLogs: readonly StepLogEntry[];
  readonly cycleLogs: readonly RepeatCycleLogEntry[];
  readonly recorderLogs: readonly RecorderLogEntry[];
  readonly filter?: RunLogFilter;
}

export function buildRunLogGroups({
  currentTabId,
  notices,
  stepLogs,
  cycleLogs,
  recorderLogs,
  filter = "all"
}: BuildRunLogGroupsInput): readonly RunLogTabGroup[] {
  const items = [
    ...notices.map((notice) => noticeItem(notice, currentTabId)),
    ...stepLogs.map(stepItem),
    ...cycleLogs.map(cycleItem),
    ...recorderLogs.map(recorderItem)
  ]
    .filter((item) => filter === "all" || item.severity === filter)
    .sort((left, right) => timestamp(right.recordedAt) - timestamp(left.recordedAt));

  const tabs = new Map<string, { tabId?: number; items: RunLogItem[] }>();
  for (const item of items) {
    const key = item.tabId === undefined ? "interface" : `tab:${item.tabId}`;
    const existing = tabs.get(key);
    if (existing === undefined) {
      tabs.set(key, {
        ...(item.tabId === undefined ? {} : { tabId: item.tabId }),
        items: [item]
      });
    } else {
      existing.items.push(item);
    }
  }

  return [...tabs.entries()].map(([key, tab]) => {
    const runs = new Map<string, RunLogItem[]>();
    for (const item of tab.items) {
      const runItems = runs.get(item.runKey);
      if (runItems === undefined) runs.set(item.runKey, [item]);
      else runItems.push(item);
    }
    return {
      key,
      ...(tab.tabId === undefined ? {} : { tabId: tab.tabId }),
      label: tab.tabId === undefined ? "Interface" : `Tab #${tab.tabId}`,
      runs: [...runs.entries()].map(([runKey, runItems]) => ({
        key: runKey,
        label: runItems[0]?.runLabel ?? "Run",
        source: runItems[0]?.source ?? "interface",
        items: runItems
      }))
    };
  });
}

export function formatRunLogTime(recordedAt: string): string {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function redactRunLogText(value: string): string {
  return value
    .replace(
      /("type"\s*:\s*"password"[\s\S]{0,300}?"value"\s*:\s*")[^"]*(")/gi,
      "$1[REDACTED]$2"
    )
    .replace(
      /("value"\s*:\s*")[^"]*("[\s\S]{0,300}?"type"\s*:\s*"password")/gi,
      "$1[REDACTED]$2"
    )
    .replace(
      /((?:password|passwd|pwd)\s*[:=]\s*["']?)[^\s,"';}&]+/gi,
      "$1[REDACTED]"
    );
}

function noticeItem(notice: Notice, currentTabId?: number): RunLogItem {
  const action = notice.action ?? noticeAction(notice.text);
  const tabId = notice.tabId ?? currentTabId;
  const runKey =
    notice.sessionId === undefined ? "interface" : `automation:${notice.sessionId}`;
  return {
    id: `notice:${notice.id}`,
    ...(tabId === undefined ? {} : { tabId }),
    runKey,
    runLabel:
      notice.sessionId === undefined
        ? "Interface events"
        : `Automation run ${shortId(notice.sessionId)}`,
    recordedAt: notice.recordedAt ?? new Date(0).toISOString(),
    severity: notice.status === "error" ? "error" : "success",
    state: notice.status === "error" ? "Error" : "Success",
    action,
    message: redactRunLogText(notice.text),
    source: notice.sessionId === undefined ? "interface" : "automation",
    ...(notice.details === undefined
      ? {}
      : { technicalDetails: redactRunLogText(notice.details) })
  };
}

function stepItem(entry: StepLogEntry): RunLogItem {
  const severity: RunLogSeverity =
    entry.status === "failed"
      ? "error"
      : entry.status === "stopped" || entry.status === "skipped"
        ? "warning"
        : "success";
  const identity = `Step #${entry.stepNumber} ${entry.stepName ?? entry.stepType}`;
  const message =
    entry.error === undefined
      ? `${identity} ${entry.status}.`
      : `${identity} failed: ${entry.error.reason}`;
  return {
    id: `step:${entry.id}`,
    tabId: entry.tabId,
    runKey: `automation:${entry.sessionId}`,
    runLabel: `Automation run ${shortId(entry.sessionId)}`,
    recordedAt: entry.recordedAt,
    severity,
    state: titleCase(entry.status),
    action: actionLabel(entry.error?.action ?? entry.stepType),
    message: redactRunLogText(message),
    source: "automation",
    ...(entry.error === undefined
      ? {}
      : { technicalDetails: redactRunLogText(formatStepLogDetails(entry)) })
  };
}

function cycleItem(entry: RepeatCycleLogEntry): RunLogItem {
  const severity: RunLogSeverity =
    entry.event === "failed"
      ? "error"
      : entry.event === "stopped"
        ? "warning"
        : "success";
  const step =
    entry.stepNumber === undefined ? "" : `Step #${entry.stepNumber}: `;
  const message =
    entry.event === "failed" && entry.error !== undefined
      ? `${step}${entry.error}. The repeat cycle was stopped; no next run was scheduled.`
      : entry.message;
  const technicalDetails = [
    `Preset: ${entry.presetId}`,
    `Tab: ${entry.tabId}`,
    ...(entry.stepId === undefined ? [] : [`Step ID: ${entry.stepId}`]),
    ...(entry.reason === undefined ? [] : [`Stop reason: ${entry.reason}`]),
    ...(entry.intervalMinutes === undefined
      ? []
      : [`Interval: ${entry.intervalMinutes} minute(s)`]),
    ...(entry.nextRunAt === undefined
      ? []
      : [`Next run: ${new Date(entry.nextRunAt).toISOString()}`]),
    ...(entry.error === undefined ? [] : [`Error: ${entry.error}`])
  ].join("\n");
  return {
    id: `cycle:${entry.id}`,
    tabId: entry.tabId,
    runKey: `repeat:${entry.presetId}`,
    runLabel: `Repeat cycle ${shortId(entry.presetId)}`,
    recordedAt: entry.recordedAt,
    severity,
    state: titleCase(entry.event),
    action: repeatAction(entry.event),
    message: redactRunLogText(message),
    source: "repeat",
    technicalDetails: redactRunLogText(technicalDetails)
  };
}

function recorderItem(entry: RecorderLogEntry): RunLogItem {
  const severity: RunLogSeverity =
    entry.event === "failed"
      ? "error"
      : entry.event === "action-skipped" ||
          entry.event === "stopped" ||
          entry.event === "context-changed" ||
          entry.event === "tab-closed"
        ? "warning"
        : "success";
  return {
    id: `recorder:${entry.id}`,
    tabId: entry.tabId,
    runKey: `recorder:${entry.sessionId ?? "unassigned"}`,
    runLabel:
      entry.sessionId === undefined
        ? "Recorder"
        : `Recording ${shortId(entry.sessionId)}`,
    recordedAt: entry.recordedAt,
    severity,
    state: recorderState(entry),
    action: recorderAction(entry),
    message: redactRunLogText(entry.message),
    source: "recorder",
    ...(entry.details === undefined
      ? {}
      : { technicalDetails: redactRunLogText(formatRecorderDetails(entry)) })
  };
}

function formatRecorderDetails(entry: RecorderLogEntry): string {
  const details = entry.details;
  if (details === undefined) return "";
  return [
    `Action: ${entry.action}`,
    `Tab: ${entry.tabId}`,
    ...(entry.sessionId === undefined ? [] : [`Session: ${entry.sessionId}`]),
    ...(entry.recorderEventId === undefined
      ? []
      : [`Event: ${entry.recorderEventId}`]),
    ...(details.code === undefined ? [] : [`Code: ${details.code}`]),
    `${details.name}: ${details.message}`,
    ...(details.cause === undefined ? [] : [`Cause: ${details.cause}`]),
    ...(details.stack === undefined ? [] : [details.stack])
  ].join("\n");
}

function recorderAction(entry: RecorderLogEntry): string {
  if (entry.event === "started") return "Record";
  if (
    entry.event === "stopped" ||
    entry.event === "context-changed" ||
    entry.event === "tab-closed"
  ) {
    return "Stop recording";
  }
  if (entry.recorderEventKind === "reload") return "Recorder · Reload";
  if (entry.event === "action-skipped") return "Recorder · Skip";
  return `Recorder · ${actionLabel(entry.recorderEventKind ?? entry.action)}`;
}

function recorderState(entry: RecorderLogEntry): string {
  if (entry.event === "action-recorded") return "Recorded";
  if (entry.event === "action-skipped") return "Warning";
  if (entry.event === "context-changed" || entry.event === "tab-closed") {
    return "Stopped";
  }
  return titleCase(entry.event);
}

function repeatAction(event: RepeatCycleLogEntry["event"]): string {
  if (event === "stopped") return "Stop repeat";
  if (event === "scheduled") return "Schedule repeat";
  return `Repeat · ${titleCase(event)}`;
}

function noticeAction(message: string): string {
  if (/stop all/i.test(message)) return "Stop All";
  if (/stop/i.test(message)) return "Stop";
  if (/record/i.test(message)) return "Recorder";
  if (/reload/i.test(message)) return "Reload";
  if (/repeat|cycle/i.test(message)) return "Repeat";
  if (/preset|import|export/i.test(message)) return "Preset";
  if (/run|automation/i.test(message)) return "Run";
  return "Interface";
}

function actionLabel(action: string): string {
  if (action === "pressKey") return "Press key";
  if (action === "customCode") return "Custom code";
  return titleCase(action);
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

function titleCase(value: string): string {
  if (value.length === 0) return value;
  return `${value[0]?.toUpperCase()}${value.slice(1).replaceAll("-", " ")}`;
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  return Number.isNaN(result) ? 0 : result;
}
