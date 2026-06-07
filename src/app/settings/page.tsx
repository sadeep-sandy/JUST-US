import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/data";
import SettingsPanel from "@/components/SettingsPanel";

export default async function SettingsPage() {
  const me = await getMyProfile();
  if (!me) redirect("/login");
  return (
    <SettingsPanel
      userId={me.userId}
      initialName={me.displayName}
      initialAvatar={me.avatarUrl}
    />
  );
}
