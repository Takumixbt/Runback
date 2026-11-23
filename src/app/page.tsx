import { WalletBrowser } from "@/components/WalletBrowser";
import { TraderGallery } from "@/components/TraderGallery";
import { ReplayStage } from "@/components/ReplayStage";
import { VenueStrip } from "@/components/VenueStrip";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col overflow-x-clip px-5 pb-10 pt-10 sm:pt-14">
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-12">
        <div className="flex flex-col">
          <h1
            className="rb-hero text-balance text-[clamp(2.35rem,4.8vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-title"
            style={{ animationDelay: "0ms" }}
          >
            Paste a wallet.
            <br />
            Watch it trade.
          </h1>
          <p
            className="rb-hero mt-4 max-w-[34rem] text-pretty text-lead leading-relaxed text-muted"
            style={{ animationDelay: "70ms" }}
          >
            Any perp position on any book that publishes a public tape. Pick one,
            watch it fill by fill, and export the clip.
          </p>
          <div className="rb-hero mt-8 w-full max-w-[680px]" style={{ animationDelay: "140ms" }}>
            <WalletBrowser />
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-12 bg-[radial-gradient(62%_62%_at_58%_36%,rgba(80,210,193,0.10),transparent_72%)]"
          />
          <div className="relative">
            <ReplayStage />
          </div>
        </div>
      </section>

      <VenueStrip />
      <TraderGallery />
    </main>
  );
}
