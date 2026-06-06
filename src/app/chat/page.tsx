import { redirect } from "next/navigation";
import { getConversations } from "@/lib/data";
import ConversationList from "@/components/ConversationList";

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
