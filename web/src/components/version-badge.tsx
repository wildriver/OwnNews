export function VersionBadge() {
  const hash = process.env.NEXT_PUBLIC_GIT_HASH || 'dev'
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || null

  const label = buildTime
    ? `v${hash.slice(0, 7)} · ${new Date(buildTime).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : `v${hash.slice(0, 7)}`

  return (
    <div className="fixed bottom-2 right-3 z-50 pointer-events-none">
      <span className="text-[10px] text-muted-foreground/50 font-mono select-none">
        {label}
      </span>
    </div>
  )
}
