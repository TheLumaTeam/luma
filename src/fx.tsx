import { useRef, type ElementType, type ReactNode } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react'

/** Strong ease-out: starts fast so entrances feel responsive, settles gently. */
export const ease = [0.23, 1, 0.32, 1] as const
export const asset = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`

/** Plain wrapper. Content does not fade in on scroll; kept so section markup stays unchanged. */
export function Reveal({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode
  i?: number
  className?: string
  as?: 'div' | 'li' | 'article' | 'p'
  y?: number
}) {
  const T = as as ElementType
  return <T className={className}>{children}</T>
}

/** Section heading with a static accent rule. */
export function SplitHeading({ id, text }: { id?: string; text: string }) {
  return (
    <h2 id={id} className="split-h">
      {text}
      <span className="split-h__rule" aria-hidden="true" />
    </h2>
  )
}

/** Screenshot in its frame. Hover zooms the picture 1.02 inside the frame (see styles.css). */
export function Shot({
  src,
  alt,
  width,
  height,
  className = '',
  eager,
  position,
  children,
}: {
  src: string
  alt: string
  width: number
  height: number
  className?: string
  eager?: boolean
  position?: string
  children?: ReactNode
}) {
  return (
    <div className={`shot ${className}`}>
      <img src={src} alt={alt} width={width} height={height} loading={eager ? 'eager' : 'lazy'} style={{ objectPosition: position }} />
      {children}
    </div>
  )
}

function Word({ word, range, progress, strong }: { word: string; range: [number, number]; progress: MotionValue<number>; strong?: boolean }) {
  const opacity = useTransform(progress, range, [0.18, 1])
  const color = useTransform(progress, range, strong ? ['#6b655e', '#c2410c'] : ['#6b655e', '#1b1917'])
  return (
    <motion.span style={{ opacity, color }} className="stmt-w">
      {word}{' '}
    </motion.span>
  )
}

/** The page's one dealt moment: the statement's words light up as it crosses the screen. */
export function Statement({ parts }: { parts: { t: string; strong?: boolean }[] }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] })
  const words = parts.flatMap((p) => p.t.split(' ').filter(Boolean).map((w) => ({ w, strong: p.strong })))
  return (
    <p ref={ref} className="statement__text">
      {words.map((x, k) => (
        <Word key={k} word={x.w} strong={x.strong} progress={scrollYProgress} range={[k / words.length, Math.min(1, (k + 1.4) / words.length)]} />
      ))}
    </p>
  )
}

export type Seg = [text: string, cls?: string]

/** A code snippet, shown whole. */
export function Typed({ segs }: { segs: Seg[] }) {
  return (
    <pre className="snip" aria-label={segs.map((s) => s[0]).join('')}>
      {segs.map(([t, cls], k) => (
        <span key={k} className={cls} aria-hidden="true">
          {t}
        </span>
      ))}
    </pre>
  )
}
