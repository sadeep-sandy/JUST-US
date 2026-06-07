"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/storage";
import { signOut } from "@/app/(auth)/actions";
import {
  WALLPAPERS,
  getWallpaperKey,
  setWallpaperKey,
} from "@/lib/theme";

interface Props {
  userId: string;
  initialName: string;
  initialAvatar: string | null;
}

export default function SettingsPanel({
  userId,
  initialName,
  initialAvatar,
}: Props) {
  const supabase = createClient();
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wallpaper, setWallpaper] = useState("default");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setWallpaper(getWallpaperKey()), []);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadAvatar(userId, file);
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
      setAvatar(url);
    } catch (err) {
      alert("Photo upload failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    setBusy(true);
    await supabase
      .from("profiles")
      .update({ display_name: name.trim() || "You" })
      .eq("id", userId);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function pickWallpaper(key: string) {
    setWallpaper(key);
    setWallpaperKey(key);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-white dark:bg-neutral-950">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-3 dark:border-neutral-800">
        <Link
          href="/chat"
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1 className="text-lg font-bold">Settings</h1>
      </header>

      <div className="space-y-8 p-6">
        {/* Avatar */}
        <section className="flex flex-col items-center gap-3">
          <div className="relative">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt="avatar"
                className="h-24 w-24 rounded-full object-cover"
              />
            ) : (
              <div className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-3xl font-semibold text-white">
                {name.charAt(0).toUpperCase()}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-fuchsia-500 text-white shadow-md disabled:opacity-50"
              aria-label="Change photo"
            >
              📷
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
          <p className="text-xs text-neutral-400">Tap the camera to change your photo</p>
        </section>

        {/* Name */}
        <section className="space-y-2">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Display name
          </label>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field"
            />
            <button
              onClick={saveName}
              disabled={busy}
              className="shrink-0 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 px-4 font-semibold text-white disabled:opacity-50"
            >
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </section>

        {/* Wallpaper */}
        <section className="space-y-2">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Chat wallpaper
          </p>
          <div className="grid grid-cols-5 gap-2">
            {WALLPAPERS.map((w) => (
              <button
                key={w.key}
                onClick={() => pickWallpaper(w.key)}
                className={`h-16 rounded-xl border-2 text-[10px] ${
                  wallpaper === w.key ? "border-fuchsia-500" : "border-transparent"
                }`}
                style={{
                  background:
                    w.background || "repeating-linear-gradient(45deg,#eee,#eee 6px,#fff 6px,#fff 12px)",
                }}
                aria-label={w.label}
              >
                <span className="rounded bg-black/40 px-1 text-white">{w.label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-400">
            Wallpaper is saved on this device.
          </p>
        </section>

        {/* Sign out */}
        <form action={signOut}>
          <button className="w-full rounded-xl border border-neutral-200 py-2.5 font-medium text-rose-600 dark:border-neutral-800">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
