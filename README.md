# RoadSalt

RoadSalt is a simple location-based awareness demo that helps people inspect nearby roads, understand winter weather risk, and identify nearby environmental features that could be harmed by unnecessary salt runoff. The default demo is centered on Salisbury, Maryland, and the interface is designed for quick exploration rather than automated decision-making.

## What the problem is

Winter maintenance is often based on broad weather information, but local conditions can vary widely from one road to the next. Roads may have different weather exposure, terrain, and nearby wetlands, waterways, farms, or protected habitats. That matters because over-application of salt can harm soil, water, and nearby ecosystems.

RoadSalt is not a treatment recommendation engine. It is a decision-support tool that helps a person review local context before deciding whether a road should receive extra attention.

## How the demo works

- The interactive map centers on a fixed Salisbury address, with live nearby roads and mapped environmental features from OpenStreetMap.
- Selecting an OSM road shows its mapped name and class, approximate proximity to mapped sensitive features, and a weather-attention indicator based on Open-Meteo forecast data.
- The map marks the demo location and supports zooming, panning, and toggling environmental layers.
- Indicators are explanatory only. Atmospheric forecasts cannot confirm pavement ice, and missing map features do not mean an area is environmentally safe.

## Screenshot placeholder

_A screenshot of the live map will be added here._

## Data sources and attribution

- The map uses CARTO Positron tiles and OpenStreetMap / Overpass data for nearby roads and environmental features.
- The Salisbury address was geocoded once with OpenStreetMap Nominatim and its coordinates are cached for the demo.
- Open-Meteo supplies current conditions and the next 24 hours of forecast data.
- Open-Meteo Elevation terrain estimates are planned for a later stage.

Follow each provider's published terms, attribution requirements, and rate limits when using its data.

## Limitations

- The elevation model is not street-level engineering data and should be presented as an estimate only.
- Weather data describes atmospheric conditions, not pavement temperature.
- Nearby environmental features are only as complete as the mapped data available in the source APIs.
- OpenStreetMap feature coverage is incomplete and is not a comprehensive inventory of waterways, farms, wetlands, or habitats.
- Terrain analysis has not yet been connected.
- The demo is intentionally simple and should not be treated as an operational road-treatment system.

## Project posture

This application is designed for a public-facing hackathon demonstration. It is intentionally lightweight, explanatory, and easy to understand for a general audience.
