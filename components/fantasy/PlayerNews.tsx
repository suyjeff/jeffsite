import React, { useMemo } from 'react'
import type { NewsItem } from '../../lib/fantasy/news'
import { useFantasy } from './FantasyContext'
import { ago, cx } from './ui'
import { useNews } from './useNews'

/** One story: headline, two lines of the write-up, and when and where it came from. Text only, never markup. */
export const NewsBlurb = ({ item, className }: { item: NewsItem; className?: string }) => (
  <div className={cx('min-w-0', className)}>
    <p className="text-[12.5px] font-semibold leading-[1.35] text-ff-text">{item.headline}</p>
    {item.body && <p className="mt-0.5 line-clamp-2 text-[12px] leading-[1.45] text-ff-text2">{item.body}</p>}
    <p className="mt-1 flex items-baseline gap-2 font-mono text-[10.5px] text-ff-muted">
      <span className="num">{ago(item.at)} ago</span>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-ff-accent hover:underline">
          {item.source} ↗
        </a>
      ) : (
        <span>{item.source}</span>
      )}
    </p>
  </div>
)

/**
 * A player's latest headlines, newest first. Renders nothing until ESPN answers, and nothing at all if it never does,
 * so the sheet it sits in looks the same as before when the feed is blocked.
 */
const PlayerNews = ({ id, max = 3, className }: { id: string; max?: number; className?: string }) => {
  const { data } = useFantasy()
  const ids = useMemo(() => [id], [id])
  const items = useNews(ids, data.players)[id]?.slice(0, max)
  if (!items?.length) return null
  return (
    <div className={cx('space-y-2.5', className)}>
      {items.map((it) => (
        <NewsBlurb key={it.id} item={it} />
      ))}
    </div>
  )
}

export default PlayerNews
