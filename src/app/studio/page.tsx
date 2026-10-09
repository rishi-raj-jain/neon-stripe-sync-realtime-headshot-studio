import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { signOut } from '@/app/auth/actions'
import { Studio } from '@/app/studio/studio'

export const dynamic = 'force-dynamic'

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  const { checkout } = await searchParams

  return (
    <div className="flex flex-col gap-8 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Hi {user.name.split(' ')[0] || 'there'}</h1>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>
      <Studio returnedFromCheckout={checkout === 'success'} />
    </div>
  )
}
