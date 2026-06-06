import { createClient } from "@/lib/supabase/server";
import type { Couple, Message, MessageKind, Profile } from "@/lib/types";

export interface SessionContext {
  userId: string;
  email: string | null;
  couple: Couple | null;
  partner: Profile | null;
}

// Resolves the signed-in user, their couple (if paired) and their partner's
// profile. Returns null when there is no authenticated user.
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: couple } = await supabase
    .from("couples")
    .select("*")
    .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
    .limit(1)
    .maybeSingle();

  let partner: Profile | null = null;
  if (couple) {
    const partnerId =
      couple.user_a === user.id ? couple.user_b : couple.user_a;
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", partnerId)
      .maybeSingle();
    partner = data;
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    couple: couple ?? null,
    partner,
  };
}

export interface ConversationSummary {
  id: string; // couple/conversation id
  partnerId: string;
  partnerName: string;
  lastMessage: string | null;
  lastKind: MessageKind | null;
  lastAt: string | null;
  lastMine: boolean;
  unread: number;
}

// Loads every conversation for the signed-in user, newest activity first,
// with the partner's name, a last-message preview and an unread count.
export async function getConversations(): Promise<{
  userId: string;
  conversations: ConversationSummary[];
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: couples } = await supabase
    .from("couples")
    .select("*")
    .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);

  const list = (couples as Couple[]) ?? [];
  if (list.length === 0) return { userId: user.id, conversations: [] };

  const partnerIds = list.map((c) =>
    c.user_a === user.id ? c.user_b : c.user_a
  );
  const coupleIds = list.map((c) => c.id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", partnerIds);
  const nameById = new Map<string, string>();
  (profiles ?? []).forEach((p) => nameById.set(p.id, p.display_name ?? "Friend"));

  // Pull recent messages across all conversations and reduce in memory.
  const { data: msgs } = await supabase
    .from("messages")
    .select("*")
    .in("couple_id", coupleIds)
    .order("created_at", { ascending: false })
    .limit(500);

  const lastByCouple = new Map<string, Message>();
  const unreadByCouple = new Map<string, number>();
  (msgs as Message[] | null)?.forEach((m) => {
    if (!lastByCouple.has(m.couple_id)) lastByCouple.set(m.couple_id, m);
    if (m.sender_id !== user.id && m.read_at === null) {
      unreadByCouple.set(m.couple_id, (unreadByCouple.get(m.couple_id) ?? 0) + 1);
    }
  });

  const conversations: ConversationSummary[] = list.map((c) => {
    const partnerId = c.user_a === user.id ? c.user_b : c.user_a;
    const last = lastByCouple.get(c.id) ?? null;
    return {
      id: c.id,
      partnerId,
      partnerName: nameById.get(partnerId) ?? "Friend",
      lastMessage: last?.body ?? null,
      lastKind: last?.kind ?? null,
      lastAt: last?.created_at ?? c.created_at,
      lastMine: last?.sender_id === user.id,
      unread: unreadByCouple.get(c.id) ?? 0,
    };
  });

  conversations.sort((a, b) =>
    (b.lastAt ?? "").localeCompare(a.lastAt ?? "")
  );

  return { userId: user.id, conversations };
}

// Resolves a single conversation the user belongs to, with the partner name.
export async function getConversation(coupleId: string): Promise<{
  userId: string;
  couple: Couple;
  partnerName: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: couple } = await supabase
    .from("couples")
    .select("*")
    .eq("id", coupleId)
    .maybeSingle();
  if (!couple) return null;
  if (couple.user_a !== user.id && couple.user_b !== user.id) return null;

  const partnerId = couple.user_a === user.id ? couple.user_b : couple.user_a;
  const { data: partner } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", partnerId)
    .maybeSingle();

  return {
    userId: user.id,
    couple: couple as Couple,
    partnerName: partner?.display_name || "Friend",
  };
}
