import { Alert, Button, Card, Checkbox, Input } from "../../components";

export interface NaturalPacingPanelProps {
  readonly enabled: boolean;
  readonly minimumDelay: string;
  readonly maximumDelay: string;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error?: string;
  readonly validationErrors: readonly string[];
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onMinimumDelayChange: (value: string) => void;
  readonly onMaximumDelayChange: (value: string) => void;
  readonly onSave: () => void;
}

export function NaturalPacingPanel({
  enabled,
  minimumDelay,
  maximumDelay,
  loading,
  saving,
  error,
  validationErrors,
  onEnabledChange,
  onMinimumDelayChange,
  onMaximumDelayChange,
  onSave
}: NaturalPacingPanelProps) {
  const validationId = "natural-pacing-validation";
  return (
    <Card className="card dashboard-card pacing-card" aria-labelledby="natural-pacing-title">
      <div className="pacing-heading">
        <div>
          <p className="section-label">Timing</p>
          <h2 id="natural-pacing-title">Natural pacing</h2>
          <p>Random pauses between enabled automation steps.</p>
        </div>
        <Checkbox
          checked={enabled}
          disabled={loading || saving}
          label="Enabled"
          onChange={(event) => onEnabledChange(event.currentTarget.checked)}
        />
      </div>

      <div className="pacing-fields">
        <label>
          <span>Minimum delay</span>
          <span className="pacing-input-row">
            <Input
              aria-describedby={validationErrors.length > 0 ? validationId : undefined}
              disabled={loading || saving}
              min="0"
              onChange={(event) => onMinimumDelayChange(event.currentTarget.value)}
              step="0.1"
              type="number"
              value={minimumDelay}
            />
            <span>seconds</span>
          </span>
        </label>
        <label>
          <span>Maximum delay</span>
          <span className="pacing-input-row">
            <Input
              aria-describedby={validationErrors.length > 0 ? validationId : undefined}
              disabled={loading || saving}
              min="0"
              onChange={(event) => onMaximumDelayChange(event.currentTarget.value)}
              step="0.1"
              type="number"
              value={maximumDelay}
            />
            <span>seconds</span>
          </span>
        </label>
      </div>

      {validationErrors.length > 0 && (
        <Alert id={validationId} tone="error">{validationErrors[0]}</Alert>
      )}
      {error !== undefined && <Alert tone="error">{error}</Alert>}
      <Button
        disabled={loading || saving || validationErrors.length > 0}
        onClick={onSave}
        size="small"
        variant="secondary"
      >
        {saving ? "Saving…" : "Save pacing"}
      </Button>
    </Card>
  );
}
