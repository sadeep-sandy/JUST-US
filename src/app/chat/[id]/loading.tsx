// Shown instantly while the conversation loads — makes tapping feel snappy.
export default function Loading() {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <div className="h-6 w-6 rounded-full bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-4 w-28 rounded bg-neutral-200 dark:bg-neutral-800" />
      </header>
      <div className="flex-1 space-y-3 p-4">
        <div className="h-9 w-40 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900" />
        <div className="ml-auto h-9 w-52 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900" />
        <div className="h-9 w-32 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900" />
        <div className="ml-auto h-9 w-44 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900" />
      </div>
    </div>
  );
}
