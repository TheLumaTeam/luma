/** "just now", "5m ago", "in 3h"; a date once it is more than a week away. */
export function relativeTime(seconds: number, now = Date.now()) {
  const delta = seconds * 1000 - now;
  const minutes = Math.floor(Math.abs(delta) / 60_000);
  if (minutes < 1) return delta > 0 ? "in under a minute" : "just now";
  if (minutes >= 7 * 24 * 60) return new Date(seconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const amount = minutes < 60 ? `${minutes}m` : minutes < 24 * 60 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / (24 * 60))}d`;
  return delta > 0 ? `in ${amount}` : `${amount} ago`;
}
