"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Unambiguous alphabet (no 0/O/1/I) for a friendly, easy-to-share code.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export type PairState = {
  error?: string;
  code?: string;
  ok?: boolean;
  coupleId?: string;
};

// Create (or reuse) an invite code for the current user to share.
export async function createInvite(): Promise<PairState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Reuse an existing unexpired, unused invite if there is one.
  const { data: existing } = await supabase
    .from("invites")
    .select("code, expires_at, used_by")
    .eq("created_by", user.id)
    .is("used_by", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return { code: existing.code };

  const code = generateCode();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const { error } = await supabase.from("invites").insert({
    code,
    created_by: user.id,
    expires_at: expires.toISOString(),
  });

  if (error) return { error: error.message };
  return { code };
}

// Redeem a partner's invite code -> forms the couple via the secure RPC.
export async function redeemInvite(
  _prev: PairState,
  formData: FormData
): Promise<PairState> {
  const code = String(formData.get("code") || "")
    .trim()
    .toUpperCase();
  if (!code) return { error: "Enter a code." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_invite", { p_code: code });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, coupleId: data as string };
}
