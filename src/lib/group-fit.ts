/** Pure, UI-independent group fit calculation. Missing ratings are not zeros. */
export type FitRating = { suggestionId: string; userId: string; score: number }
export type FitResult = { suggestionId: string; count: number; average: number; percent: number; complete: boolean }

export function calculateGroupFit(suggestionIds: string[], memberCount: number, ratings: FitRating[]): FitResult[] {
  const grouped = new Map<string, Map<string, number>>()
  for (const rating of ratings) {
    if (!Number.isInteger(rating.score) || rating.score < 1 || rating.score > 5) continue
    const map = grouped.get(rating.suggestionId) ?? new Map<string, number>()
    map.set(rating.userId, rating.score)
    grouped.set(rating.suggestionId, map)
  }
  return suggestionIds.map(suggestionId => {
    const scores = [...(grouped.get(suggestionId)?.values() ?? [])]
    const count = scores.length
    const average = count ? scores.reduce((sum, n) => sum + n, 0) / count : 0
    return { suggestionId, count, average, percent: count ? Math.round(average / 5 * 100) : 0, complete: memberCount > 0 && count >= memberCount }
  }).sort((a, b) => (b.average - a.average) || (b.count - a.count) || a.suggestionId.localeCompare(b.suggestionId))
}
