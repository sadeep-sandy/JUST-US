"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createInvite, redeemInvite, type PairState } from "@/app/pair/actions";

export default function PairPanel({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"share" | "enter">("share");

  // --- Generate / share my code ---
  const [code, setCode] = useState<string | null>(null);

  // Once a code has been shared, watch for someone redeeming it, then open
  // that brand-new conversation automatically.
  useEffect(() => {
    if (!code) return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("invites")
        .select("couple_id")
        .eq("code", code)
        .maybeSingle();
      if (data?.couple_id) {
        clearInterval(interval);
        router.replace(`/chat/${data.couple_id}`);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [code, router]);

  const [genError, setGenError] = useState<string | null>(null);
  const [generating, startGen] = useTransition();
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    setGenError(null);
    startGen(async () => {
      const res = await createInvite();
      if (res.error) setGenError(res.error);
      else setCode(res.code ?? null); // setting the code starts the watcher
    });
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // --- Enter partner's code ---
  const [redeemState, redeemAction, redeeming] = useActionState<
    PairState,
    FormData
  >(redeemInvite, {});

  useEffect(() => {
    // Once redeem succeeds, open the new conversation.
    if (redeemState.ok && redeemState.coupleId) {
      router.replace(`/chat/${redeemState.coupleId}`);
    }
  }, [redeemState, router]);

  return (
    <div className="w-full max-w-md rounded-3xl bg-white dark:bg-neutral-900 p-7 shadow-2xl">
      <div className="mb-2 flex items-center">
        <Link
          href="/chat"
          aria-label="Back to messages"
          className="-ml-2 grid h-9 w-9 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
      </div>
      <h1 className="text-center text-xl font-semibold">Start a new chat</h1>
      <p className="mt-1 text-center text-sm text-neutral-500">
        Hi {displayName} — connect with someone using a private code.
      </p>

      <div className="mt-6 grid grid-cols-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 p-1 text-sm font-medium">
        <button
          onClick={() => setTab("share")}
          className={`rounded-lg py-2 transition ${
            tab === "share" ? "bg-white dark:bg-neutral-700 shadow" : "text-neutral-500"
          }`}
        >
          Share my code
        </button>
        <button
          onClick={() => setTab("enter")}
          className={`rounded-lg py-2 transition ${
            tab === "enter" ? "bg-white dark:bg-neutral-700 shadow" : "text-neutral-500"
          }`}
        >
          Enter their code
        </button>
      </div>

      {tab === "share" ? (
        <div className="mt-6 text-center">
          {code ? (
            <>
              <div className="select-all rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 py-5 text-3xl font-bold tracking-[0.3em] text-violet-600">
                {code}
              </div>
              <button
                onClick={copyCode}
                className="mt-4 w-full rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 py-2.5 font-semibold text-white shadow-lg shadow-violet-500/25 hover:opacity-95"
              >
                {copied ? "Copied!" : "Copy code"}
              </button>
              <p className="mt-3 text-xs text-neutral-500">
                Send this to your partner. It expires in 7 days. This page will
                move to your chat once they join.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-500">
                Generate a private code and share it with your partner.
              </p>
              {genError && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  {genError}
                </p>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="mt-4 w-full rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 py-2.5 font-semibold text-white shadow-lg shadow-violet-500/25 hover:opacity-95 disabled:opacity-60"
              >
                {generating ? "Generating…" : "Generate my code"}
              </button>
            </>
          )}
        </div>
      ) : (
        <form action={redeemAction} className="mt-6 space-y-4">
          <input
            name="code"
            placeholder="ENTER CODE"
            autoCapitalize="characters"
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-center text-xl font-semibold uppercase tracking-[0.25em] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-300/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          {redeemState.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {redeemState.error}
            </p>
          )}
          <button
            type="submit"
            disabled={redeeming}
            className="w-full rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 py-2.5 font-semibold text-white shadow-lg shadow-violet-500/25 hover:opacity-95 disabled:opacity-60"
          >
            {redeeming ? "Linking…" : "Link with partner"}
          </button>
        </form>
      )}
    </div>
  );
}
