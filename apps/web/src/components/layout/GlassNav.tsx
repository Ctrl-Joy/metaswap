import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The main nav as a bar of frosted glass, drawn by one WebGL fragment shader behind the real
 * links. The active tab sits in a glass bead that bulges out of the bar and glows in the tab's
 * colour. On a route change the bead sinks into the bar, travels under the glass as a low,
 * stretched wave and resurfaces at the new tab with a small bounce; tabs it passes lift, the new
 * icon redraws, a ring ripples out and one light sweep crosses the bar.
 *
 * The links stay ordinary DOM (keyboard, hover menus and tests are untouched). The canvas only
 * renders while something moves, then stops, so an idle header costs nothing. Reduced motion
 * jumps straight to the new tab. Without WebGL the bar falls back to flat CSS (`glass-nav--flat`).
 */

/** Glow colour per tab, keyed by the tab's route. */
export const TAB_GLOW: Record<string, string> = {
  '/swap': '#7c7fff',
  '/explore': '#38bdf8',
  '/launches': '#f5b83d',
  '/positions': '#f472b6',
  '/portfolio': '#3fcf8e',
  '/metaswapx': '#a78bfa',
  '/metachain': '#22d3ee',
}

// Room around the bar for the bead's bulge, the glow and the ring (CSS px).
const PAD_X = 28
const PAD_T = 14
const PAD_B = 24

export function GlassNav({ activeTo, children }: { activeTo: string | null; children: ReactNode }) {
  const navRef = useRef<HTMLElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Engine | null>(null)
  const active = useRef(activeTo)
  active.current = activeTo

  useEffect(() => {
    const nav = navRef.current
    const row = rowRef.current
    const canvas = canvasRef.current
    if (!nav || !row || !canvas) return
    const e = createEngine(nav, row, canvas)
    if (!e) {
      nav.classList.add('glass-nav--flat')
      return
    }
    engine.current = e
    e.go(active.current, true)
    return () => {
      e.destroy()
      engine.current = null
    }
  }, [])

  useEffect(() => {
    engine.current?.go(activeTo, false)
  }, [activeTo])

  return (
    <nav ref={navRef} aria-label="Main" className="glass-nav relative ml-4 hidden lg:block">
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: -PAD_X, top: -PAD_T, width: `calc(100% + ${PAD_X * 2}px)`, height: `calc(100% + ${PAD_T + PAD_B}px)` }}
      />
      <div
        ref={rowRef}
        className="relative flex items-center gap-0.5 px-1.5"
        onClick={(e) => {
          // Start the move on the click itself, not when the next page's code has loaded.
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          const link = (e.target as HTMLElement).closest('a')
          if (!link?.matches('[data-glass-tab] > a')) return
          const to = link.parentElement?.dataset.glassTab
          if (to) engine.current?.go(to, false)
        }}
      >
        {children}
      </div>
    </nav>
  )
}

type Engine = { go: (to: string | null, instant: boolean) => void; destroy: () => void }
type Rgb = [number, number, number]

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uBar;    // centre x, centre y, half width, half height
uniform vec2 uBead;   // centre x, half width
uniform float uOn;    // bead visibility 0..1
uniform float uLift;  // 0 sunk in the bar, 1 bulging out (overshoots a little)
uniform vec3 uGlow;
uniform vec3 uBg;
uniform float uDark;
uniform float uTime;
uniform vec2 uRing;   // progress, strength
uniform float uSweep; // x of the light sweep

