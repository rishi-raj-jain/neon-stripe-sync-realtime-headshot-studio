import { AppLogo, GitHubIcon, NeonLogo, StripeLogo } from '@/components/brand/logos'
import { buttonVariants } from '@/components/ui/button'
import { env } from '@/env'
import { SITE } from '@/shared/site'
import type { Metadata } from 'next'
import { Google_Sans } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

// next/font has no fallback metrics for Google Sans yet, so name the system fallback explicitly.
const googleSans = Google_Sans({ subsets: ['latin'], variable: '--font-google-sans', display: 'swap', adjustFontFallback: false, fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'] })

// The social card is the pre-rendered src/app/opengraph-image.png (npm run og), which Next
// serves as og:image by file convention. X falls back to it for twitter:image.
export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: SITE.name,
  description: 'AI headshots on Neon + Stripe, with no webhooks.',
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark only: the Neon UI tokens key their dark palette off this class.
    <html lang="en" className={`dark ${googleSans.variable}`}>
      <body className="flex min-h-screen flex-col">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <AppLogo className="size-7 text-primary" />
            {SITE.name}
          </Link>
          <nav className="flex items-center gap-1">
            <a href={SITE.githubUrl} target="_blank" rel="noreferrer" aria-label="Source on GitHub" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
              <GitHubIcon className="size-4" />
            </a>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-24">{children}</main>
        <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 border-t px-6 py-6 text-sm text-muted-foreground">
          <a href="https://neon.com" target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-foreground">
            <NeonLogo className="size-4 text-neon" title="Neon" />
            Built on Neon
          </a>
          <a href="https://stripe.com" target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-foreground">
            <StripeLogo className="size-4" title="Stripe" />
            Payments by Stripe
          </a>
          <span className="sm:ml-auto">
            Built by{' '}
            <a href="https://rishi.app" target="_blank" rel="noreferrer" className="text-foreground underline-offset-4 hover:underline">
              Rishi
            </a>
          </span>
        </footer>
      </body>
    </html>
  )
}
