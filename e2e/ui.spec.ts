import {
  expect,
  openApp,
  searchBox,
  searchFor,
  section,
  selectAnyRoad,
  shot,
  test,
  viewButton,
} from "./fixtures";

// Walks every user-facing feature against live data and saves a screenshot of
// each to e2e/screenshots/. Assertions check structure and states, never
// specific weather values (those change).

async function openLegend(page: import("@playwright/test").Page) {
  const toggle = page.locator(".map-legend-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

test.describe("desktop", () => {
  test("initial load: header, map, information panel, attribution", async ({ page, problems }) => {
    await openApp(page);

    await expect(page.locator(".wordmark")).toHaveText("RoadSalt");
    await expect(page.locator(".header-location-name")).toContainText("Camden");
    await expect(section(page, "Selected location").locator(".place-name")).toContainText("Camden");
    await expect(section(page, "Selected location")).toContainText(/\d+\.\d{4}° N/);
    await expect(section(page, "Selected road")).toContainText("No road selected");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByLabel("Selected location marker")).toBeVisible();
    await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");

    const weather = section(page, "Current weather conditions");
    await expect(weather).toContainText("Air temperature");
    await expect(weather).toContainText(/°F/);
    await expect(weather).toContainText(/Winter weather attention\s*(Low|Moderate|Elevated|Insufficient data)/);

    const forecast = section(page, "24-hour forecast");
    await expect(forecast.locator(".forecast-hour").first()).toBeVisible();
    expect(await forecast.locator(".forecast-hour").count()).toBeGreaterThan(3);

    await expect(section(page, "Data sources")).toContainText("Open-Meteo");
    await shot(page, "01-initial-load");
    expect(problems).toEqual([]);
  });

  test("road conditions status bar and legend", async ({ page, problems }) => {
    await openApp(page);
    await expect(viewButton(page, "Road conditions")).toHaveAttribute("aria-pressed", "true");

    const banner = page.locator(".condition-banner");
    await expect(banner).toBeVisible();
    const headline = (await banner.locator(".condition-headline").textContent())?.trim();
    test.info().annotations.push({ type: "conditions status", description: headline ?? "" });
    expect(headline).toBeTruthy();

    await openLegend(page);
    for (const label of ["No reported problems", "Closed", "Selected road", "Wetland", "Farmland"]) {
      await expect(page.locator(".map-legend")).toContainText(label);
    }
    await shot(page, "02-road-conditions");
    expect(problems).toEqual([]);
  });

  test("select a road: classification, condition, nearby features", async ({ page, problems }) => {
    await openApp(page);
    const name = await selectAnyRoad(page);
    test.info().annotations.push({ type: "selected road", description: name });

    const road = section(page, "Selected road");
    await expect(road).toContainText("Road classification");
    await expect(road.locator(".condition-card")).toContainText(/No reported problems|Use caution|Closed|No condition data/);
    await expect(road.locator(".fine-print").first()).toContainText("Not a measurement of the road surface");
    const nearby = section(page, "Nearby environmental features");
    await expect(nearby).toContainText(/sensitivity/);
    await expect(nearby).toContainText(/Runoff exposure in 100 m segments \(\d+\)/);
    expect(await nearby.locator(".segment-cell").count()).toBeGreaterThan(0);

    // Gemini suggestion: a streamed answer with the review disclaimer, or a
    // clear "not connected"/error state with Retry. Never silently empty.
    const advice = road.locator(".advice");
    await expect(advice).toContainText("Treatment approach");
    await expect(advice.locator(".fine-print, .ip-error").first()).toBeVisible({ timeout: 60_000 });
    test.info().annotations.push({ type: "gemini", description: (await advice.innerText()).slice(0, 300) });
    await shot(page, "03-road-selected");

    await page.getByRole("button", { name: "Clear road selection" }).click();
    await expect(road).toContainText("No road selected");
    expect(problems).toEqual([]);
  });

  test("environmental proximity view", async ({ page, problems }) => {
    await openApp(page);
    await openLegend(page);

    await viewButton(page, "Environmental proximity").click();
    await expect(viewButton(page, "Environmental proximity")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".condition-banner")).toBeHidden();
    await expect(page.locator(".map-statusbar")).toContainText("nearest mapped waterway");
    await expect(page.locator(".map-legend")).toContainText("Each 100 m of road");
    await page.waitForTimeout(1_500);
    await shot(page, "04-environmental-proximity");

    // Selecting a road in this view keeps its 100 m colours, with a navy halo.
    const name = await selectAnyRoad(page);
    test.info().annotations.push({ type: "selected road (proximity)", description: name });
    await page.waitForTimeout(1_000);
    await shot(page, "04b-proximity-road-selected");

    // No plow feed in Salisbury, so that view isn't offered here.
    await expect(viewButton(page, "Plow status")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("dark / light basemap toggle", async ({ page, problems }) => {
    await openApp(page);
    const group = page.getByRole("group", { name: "Map style" });
    test.skip((await group.count()) === 0, "Only one basemap style is configured");

    await group.getByRole("button", { name: "Dark" }).click();
    await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".map-canvas")).toHaveClass(/map-theme-dark/);
    await expect(page.getByText("Loading map…")).toBeHidden();
    await page.waitForTimeout(2_500); // let tiles repaint before the screenshot
    await shot(page, "05-dark-basemap");

    await group.getByRole("button", { name: "Light" }).click();
    await expect(page.locator(".map-canvas")).toHaveClass(/map-theme-light/);
    expect(problems).toEqual([]);
  });

  test("layer toggles: roads and each environmental kind", async ({ page, problems }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Layers" }).click();
    const panel = page.locator(".map-layer-controls");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Roads");
    const boxes = panel.getByRole("checkbox");
    const count = await boxes.count();
    expect(count).toBeGreaterThan(4);

    for (let i = 0; i < count; i++) {
      await boxes.nth(i).uncheck();
      await expect(boxes.nth(i)).not.toBeChecked();
    }
    await page.waitForTimeout(800);
    await shot(page, "06-layers-all-off");
    for (let i = 0; i < count; i++) await boxes.nth(i).check();
    await expect(boxes.first()).toBeChecked();

    await page.getByRole("button", { name: "Layers" }).click();
    await expect(panel).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("°F / °C switch is applied and remembered", async ({ page, problems }) => {
    await openApp(page);
    const units = page.getByRole("group", { name: "Temperature units" });
    const weather = section(page, "Current weather conditions");
    await expect(weather).toContainText("°F");

    await units.getByRole("button", { name: "°C" }).click();
    await expect(units.getByRole("button", { name: "°C" })).toHaveAttribute("aria-pressed", "true");
    await expect(weather).toContainText("°C");
    await shot(page, "07-celsius");

    await page.reload();
    await openApp(page);
    await expect(units.getByRole("button", { name: "°C" })).toHaveAttribute("aria-pressed", "true");

    await units.getByRole("button", { name: "°F" }).click();
    await expect(weather).toContainText("°F");
    expect(problems).toEqual([]);
  });

  test("Recenter returns to the selected location", async ({ page, problems }) => {
    await openApp(page);
    const canvas = page.locator(".maplibregl-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas");
    const marker = page.getByLabel("Selected location marker");
    await page.waitForTimeout(1_500); // let the initial fly-to finish
    const before = await marker.boundingBox();

    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2 + 160, { steps: 10 });
    await page.mouse.up();
    const moved = await marker.boundingBox();
    expect(Math.abs((moved?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(100);

    await page.getByRole("button", { name: "Recenter" }).click();
    await expect
      .poll(async () => Math.abs(((await marker.boundingBox())?.x ?? 0) - (before?.x ?? 0)), { timeout: 10_000 })
      .toBeLessThan(15);
    expect(problems).toEqual([]);
  });

  test("location search: messages, keyboard, clear", async ({ page, problems }) => {
    await openApp(page);
    const input = searchBox(page);

    await input.fill("Ba");
    await expect(page.locator(".location-search-message")).toHaveText(/at least 3 characters/);

    await input.fill("Baltimore");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".location-search-attribution")).toContainText("Photon");
    await input.press("ArrowDown");
    await shot(page, "08-search-suggestions");

    await input.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(input).toHaveValue("");

    await input.fill("zzqxqzzqxq");
    await expect(page.locator(".location-search-message")).toHaveText(/No matching places|failed/i, {
      timeout: 20_000,
    });
    expect(problems).toEqual([]);
  });

  test("search Baltimore: map, weather and station follow the location", async ({ page, problems }) => {
    await openApp(page);
    await searchFor(page, "Baltimore");

    await expect(page.locator(".place-name")).toContainText("Baltimore");
    await expect(page.locator(".header-location-name")).toContainText("Baltimore");
    await expect(page.getByLabel(/Interactive road map around .*Baltimore/)).toBeAttached();
    await expect(page.locator(".map-data-status").first()).toHaveText(/\d+ roads/, { timeout: 30_000 });
    await expect(section(page, "Current weather conditions")).toContainText(/Observed at K/, { timeout: 30_000 });
    await page.waitForTimeout(2_500); // fly-to animation and tile load
    await shot(page, "09-baltimore");

    const name = await selectAnyRoad(page);
    test.info().annotations.push({ type: "selected road (Baltimore)", description: name });
    expect(problems).toEqual([]);
  });

  test("agency plow status in Leonardtown, MD", async ({ page, problems }) => {
    await openApp(page);
    await searchFor(page, "Leonardtown, MD");
    await expect(page.locator(".place-name")).toContainText("Leonardtown");

    const plow = viewButton(page, "Plow status");
    await expect(plow).toBeVisible({ timeout: 30_000 });
    await expect(section(page, "Alerts and local reports")).toContainText(/route segments/);
    await plow.click();
    await expect(plow).toHaveAttribute("aria-pressed", "true");

    await openLegend(page);
    await expect(page.locator(".map-legend")).toContainText("Plowed or treated");
    await page.waitForTimeout(2_500);
    await shot(page, "10-plow-status");
    expect(problems).toEqual([]);
  });

  test("non-US location: weather works, NWS says US only", async ({ page, problems }) => {
    await openApp(page);
    await searchFor(page, "London, United Kingdom");
    await expect(page.locator(".place-name")).toContainText("London");
    const weather = section(page, "Current weather conditions");
    await expect(weather).toContainText("Air temperature", { timeout: 30_000 });
    await expect(weather).toContainText(/Measured observations: .*only available for United States/, {
      timeout: 30_000,
    });
    await page.waitForTimeout(2_000);
    await shot(page, "11-non-us-location");
    // A 404/4xx from NWS is expected here and is not counted as a problem.
    expect(problems).toEqual([]);
  });

  test("cache database records API responses", async ({ page, request, problems }) => {
    await openApp(page);
    await expect(section(page, "Current weather conditions")).toContainText("Air temperature");
    const stats = await (await request.get("/api/cache")).json();
    test.info().annotations.push({ type: "cache", description: JSON.stringify(stats) });
    expect(stats.storage).toBe("sqlite");
    const namespaces = stats.namespaces.map((entry: { namespace: string }) => entry.namespace);
    for (const name of ["weather", "observations", "incidents", "storm-reports"]) expect(namespaces).toContain(name);
    expect(problems).toEqual([]);
  });
});

test.describe("mobile 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("layout: map first, legend collapsed, no horizontal scroll", async ({ page, problems }) => {
    await openApp(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const mapBox = await page.locator(".map-frame").boundingBox();
    expect(mapBox?.height ?? 0).toBeGreaterThan(812 * 0.45);
    await expect(searchBox(page)).toBeVisible();
    await expect(page.locator(".map-legend-toggle")).toHaveAttribute("aria-expanded", "false");
    await shot(page, "13-mobile");

    await page.locator(".map-legend-toggle").click();
    await expect(page.locator(".map-legend")).toContainText("Selected road");
    expect(problems).toEqual([]);
  });
});
