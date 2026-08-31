"use client";

import { useEffect } from "react";

export default function ErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /**
   * The boundary used to swallow `error` entirely, which made a production failure
   * unreconstructable: no stack anywhere and no digest to match against a server log.
   * Every read this app makes is somebody else's API, so the message is usually the
   * whole diagnosis.
   */
  useEffect(() => {
    console.error("[runback]", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col items-center px-5 py-24 text-center">
      <h1 className="text-balance text-head font-medium tracking-tight text-title">
        Something broke
      </h1>
      <p
        className="mt-3 max-w-[32rem] text-pretty text-body leading-relaxed text-muted"
        role="alert"
      >
        Reload this page. If it keeps happening, the book may be refusing us.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rb-press mt-8 h-11 rounded-full bg-mint-soft px-5 text-body font-medium text-mint-text hover:brightness-110"
      >
        Try again
      </button>
      {error.digest ? (
        <p className="mt-6 font-mono text-micro text-faint">ref {error.digest}</p>
      ) : null}
    </main>
  );
}
