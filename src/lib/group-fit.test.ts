import { describe, expect, it } from 'vitest'
import { calculateGroupFit } from './group-fit'

describe('group preference matching', () => {
  it('does not count missing ratings as zeros, and reports participation', () => {
    const result = calculateGroupFit(['a', 'b'], 3, [{ suggestionId: 'a', userId: 'u1', score: 5 }, { suggestionId: 'b', userId: 'u1', score: 3 }, { suggestionId: 'b', userId: 'u2', score: 3 }])
    expect(result[0]).toMatchObject({ suggestionId: 'a', percent: 100, count: 1, complete: false })
    expect(result[1]).toMatchObject({ suggestionId: 'b', percent: 60, count: 2, complete: false })
  })
  it('uses coverage to break equal average ratings', () => {
    const result = calculateGroupFit(['a', 'b'], 2, [{ suggestionId: 'a', userId: 'u1', score: 4 }, { suggestionId: 'b', userId: 'u1', score: 4 }, { suggestionId: 'b', userId: 'u2', score: 4 }])
    expect(result[0]).toMatchObject({ suggestionId: 'b', percent: 80, complete: true })
  })
  it('keeps unrated options visible', () => {
    expect(calculateGroupFit(['a'], 1, [])[0]).toMatchObject({ count: 0, percent: 0, complete: false })
  })
})
