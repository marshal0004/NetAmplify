// /home/z/my-project/NetAmplify/apps/frontend/src/pages/Landing.tsx
// NetAmplify — Landing page (postflare-inspired orbital hero).
//
// Ports the postflare landing design (dark, warm orange glow, orbital brand
// logos on dashed rings with constellation beams, floating post card, bento
// features, steps, platforms grid, trust, open-source, CTA, footer) into the
// NetAmplify Vite frontend. The postflare CSS is imported from `@/landing.css`
// and scoped under the `.pf` wrapper so its generic selectors (.card, .btn,
// .grid, body, section…) never leak into the dashboard pages. The wrapper also
// carries `.dark` so the dark palette is always active on this page.
//
// Rebranded to NetAmplify with our 8 platforms (Discord, Dev.to, Telegram,
// Bluesky, X, LinkedIn, Instagram, YouTube) using real brand SVG glyphs.

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import '@/landing.css';

// CSS custom-property style objects (React 18 types support `--*` keys, but
// cast for strict-mode safety across @types/react versions).
type Vars = React.CSSProperties & Record<`--${string}`, string>;

// SVG sprite — our 8 platform brand icons (paths from simple-icons).
// LinkedIn uses a <b>in</b> text glyph (matching postflare's approach).
const SVG_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-discord" viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></symbol>
<symbol id="i-devto" viewBox="0 0 24 24"><path d="M7.42 10.05c-.18-.16-.46-.23-.84-.23H6l.02 2.44.04 2.45.56-.02c.41 0 .63-.07.83-.26.24-.24.26-.36.26-2.2 0-1.91-.02-1.96-.29-2.18zM0 4.94v14.12h24V4.94H0zM8.56 15.3c-.44.58-1.06.77-2.53.77H4.71V8.53h1.4c1.67 0 2.16.18 2.6.9.27.43.29.6.32 2.57.05 2.23-.02 2.73-.47 3.3zm5.09-5.47h-2.47v1.77h1.52v1.28l-.72.04-.75.03v1.77l1.22.03 1.2.04v1.28h-1.6c-1.53 0-1.6-.01-1.87-.3l-.3-.28v-3.16c0-3.02.01-3.18.25-3.48.23-.31.25-.31 1.88-.31h1.64v1.3zm4.68 5.45c-.17.43-.64.79-1 .79-.18 0-.45-.15-.67-.39-.32-.32-.45-.63-.82-2.08l-.9-3.39-.45-1.67h.76c.4 0 .75.02.75.05 0 .06 1.16 4.54 1.26 4.83.04.15.32-.7.73-2.3l.66-2.52.74-.04c.4-.02.73 0 .73.04 0 .14-1.67 6.38-1.8 6.68z"/></symbol>
<symbol id="i-telegram" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></symbol>
<symbol id="i-bluesky" viewBox="0 0 24 24"><path d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.299-2.777.472-5.899-.309-6.755-3.37C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></symbol>
<symbol id="i-instagram" viewBox="0 0 24 24"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></symbol>
<symbol id="i-youtube" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></symbol>
</svg>`;

// Orbit config — our 8 platforms on 2 rings (4 inner + 4 outer, staggered).
type SlotDef = { a: number; d: number; c: string; title: string; icon?: string; text?: string };
const RING_INNER: SlotDef[] = [
  { a: 0, d: 0, c: '#E4405F', title: 'Instagram', icon: 'i-instagram' },
  { a: 90, d: 0.53, c: '#FF0000', title: 'YouTube', icon: 'i-youtube' },
  { a: 180, d: 1.06, c: '#000000', title: 'X', icon: 'i-x' },
  { a: 270, d: 1.59, c: '#0A66C2', title: 'LinkedIn', text: 'in' },
];
const RING_OUTER: SlotDef[] = [
  { a: 45, d: 0, c: '#1185FE', title: 'Bluesky', icon: 'i-bluesky' },
  { a: 135, d: 0.53, c: '#5865F2', title: 'Discord', icon: 'i-discord' },
  { a: 225, d: 1.06, c: '#26A5E4', title: 'Telegram', icon: 'i-telegram' },
  { a: 315, d: 1.59, c: '#0A0A0A', title: 'Dev.to', icon: 'i-devto' },
];

function Slot({ s }: { s: SlotDef }) {
  const slotStyle: Vars = { ['--a']: `${s.a}deg`, ['--d']: `${s.d}s` };
  const piStyle: Vars = { ['--c']: s.c, ['--f']: '#fff' };
  return (
    <div className="slot" style={slotStyle}>
      <i className="beam"></i>
      <i className="spark"></i>
      <span className="orb">
        <span className="pi lg" style={piStyle} title={s.title}>
          {s.icon ? (
            <svg viewBox="0 0 24 24" aria-hidden="true"><use href={`#${s.icon}`} /></svg>
          ) : (
            <b aria-hidden="true">{s.text}</b>
          )}
        </span>
      </span>
    </div>
  );
}

