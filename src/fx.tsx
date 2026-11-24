import { Fragment, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import {
  motion,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react'

export const ease = [0.2, 0.8, 0.2, 1] as const
export const asset = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`

/** Fades, lifts and un-blurs its children into view; `i` staggers siblings. */
export function Reveal({
  children,
  i = 0,
  className,
  as = 'div',
  y = 36,
}: {
  children: ReactNode
  i?: number
  className?: string
  as?: 'div' | 'li' | 'article' | 'p'
  y?: number
}) {
  const M = motion[as] as ElementType
  return (
    <M
      className={className}
      initial={{ opacity: 0, y, scale: 0.97, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.9, delay: Math.min(i, 6) * 0.1, ease }}
    >
      {children}
    </M>
  )
}

/** A heading whose words rise out of a mask, then an accent underline draws. */
export function SplitHeading({ id, text }: { id?: string; text: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.6 })
  return (
    <h2 id={id} ref={ref} className="split-h">
      {text.split(' ').map((w, k) => (
        <Fragment key={k}>
        <span className="mx-w">
          <motion.span
            className="mx-wi"
            initial={{ y: '110%', rotate: 4 }}
            animate={seen ? { y: '0%', rotate: 0 } : undefined}
            transition={{ duration: 0.9, delay: k * 0.07, ease }}
          >
            {w}
          </motion.span>
        </span>{' '}
        </Fragment>
      ))}
      <motion.span
        className="split-h__rule"
        aria-hidden="true"
        initial={{ scaleX: 0 }}
        animate={seen ? { scaleX: 1 } : undefined}
        transition={{ duration: 1, delay: 0.5, ease }}
      />
    </h2>
  )
}

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.3 })
  return <motion.div className="progress" style={{ scaleX }} aria-hidden="true" />
}

/** Screenshot that tilts toward the pointer on springs and drifts as the page scrolls. */
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
  const ref = useRef<HTMLDivElement>(null)
  const rx = useSpring(0, { stiffness: 180, damping: 18 })
  const ry = useSpring(0, { stiffness: 180, damping: 18 })
  const lift = useSpring(0, { stiffness: 180, damping: 18 })
  const gx = useMotionValue(50)
  const gy = useMotionValue(50)
  const glow = useTransform([gx, gy], ([x, y]) => `radial-gradient(520px circle at ${x}% ${y}%, rgba(255,255,255,.16), transparent 55%)`)
  const [hot, setHot] = useState(false)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const drift = useTransform(scrollYProgress, [0, 1], ['-3%', '3%'])

  return (
    <motion.div
      ref={ref}
      className={`shot ${className}`}
      style={{ rotateX: rx, rotateY: ry, y: lift, transformPerspective: 1100, boxShadow: hot ? '0 30px 60px -30px rgba(0,0,0,.45)' : '0 0 0 rgba(0,0,0,0)' }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width
        const y = (e.clientY - r.top) / r.height
        rx.set((0.5 - y) * 5)
        ry.set((x - 0.5) * 6)
        lift.set(-4)
        gx.set(x * 100)
        gy.set(y * 100)
        setHot(true)
      }}
      onPointerLeave={() => {
        rx.set(0)
        ry.set(0)
        lift.set(0)
        setHot(false)
      }}
    >
      <motion.img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        style={{ y: drift, scale: 1.06, objectPosition: position }}
      />
      <motion.span className="shot__glow" aria-hidden="true" style={{ background: glow, opacity: hot ? 1 : 0 }} />
      {children}
    </motion.div>
  )
}

/** Pulls toward the pointer, springs back on leave. */
export function Magnetic({ children, className }: { children: ReactNode; className?: string }) {
  const x = useSpring(0, { stiffness: 220, damping: 14 })
  const y = useSpring(0, { stiffness: 220, damping: 14 })
  return (
    <motion.span
      className={className}
      style={{ x, y, display: 'inline-block' }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        x.set((e.clientX - r.left - r.width / 2) * 0.25)
        y.set((e.clientY - r.top - r.height / 2) * 0.35)
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </motion.span>
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

/** One statement whose words light up one by one as it crosses the screen. */
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

/** A code snippet that types itself out once, with a blinking caret. */
export function Typed({ segs }: { segs: Seg[] }) {
  const ref = useRef<HTMLPreElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.5 })
  const total = segs.reduce((a, [t]) => a + t.length, 0)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!seen) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setN(total)
    const step = Math.max(2, Math.ceil(total / 70))
    const id = setInterval(() => setN((c) => (c + step >= total ? (clearInterval(id), total) : c + step)), 22)
    return () => clearInterval(id)
  }, [seen, total])
  let left = n
  return (
    <pre className="snip" ref={ref} aria-label={segs.map((s) => s[0]).join('')}>
      {segs.map(([t, cls], k) => {
        const take = Math.max(0, Math.min(t.length, left))
        left -= t.length
        return (
          <span key={k} className={cls} aria-hidden="true">
            {t.slice(0, take)}
            <span className="ghost">{t.slice(take)}</span>
          </span>
        )
      })}
      {seen && n < total && <span className="cur" aria-hidden="true" />}
    </pre>
  )
}
