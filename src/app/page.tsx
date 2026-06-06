import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/data";

export default async function Home() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  redirect("/chat");
}
