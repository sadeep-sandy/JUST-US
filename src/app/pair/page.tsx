import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import PairPanel from "@/components/PairPanel";

export default async function PairPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", ctx.userId)
    .maybeSingle();

  const displayName =
    profile?.display_name || ctx.email?.split("@")[0] || "there";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-fuchsia-600 via-violet-600 to-indigo-700 p-4">
      <PairPanel displayName={displayName} />
    </main>
  );
}
