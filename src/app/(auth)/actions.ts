"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

// Usernames are mapped to a hidden internal email so we can use Supabase's
// email/password auth while users only ever deal with a username.
const USERNAME_DOMAIN = "justus.app";
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function usernameToEmail(username: string): string {
  return `${username.toLowerCase()}@${USERNAME_DOMAIN}`;
}

// Turn Supabase's email-centric errors into username-friendly messages.
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Incorrect username or password.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "That username is already taken.";
  if (m.includes("email")) return message.replace(/email/gi, "username");
  return message;
}

export async function signIn(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const username = String(formData.get("username") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  if (!USERNAME_RE.test(username)) {
    return { error: "Enter a valid username." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error) return { error: friendly(error.message) };
  redirect("/chat");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const username = String(formData.get("username") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  if (!USERNAME_RE.test(username)) {
    return {
      error:
        "Username must be 3–20 characters: letters, numbers or underscores only.",
    };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
    options: { data: { display_name: username } },
  });

  if (error) return { error: friendly(error.message) };

  if (data.session) redirect("/chat");
  return {
    message:
      "Account created! You can sign in now. (If sign-in fails, turn off 'Confirm email' in Supabase.)",
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
