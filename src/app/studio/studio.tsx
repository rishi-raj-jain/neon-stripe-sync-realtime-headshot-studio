'use client'

import { APP_LOADER_MARK, StripeLogo } from '@/components/brand/logos'
import { EmptyState } from '@/components/empty-state/empty-state'
import { NeonLoader } from '@/components/neon-loader/neon-loader'
import { StatusBadge, type AppStatus } from '@/components/status-badge/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { UpgradeDialog } from '@/components/upgrade-dialog/upgrade-dialog'
import { CREDIT_PACKS, CREDITS_PER_VARIANT, DAILY_IMAGE_LIMIT, MAX_VARIANTS, SELFIE_CONTENT_TYPES, STYLES, type PackId, type StyleId } from '@/shared/headshots'
import { useCallback, useEffect, useState } from 'react'

type Wallet = { purchased: number; spent: number; balance: number }
type Purchase = { id: string; amount: number; amountRefunded: number; currency: string; refunded: boolean; disputed: boolean; credits: number; created: number }
/** The daily rate limit (rolling 24 hours). `freesAt`: when the oldest counted run ages out. */
type Usage = { used: number; limit: number; remaining: number; freesAt: string | null }
type JobStatus = 'awaiting_upload' | 'processing' | 'succeeded' | 'failed' | 'insufficient_credits' | 'rate_limited' | 'expired'
/** What POST /api/jobs returns for a fresh job. */
type Job = { id: string; style: StyleId; variants: number; cost: number; status: JobStatus; error: string | null; createdAt: string }
/** A stored run from GET /api/jobs: the job plus what it used and produced (signed URLs). */
type Run = Job & { model: string | null; prompt: string | null; startedAt: string | null; finishedAt: string | null; durationMs: number | null; inputUrl: string | null; images: string[] }
type RunStats = { runs: number; succeeded: number; headshots: number; creditsSpent: number }
type RunsPage = { runs: Run[]; nextCursor: string | null; stats?: RunStats }
/** First paint, rendered on the server (src/lib/dashboard.ts). */
type Dashboard = { wallet: Wallet; usage: Usage; purchases: Purchase[]; runs: Run[]; nextCursor: string | null; stats: RunStats }

const pendingRun = (job: Job): Run => ({ ...job, model: null, prompt: null, startedAt: null, finishedAt: null, durationMs: null, inputUrl: null, images: [] })

/** A run can't be bigger than the daily limit, so don't offer variant counts that could never pass. */
const MAX_VARIANTS_PER_RUN = Math.min(MAX_VARIANTS, DAILY_IMAGE_LIMIT)

const IN_FLIGHT: JobStatus[] = ['awaiting_upload', 'processing']

/** Jobs speak the Neon UI status vocabulary. */
const JOB_STATUS: Record<JobStatus, { status: AppStatus; label: string }> = {
  awaiting_upload: { status: 'provisioning', label: 'Uploading' },
  processing: { status: 'provisioning', label: 'Generating' },
  succeeded: { status: 'ready', label: 'Ready' },
  failed: { status: 'error', label: 'Failed, credits returned' },
  insufficient_credits: { status: 'error', label: 'Not enough credits' },
  rate_limited: { status: 'error', label: 'Daily limit reached' },
  expired: { status: 'stopped', label: 'Upload never arrived' },
}

const BASELINE_KEY = 'headshots:purchased-before-checkout'
/** Free ($0) orders exist only as Checkout Session rows, whose creates can lag during the sync preview. */
const SYNC_PATIENCE_MS = 10 * 60_000

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body as T
}

const dollars = (cents: number) => cents / 100

