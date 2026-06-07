// Shown instantly while the inbox loads.
export default function Loading() {
  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-white dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="h-6 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-800" />
      </header>
      <div className="space-y-1 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-3">
            <div className="h-14 w-14 animate-pulse rounded-full bg-neutral-100 dark:bg-neutral-900" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
              <div className="h-3 w-48 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
