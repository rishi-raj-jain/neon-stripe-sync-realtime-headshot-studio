'use client'

import { AuthForm, type AuthFieldName, type AuthFormValues, type AuthMode } from '@/components/auth-form/auth-form'
import { AppLogo } from '@/components/brand/logos'
import { Button } from '@/components/ui/button'
import { useState, useTransition } from 'react'
import { signInAsDemo, signInWithUsername, signUpWithUsername, type AuthResult } from '@/app/auth/actions'

/** One page for both: try the demo, create an account (name, username, password), or sign in. */
export function AuthPanel() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [result, setResult] = useState<AuthResult | null>(null)
  const [pending, startTransition] = useTransition()
  const [demoPending, startDemo] = useTransition()
  const busy = pending || demoPending

  function submit(values: AuthFormValues) {
    setResult(null)
    startTransition(async () => {
      const input = { username: values.email, password: values.password }
      // On success the action redirects to /studio; only failures come back.
      const outcome = mode === 'sign-up' ? await signUpWithUsername({ ...input, name: values.name }) : await signInWithUsername(input)
      setResult(outcome ?? null)
    })
  }

  function tryDemo() {
    setResult(null)
    startDemo(async () => setResult((await signInAsDemo()) ?? null))
  }

  const fieldErrors = result?.field ? ({ [result.field]: result.error } as Partial<Record<AuthFieldName, string>>) : undefined

  return (
    <div className="flex justify-center pt-12">
      <AuthForm
        identifier="username"
        mode={mode}
        onModeChange={(next: AuthMode) => {
          setResult(null)
          setMode(next === 'sign-up' ? 'sign-up' : 'sign-in')
        }}
        mark={<AppLogo className="size-8" />}
        description={mode === 'sign-up' ? 'Pick a username and password. No email needed.' : 'Sign in to turn one selfie into studio headshots.'}
        isBusy={busy}
        error={result && !result.field ? result.error : null}
        fieldErrors={fieldErrors}
        onSubmit={submit}
        lead={
          <>
            <Button type="button" variant="outline" size="lg" className="h-10 w-full text-sm" disabled={busy} onClick={tryDemo}>
              {demoPending ? 'Opening the demo…' : 'Try the demo account'}
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        }
      />
    </div>
  )
}
