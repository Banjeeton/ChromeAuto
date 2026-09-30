import { useCallback, useState } from "react";

import {
  DEFAULT_NATURAL_PACING_SETTINGS,
  type NaturalPacingSettings,
  validateNaturalPacingSettings
} from "../../../core/domain/natural-pacing";
import { AUTOMATION_RUNTIME_MESSAGE } from "../../../shared/types/automation-runtime";
import {
  errorMessage,
  runtimeResponseError,
  sendRuntimeMessage
} from "../../runtime/runtime-client";

export function useNaturalPacingController() {
  const [presetId, setPresetId] = useState<string>();
  const [settings, setSettings] = useState<NaturalPacingSettings>(
    DEFAULT_NATURAL_PACING_SETTINGS
  );
  const [minimumDelay, setMinimumDelay] = useState("1");
  const [maximumDelay, setMaximumDelay] = useState("3");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async (nextPresetId?: string) => {
    setPresetId(nextPresetId);
    setError(undefined);
    if (nextPresetId === undefined) {
      applySettings(DEFAULT_NATURAL_PACING_SETTINGS);
      return;
    }
    setLoading(true);
    try {
      const response = await sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "natural-pacing",
        presetId: nextPresetId
      });
      if (!response.ok) throw runtimeResponseError(response);
      if (response.result.kind !== "natural-pacing") {
        throw new Error("The extension returned an unexpected Natural pacing response.");
      }
      applySettings(response.result.settings);
    } catch (caught) {
      setError(`Unable to load Natural pacing: ${errorMessage(caught)}`);
    } finally {
      setLoading(false);
    }

    function applySettings(value: NaturalPacingSettings) {
      setSettings(value);
      setMinimumDelay(String(value.minimumDelaySeconds));
      setMaximumDelay(String(value.maximumDelaySeconds));
    }
  }, []);

  const parsed: NaturalPacingSettings = {
    enabled: settings.enabled,
    minimumDelaySeconds: Number(minimumDelay),
    maximumDelaySeconds: Number(maximumDelay)
  };
  const validationErrors = [
    ...(minimumDelay.trim() === "" ? ["Minimum delay is required."] : []),
    ...(maximumDelay.trim() === "" ? ["Maximum delay is required."] : []),
    ...validateNaturalPacingSettings(parsed)
  ];

  const save = useCallback(async () => {
    if (presetId === undefined || validationErrors.length > 0) return false;
    setSaving(true);
    setError(undefined);
    try {
      const response = await sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "update-natural-pacing",
        presetId,
        settings: parsed
      });
      if (!response.ok) throw runtimeResponseError(response);
      if (response.result.kind !== "natural-pacing") {
        throw new Error("The extension returned an unexpected Natural pacing response.");
      }
      setSettings(response.result.settings);
      setMinimumDelay(String(response.result.settings.minimumDelaySeconds));
      setMaximumDelay(String(response.result.settings.maximumDelaySeconds));
      return true;
    } catch (caught) {
      setError(`Unable to save Natural pacing: ${errorMessage(caught)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [maximumDelay, minimumDelay, parsed, presetId, settings.enabled, validationErrors.length]);

  return {
    enabled: settings.enabled,
    error,
    loading,
    maximumDelay,
    minimumDelay,
    presetId,
    saving,
    setEnabled: (enabled: boolean) => setSettings((current) => ({ ...current, enabled })),
    setMaximumDelay,
    setMinimumDelay,
    validationErrors,
    refresh,
    save
  } as const;
}
