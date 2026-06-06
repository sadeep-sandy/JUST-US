"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Uses the public anon key; all access is
// still gated by Row Level Security on the database.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
