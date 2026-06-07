// Chat wallpaper presets, stored per-device in localStorage (no DB needed).

export interface Wallpaper {
  key: string;
  label: string;
  // CSS background applied to the chat thread.
  background: string;
}

export const WALLPAPERS: Wallpaper[] = [
  { key: "default", label: "Default", background: "" },
  {
    key: "blush",
    label: "Blush",
    background: "linear-gradient(160deg, #fdf2f8 0%, #fae8ff 100%)",
  },
  {
    key: "sunset",
    label: "Sunset",
    background: "linear-gradient(160deg, #fff1eb 0%, #ffe3ec 60%, #ffd6e8 100%)",
  },
  {
    key: "ocean",
    label: "Ocean",
    background: "linear-gradient(160deg, #eef2ff 0%, #e0f2fe 100%)",
  },
  {
    key: "night",
    label: "Night",
    background: "linear-gradient(160deg, #0f172a 0%, #1e1b4b 100%)",
  },
];

const KEY = "chatWallpaper";

export function getWallpaperKey(): string {
  if (typeof window === "undefined") return "default";
  return localStorage.getItem(KEY) || "default";
}

export function setWallpaperKey(key: string) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, key);
}

export function wallpaperBackground(key: string): string {
  return WALLPAPERS.find((w) => w.key === key)?.background || "";
}
