import { WalletBrowser } from "@/components/WalletBrowser";
import { TraderGallery } from "@/components/TraderGallery";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col px-5 pb-8 pt-12 sm:pt-16">
      <section className="flex flex-col items-center text-center">
        <h1 className="max-w-[18ch] text-balance text-[clamp(1.75rem,4vw,2.5rem)] font-medium leading-[1.15] tracking-tight text-title">
          Paste a wallet. Watch it trade.
        </h1>
        <p className="mt-3 max-w-[32rem] text-pretty text-body leading-relaxed text-muted">
          Any perp position on any book we can read. Pick one, watch it, export the clip.
        </p>
        <div className="mt-8 w-full max-w-[720px] text-left">
          <WalletBrowser />
        </div>
      </section>

      <TraderGallery />
    </main>
  );
}
