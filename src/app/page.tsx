import { NeonLogo, StripeLogo } from '@/components/brand/logos'
import { NeonAurora } from '@/components/neon-aurora/neon-aurora'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getUser } from '@/lib/auth/server'
import { cn } from '@/lib/utils'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const steps = [
  { title: 'Buy credits', body: 'Stripe Checkout. No webhook: the purchase syncs into Postgres in seconds.', by: 'stripe' },
  { title: 'Upload a selfie', body: 'Straight from your browser to Neon Object Storage through a presigned URL.', by: 'neon' },
  { title: 'The upload is the queue', body: 'A storage trigger runs a Neon Function that spends credits and generates.', by: 'neon' },
  { title: 'Download', body: 'Results land in a private bucket, served through short-lived signed URLs.', by: 'neon' },
] as const

export default async function Home() {
  const user = await getUser()

  return (
    <div className="flex flex-col gap-12 pt-6">
      <section className="relative isolate overflow-hidden rounded-2xl border bg-card">
        <NeonAurora className="absolute inset-0 -z-10 size-full opacity-60" intensity={0.9} />
        <div className="flex flex-col gap-6 bg-gradient-to-t from-card via-card/70 to-transparent px-6 pt-18 pb-10 sm:px-12">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Studio-quality headshots from one selfie.</h1>
          <p className="max-w-xl text-lg text-muted-foreground">A reference app for Stripe&apos;s real-time sync to Neon Postgres, built with Neon Functions, Object Storage, Auth and AI Gateway.</p>
          <div>
            <Link href={user ? '/studio' : '/auth'} className={cn(buttonVariants({ size: 'lg' }), 'h-10 px-4 text-base')}>
              Get started &rarr;
            </Link>
          </div>
        </div>
      </section>

      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span className="font-medium text-primary">Step {index + 1}</span>
                  {step.by === 'stripe' ? <StripeLogo className="size-4" title="Stripe" /> : <NeonLogo className="size-4 text-neon" title="Neon" />}
                </div>
                <CardTitle>{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  )
}
