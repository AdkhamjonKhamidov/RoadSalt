import MapCanvas from "./components/MapCanvas";
import { DEMO_LOCATION } from "./components/map-config";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F9F7F7] text-[#112D4E]">
      <header className="border-b border-[#DBE2EF] bg-[#F9F7F7]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-3 md:px-8">
          <div>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-[#3F72AF]">
              RoadSalt
            </p>
            <p className="mt-1 text-sm font-medium text-[#112D4E]">
              {DEMO_LOCATION}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-4 text-sm md:gap-8">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[#3F72AF]">
                Weather data
              </p>
              <p className="font-medium">Added in a later stage</p>
            </div>
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[#3F72AF]">
                Basemap
              </p>
              <p className="font-medium">Live tiles</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-4 md:px-6 md:py-6">
        <div className="grid gap-4 xl:grid-cols-[2.2fr_1fr]">
          <section className="overflow-hidden border border-[#112D4E] bg-[#DBE2EF]/40">
            <div className="flex items-center justify-between border-b border-[#112D4E]/20 bg-[#F9F7F7] px-4 py-3">
              <div>
                <p className="text-[0.6rem] uppercase tracking-[0.25em] text-[#3F72AF]">
                  Local road map
                </p>
                <h2 className="mt-1 text-lg font-semibold">Salisbury area overview</h2>
              </div>

              <div className="rounded border border-[#112D4E]/20 bg-[#DBE2EF] px-2 py-1 text-xs text-[#112D4E]">
                3 km radius
              </div>
            </div>

            <div className="h-[560px] bg-[#EAF1F7]">
              <MapCanvas />
            </div>
          </section>

          <aside className="border border-[#112D4E] bg-[#F9F7F7] p-4">
            <div className="mb-4 border-b border-[#DBE2EF] pb-3">
              <p className="text-[0.6rem] uppercase tracking-[0.25em] text-[#3F72AF]">
                Road details
              </p>
              <h3 className="mt-2 text-2xl font-semibold">No road selected</h3>
            </div>

            <div className="space-y-5 text-sm leading-6">
              <p>
                Road selection and road details will appear when live road
                geometry is connected. The roads currently visible are part of
                the basemap and are not yet selectable.
              </p>
              <div className="border border-[#DBE2EF] bg-[#DBE2EF]/40 p-3">
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.19em] text-[#3F72AF]">
                  Available in this stage
                </p>
                <p className="mt-2">
                  Live CARTO basemap tiles with OpenStreetMap road and place
                  labels, plus the marked Salisbury demo location.
                </p>
              </div>
              <p className="text-[#3F72AF]">
                Weather, terrain, environmental features, and road-attention
                indicators are not loaded yet.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
