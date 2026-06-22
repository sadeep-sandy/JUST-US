import { redirect } from "next/navigation";
import { getConversation } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import ChatRoom from "@/components/ChatRoom";
import type { Message } from "@/lib/types";

// Always render fresh: never serve a cached snapshot of the thread when the
// chat is reopened, so the latest messages are guaranteed to load.
export const dynamic = "force-dynamic";

// In Next.js 16, route `params` are async and must be awaited.
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const convo = await getConversation(id);
  if (!convo) redirect("/chat"); // not signed in or not a member

  const supabase = await createClient();
  // Load the most recent 300 messages (newest first), then flip back to
  // chronological order for display. Ordering ascending with a limit would
  // cap at the OLDEST 300 and hide newer messages once the thread grows.
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("couple_id", id)
    .order("created_at", { ascending: false })
    .limit(300);

  const initialMessages = ((messages as Message[]) ?? []).reverse();

  return (
    <ChatRoom
      coupleId={convo.couple.id}
      meId={convo.userId}
      partnerId={convo.partnerId}
      partnerName={convo.partnerName}
      partnerAvatar={convo.partnerAvatar}
      partnerLastSeen={convo.partnerLastSeen}
      disappearSeconds={convo.disappearSeconds}
      initialMessages={initialMessages}
    />
  );
}
