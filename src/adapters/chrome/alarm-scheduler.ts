import {
  CycleSchedulerError,
  type CycleScheduler,
  type CycleTimerIdentity,
  type ScheduledCycleTimer,
  type ScheduleCycleTimerRequest
} from "../../core/ports/cycle-scheduler";

const CYCLE_ALARM_PREFIX = "automation.repeat.v1:";

export interface ChromeAlarmRecord {
  readonly name: string;
  readonly scheduledTime: number;
}

export interface ChromeAlarmsApi {
  create(name: string, alarmInfo: { readonly when: number }): Promise<void>;
  get(name: string): Promise<ChromeAlarmRecord | undefined>;
  getAll(): Promise<readonly ChromeAlarmRecord[]>;
  clear(name: string): Promise<boolean>;
}

/** Manifest V3 scheduler backed by one-shot chrome.alarms entries. */
export class ChromeAlarmScheduler implements CycleScheduler {
  readonly #alarms: ChromeAlarmsApi;

  constructor(alarms: ChromeAlarmsApi = createChromeAlarmsApi()) {
    this.#alarms = alarms;
  }

  async schedule(request: ScheduleCycleTimerRequest): Promise<void> {
    assertCycleTimerIdentity(request);
    assertScheduledFor(request.scheduledFor);

    try {
      await this.#alarms.create(createCycleAlarmName(request), {
        when: request.scheduledFor
      });
    } catch (error) {
      throw new CycleSchedulerError("schedule", request, error);
    }
  }

  async get(
    identity: CycleTimerIdentity
  ): Promise<ScheduledCycleTimer | undefined> {
    assertCycleTimerIdentity(identity);

    try {
      const alarm = await this.#alarms.get(createCycleAlarmName(identity));
      if (alarm === undefined) {
        return undefined;
      }
      return Object.freeze({
        tabId: identity.tabId,
        presetId: identity.presetId,
        scheduledFor: alarm.scheduledTime
      });
    } catch (error) {
      throw new CycleSchedulerError("get", identity, error);
    }
  }

  async list(): Promise<readonly ScheduledCycleTimer[]> {
    try {
      const alarms = await this.#alarms.getAll();
      return Object.freeze(
        alarms.flatMap((alarm) => {
          const identity = parseCycleAlarmName(alarm.name);
          return identity === undefined
            ? []
            : [
                Object.freeze({
                  ...identity,
                  scheduledFor: alarm.scheduledTime
                })
              ];
        })
      );
    } catch (error) {
      throw new CycleSchedulerError("list", undefined, error);
    }
  }

  async cancel(identity: CycleTimerIdentity): Promise<boolean> {
    assertCycleTimerIdentity(identity);

    try {
      return await this.#alarms.clear(createCycleAlarmName(identity));
    } catch (error) {
      throw new CycleSchedulerError("cancel", identity, error);
    }
  }
}

export function createCycleAlarmName(identity: CycleTimerIdentity): string {
  assertCycleTimerIdentity(identity);
  return `${CYCLE_ALARM_PREFIX}${identity.tabId}:${encodeURIComponent(identity.presetId)}`;
}

export function parseCycleAlarmName(
  alarmName: string
): Readonly<CycleTimerIdentity> | undefined {
  if (!alarmName.startsWith(CYCLE_ALARM_PREFIX)) {
    return undefined;
  }

  const encodedIdentity = alarmName.slice(CYCLE_ALARM_PREFIX.length);
  const separatorIndex = encodedIdentity.indexOf(":");
  if (separatorIndex < 1 || separatorIndex === encodedIdentity.length - 1) {
    return undefined;
  }

  const tabId = Number(encodedIdentity.slice(0, separatorIndex));
  let presetId: string;
  try {
    presetId = decodeURIComponent(encodedIdentity.slice(separatorIndex + 1));
  } catch {
    return undefined;
  }

  const identity = { tabId, presetId };
  try {
    assertCycleTimerIdentity(identity);
  } catch {
    return undefined;
  }
  return Object.freeze(identity);
}

function createChromeAlarmsApi(): ChromeAlarmsApi {
  return {
    create: (name, alarmInfo) => chrome.alarms.create(name, alarmInfo),
    get: (name) => chrome.alarms.get(name),
    getAll: () => chrome.alarms.getAll(),
    clear: (name) => chrome.alarms.clear(name)
  };
}

function assertCycleTimerIdentity(identity: CycleTimerIdentity): void {
  if (!Number.isInteger(identity.tabId) || identity.tabId < 0) {
    throw new RangeError("tabId must be a non-negative integer.");
  }
  if (identity.presetId.trim().length === 0) {
    throw new TypeError("presetId must be a non-empty string.");
  }
}

function assertScheduledFor(scheduledFor: number): void {
  if (!Number.isFinite(scheduledFor) || scheduledFor < 0) {
    throw new RangeError(
      "scheduledFor must be a non-negative Unix time in milliseconds."
    );
  }
}
