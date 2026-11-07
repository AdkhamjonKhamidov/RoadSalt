import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOpenMeteo } from "../app/lib/open-meteo";
import { parseAlerts, parseNearestStation, parseObservation } from "../app/lib/nws";
import { classifyWeatherAttention } from "../app/lib/weather";

// Fixtures follow the shape of real Open-Meteo / NWS responses (synthetic values).
function openMeteo(hours = 30, overrides: Record<string, unknown> = {}) {
  const times = Array.from({ length: hours }, (_, index) => {
    const day = 7 + Math.floor((index + 10) / 24);
    const hour = (index + 10) % 24;
    return `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`;
  });
  return {
    latitude: 38.35,
    longitude: -75.6,
    timezone: "America/New_York",
    current: {
      time: "2026-11-07T12:15",
      temperature_2m: 4.2,
      apparent_temperature: 1.1,
      relative_humidity_2m: 80,
      wind_speed_10m: 12.5,
      precipitation: 0,
      weather_code: 3,
      ...overrides,
    },
    hourly: {
      time: times,
      temperature_2m: times.map(() => 3),
      precipitation_probability: times.map(() => 20),
      precipitation: times.map(() => 0),
      snowfall: times.map(() => 0),
    },
  };
}

test("parses current conditions, optional fields and the next 24 hours", () => {
  const weather = parseOpenMeteo(openMeteo());
  assert.equal(weather.timezone, "America/New_York");
  assert.equal(weather.current.temperature, 4.2);
  assert.equal(weather.current.apparentTemperature, 1.1);
  assert.equal(weather.current.relativeHumidity, 80);
  assert.equal(weather.current.windSpeed, 12.5);
  assert.equal(weather.hourly.length, 24);
  assert.equal(weather.hourly[0].time, "2026-11-07T12:00");
});

test("leaves missing optional values null instead of inventing them", () => {
  const weather = parseOpenMeteo(openMeteo(30, { apparent_temperature: null, wind_speed_10m: undefined }));
  assert.equal(weather.current.apparentTemperature, null);
  assert.equal(weather.current.windSpeed, null);
});

test("rejects responses missing required values", () => {
  assert.throws(() => parseOpenMeteo(openMeteo(30, { temperature_2m: null })), /usable current weather/);
  assert.throws(() => parseOpenMeteo({}), /invalid response/);
  const noHourly = openMeteo();
  (noHourly.hourly as Record<string, unknown>).snowfall = "x";
  assert.throws(() => parseOpenMeteo(noHourly), /hourly forecast fields/);
});

test("skips incomplete forecast hours rather than filling them", () => {
  const input = openMeteo();
  input.hourly.temperature_2m[3] = null as unknown as number;
  const weather = parseOpenMeteo(input);
  assert.ok(!weather.hourly.some((hour) => hour.time === "2026-11-07T13:00"));
});

test("weather attention never needs pavement data and handles no data", () => {
  assert.equal(classifyWeatherAttention(null), "Insufficient data");
  const freezing = parseOpenMeteo(openMeteo());
  freezing.hourly[2] = { ...freezing.hourly[2], temperature: -1, precipitationProbability: 70 };
  assert.equal(classifyWeatherAttention(freezing), "Elevated");
});

test("parses an NWS observation, keeping unreported values null", () => {
  const observation = parseObservation({
    properties: {
      timestamp: "2026-11-07T21:54:00+00:00",
      textDescription: "Light Snow",
      temperature: { unitCode: "wmoUnit:degC", value: -1.5 },
      dewpoint: { value: null },
      windSpeed: { value: 9.4 },
      presentWeather: [{ weather: "snow" }, { nope: 1 }],
    },
  });
  assert.equal(observation.temperatureC, -1.5);
  assert.equal(observation.dewpointC, null);
  assert.equal(observation.visibilityM, null);
  assert.deepEqual(observation.presentWeather, ["snow"]);
  assert.throws(() => parseObservation({ properties: {} }), /no usable observation/);
});

test("parses and deduplicates NWS alerts; finds the nearest station", () => {
  const alert = { properties: { id: "a1", event: "Winter Storm Warning", severity: "Severe", ends: "2026-11-08T12:00:00-05:00" } };
  const alerts = parseAlerts({ features: [alert, alert, { properties: { id: "x" } }] });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].event, "Winter Storm Warning");
  assert.throws(() => parseAlerts({}), /invalid alert data/);

  const station = parseNearestStation({ features: [{ properties: { stationIdentifier: "KSBY", name: "Salisbury" } }] });
  assert.deepEqual(station, { id: "KSBY", name: "Salisbury" });
  assert.throws(() => parseNearestStation({ features: [] }), /No National Weather Service station/);
});
