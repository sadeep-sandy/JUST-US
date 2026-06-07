// Shared application types mirroring the database schema.

export type MessageKind = "text" | "image" | "audio" | "file" | "call";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Couple {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
}

export interface Message {
  id: string;
  couple_id: string;
  sender_id: string;
  kind: MessageKind;
  body: string | null;
  media_path: string | null;
  created_at: string;
  read_at: string | null;
  reply_to: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  expires_at: string | null;
}

export interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface Invite {
  code: string;
  created_by: string;
  used_by: string | null;
  couple_id: string | null;
  created_at: string;
  expires_at: string;
}
