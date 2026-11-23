import { WalletBrowser } from "@/components/WalletBrowser";
import { TraderGallery } from "@/components/TraderGallery";
import { VenueStrip } from "@/components/VenueStrip";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col overflow-x-clip px-5 pb-10 pt-10 sm:pt-14">
      <section className="flex flex-col items-center text-center">
        <h1
          className="rb-hero max-w-[20ch] text-balance text-[clamp(2.35rem,4.8vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-title"
          style={{ animationDelay: "0ms" }}
        >
          Paste a wallet.
          <br />
          Watch it trade.
        </h1>
        <p
          className="rb-hero mt-4 max-w-[32rem] text-pretty text-lead leading-relaxed text-muted"
          style={{ animationDelay: "70ms" }}
        >
          Any perp position on any book that publishes a public tape. Pick one,
          watch it fill by fill, and export the clip.
        </p>
        <div
          className="rb-hero mt-8 w-full max-w-[720px] text-left"
          style={{ animationDelay: "140ms" }}
        >
          <WalletBrowser />
        </div>
      </section>

      <VenueStrip />
      <TraderGallery />
    </main>
  );
}
