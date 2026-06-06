"use client";

import { createClient } from "@/lib/supabase/client";

const BUCKET = "media";

// Upload a file into the couple's private folder. Returns the storage path
// (e.g. "{coupleId}/169..._photo.jpg") to store on the message row.
export async function uploadMedia(
  coupleId: string,
  file: Blob,
  filename: string
): Promise<string> {
  const supabase = createClient();
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${coupleId}/${crypto.randomUUID()}_${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Create a short-lived signed URL to view a private media object.
export async function getSignedUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
