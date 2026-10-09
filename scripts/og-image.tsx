import { AppLogo, NeonLogo, StripeLogo } from '@/components/brand/logos'
import { SITE } from '@/shared/site'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Pre-renders the social card to src/app/opengraph-image.png, once:
 *   - Next serves that file as the site's og:image (file convention, nothing to run at build)
 *   - the README embeds the same PNG
 *
 * It's plain HTML screenshotted by headless Chrome, so the card uses the site's real font
 * (Google Sans). next/og can't: Satori can't parse Google Sans's OpenType tables.
 * Re-run only after changing the name, the copy or the marks:
 *
 *   npm run og                      # CHROME_PATH=… to use another Chrome/Chromium
 */
const OUT = resolve('src/app/opengraph-image.png')
const [WIDTH, HEIGHT] = [1200, 630]
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const TAGLINE = 'Studio-quality headshots from one selfie.'
const FOOTNOTE = 'Real-time sync to Postgres · no webhooks'

const card = (
  <main>
    {/* The mark again, large and faint, as the backdrop. */}
    <AppLogo className="backdrop" />
    <div className="tile">
      <AppLogo className="mark" />
    </div>
    <div className="copy">
      <h1>{SITE.name}</h1>
      <p>{TAGLINE}</p>
    </div>
    <footer>
      <span className="chip">
        <NeonLogo className="neon" />
        Neon
      </span>
      <span className="plus">+</span>
      <span className="chip">
        <StripeLogo />
        Stripe
      </span>
      <span className="note">{FOOTNOTE}</span>
    </footer>
  </main>
)

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@500;700&display=block" rel="stylesheet">
<style>
  :root { --bg: #0c0d0d; --fg: #f3f4f6; --muted: #9aa3ae; --subtle: #6b7480; --border: #23282b; --tile: #121514; --neon: #00e599; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    font-family: 'Google Sans', sans-serif; color: var(--fg); background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  main {
    position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; padding: 72px 80px; overflow: hidden;
    /* Neon green from the top right, Stripe blurple from the bottom left. */
    background:
      radial-gradient(circle at 88% 8%, rgba(0, 229, 153, 0.20), transparent 46%),
      radial-gradient(circle at 0% 100%, rgba(99, 91, 255, 0.18), transparent 50%);
  }
  .backdrop { position: absolute; right: -70px; top: 35px; width: 560px; height: 560px; color: var(--neon); opacity: 0.07; }
  .tile { display: flex; align-items: center; justify-content: center; width: 112px; height: 112px; border-radius: 28px; background: var(--tile); border: 1px solid var(--border); }
  .mark { width: 72px; height: 72px; color: var(--neon); }
  .copy { display: flex; flex-direction: column; gap: 18px; margin-top: auto; }
  h1 { font-size: 96px; font-weight: 700; letter-spacing: -3px; line-height: 1; }
  p { font-size: 40px; font-weight: 500; color: var(--muted); }
  footer { display: flex; align-items: center; gap: 18px; margin-top: 56px; }
  .chip { display: flex; align-items: center; gap: 14px; padding: 14px 24px; border-radius: 999px; border: 1px solid var(--border); background: var(--tile); font-size: 30px; font-weight: 500; }
  .chip svg { width: 30px; height: 30px; }
  .neon { color: var(--neon); }
  .plus { font-size: 32px; color: var(--subtle); }
  .note { margin-left: auto; font-size: 26px; font-weight: 500; color: var(--subtle); }
</style>
</head>
<body>${renderToStaticMarkup(card)}</body>
</html>`

const dir = mkdtempSync(join(tmpdir(), 'og-'))
try {
  const page = join(dir, 'card.html')
  writeFileSync(page, html)
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
      // Lets the web font load before the screenshot is taken.
      '--virtual-time-budget=10000',
      `--user-data-dir=${join(dir, 'profile')}`,
      `--screenshot=${OUT}`,
      pathToFileURL(page).href,
    ],
    { stdio: 'ignore' },
  )
  console.log(`Wrote ${OUT} (${WIDTH}×${HEIGHT})`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