float sdRB(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
float smin(float a, float b, float k){ float h=clamp(.5+.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }

vec2 beadCentre(){ return vec2(uBead.x, uBar.y + 4.*uLift); }
float beadHalfH(){ return mix(uBar.w - 6., uBar.w + 5., uLift); }

vec2 scene(vec2 p){
  float dBar = sdRB(p - uBar.xy, uBar.zw, uBar.w);
  float hh = max(beadHalfH(), 2.);
  float dBead = sdRB(p - beadCentre(), vec2(max(uBead.y, hh), hh), hh);
  dBead = mix(1e3, dBead, step(.001, uOn));
  return vec2(smin(dBar, dBead, 10.*uOn + .001), dBead);
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y*uDpr - gl_FragCoord.y) / uDpr;
  vec2 s = scene(p);
  float d = s.x, db = s.y;
  vec2 g = vec2(scene(p+vec2(1.,0.)).x - scene(p-vec2(1.,0.)).x, scene(p+vec2(0.,1.)).x - scene(p-vec2(0.,1.)).x);
  vec2 n = length(g) > 1e-4 ? normalize(g) : vec2(0.);
  float inside = smoothstep(.75, -.75, d);
  float edge = 1. - smoothstep(0., 12., -d);
  bool dark = uDark > .5;

  // Refracted haze: the glass bends a soft procedural background near its rim.
  vec2 q = p - n*edge*10.;
  float h = fbm(q*.013 + vec2(uTime*.05, uTime*.03));
  vec3 haze = mix(uBg, mix(uBg, uGlow, dark ? .30 : .18), h*.55);
  vec3 col = mix(haze, dark ? vec3(1.) : vec3(.06,.08,.12), dark ? .065 : .05);

  // Light inside the bead, in the tab's colour.
  vec2 bc = beadCentre();
  float bh = uBar.w + 5.;
  float r = length((p - bc) / vec2(max(uBead.y, bh), bh));
  float core = exp(-r*r*2.);
  col += uGlow * core * (.08 + .26*clamp(uLift,0.,1.)) * (dark ? 1. : .55) * uOn;
  float spec = exp(-pow((p.y - (bc.y - bh*.62))/2.6, 2.)) * smoothstep(1., .25, abs(p.x - bc.x)/max(uBead.y, 1.));
  col += vec3(1.) * spec * (dark ? .13 : .5) * clamp(uLift,0.,1.) * uOn * smoothstep(.75,-.75,db);

  // Thin rim with a faint rainbow sheen, lit from above.
  float rim = exp(-pow((d + 1.)/1.1, 2.));
  float ang = atan(n.y, n.x);
  vec3 rainbow = .5 + .5*cos(6.2831*(ang/6.2831 + p.x*.004 + vec3(0.,.33,.67)));
  vec3 rimCol = dark ? mix(vec3(1.), rainbow, .4) : mix(vec3(.08,.1,.16), rainbow, .3);
  col = mix(col, rimCol, rim*(dark ? .26 : .2));
  col += vec3(1.) * max(-n.y, 0.) * edge * (dark ? .05 : .0);
  col = mix(col, vec3(.08,.1,.16), (dark ? 0. : 1.) * max(n.y, 0.) * edge * .05);

  // One light sweep across the bar after the bead lands.
  float sw = exp(-pow((p.x - uSweep + (p.y - uBar.y)*.7)/12., 2.));
  col = dark ? col + mix(uGlow, vec3(1.), .5)*sw*.12 : mix(col, uGlow, sw*.12);

  // Outside the glass: the glow tints the page around the bead, and the landing ring.
  float halo = exp(-max(db, 0.)/16.) * uOn * clamp(uLift,0.,1.) * (dark ? .17 : .1);
  float rr = length((p - bc) * vec2(.6, 1.));
  float ringR = bh*.95 + uRing.x*38.;
  float ring = exp(-pow((rr - ringR)/1.4, 2.)) * uRing.y * (dark ? .55 : .4);
  float outA = clamp(halo + ring, 0., 1.) * (1. - inside);
  float glassA = inside * .94;
  gl_FragColor = vec4(col*glassA + uGlow*outA, max(glassA, outA));
}
`

function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(v, 16)
  return Number.isNaN(n) ? [0, 0, 0] : [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const easeOutBack = (x: number) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2)
const mixN = (a: number, b: number, t: number) => a + (b - a) * t
const mixC = (a: Rgb, b: Rgb, t: number): Rgb => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)]

function createEngine(nav: HTMLElement, row: HTMLElement, canvas: HTMLCanvasElement): Engine | null {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) return null
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null
  }
  const vs = compile(gl.VERTEX_SHADER, VERT)
  const fs = compile(gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const U = (name: string) => gl.getUniformLocation(prog, name)
  const u = {
    res: U('uRes'), dpr: U('uDpr'), bar: U('uBar'), bead: U('uBead'), on: U('uOn'), lift: U('uLift'), glow: U('uGlow'),
    bg: U('uBg'), dark: U('uDark'), time: U('uTime'), ring: U('uRing'), sweep: U('uSweep'),
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let w = 0, h = 0, dpr = 1
  let bar = { cx: 0, cy: 0, hw: 0, hh: 0 }
  let tabs = new Map<string, { cx: number; hw: number; link: HTMLElement | null }>()
  let bg: Rgb = [0, 0, 0]
  let dark = true
  let target: string | null = null
  const cur = { x: 0, w: 0, lift: 1, on: 0, glow: hexToRgb('#7c7fff') }
  let anim: { from: typeof cur; to: { x: number; w: number; on: number; glow: Rgb }; t0: number; dur: number; landed: boolean; dest: string | null } | null = null
  let ring = -1, sweep = -1
  let raf = 0
  let time = 0

  const readTheme = () => {
    const css = getComputedStyle(document.documentElement)
    bg = hexToRgb(css.getPropertyValue('--ms-bg') || '#0d0f13')
    dark = document.documentElement.dataset.theme !== 'light'
  }

  const measure = () => {
    const nr = nav.getBoundingClientRect()
    w = nr.width + PAD_X * 2
    h = nr.height + PAD_T + PAD_B
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const rr = row.getBoundingClientRect()
    bar = { cx: rr.left - nr.left + PAD_X + rr.width / 2, cy: rr.top - nr.top + PAD_T + rr.height / 2, hw: rr.width / 2, hh: rr.height / 2 }
    tabs = new Map()
    row.querySelectorAll<HTMLElement>('[data-glass-tab]').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 1) return
      tabs.set(el.dataset.glassTab!, { cx: r.left - nr.left + PAD_X + r.width / 2, hw: r.width / 2 - 1, link: el.querySelector('a') })
      el.querySelectorAll('svg *').forEach((s) => s.setAttribute('pathLength', '1'))
    })
  }

  const draw = () => {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(u.res, w, h)
    gl.uniform1f(u.dpr, dpr)
    gl.uniform4f(u.bar, bar.cx, bar.cy, bar.hw, bar.hh)
    gl.uniform2f(u.bead, cur.x, cur.w)
    gl.uniform1f(u.on, cur.on)
    gl.uniform1f(u.lift, cur.lift)
    gl.uniform3f(u.glow, cur.glow[0], cur.glow[1], cur.glow[2])
    gl.uniform3f(u.bg, bg[0], bg[1], bg[2])
    gl.uniform1f(u.dark, dark ? 1 : 0)
    gl.uniform1f(u.time, time)
    const now = performance.now()
    const rp = ring < 0 ? 1 : (now - ring) / 560
    gl.uniform2f(u.ring, clamp01(rp), rp < 1 ? 1 - rp : 0)
    const sp = sweep < 0 ? 2 : (now - sweep) / 720
    gl.uniform1f(u.sweep, sp <= 1 ? mixN(bar.cx - bar.hw - 30, bar.cx + bar.hw + 30, easeInOut(sp)) : -1e4)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  const replay = (el: HTMLElement | null | undefined, cls: string) => {
    if (!el) return
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
  }

  const frame = (now: number) => {
    raf = 0
    let moving = false
    if (anim) {
      const t = clamp01((now - anim.t0) / anim.dur)
      const { from, to } = anim
      const travel = easeInOut(clamp01((t - 0.12) / 0.68))
      const dx = Math.abs(to.x - from.x)
      cur.x = mixN(from.x, to.x, travel)
      cur.w = mixN(from.w, to.w, travel) + Math.sin(Math.PI * travel) * Math.min(dx * 0.22, 36)
      cur.on = mixN(from.on, to.on, clamp01(t / 0.3))
      cur.glow = mixC(from.glow, to.glow, travel)
      if (t < 0.2) cur.lift = mixN(from.lift, 0, easeInOut(t / 0.2))
      else if (t < 0.78) cur.lift = 0.12 * Math.sin(Math.PI * travel)
      else cur.lift = to.on ? easeOutBack((t - 0.78) / 0.22) : 0
      // Tabs lift a little as the wave passes under them.
      const wave = Math.sin(Math.PI * travel)
      tabs.forEach((tab) => {
        if (!tab.link) return
        const k = Math.exp(-Math.pow((tab.cx - cur.x) / 34, 2)) * wave
        tab.link.style.transform = k > 0.02 ? `translateY(${(-3 * k).toFixed(2)}px)` : ''
      })
      if (!anim.landed && t >= 0.84) {
        anim.landed = true
        if (anim.dest && to.on) {
          ring = now
          sweep = now + 90
          const link = tabs.get(anim.dest)?.link
          replay(link?.querySelector<HTMLElement>('.gn-icon'), 'gn-redraw')
          replay(link, 'gn-arrive')
        }
      }
      if (t >= 1) anim = null
      moving = true
    }
    if (ring >= 0 && now - ring < 560) moving = true
    if (sweep >= 0 && now - sweep < 720) moving = true
    if (moving) time = now / 1000
    draw()
    if (moving) raf = requestAnimationFrame(frame)
  }

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame)
  }

  const settle = () => {
    const t = target ? tabs.get(target) : undefined
    if (t) {
      cur.x = t.cx
      cur.w = t.hw
      cur.on = 1
      cur.lift = 1
      cur.glow = hexToRgb(TAB_GLOW[target!] ?? '#7c7fff')
    } else cur.on = 0
  }

  const go = (to: string | null, instant: boolean) => {
    const prev = target
    // The click already started this move; the route change that follows only confirms it.
    if (prev === to && anim && !instant) return
    target = to
    measure()
    const t = to ? tabs.get(to) : undefined
    if (instant || reduced.matches || !cur.on || prev === to) {
      anim = null
      settle()
      kick()
      return
    }
    anim = {
      from: { ...cur, glow: [...cur.glow] as Rgb },
      to: t ? { x: t.cx, w: t.hw, on: 1, glow: hexToRgb(TAB_GLOW[to!] ?? '#7c7fff') } : { x: cur.x, w: cur.w, on: 0, glow: cur.glow },
      t0: performance.now(),
      dur: 620 + Math.min(Math.abs((t?.cx ?? cur.x) - cur.x), 480) * 0.55,
      landed: false,
      dest: to,
    }
    kick()
  }

  readTheme()
  const ro = new ResizeObserver(() => {
    measure()
    if (!anim) settle()
    kick()
  })
  ro.observe(nav)
  ro.observe(row)
  const mo = new MutationObserver(() => {
    readTheme()
    kick()
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  const onLost = (e: Event) => {
    e.preventDefault()
    nav.classList.add('glass-nav--flat')
  }
  canvas.addEventListener('webglcontextlost', onLost)
  document.fonts?.ready.then(() => {
    measure()
    if (!anim) settle()
    kick()
  })

  return {
    go,
    destroy: () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      tabs.forEach((t) => t.link && (t.link.style.transform = ''))
    },
  }
}
