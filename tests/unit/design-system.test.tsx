import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Confirmation,
  ConfirmationDialog,
  Input,
  Modal,
  Select,
  Textarea
} from "../../src/sidepanel/components";

describe("side panel design system", () => {
  it("renders primary, secondary and danger button variants and native states", () => {
    const html = renderToStaticMarkup(
      <div>
        <Button>Run</Button>
        <Button variant="secondary">Cancel</Button>
        <Button disabled variant="danger">Delete</Button>
      </div>
    );

    expect(html).toContain("ui-button--primary");
    expect(html).toContain("ui-button--secondary");
    expect(html).toContain("ui-button--danger");
    expect(html).toContain("disabled");
    expect(html).toContain('type="button"');
  });

  it("renders reusable input, select, checkbox and textarea controls", () => {
    const html = renderToStaticMarkup(
      <form>
        <Input aria-label="Name" defaultValue="Checkout" />
        <Select aria-label="State" defaultValue="ready">
          <option value="ready">Ready</option>
        </Select>
        <Checkbox
          defaultChecked
          description="Runs after the previous pass"
          label="Repeat"
        />
        <Textarea aria-label="Description" defaultValue="Automation" />
      </form>
    );

    expect(html).toContain("ui-input");
    expect(html).toContain("ui-select");
    expect(html).toContain("ui-checkbox__control");
    expect(html).toContain("ui-checkbox__description");
    expect(html).toContain("ui-textarea");
  });

  it("visually distinguishes semantic badge and alert states", () => {
    const html = renderToStaticMarkup(
      <Card>
        <Badge tone="success">Enabled</Badge>
        <Badge tone="warning">Waiting</Badge>
        <Alert tone="error">Unable to save.</Alert>
        <Alert tone="info" title="Tip">Select a preset first.</Alert>
      </Card>
    );

    expect(html).toContain("ui-card");
    expect(html).toContain("ui-badge--success");
    expect(html).toContain("ui-badge--warning");
    expect(html).toContain("ui-alert--error");
    expect(html).toContain("ui-alert--info");
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
  });

  it("renders modal and inline confirmation primitives independently of features", () => {
    const hiddenModal = renderToStaticMarkup(
      <Modal open={false} title="Hidden">Hidden body</Modal>
    );
    const html = renderToStaticMarkup(
      <>
        <Modal open title="Edit preset" onClose={() => undefined}>
          Modal body
        </Modal>
        <Confirmation
          confirmLabel="Delete"
          onCancel={() => undefined}
          onConfirm={() => undefined}
        >
          Delete this preset?
        </Confirmation>
        <ConfirmationDialog
          confirmLabel="Replace"
          onCancel={() => undefined}
          onConfirm={() => undefined}
          open
          title="Replace preset"
        >
          The existing preset will be replaced.
        </ConfirmationDialog>
      </>
    );

    expect(hiddenModal).toBe("");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("ui-confirmation");
    expect(html).toContain("Delete this preset?");
    expect(html).toContain("Replace preset");
  });
});
