"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, signUp, type AuthState } from "@/app/(auth)/actions";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const action = mode === "login" ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {}
  );

  return (
    <div className="w-full max-w-sm">
      {/* Brand */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-white/15 backdrop-blur-sm">
          <svg viewBox="0 0 24 24" className="h-9 w-9 text-white" fill="currentColor">
            <path d="M12 21s-6.7-4.35-9.33-8.07C.9 10.27 1.4 6.6 4.2 5.13c2.05-1.08 4.4-.4 5.8 1.27L12 8l2-1.6c1.4-1.67 3.75-2.35 5.8-1.27 2.8 1.47 3.3 5.14 1.53 7.8C18.7 16.65 12 21 12 21z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Just Us</h1>
        <p className="mt-1 text-sm text-white/70">A private space, just for two.</p>
      </div>

      {/* Card */}
      <div className="rounded-3xl bg-white p-7 shadow-2xl dark:bg-neutral-900">
        <h2 className="mb-5 text-center text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {mode === "login" ? "Welcome back 💜" : "Create your account"}
        </h2>

        <form action={formAction} className="space-y-3.5">
          <Field
            label="Username"
            name="username"
            type="text"
            placeholder="e.g. sandeep"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            required
          />
          {mode === "signup" && (
            <p className="text-xs text-neutral-400">
              Your username is what your partner will see. 3–20 letters, numbers
              or underscores.
            </p>
          )}

          {state.error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {state.error}
            </p>
          )}
          {state.message && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 py-3 font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-60"
          >
            {pending
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-500">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="font-semibold text-violet-600">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-violet-600">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </span>
      <input {...props} className="field" />
    </label>
  );
}
