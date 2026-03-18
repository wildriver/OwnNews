// Loading skeleton shown by Next.js App Router during page transitions
// (date filter, category filter, URL navigation etc.)

export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 animate-pulse">
      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="h-8 w-36 bg-white/10 rounded-lg mb-2" />
          <div className="h-4 w-52 bg-white/5 rounded" />
        </div>
        <div className="h-8 w-40 bg-white/10 rounded-lg" />
      </header>

      {/* Category filter bar skeleton */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        <div className="h-4 w-12 bg-white/5 rounded mr-1" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-6 w-20 bg-white/10 rounded-full" />
        ))}
      </div>

      {/* Article card grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/10 bg-white/5 overflow-hidden flex flex-col"
          >
            {/* Image area */}
            <div className="h-32 bg-white/10" />
            {/* Content */}
            <div className="p-3 space-y-2 flex-1">
              <div className="flex gap-1.5">
                <div className="h-5 w-8 bg-white/10 rounded-full" />
                <div className="h-5 w-14 bg-white/10 rounded-full" />
              </div>
              <div className="h-4 w-full bg-white/10 rounded" />
              <div className="h-4 w-4/5 bg-white/10 rounded" />
              <div className="h-3 w-full bg-white/5 rounded mt-2" />
              <div className="h-3 w-3/4 bg-white/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