export function Studio({ initial, returnedFromCheckout }: { initial: Dashboard; returnedFromCheckout: boolean }) {
  const [wallet, setWallet] = useState<Wallet | null>(initial.wallet)
  const [usage, setUsage] = useState<Usage>(initial.usage)
  const [purchases, setPurchases] = useState<Purchase[]>(initial.purchases)
  const [runs, setRuns] = useState<Run[] | null>(initial.runs)
  const [stats, setStats] = useState<RunStats | null>(initial.stats)
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [awaitingPayment, setAwaitingPayment] = useState(returnedFromCheckout)
  const [waitingLong, setWaitingLong] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshCredits = useCallback(async () => {
    const data = await api<{ wallet: Wallet; usage: Usage; purchases: Purchase[] }>('/api/credits')
    setWallet(data.wallet)
    setUsage(data.usage)
    setPurchases(data.purchases)
    return data.wallet
  }, [])

  /** Re-fetch the newest page and stats, keeping any older pages already loaded. */
  const refreshRuns = useCallback(async () => {
    const page = await api<RunsPage>('/api/jobs')
    setStats(page.stats ?? null)
    setRuns((current) => {
      const fresh = new Set(page.runs.map((run) => run.id))
      const oldest = page.runs.at(-1)?.createdAt
      const older = (current ?? []).filter((run) => !fresh.has(run.id) && oldest !== undefined && run.createdAt < oldest)
      return [...page.runs, ...older]
    })
    setNextCursor((cursor) => cursor ?? page.nextCursor)
    return page.runs
  }, [])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await api<RunsPage>(`/api/jobs?cursor=${encodeURIComponent(nextCursor)}`)
      setRuns((current) => {
        const seen = new Set((current ?? []).map((run) => run.id))
        return [...(current ?? []), ...page.runs.filter((run) => !seen.has(run.id))]
      })
      setNextCursor(page.nextCursor)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  // Back from Checkout: no webhook to wait on. Poll the wallet view until the synced purchase lands.
  useEffect(() => {
    if (!awaitingPayment) return
    const baseline = Number(sessionStorage.getItem(BASELINE_KEY) ?? 0)
    const startedAt = Date.now()
    const done = () => {
      clearInterval(timer)
      sessionStorage.removeItem(BASELINE_KEY)
      setAwaitingPayment(false)
      setWaitingLong(false)
      window.history.replaceState(null, '', '/studio')
    }
    const timer = setInterval(async () => {
      const latest = await refreshCredits().catch(() => null)
      const elapsed = Date.now() - startedAt
      if (elapsed > 45_000) setWaitingLong(true)
      if ((latest && latest.purchased > baseline) || elapsed > SYNC_PATIENCE_MS) done()
    }, 3_000)
    return () => clearInterval(timer)
  }, [awaitingPayment, refreshCredits])

  // While any run is in flight, poll runs and the wallet (spent credits move with them).
  const hasInFlight = (runs ?? []).some((run) => IN_FLIGHT.includes(run.status))
  // Runs still uploading count toward the limit once claimed, so hold their images back here too.
  const reserved = (runs ?? []).filter((run) => run.status === 'awaiting_upload').reduce((sum, run) => sum + run.variants, 0)
  const imagesLeft = Math.max(0, usage.remaining - reserved)
  useEffect(() => {
    if (!hasInFlight) return
    const timer = setInterval(() => {
      refreshRuns().catch(() => {})
      refreshCredits().catch(() => {})
    }, 2_500)
    return () => clearInterval(timer)
  }, [hasInFlight, refreshRuns, refreshCredits])

  return (
    // Phones and tablets stack wallet → create → runs → buy credits. Desktop keeps a sidebar
    // (wallet over packs) beside the main column.
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      <div className="lg:col-start-1 lg:row-start-1">
        <WalletCard wallet={wallet} awaitingPayment={awaitingPayment} waitingLong={waitingLong} />
      </div>

      <section className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <UploadCard
          balance={wallet?.balance ?? 0}
          imagesLeft={imagesLeft}
          freesAt={usage.freesAt}
          onCreated={(job) => setRuns((current) => [pendingRun(job), ...(current ?? [])])}
          onUploaded={() => refreshRuns()}
          onError={setError}
        />
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 className="font-semibold tracking-tight">Your runs</h2>
            {stats && stats.runs > 0 && <span className="text-xs text-muted-foreground">Every run and result is saved in Neon (Postgres + Object Storage)</span>}
          </div>
          {stats && stats.runs > 0 && <RunStatsRow stats={stats} />}
          {runs === null ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : runs.length === 0 ? (
            <EmptyState title="No headshots yet" description="Upload a selfie above. Each variant costs one credit, and failed generations give it back." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {runs.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </div>
          )}
          {nextCursor && (
            <Button variant="outline" className="self-center" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Loading…' : 'Load older runs'}
            </Button>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start lg:col-start-1 lg:row-start-2 lg:flex lg:flex-col lg:items-stretch">
        <Packs wallet={wallet} onError={setError} />
        <Purchases purchases={purchases} />
      </aside>
    </div>
  )
}

function WalletCard({ wallet, awaitingPayment, waitingLong }: { wallet: Wallet | null; awaitingPayment: boolean; waitingLong: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Credits</CardDescription>
        {wallet ? <CardTitle className="text-4xl tabular-nums">{wallet.balance}</CardTitle> : <Skeleton className="h-10 w-16" />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
        <span>{wallet ? `${wallet.purchased} purchased · ${wallet.spent} spent` : 'Loading…'}</span>
        {awaitingPayment && (
          <NeonLoader size="sm" label={waitingLong ? 'Free orders can take a few minutes to sync while Stripe’s Postgres sync is in preview…' : 'Purchase complete. Waiting for Stripe to sync it to Postgres…'} />
        )}
      </CardContent>
    </Card>
  )
}

function Packs({ wallet, onError }: { wallet: Wallet | null; onError: (message: string | null) => void }) {
  const [selected, setSelected] = useState<PackId | null>(null)
  const [processing, setProcessing] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  async function checkout(pack: PackId) {
    onError(null)
    setDialogError(null)
    setProcessing(true)
    try {
      const { url } = await api<{ url: string }>('/api/checkout', { method: 'POST', body: JSON.stringify({ pack }) })
      sessionStorage.setItem(BASELINE_KEY, String(wallet?.purchased ?? 0))
      window.location.assign(url)
    } catch (e) {
      setDialogError((e as Error).message)
      setProcessing(false)
    }
  }

  const pack = selected ? CREDIT_PACKS[selected] : null

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">Buy credits</span>
      {(Object.keys(CREDIT_PACKS) as PackId[]).map((id) => {
        const option = CREDIT_PACKS[id]
        return (
          <Button key={id} variant="outline" className="h-auto justify-between px-4 py-3" onClick={() => setSelected(id)}>
            <span className="flex items-baseline gap-2">
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.credits} credits</span>
            </span>
            <span className="tabular-nums">${dollars(option.unitAmount)}</span>
          </Button>
        )
      })}
      {pack && (
        <UpgradeDialog
          open={selected !== null}
          onOpenChange={(open) => !open && setSelected(null)}
          onUpgrade={() => selected && checkout(selected)}
          isProcessing={processing}
          error={dialogError}
          title={`${pack.label} pack`}
          description={
            <span className="flex items-start gap-2">
              <StripeLogo className="mt-0.5 size-3.5 shrink-0" /> Secure checkout with Stripe. Credits arrive through Stripe&apos;s real-time sync to Neon.
            </span>
          }
          plan={{
            name: pack.label,
            price: dollars(pack.unitAmount),
            period: 'one-time',
            action: 'Continue to checkout',
            working: 'Opening checkout…',
            features: [`${pack.credits} headshot credits`, 'All four styles', `Up to ${MAX_VARIANTS_PER_RUN} variant${MAX_VARIANTS_PER_RUN === 1 ? '' : 's'} per selfie`, 'Failed generations refund automatically'],
          }}
        />
      )}
    </div>
  )
}

function Purchases({ purchases }: { purchases: Purchase[] }) {
  if (purchases.length === 0) return null
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-start gap-2">
          <StripeLogo className="mt-0.5 size-3.5 shrink-0" />
          {/* One inline run of text, so it wraps as a sentence instead of as flex columns. */}
          <span>
            Purchases, from the synced <code className="font-mono text-xs">stripe.*</code> tables
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {purchases.map((purchase) => (
          <div key={purchase.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {purchase.credits} credits
              {purchase.refunded && <Badge variant="outline">refunded</Badge>}
              {!purchase.refunded && purchase.amountRefunded > 0 && <Badge variant="outline">partly refunded</Badge>}
              {purchase.disputed && <Badge variant="destructive">disputed</Badge>}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {dollars(purchase.amount).toFixed(2)} {purchase.currency.toUpperCase()}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function UploadCard(props: { balance: number; imagesLeft: number; freesAt: string | null; onCreated: (job: Job) => void; onUploaded: () => void; onError: (message: string | null) => void }) {
  const [style, setStyle] = useState<StyleId>('corporate')
  const [variants, setVariants] = useState(Math.min(2, MAX_VARIANTS_PER_RUN))
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const cost = variants * CREDITS_PER_VARIANT
  const overLimit = variants > props.imagesLeft

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return
    const form = event.currentTarget
    props.onError(null)
    setBusy(true)
    try {
      const { job, upload } = await api<{ job: Job; upload: { url: string; method: 'PUT'; headers: Record<string, string> } }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ style, variants, contentType: file.type }),
      })
      props.onCreated(job)
      // Browser → Neon Object Storage. The object landing fires the `onupload` function.
      const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file })
      if (!put.ok) throw new Error(`Upload failed (${put.status})`)
      props.onUploaded()
      setFile(null)
      form.reset()
    } catch (e) {
      props.onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const styleItems = (Object.keys(STYLES) as StyleId[]).map((id) => ({ value: id, label: STYLES[id].label }))
  const variantItems = Array.from({ length: MAX_VARIANTS_PER_RUN }, (_, i) => ({ value: String(i + 1), label: `${i + 1} variant${i ? 's' : ''}` }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>New headshots</CardTitle>
        <CardDescription>One selfie in, studio portraits out. JPEG, PNG or WebP, up to 10 MB.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="selfie">Selfie</Label>
            <Input id="selfie" type="file" accept={Object.keys(SELFIE_CONTENT_TYPES).join(',')} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Style</Label>
            <Select items={styleItems} value={style} onValueChange={(value) => value && setStyle(value as StyleId)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {styleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Variants</Label>
            <Select items={variantItems} value={String(variants)} onValueChange={(value) => value && setVariants(Number(value))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variantItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="lg" className="sm:col-span-2" disabled={!file || busy || overLimit || props.balance < cost}>
            {busy
              ? 'Uploading…'
              : overLimit
                ? props.imagesLeft === 0
                  ? 'Daily limit reached'
                  : `Only ${props.imagesLeft} left today`
                : props.balance < cost
                  ? `Needs ${cost} credit${cost === 1 ? '' : 's'}`
                  : `Generate · ${cost} credit${cost === 1 ? '' : 's'}`}
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {props.imagesLeft} of {DAILY_IMAGE_LIMIT} headshots left today
            {props.imagesLeft < DAILY_IMAGE_LIMIT && props.freesAt && (
              // Local time differs between server and browser, so let the client's rendering win.
              <span suppressHydrationWarning> · more from {new Date(props.freesAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function RunStatsRow({ stats }: { stats: RunStats }) {
  const items = [
    { label: 'Runs', value: stats.runs },
    { label: 'Headshots', value: stats.headshots },
    { label: 'Credits spent', value: stats.creditsSpent },
    { label: 'Success rate', value: stats.runs ? `${Math.round((stats.succeeded / stats.runs) * 100)}%` : '–' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} size="sm">
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{item.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  return 'just now'
}

const formatDuration = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

function RunCard({ run }: { run: Run }) {
  const badge = JOB_STATUS[run.status]
  const meta = [
    timeAgo(run.createdAt),
    `${run.variants} variant${run.variants === 1 ? '' : 's'}`,
    `${run.cost} credit${run.cost === 1 ? '' : 's'}`,
    run.durationMs !== null && formatDuration(run.durationMs),
    run.model,
  ].filter(Boolean)

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{STYLES[run.style]?.label ?? run.style}</CardTitle>
          <StatusBadge status={badge.status} label={badge.label} />
        </div>
        {/* Each fact stays whole when the line wraps on narrow screens. */}
        <CardDescription title={new Date(run.createdAt).toLocaleString()} className="flex flex-wrap gap-x-1.5">
          {meta.map((item, index) => (
            <span key={index} className="whitespace-nowrap">
              {index > 0 && <span aria-hidden="true">· </span>}
              {item}
            </span>
          ))}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {IN_FLIGHT.includes(run.status) && <NeonLoader mark={APP_LOADER_MARK} size="md" className="py-6" label={run.status === 'processing' ? 'Generating your headshots…' : 'Uploading your selfie…'} />}
        {run.error && <p className="text-xs text-muted-foreground">{run.error}</p>}
        {(run.inputUrl || run.images.length > 0) && (
          <div className="flex gap-2">
            {run.inputUrl && (
              <a href={run.inputUrl} target="_blank" rel="noreferrer" className="flex w-1/4 shrink-0 flex-col gap-1" title="The selfie this run started from">
                <img src={run.inputUrl} alt="Selfie" className="aspect-square w-full rounded-md object-cover opacity-80" />
                <span className="text-[10px] text-muted-foreground">Selfie</span>
              </a>
            )}
            {run.images.length > 0 && (
              <div className={`grid min-w-0 flex-1 gap-2 ${run.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {run.images.map((src, index) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer">
                    <img src={src} alt={`Headshot ${index + 1}`} className="aspect-square w-full rounded-md object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        {run.prompt && (
          <details className="text-xs text-muted-foreground">
            <summary className="select-none hover:text-foreground">Prompt</summary>
            <p className="mt-1 leading-relaxed">{run.prompt}</p>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
