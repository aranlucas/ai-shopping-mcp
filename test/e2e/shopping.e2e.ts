import { test } from "@e2e-dev/web";
import { expect } from "e2e";

test("edits a saved list, rolls back a failed edit, and removes an item", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/preview.html");
  await screen.getByRole("combobox", "Preview view").selectOption({ value: "list" });
  const name = "Fresh organic strawberries";
  const increase = screen.getByRole("button", `Increase quantity of ${name}`);
  const quantity = screen.getByRole("status", `Quantity of ${name}`);
  // Hold the preview host reply until both pending-state assertions finish.
  // Its fixture uses 600ms timers; production components are unchanged.
  await browser.evaluate(`(() => {
    const original = globalThis.setTimeout;
    const pending = [];
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 600) { pending.push(() => callback(...args)); return 0; }
      return original(callback, delay, ...args);
    };
    globalThis.releasePreviewReply = () => {
      globalThis.setTimeout = original;
      pending.forEach(callback => callback());
    };
  })()`);
  await increase.tap();
  await expect(increase).toBeDisabled();
  await expect(
    screen.getByRole("button", "Increase quantity of Greek yogurt, plain and unsweetened"),
  ).toBeDisabled();
  await browser.evaluate("globalThis.releasePreviewReply()");
  await expect(quantity).toHaveText("3");
  await expect(increase).toBeEnabled();
  await screen.getByRole("checkbox", "Fail actions").check();
  await increase.tap();
  await expect(screen.getByRole("alert")).toContainText("session expired");
  await expect(quantity).toHaveText("3");
  await screen.getByRole("checkbox", "Fail actions").uncheck();
  await screen.getByRole("button", `Remove ${name}`).tap();
  await expect(screen.getByRole("button", `Remove ${name}`)).toHaveCount(0);
});

test("adds a list then records a completed purchase", async ({ app, screen }) => {
  await app.open("/preview.html");
  await screen.getByRole("combobox", "Preview view").selectOption({ value: "list" });
  await screen.getByRole("button", "Add 3 items to cart").tap();
  await expect(screen.getByRole("button", "Added to cart")).toBeVisible();
  await screen.getByRole("button", "Mark as purchased").tap();
  await expect(screen.getByText("Recorded in your order history.")).toBeVisible();
  await expect(screen.getByRole("button", "Recorded")).toBeDisabled();
});

test("blocks retry after an ambiguous cart write", async ({ app, screen }) => {
  await app.open("/preview.html");
  await screen.getByRole("combobox", "Preview view").selectOption({ value: "list" });
  await screen.getByRole("checkbox", "Unknown cart outcome").check();
  await screen.getByRole("button", "Add 3 items to cart").tap();
  await expect(screen.getByRole("alert")).toContainText("confirmation was lost");
  await expect(screen.getByRole("link", "Check Kroger cart")).toBeVisible();
  await expect(screen.getByRole("button", "Add 3 items to cart")).toHaveCount(0);
  await screen.getByRole("checkbox", "Unknown cart outcome").uncheck();
  await expect(screen.getByRole("link", "Check Kroger cart")).toBeVisible();
});
