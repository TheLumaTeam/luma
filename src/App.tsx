import { Fragment, useState } from 'react'
import { motion, useMotionValueEvent, useScroll } from 'motion/react'
import { Reveal, Shot, SplitHeading, Statement, Typed, asset, ease, type Seg } from './fx'

const GH = 'https://github.com/ManiProjs/luma'
const REL = `${GH}/releases`
const base = import.meta.env.BASE_URL
const docs = (p = '') => `${base}docs/${p}`

const Arrow = () => (
  <svg className="m-arrow" viewBox="0 0 12 12" aria-hidden="true" width="12" height="12">
    <path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function TextLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="link" href={href}>
      <span className="link__t">{children}</span>
      <Arrow />
    </a>
  )
}

function Download({ secondary }: { secondary?: boolean }) {
  return (
    <motion.a
      className={`btn ${secondary ? 'btn--secondary' : 'btn--primary'}`}
      href={REL}
      target="_blank"
      rel="noreferrer"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.16, ease }}
    >
      Download Luma
    </motion.a>
  )
}

/* ------------------------------------------------------------------ nav */
function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 8))
  return (
    <motion.header
      className={`nav${open ? ' is-open' : ''}${scrolled ? ' is-scrolled' : ''}`}
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, ease }}
    >
      <div className="wrap nav__bar">
        <a className="skip-link" href="#top">Skip to content</a>
        <a className="nav__logo" href="#top">
          <motion.img src={`${base}luma-mark.svg`} alt="" width="24" height="24" whileHover={{ rotate: 90 }} transition={{ duration: 0.4, ease }} />
          Luma
        </a>
        <nav className="nav__links" aria-label="Main">
          <div className="nav__item">
            <a className="nav__link" href="#code">
              Product{' '}
              <svg className="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </a>
            <div className="nav__menu">
              <div className="wrap grid">
                <div className="menu-col span-3">
                  <p className="t-label">Workspace</p>
                  <a href="#code">Code<span>Edits files you approve</span></a>
                  <a href="#teammates">Teammates<span>Agents that keep working</span></a>
                  <a href="#clients">Desktop and terminal<span>One Rust core</span></a>
                </div>
                <div className="menu-col span-3">
                  <p className="t-label">Connect</p>
                  <a href="#models">Models<span>Local or hosted endpoints</span></a>
                  <a href="#extend">Extensions<span>MCP, skills and plugins</span></a>
                </div>
                <a className="menu-card span-3 start-10" href="#teammates">
                  <div className="panel"><img className="frame__img" src={asset('img/luma-teammates.webp')} alt="The Luma desktop app on the Teammates tab" style={{ objectPosition: '20% 0' }} /></div>
                  <span className="t-card">Teammates</span>
                  <span className="t-small muted">Memory, schedules and tasks</span>
                </a>
              </div>
            </div>
          </div>
          <div className="nav__item"><a className="nav__link" href="#models">Models</a></div>
          <div className="nav__item"><a className="nav__link" href={docs()}>Docs</a></div>
          <div className="nav__item"><a className="nav__link" href={GH} target="_blank" rel="noreferrer">GitHub</a></div>
        </nav>
        <div className="nav__actions"><Download /></div>
        <button className="nav__toggle" type="button" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <motion.path d="M2 5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" animate={open ? { d: 'M3 3l12 12' } : { d: 'M2 5h14' }} />
            <motion.path d="M2 13h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" animate={open ? { d: 'M3 15L15 3' } : { d: 'M2 13h14' }} />
          </svg>
        </button>
      </div>
    </motion.header>
  )
}

