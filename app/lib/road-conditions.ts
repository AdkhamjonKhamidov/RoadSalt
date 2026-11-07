import type { Feature, Geometry } from "geojson";
import type { NwsAlert, RoadProperties, TrafficIncident } from "./data-types";
import { minimumDistance } from "./proximity";
import type { WeatherAttention } from "./weather";

// Road condition categories shown on the map. Each colour is backed by real,
// named data; "clear" means nothing was reported, never "safe".

export type RoadCondition = "clear" | "caution" | "closed" | "unknown";

export const CONDITION_COLORS: Record<RoadCondition, string> = {
  clear: "#B7D894",
  caution: "#F1A344",
  closed: "#E00000",
  unknown: "#9AA3AD",
};

export const CONDITION_LABELS: Record<RoadCondition, string> = {
  clear: "No reported problems",
  caution: "Use caution",
  closed: "Closed",
  unknown: "No condition data",
};

/**
 * NWS alert events about winter *road* hazards across the whole area.
 * Freeze Warnings / Frost Advisories (crops and plants), Wind Chill and cold
 * alerts are deliberately excluded: they do not by themselves mean roads are
 * hazardous, and flagging every road for them would be misleading.
 */
const WINTER_ALERT =
  /winter storm|winter weather|ice storm|blizzard|freezing (rain|drizzle|fog|spray)|snow squall|lake effect snow|heavy snow|sleet/i;

export function winterAlerts(alerts: NwsAlert[] | null | undefined): NwsAlert[] {
  return (alerts ?? []).filter((alert) => WINTER_ALERT.test(alert.event));
}

/**
 * Area-wide caution reason, or null. Applies to every road without a more
 * specific report: an active NWS winter alert, or forecast freezing
 * precipitation (the Elevated weather-attention rule).
 */
export function areaCautionReason(
  alerts: NwsAlert[] | null | undefined,
  attention: WeatherAttention,
): string | null {
  const winter = winterAlerts(alerts);
  if (winter.length > 0) {
    return `${winter.map((alert) => alert.event).join(", ")} in effect`;
  }
  if (attention === "Elevated") {
    return "Freezing precipitation in the 24-hour forecast";
  }
  return null;
}

/**
 * Colour for an ordinary road (one without its own incident). Incident lines
 * are drawn on top in their own colour, so closures and hazards show where
 * they actually are.
 */
export function baseRoadCondition(
  incidentDataLoaded: boolean,
  areaCaution: string | null,
): RoadCondition {
  if (areaCaution) return "caution";
  return incidentDataLoaded ? "clear" : "unknown";
}

export type ConditionSummary = {
  tone: RoadCondition;
  headline: string;
  detail: string;
};

/** One plain-language sentence for the banner above the map. */
export function summarizeConditions(input: {
  incidents: TrafficIncident[] | null;
  incidentsConfigured: boolean;
  incidentsError: string | null;
  areaCaution: string | null;
}): ConditionSummary {
  const incidents = input.incidents ?? [];
  const closed = incidents.filter((incident) => incident.condition === "closed").length;
  const caution = incidents.filter((incident) => incident.condition === "caution").length;
  const counts = [
    closed ? `${closed} closure${closed === 1 ? "" : "s"}` : null,
    caution ? `${caution} hazard${caution === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" and ");

  if (input.areaCaution) {
    return {
      tone: closed ? "closed" : "caution",
      headline: `Use caution on all roads — ${input.areaCaution}.`,
      detail: counts ? `${counts} reported nearby.` : input.incidents ? "No closures reported nearby." : "",
    };
  }
  if (closed || caution) {
    return {
      tone: closed ? "closed" : "caution",
      headline: `${counts.charAt(0).toUpperCase()}${counts.slice(1)} reported nearby.`,
      detail: "Other roads: no reported problems.",
    };
  }
  if (input.incidents) {
    return {
      tone: "clear",
      headline: "No closures or hazards reported nearby.",
      detail: "Green means nothing is reported — not a guarantee of road surface conditions.",
    };
  }
  return {
    tone: "unknown",
    headline: input.incidentsConfigured
      ? "Closure and hazard reports are unavailable right now."
      : "Closure and hazard reports are not connected.",
    detail: input.incidentsConfigured
      ? input.incidentsError ?? ""
      : "Roads show weather caution only. Add TOMTOM_API_KEY to enable live closures.",
  };
}

/** Incidents on or right next to a road (within `meters`), closures first. */
export function incidentsOnRoad(
  road: Feature<Geometry, RoadProperties>,
  incidents: TrafficIncident[],
  meters = 30,
): TrafficIncident[] {
  return incidents.filter((incident) => {
    const distance = minimumDistance(road.geometry, incident.geometry);
    return distance !== null && distance <= meters;
  });
}

/** Condition of one selected road, with the reason in plain words. */
export function roadConditionFor(
  onRoad: TrafficIncident[],
  incidentDataLoaded: boolean,
  areaCaution: string | null,
): { condition: RoadCondition; reason: string } {
  const closure = onRoad.find((incident) => incident.condition === "closed");
  if (closure) return { condition: "closed", reason: closure.description };
  const hazard = onRoad[0];
  if (hazard) return { condition: "caution", reason: hazard.description };
  if (areaCaution) return { condition: "caution", reason: areaCaution };
  return incidentDataLoaded
    ? { condition: "clear", reason: "No closures or hazards reported on this road." }
    : { condition: "unknown", reason: "Closure and hazard reports are not available here." };
}
