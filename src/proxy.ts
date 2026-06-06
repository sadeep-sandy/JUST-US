import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed `middleware` to `proxy` (runs on the Node.js runtime).
// This refreshes the Supabase auth session and guards protected routes.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on everything except static assets and the public icons/manifest.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