/* ------------------------------------------------------------------ hero */
function Hero() {
  const words = 'Agent workspace for developers'.split(' ')
  return (
    <section className="hero hero--centred" aria-labelledby="hero-h">
      <div className="hero__glow" aria-hidden="true" />
      <div className="wrap">
        <div className="hero-text">
          <div className="hero__c">
            <motion.a className="pill" href={GH} target="_blank" rel="noreferrer" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7, ease }}>
              <span>Open source, built in Rust</span>
              <span className="muted">View on GitHub</span>
            </motion.a>
            <h1 id="hero-h">
              {words.map((w, k) => (
                <Fragment key={k}>
                  <span className="mx-w">
                    <motion.span className="mx-wi" initial={{ y: '115%', rotate: 5 }} animate={{ y: '0%', rotate: 0 }} transition={{ duration: 0.95, delay: 0.3 + k * 0.1, ease }}>{w}</motion.span>
                  </span>{' '}
                </Fragment>
              ))}
            </h1>
            <motion.p className="hero__lead" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.8, ease }}>
              Code edits your project and shows each change as a diff. Teammates keep working in the background. Bring any OpenAI-compatible model.
            </motion.p>
            <motion.div className="btn-row" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1, duration: 0.8, ease }}>
              <Download />
              <TextLink href={docs()}>Read the docs</TextLink>
            </motion.div>
          </div>
          <div className="hero__window" role="img" aria-label="The Luma desktop app on the Code tab, answering a question about a codebase">
            <div className="ly-piece hero__shot" aria-hidden="true">
              <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6, duration: 0.8, ease }}>
                <img src={asset('img/luma-code.webp')} alt="" width="1800" height="1152" fetchPriority="high" />
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ sections */
function Code() {
  return (
    <section className="section" id="code" aria-labelledby="code-h">
      <div className="wrap">
        <div className="grid">
          <div className="section-head span-5"><SplitHeading id="code-h" text="Code shows every change first." /></div>
          <div className="span-6 start-7 stack-4">
            <Reveal><p className="t-lead">The coding agent reads your project, prepares a patch and waits for your approval. Shell commands ask first. Then it runs your tests and reads the result.</p></Reveal>
            <Reveal i={1}><TextLink href={docs('cli')}>Read the CLI guide</TextLink></Reveal>
          </div>
        </div>
        <Reveal><Shot className="shot--wide" src={asset('img/luma-code.webp')} alt="Luma Code: a conversation about a codebase, with the Changes, History, Branches, Files and Terminal tabs beside it" width={1800} height={1152} /></Reveal>
      </div>
    </section>
  )
}

