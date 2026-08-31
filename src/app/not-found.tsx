import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col items-center px-5 py-24 text-center">
      <h1 className="text-balance text-head font-medium tracking-tight text-title">
        Nothing at this address
      </h1>
      <p className="mt-3 max-w-[32rem] text-pretty text-body leading-relaxed text-muted">
        That wallet link is malformed, or it points at a book we do not read.
      </p>
      <Link
        href="/"
        className="rb-press mt-8 inline-flex h-11 items-center rounded-full bg-mint-soft px-5 text-body font-medium text-mint-text hover:brightness-110"
      >
        Back to Runback
      </Link>
    </main>
  );
}
