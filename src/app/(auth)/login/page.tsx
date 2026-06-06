import AuthForm from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-fuchsia-600 via-violet-600 to-indigo-700 p-4">
      <AuthForm mode="login" />
    </main>
  );
}