function Teammates() {
  const facts = [
    'Schedules run a prompt once or on an interval.',
    'Triggers start work on task.completed, task.failed or approval.requested.',
    'Delegation hands a task to another Teammate, three levels deep at most.',
  ]
  return (
    <section className="section" id="teammates" aria-labelledby="teammates-h">
      <div className="wrap">
        <div className="grid grid--top fill">
          <div className="span-5 split-col">
            <div className="section-head"><SplitHeading id="teammates-h" text="Teammates work in the background." /></div>
            <Reveal><p className="t-lead">Each Teammate has its own memory, skills, conversations and schedules. Tasks run in the Luma gateway, so they continue with the window closed.</p></Reveal>
            <ul className="facts-list">
              {facts.map((f, k) => (
                <Reveal as="li" i={k} key={f}>{f}</Reveal>
              ))}
            </ul>
            <div className="split-col__end"><TextLink href={docs('teammates')}>Read about Teammates</TextLink></div>
          </div>
          <Reveal className="frame--fill span-6 start-7">
            <Shot className="shot--fill" src={asset('img/luma-teammates.webp')} alt="Luma Teammates: a list of Teammates, a conversation, and an inbox of tasks that need attention" width={1800} height={1152} />
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Statements() {
  return (
    <section className="section statement" aria-label="What Luma is for">
      <div className="wrap">
        <Statement
          parts={[
            { t: 'Luma shows you every change ' },
            { t: 'before it lands,', strong: true },
            { t: ' keeps Teammates working while you are away, and runs on the model you already trust,' },
            { t: ' local or hosted.', strong: true },
          ]}
        />
      </div>
    </section>
  )
}

function Clients() {
  return (
    <section className="section ground-inverse" id="clients" aria-labelledby="clients-h">
      <div className="wrap">
        <div className="grid">
          <div className="section-head span-5"><SplitHeading id="clients-h" text="One Rust core runs every client." /></div>
          <div className="span-6 start-7 stack-4">
            <Reveal><p className="t-lead">The desktop app, the terminal interface and the local dashboard share one runtime and one SQLite database, so a task started in one shows up in the others.</p></Reveal>
            <Reveal i={1}><TextLink href={docs('architecture')}>Read the architecture</TextLink></Reveal>
          </div>
        </div>
        <div className="grid" style={{ marginTop: 'var(--s-7)' }}>
          <Reveal className="span-6"><Shot className="shot--cover" src={asset('img/luma-editor.webp')} alt="The Luma desktop editor with a file tree, a TypeScript file and a quick-fix hint" width={1800} height={1152} /></Reveal>
          <Reveal i={1} className="span-6"><Shot className="shot--cover" src={asset('img/luma-terminal.webp')} alt="The Luma terminal interface with open sessions, the current branch and the active model" width={1400} height={1003} position="0 0" /></Reveal>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ models hub */
const spokes = [
  { label: 'Ollama', icon: 'icons/ollama.svg', at: [14, 20] },
  { label: 'LM Studio', icon: 'icons/lmstudio.svg', at: [86, 20] },
  { label: 'llama.cpp server', icon: 'icons/ui-server.svg', at: [14, 80] },
  { label: 'Hosted provider', icon: 'icons/ui-cloud.svg', at: [86, 80] },
] as const

function Hub() {
  return (
    <div className="hub" role="img" aria-label="Luma connects to Ollama, LM Studio, a llama.cpp server and a hosted provider.">
      <svg className="hub__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {spokes.map((s, k) => (
          <g key={s.label}>
            <line x1="50" y1="50" x2={s.at[0]} y2={s.at[1]} vectorEffect="non-scaling-stroke" />
            <motion.circle r="1.1" fill="#c2410c" animate={{ cx: [50, s.at[0]], cy: [50, s.at[1]], opacity: [0, 1, 1, 0] }} transition={{ duration: 2.4, delay: k * 0.6, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }} />
          </g>
        ))}
      </svg>
      <div className="hub__core">
        <motion.span className="hub__ring" aria-hidden="true" animate={{ scale: [1, 1.9], opacity: [0.5, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }} />
        Luma
      </div>
      {spokes.map((s) => (
        <div key={s.label} className="hub__node" style={{ left: `${s.at[0]}%`, top: `${s.at[1]}%` }}>
          <span className="hub__chip">
            <img src={asset(s.icon)} alt="" width="16" height="16" />
            {s.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function Models() {
  return (
    <section className="section" id="models" aria-labelledby="models-h">
      <div className="wrap">
        <div className="grid grid--top fill">
          <div className="span-5 split-col">
            <div className="section-head"><SplitHeading id="models-h" text="Connect a local or hosted model." /></div>
            <Reveal><p className="t-lead">Luma talks to any OpenAI-compatible chat endpoint: Ollama, LM Studio, a llama.cpp server or a hosted provider. Run <code>luma setup</code> to choose one.</p></Reveal>
            <Reveal i={1}><p>Smaller local models work. Task quality still follows the model you pick.</p></Reveal>
            <div className="split-col__end"><TextLink href={docs('configuration')}>Read the model guide</TextLink></div>
          </div>
          <div className="frame frame--fill span-6 start-7"><Hub /></div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ extend */
const mcp: Seg[] = [
  ['# local server\n', 'c'],
  ['luma mcp add', 'k'], [' filesystem npx -y \\\n  @modelcontextprotocol/server-filesystem .\n'],
  ['luma mcp enable', 'k'], [' filesystem\n'],
  ['luma mcp tools', 'k'], [' filesystem\n'],
  ['luma mcp list', 'k'],
]
const skill: Seg[] = [
  ['# .agents/skills/rust-testing/SKILL.md\n', 'c'],
  ['---\nname: rust-testing\ndescription: Run focused Rust tests\n---\n\nPrefer focused tests first, then run\nthe full suite before finalizing.'],
]
const plugin: Seg[] = [
  ['# plugin.toml\n', 'c'],
  ['id = "summarize-text"\ncommand = "python3"\nargs = ["main.py"]\n\n[[tools]]\nname = "summarize_text"\ntimeout_seconds = 45'],
]

function Extend() {
  const cards = [
    { h: 'Connect an MCP server', p: 'Add a local stdio server or a remote HTTP one, then enable it.', s: mcp },
    { h: 'Teach a skill', p: 'A SKILL.md file in .agents/skills gives the agent a repeatable job.', s: skill },
    { h: 'Ship a native plugin', p: 'A plugin.toml and any executable add tools over JSON on stdin.', s: plugin },
  ]
  return (
    <section className="section" id="extend" aria-labelledby="extend-h">
      <div className="wrap">
        <div className="section-head"><SplitHeading id="extend-h" text="Add tools with MCP, skills and plugins." /></div>
        <div className="grid">
          {cards.map((c) => (
            <motion.article key={c.h} className="card card--row card--open span-4" whileHover={{ y: -2 }} transition={{ duration: 0.2, ease }}>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
              <div className="panel"><Typed segs={c.s} /></div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ faq */
const faqL = [
  ['Which models can I use?', 'Any OpenAI-compatible endpoint you configure, local or hosted.'],
  ['What can the agent run without asking?', 'Inspection tools only read. Shell commands need your approval, and edits show a diff first.'],
  ['Is Luma open source?', 'Yes. The source, issues and releases are on GitHub.'],
  ['Can I use Luma from the terminal?', 'Yes. Run luma for the terminal interface, or luma dashboard for the browser one.'],
]
const faqR = [
  ['Where is Teammate memory stored?', "In a local SQLite database. A Teammate's memory stays private unless it opts into Global context."],
  ['Does the gateway open a network port?', 'On Unix its IPC endpoint is local and exposes no network listener.'],
  ['Can Teammates reach the internet?', 'Only when their network permission allows web_search, fetch_url or http_request.'],
  ['Can Teammates hand work to each other?', 'Yes, three levels deep at most. A child task never gets wider permissions than its parent.'],
]

function FaqItem({ q, a, i }: { q: string; a: string; i: number }) {
  return (
    <div className="faq__item" data-i={i}>
      <h3>{q}</h3>
      <p>{a}</p>
    </div>
  )
}

function Faq() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-h">
      <div className="wrap">
        <div className="section-head"><SplitHeading id="faq-h" text="Questions about Luma." /></div>
        <div className="grid">
          <div className="faq span-6">{faqL.map(([q, a], i) => <FaqItem key={q} q={q} a={a} i={i} />)}</div>
          <div className="faq span-6">{faqR.map(([q, a], i) => <FaqItem key={q} q={q} a={a} i={i} />)}</div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ footer */
function Footer() {
  return (
    <footer className="footer closing footer--dark ground-inverse" id="contact" aria-labelledby="close-h">
      <div className="wrap">
        <div className="closing__cta close--word">
          <div className="section-head--split">
            <div><SplitHeading id="close-h" text="Download Luma" /><p className="t-lead">Open source, built in Rust. Releases are on GitHub.</p></div>
            <motion.a className="btn btn--primary" href={REL} target="_blank" rel="noreferrer" whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }} transition={{ duration: 0.16, ease }}>
              Download Luma<Arrow />
            </motion.a>
          </div>
          <p className="close__word" aria-hidden="true">Luma</p>
        </div>
        <div className="closing__links">
          <div className="grid">
            <div className="span-4 stack-4">
              <a className="nav__logo" href="#top"><img src={`${base}luma-mark.svg`} alt="" width="24" height="24" />Luma</a>
              <p className="footer__lede">An open-source agent workspace with Code and Teammates, built in Rust.</p>
            </div>
            <div className="span-2 start-7 footer__col"><h3>Product</h3><ul><li><a href="#code">Code</a></li><li><a href="#teammates">Teammates</a></li><li><a href="#models">Models</a></li></ul></div>
            <div className="span-2 footer__col"><h3>Docs</h3><ul><li><a href={docs('architecture')}>Architecture</a></li><li><a href={docs('cli')}>CLI</a></li><li><a href={docs('mcp')}>MCP</a></li></ul></div>
            <div className="span-2 footer__col"><h3>Source</h3><ul><li><a href={GH} target="_blank" rel="noreferrer">GitHub</a></li><li><a href={`${GH}/issues`} target="_blank" rel="noreferrer">Issues</a></li><li><a href={REL} target="_blank" rel="noreferrer">Releases</a></li></ul></div>
          </div>
          <div className="footer__legal">
            <span>&copy; 2026 Luma</span>
            <span>Product names and logos are trademarks of their owners.</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <>
      <Nav />
      <main id="top">
        <Hero />
        <Code />
        <Teammates />
        <Statements />
        <Clients />
        <Models />
        <Extend />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
