import {
  captureScreenshot,
  expect,
  expectNoModerateOrWorseAxeViolations,
  test,
} from "./fixtures/test";
import { ids } from "./fixtures/data";

test("document editor loads, saves, versions, comments, and renders chat tools", async ({
  page,
  mockApi,
}) => {
  const loadedScripts: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith(".js")) loadedScripts.push(path);
  });

  await page.goto(`/documents/${ids.document}`);

  await expect(
    page.getByText("Master Services Agreement.docx", { exact: true }).first(),
  ).toBeVisible();
  const editor = page.locator('[aria-label="Document editor"] [contenteditable="true"]');
  await expect(editor).toContainText("The initial term is twelve months.");
  await expectNoModerateOrWorseAxeViolations(page);

  await editor.fill(
    "Master Services Agreement\nThe initial term is twenty-four months.\nEither party may terminate with thirty days notice.",
  );
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
  const saveButton = page.locator("header button").filter({ hasText: /^Save$/ });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText("Saved version 3.")).toBeVisible();
  expect(mockApi.wasCalled("POST", `/documents/${ids.document}/versions/from-html`)).toBe(true);

  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: "Versions History" }).click();
  await expect(page.getByText(/Manual save/)).toBeVisible();
  await page
    .getByText("Versions History", { exact: true })
    .locator("..")
    .getByRole("button", { name: "✕" })
    .click();

  await page.getByRole("tab", { name: "Comments" }).click();
  await expect(page.getByText("Confirm the renewal notice period.")).toBeVisible();
  const comment = page.getByPlaceholder("Add a comment on this section...");
  await comment.fill("Please confirm the governing law.");
  await comment.press("Enter");
  await expect(page.getByText("Please confirm the governing law.")).toBeVisible();
  await page.getByTitle("Resolve comment").first().click();
  await expect(page.getByText("Resolved").first()).toBeVisible();

  await page.getByRole("tab", { name: "Prism" }).click();
  await page.getByLabel("Message Prism").fill("Extract the termination clause.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Extracted Clauses")).toBeVisible();
  await expect(page.getByText("Termination for convenience")).toBeVisible();
  await expect(page.getByText("I found one termination clause.")).toBeVisible();

  expect(
    loadedScripts.filter((path) =>
      /(?:WorkspaceDetailView|ReviewPage|CompliancePage|DocsCompliancePage)-/.test(path),
    ),
  ).toEqual([]);
  await expectNoModerateOrWorseAxeViolations(page);
  await captureScreenshot(page, "document-editor");
});
