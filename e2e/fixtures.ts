import { test as base, expect, type Page } from "@playwright/test";

export const SCREENSHOT_DIR = "e2e/screenshots";

type Fixtures = {
  /** Console errors and failed same-origin requests collected during the test. */
  problems: string[];
};

/** Every test gets a page that records console errors and failed API calls. */
export const test = base.extend<Fixtures>({
  // `provide` is Playwright's fixture callback (usually named `use`, which the
  // React hooks lint rule mistakes for React's `use`).
  problems: async ({ page }, provide) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      // Resource failures are reported through the response check below.
      if (/Failed to load resource/i.test(text)) return;
      problems.push(`console: ${text}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
      const url = new URL(response.url());
      // 503 from /api/advice means "GEMINI_API_KEY not set"; the UI test checks it is shown.
      const adviceNotConfigured = url.pathname === "/api/advice" && response.status() === 503;
      if (url.origin === "http://localhost:3000" && url.pathname.startsWith("/api/") && response.status() >= 500 && !adviceNotConfigured) {
        problems.push(`HTTP ${response.status()} ${url.pathname}${url.search}`);
      }
    });
    await provide(problems);
  },
});

export { expect };

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

/** Opens the app and waits until the map has drawn roads from the basemap tiles. */
export async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Loading map…")).toBeHidden({ timeout: 30_000 });
  const mapError = page.locator(".map-error");
  if (await mapError.isVisible()) {
    throw new Error(`Basemap failed to load: ${(await mapError.textContent())?.trim()}`);
  }
  await expect(page.locator(".map-data-status").first()).toHaveText(/\d+ roads · \d+ features/, {
    timeout: 30_000,
  });
}

/**
 * Clicks around the map center in a widening spiral until a road is selected.
 * Roads are drawn on a WebGL canvas, so there is no DOM element to target.
 */
export async function selectAnyRoad(page: Page): Promise<string> {
  const heading = page.locator("#road-heading");
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas not found");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Start outside the location marker, which sits on the center and takes the click.
  for (let radius = 24; radius <= 240; radius += 10) {
    const steps = Math.max(12, Math.round(radius / 6));
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      await page.mouse.click(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      if ((await heading.count()) > 0) return ((await heading.textContent()) ?? "").trim();
    }
  }
  throw new Error("No road could be selected near the map center");
}

/** Chooses a place through the search box (type, wait for options, Enter). */
/** An information-panel section, found by its heading. */
export function section(page: Page, title: string) {
  return page.locator(".ip-section", { has: page.locator(".ip-heading", { hasText: title }) });
}

export function viewButton(page: Page, label: string) {
  return page.getByRole("group", { name: "Road view" }).getByRole("button", { name: label });
}

export function searchBox(page: Page) {
  return page.getByRole("combobox", { name: /Search for an address/ });
}

export async function searchFor(page: Page, query: string) {
  const input = searchBox(page);
  await input.fill(query);
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 20_000 });
  await input.press("Enter");
}
