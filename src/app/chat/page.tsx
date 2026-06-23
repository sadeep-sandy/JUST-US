import { redirect } from "next/navigation";
import { getConversations } from "@/lib/data";
import ConversationList from "@/components/ConversationList";

// Always render the inbox fresh so last-message previews and unread counts are
// up to date when returning from a chat (never a cached snapshot).
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const data = await getConversations();
  if (!data) redirect("/login");

  return (
    <ConversationList
      userId={data.userId}
      conversations={data.conversations}
    />
  );
}
