import { redirect } from "next/navigation";
import { getConversation } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import ChatRoom from "@/components/ChatRoom";
import type { Message } from "@/lib/types";

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
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("couple_id", id)
    .order("created_at", { ascending: true })
    .limit(300);

  return (
    <ChatRoom
      coupleId={convo.couple.id}
      meId={convo.userId}
      partnerName={convo.partnerName}
      initialMessages={(messages as Message[]) ?? []}
    />
  );
}