export function Landing() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('js');

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Scroll reveal
    const rv = document.querySelectorAll('.rv');
    if (!('IntersectionObserver' in window) || reduce) {
      rv.forEach((el) => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver(
        (es) => {
          es.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('in');
              io.unobserve(e.target);
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
      );
      rv.forEach((el) => io.observe(el));
    }

    // Marquee — duplicate the platform grid items for a seamless loop
    const marq = document.getElementById('marq');
    if (marq) {
      const items = Array.from(document.querySelectorAll('.pf .grid li')).map((li) => li.innerHTML);
      const html = items.map((h) => `<li>${h}</li>`).join('');
      marq.innerHTML = html + html;
    }

    // Count-up numbers
    const counters = document.querySelectorAll('[data-count]');
    const run = (el: Element) => {
      const to = +(el.getAttribute('data-count') || 0);
      const suf = el.getAttribute('data-suffix') || '';
      const t0 = performance.now();
      const dur = 1400;
      if (!to) return;
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const v = Math.round(to * (1 - Math.pow(1 - p, 3)));
        el.textContent = v + suf;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (!reduce && 'IntersectionObserver' in window) {
      const co = new IntersectionObserver(
        (es) => {
          es.forEach((e) => {
            if (e.isIntersecting) {
              run(e.target);
              co.unobserve(e.target);
            }
          });
        },
        { threshold: 0.6 },
      );
      counters.forEach((el) => co.observe(el));
    }

    // Pause hero orbit when off-screen
    const orbit = document.getElementById('orbit');
    if (orbit && 'IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        orbit.classList.toggle('paused', !es[0].isIntersecting);
      }).observe(orbit);
    }

    // Cursor-following glow on cards
    if (!reduce && matchMedia('(hover: hover)').matches) {
      document.querySelectorAll<HTMLElement>('.pf .card').forEach((c) => {
        c.addEventListener('pointermove', (e: Event) => {
          const pe = e as PointerEvent;
          const r = c.getBoundingClientRect();
          c.style.setProperty('--mx', `${pe.clientX - r.left}px`);
          c.style.setProperty('--my', `${pe.clientY - r.top}px`);
        });
      });
    }

    return () => {
      root.classList.remove('js');
    };
  }, []);

  const rd = (v: string): Vars => ({ ['--rd']: v });

  return (
    <div className="pf dark">
      <div dangerouslySetInnerHTML={{ __html: SVG_SPRITE }} />

      {/* Background */}
      <div className="bg" aria-hidden="true">
        <div className="blob a"></div>
        <div className="blob b"></div>
      </div>

      {/* Nav */}
      <header className="nav">
        <div className="wrap">
          <a className="brand" href="#top">
            <span className="pi" style={{ ['--c']: 'var(--grad)', ['--f']: '#fff', width: 30, height: 30, borderRadius: 9 } as Vars}>
              <b aria-hidden="true">N</b>
            </span>
            NetAmplify
          </a>
          <nav>
            <a href="#features">Features</a>
            <a href="#platforms">Platforms</a>
            <a href="#open-source">Open source</a>
          </nav>
          <span className="sp" />
          <Link className="btn sm ghost" to="/login">Sign in</Link>
          <Link className="btn sm pri" to="/signup">Get started</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="hero" id="top">
        <div className="wrap">
          <div>
            <a className="pill rv" href="#open-source"><b>Open source</b>Self-hosted on your own server</a>
            <h1 id="hero-title" className="rv" style={rd('.06s')}>Post once.<br /><span className="gt">Get seen everywhere.</span></h1>
            <p className="lead rv" style={rd('.12s')}><strong>NetAmplify</strong> is an open-source social media scheduler you run on your own server. Write a post once, tailor it per network, put it on a calendar, and NetAmplify publishes it to Discord, Dev.to, Telegram, Bluesky, X, LinkedIn, Instagram and YouTube through their official APIs, right on time.</p>
            <div className="ctas rv" style={rd('.18s')}>
              <Link className="btn pri" to="/signup">Get started — it&apos;s free</Link>
              <Link className="btn sec" to="/signup">Sign up</Link>
              <a className="btn x" href="https://github.com/marshal0004/NetAmplify" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.2-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.6.23 2.76.11 3.05.75.81 1.2 1.84 1.2 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" /></svg>
                GitHub
              </a>
              <Link className="btn ghost" to="/login">Sign in</Link>
            </div>
            <div className="meta rv" style={rd('.24s')}>
              <span>8 integrations</span>
              <span>OAuth 2.0 + AES-256-GCM</span>
              <span>MIT licensed</span>
              <span>NestJS + Prisma</span>
            </div>
          </div>

          {/* Orbital stage */}
          <div className="stage" role="img" aria-label="One scheduled post flaring out to Discord, Dev.to, Telegram, Bluesky, X, LinkedIn, Instagram and YouTube.">
            <div className="orbit" id="orbit">
              <i className="circle c2"></i><i className="circle c1"></i><i className="halo"></i>
              <div className="ring r1" style={{ ['--r']: '182px' } as Vars}>
                {RING_INNER.map((s) => <Slot key={s.title} s={s} />)}
              </div>
              <div className="ring r2" style={{ ['--r']: '258px' } as Vars}>
                {RING_OUTER.map((s) => <Slot key={s.title} s={s} />)}
              </div>
              <div className="post" aria-hidden="true">
                <div className="hd"><span className="av" style={{ background: 'var(--grad)' }}></span><span className="nm">NetAmplify<small>@netamplify</small></span></div>
                <p>v2.0 is live: multi-platform posting, scheduling &amp; live preview.</p>
                <div className="media"><span className="play"></span></div>
                <div className="ft"><span className="chip"><i className="dot"></i>Scheduled</span><span>Tue 9:00 AM</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Strip + marquee */}
      <div className="strip" aria-hidden="true">
        <div className="wrap">Publishes natively to the networks your audience already uses</div>
        <div className="marquee"><ul id="marq"></ul></div>
      </div>

      {/* Features bento */}
      <section id="features" aria-labelledby="f-title">
        <div className="wrap">
          <div className="head c rv">
            <span className="eyebrow">What NetAmplify does</span>
            <h2 id="f-title">Everything you need to run a content calendar.<br />Nothing you don&apos;t.</h2>
            <p className="sub">NetAmplify replaces a stack of paid scheduling tools with one open-source app that talks to every network through its official API — using your own credentials, encrypted at rest.</p>
          </div>
          <div className="bento">
            <article className="card s3 rv">
              <div className="ic"><svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg></div>
              <h3>Compose once, customize per platform</h3>
              <p>Write a single Post Card and fine-tune the caption, media, title and settings for each network. Character limits and media rules are checked as you type.</p>
              <div className="vis comp" aria-hidden="true">
                <div className="tabs">
                  <span className="on">All networks</span>
                  <span><i className="pi" style={{ ['--c']: '#000', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-x" /></svg></i>X</span>
                  <span><i className="pi" style={{ ['--c']: '#0A66C2', ['--f']: '#fff' } as Vars}><b>in</b></i>LinkedIn</span>
                  <span><i className="pi" style={{ ['--c']: '#FF0000', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-youtube" /></svg></i>YouTube</span>
                  <span><i className="pi" style={{ ['--c']: '#1185FE', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-bluesky" /></svg></i>Bluesky</span>
                </div>
                <div className="txt">v2.0 is live. Multi-platform posting, scheduling and live preview, all in one update<span className="caret"></span></div>
                <div className="bar"><span>Shared caption<span className="ov"> &middot; 3 overrides</span></span><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>172 / 280 <span className="meter"><i></i></span></span></div>
              </div>
            </article>
            <article className="card s3 rv" style={rd('.08s')}>
              <div className="ic"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg></div>
              <h3>Calendar scheduling</h3>
              <p>See every scheduled, published and failed post on a calendar. Pick a time, and NetAmplify takes it from there in your time zone.</p>
              <div className="vis cal" aria-hidden="true">
                <span></span><span className="h">Mon</span><span className="h today">Tue</span><span className="h">Wed</span><span className="h">Thu</span><span className="h">Fri</span><span className="h">Sat</span><span className="h">Sun</span>
                <span className="t">09:00</span><i className="cell"></i><i className="cell"><span className="ev" style={{ ['--c']: '#E4405F', ['--d']: '.2s' } as Vars}><i className="pi" style={{ ['--c']: '#E4405F', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-instagram" /></svg></i><span className="l">Reel</span></span></i><i className="cell"></i><i className="cell"><span className="ev" style={{ ['--c']: '#FF0000', ['--d']: '1.1s' } as Vars}><i className="pi" style={{ ['--c']: '#FF0000', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-youtube" /></svg></i><span className="l">Clip</span></span></i><i className="cell"></i><i className="cell"></i><i className="cell"></i>
                <span className="t">13:00</span><i className="cell"><span className="ev" style={{ ['--c']: '#0A66C2', ['--d']: '.65s' } as Vars}><i className="pi" style={{ ['--c']: '#0A66C2', ['--f']: '#fff' } as Vars}><b>in</b></i><span className="l">Post</span></span></i><i className="cell"></i><i className="cell"><span className="ev" style={{ ['--c']: '#000', ['--d']: '1.55s' } as Vars}><i className="pi" style={{ ['--c']: '#000', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-x" /></svg></i><span className="l">Post</span></span></i><i className="cell"></i><i className="cell"></i><i className="cell"><span className="ev" style={{ ['--c']: '#1185FE', ['--d']: '2s' } as Vars}><i className="pi" style={{ ['--c']: '#1185FE', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-bluesky" /></svg></i><span className="l">Post</span></span></i><i className="cell"></i>
                <span className="t">18:00</span><i className="cell"></i><i className="cell"><span className="ev" style={{ ['--c']: '#5865F2', ['--d']: '2.45s' } as Vars}><i className="pi" style={{ ['--c']: '#5865F2', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-discord" /></svg></i><span className="l">Msg</span></span></i><i className="cell"></i><i className="cell"></i><i className="cell"><span className="ev" style={{ ['--c']: '#26A5E4', ['--d']: '2.9s' } as Vars}><i className="pi" style={{ ['--c']: '#26A5E4', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-telegram" /></svg></i><span className="l">Post</span></span></i><i className="cell"></i><i className="cell"><span className="ev" style={{ ['--c']: '#000', ['--d']: '3.35s' } as Vars}><i className="pi" style={{ ['--c']: '#0A0A0A', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-devto" /></svg></i><span className="l">Article</span></span></i>
              </div>
            </article>
            <article className="card s2 rv">
              <div className="ic"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg></div>
              <h3>Media library</h3>
              <p>Upload images and videos once and reuse them across posts and networks. Each platform gets the right format automatically.</p>
              <div className="vis mgrid" aria-hidden="true">
                <i style={{ ['--g']: 'linear-gradient(135deg,#fb923c,#e11d48)' } as Vars}><span>0:30</span></i>
                <i style={{ ['--g']: 'linear-gradient(135deg,#6366f1,#22d3ee)' } as Vars}></i>
                <i style={{ ['--g']: 'linear-gradient(135deg,#10b981,#a3e635)' } as Vars}><span>1:12</span></i>
                <i style={{ ['--g']: 'linear-gradient(135deg,#f472b6,#a855f7)' } as Vars}></i>
                <i style={{ ['--g']: 'linear-gradient(135deg,#0ea5e9,#1e3a8a)' } as Vars}></i>
                <i style={{ ['--g']: 'linear-gradient(135deg,#facc15,#f97316)' } as Vars}><span>0:15</span></i>
                <i style={{ ['--g']: 'linear-gradient(135deg,#334155,#0f172a)' } as Vars}></i>
                <i className="up"></i>
              </div>
            </article>
            <article className="card s4 rv" style={rd('.08s')}>
              <div className="ic"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg></div>
              <h3>Reliable publishing with retries</h3>
              <p>Each post runs as a BullMQ job. Rate limits and flaky uploads are retried with exponential backoff, every step is logged, and you see exactly what happened.</p>
              <div className="vis log" aria-hidden="true">
                <div style={{ ['--d']: '0s' } as Vars}><time>09:00:00</time><span className="k in">QUEUED</span><span>Discord &middot; webhook</span></div>
                <div style={{ ['--d']: '.8s' } as Vars}><time>09:00:01</time><span className="k ok">SUCCESS</span><span>Dev.to &middot; article published</span></div>
                <div style={{ ['--d']: '1.6s' } as Vars}><time>09:00:02</time><span className="k wa">RETRY</span><span>YouTube &middot; 503 → backoff 10s</span></div>
                <div style={{ ['--d']: '2.4s' } as Vars}><time>09:00:12</time><span className="k ok">SUCCESS</span><span>YouTube &middot; video live</span></div>
                <div style={{ ['--d']: '3.2s' } as Vars}><time>09:00:13</time><span className="k ok">SUCCESS</span><span>Telegram &middot; message sent</span></div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section aria-labelledby="s-title" style={{ background: 'var(--bg2)' }}>
        <div className="wrap">
          <div className="head c rv">
            <span className="eyebrow">How it works</span>
            <h2 id="s-title">Three steps from draft to published.</h2>
          </div>
          <div className="flow" aria-hidden="true"></div>
          <div className="steps">
            <div className="step rv">
              <div className="n">1</div>
              <h3>Connect your platforms</h3>
              <p>OAuth login for LinkedIn, Meta and Google. Paste a key for Dev.to, Discord, Telegram or Bluesky. Encrypted with AES-256-GCM — we never see your passwords.</p>
            </div>
            <div className="step rv" style={rd('.1s')}>
              <div className="n">2</div>
              <h3>Compose a Post Card</h3>
              <p>Write a title, summary and description once. The Format Engine reshapes it per-platform — char limits, markdown, hashtags — automatically.</p>
            </div>
            <div className="step rv" style={rd('.2s')}>
              <div className="n">3</div>
              <h3>Publish or schedule</h3>
              <p>Send now or queue for later. Watch live previews, then track every target through queued, publishing, success or failed with full audit logs.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Platforms grid */}
      <section id="platforms" aria-labelledby="p-title">
        <div className="wrap">
          <div className="head c rv">
            <span className="eyebrow">Integrations</span>
            <h2 id="p-title">Eight networks, your own credentials.</h2>
            <p className="sub">No shared rate limits, no platform account required. You connect your own keys and tokens — they stay yours, encrypted at rest.</p>
          </div>
          <ul className="grid">
            <li className="rv"><i className="pi" style={{ ['--c']: '#5865F2', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-discord" /></svg></i>Discord<i className="tag v" title="OAuth / webhook">Webhook</i></li>
            <li className="rv" style={rd('.04s')}><i className="pi" style={{ ['--c']: '#0A0A0A', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-devto" /></svg></i>Dev.to<i className="tag v" title="API key">API key</i></li>
            <li className="rv" style={rd('.08s')}><i className="pi" style={{ ['--c']: '#26A5E4', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-telegram" /></svg></i>Telegram<i className="tag v" title="Bot token">Bot token</i></li>
            <li className="rv" style={rd('.12s')}><i className="pi" style={{ ['--c']: '#1185FE', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-bluesky" /></svg></i>Bluesky<i className="tag v" title="App password">App pass</i></li>
            <li className="rv" style={rd('.16s')}><i className="pi" style={{ ['--c']: '#000', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-x" /></svg></i>X (Twitter)<i className="tag e" title="Cookie-based">Cookie</i></li>
            <li className="rv" style={rd('.2s')}><i className="pi" style={{ ['--c']: '#0A66C2', ['--f']: '#fff' } as Vars}><b>in</b></i>LinkedIn<i className="tag v" title="OAuth 2.0 + PKCE">OAuth</i></li>
            <li className="rv" style={rd('.24s')}><i className="pi" style={{ ['--c']: '#E4405F', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-instagram" /></svg></i>Instagram<i className="tag v" title="Meta OAuth">OAuth</i></li>
            <li className="rv" style={rd('.28s')}><i className="pi" style={{ ['--c']: '#FF0000', ['--f']: '#fff' } as Vars}><svg viewBox="0 0 24 24"><use href="#i-youtube" /></svg></i>YouTube<i className="tag v" title="Google OAuth">OAuth</i></li>
          </ul>
          <div className="legend"><b>v</b> Live <b>e</b> Cookie-based (X free tier)</div>
        </div>
      </section>

      {/* Trust / security */}
      <section aria-labelledby="t-title" style={{ background: 'var(--bg2)' }}>
        <div className="wrap">
          <div className="trust">
            <div className="card rv">
              <h3 id="t-title">Your keys never leave your control</h3>
              <ul>
                <li>OAuth 2.0 + PKCE for LinkedIn, Meta (Facebook, Instagram, Threads) and Google (YouTube).</li>
                <li>AES-256-GCM encryption at rest via a dedicated TokenVault service.</li>
                <li>Full audit trail — every connect, disconnect, publish and failure logged with IP and timestamp.</li>
                <li>Decryption happens in memory, only at publish time, never logged.</li>
              </ul>
              <div className="note">No shared rate limits, no platform account required. You bring your own credentials and own the publishing pipeline end to end.</div>
            </div>
            <div className="side">
              <div className="card rv" style={rd('.08s')}>
                <pre className="code"><span className="c2">{'// Credentials are sealed before storage'}</span>{'\n'}<span className="c1">const</span> cipher = vault.<span className="c3">encrypt</span>({'{'}{'\n'}  accessToken, refreshToken,{'\n'}{'}'});{'\n\n'}<span className="c2">{'// Stored ciphertext — never plaintext'}</span>{'\n'}<span className="c1">await</span> repo.<span className="c3">upsert</span>({'{'} credentialsCipher: cipher {'}'});</pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Open source */}
      <section id="open-source" aria-labelledby="o-title">
        <div className="wrap">
          <div className="oss rv">
            <div>
              <span className="eyebrow">Open source</span>
              <h2 id="o-title">Inspect every line. Run it yourself.</h2>
              <p className="sub">NetAmplify is MIT-licensed. NestJS backend, Prisma, Playwright for X. Self-host on your own infrastructure and own your publishing pipeline end to end.</p>
              <div className="stack">
                <span>NestJS</span><span>TypeScript</span><span>Prisma</span><span>Playwright</span><span>BullMQ</span><span>React</span>
              </div>
              <div className="ctas">
                <a className="btn pri" href="https://github.com/marshal0004/NetAmplify" target="_blank" rel="noopener noreferrer">View on GitHub</a>
                <Link className="btn sec" to="/signup">Get started</Link>
              </div>
            </div>
            <div className="stats">
              <div className="stat"><b data-count="8" data-suffix="">0</b><span>Platform integrations</span></div>
              <div className="stat"><b data-count="600" data-suffix="+">0</b><span>Passing tests</span></div>
              <div className="stat"><b>256</b><span>Bit AES-GCM encryption</span></div>
              <div className="stat"><b>MIT</b><span>Open source license</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Hosted CTA */}
      <section className="hosted" id="get-started">
        <div className="wrap">
          <div className="hcard rv">
            <h2>Start publishing in minutes</h2>
            <p className="sub">Connect a platform with your own credentials, draft a Post Card, and hit publish. No credit card, no platform account required.</p>
            <div className="ctas">
              <Link className="btn pri" to="/signup">Get started — it&apos;s free</Link>
              <a className="btn sec" href="https://github.com/marshal0004/NetAmplify" target="_blank" rel="noopener noreferrer">View on GitHub</a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="wrap">
          <a className="brand" href="#top">
            <span className="pi" style={{ ['--c']: 'var(--grad)', ['--f']: '#fff', width: 24, height: 24, borderRadius: 7 } as Vars}><b aria-hidden="true">N</b></span>
            NetAmplify
          </a>
          <nav>
            <a href="#features">Features</a>
            <a href="#platforms">Platforms</a>
            <a href="#open-source">Open source</a>
            <Link to="/signup">Get started</Link>
          </nav>
          <span>&copy; {new Date().getFullYear()} NetAmplify · MIT</span>
        </div>
      </footer>
    </div>
  );
}
