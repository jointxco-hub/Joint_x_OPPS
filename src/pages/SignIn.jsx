import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';

const REDIRECT = `${window.location.origin}/Dashboard`;

export default function SignIn() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode]         = useState('password'); // 'password' | 'signup' | 'magic_link'
  const [loading, setLoading]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState('');
  const { checkAppState } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/Dashboard';

  const reset = (toMode = 'password') => {
    setSent(false);
    setMode(toMode);
    setError('');
  };

  // ── Auth handlers ────────────────────────────────────────────────

  const handleGoogle = async () => {
    if (!supabase) return setError('Supabase is not configured.');
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: REDIRECT },
      });
      if (error) throw error;
      // Browser navigates away — no further state updates needed
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setLoading(false);
    }
  };

  const handlePassword = async (e) => {
    e.preventDefault();
    if (!supabase) return setError('Supabase is not configured.');
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await checkAppState();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || 'Sign in failed.');
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!supabase) return setError('Supabase is not configured.');
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: REDIRECT },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err.message || 'Sign up failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e) => {
    e.preventDefault();
    if (!supabase) return setError('Supabase is not configured.');
    setError('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: REDIRECT },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send magic link.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = mode === 'signup'     ? handleSignup
                     : mode === 'magic_link' ? handleMagicLink
                     :                         handlePassword;

  // ── Sent confirmation screen (Google button explicitly absent) ───

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Check your email</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {mode === 'magic_link' ? (
              <>We sent a sign-in link to <span className="font-semibold text-foreground">{email}</span>.<br />Click it to sign in — no password needed.</>
            ) : (
              <>We sent a confirmation to <span className="font-semibold text-foreground">{email}</span>.<br />Click the link to verify your account, then sign in.</>
            )}
          </p>
          <button
            onClick={() => reset('password')}
            className="mt-6 text-sm text-primary hover:underline"
          >
            Use a different method
          </button>
        </div>
      </div>
    );
  }

  // ── Derived labels ───────────────────────────────────────────────

  const heading = mode === 'signup' ? 'Create account' : 'Sign in';
  const subheading = mode === 'signup'     ? 'Create your Joint X account.'
                   : mode === 'magic_link' ? "Enter your email and we'll send a sign-in link."
                   :                        'Enter your email and password to continue.';
  const submitLabel = loading
    ? (mode === 'signup' ? 'Creating account…' : mode === 'magic_link' ? 'Sending link…' : 'Signing in…')
    : (mode === 'signup' ? 'Create account'    : mode === 'magic_link' ? 'Send magic link' : 'Sign in');

  // ── Main form ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
            <div className="relative w-6 h-6">
              <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-[#1a7a5e]" />
              <span className="absolute bottom-0 left-0 w-2.5 h-2.5 rounded-full bg-[#b83a1a]" />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#c0a4e0]" />
            </div>
          </div>
          <div>
            <p className="font-bold text-foreground text-sm leading-tight">Joint X</p>
            <p className="text-xs text-muted-foreground">Operations OS</p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-1">{heading}</h2>
        <p className="text-sm text-muted-foreground mb-7">{subheading}</p>

        {/* Google OAuth — not rendered on sent screen (early return above) */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full h-11 rounded-xl border border-border bg-card flex items-center justify-center gap-3 text-sm font-medium text-foreground hover:bg-muted transition-all disabled:opacity-50 mb-5"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"/>
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Email form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@jointx.co"
              className="w-full h-11 rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
            />
          </div>

          {(mode === 'password' || mode === 'signup') && (
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full h-11 rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </form>

        {/* Below-form links */}
        <div className="mt-5 text-center space-y-2">
          {mode === 'password' && (
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <button onClick={() => reset('signup')} className="text-primary hover:underline font-medium">
                Sign up
              </button>
            </p>
          )}
          {mode === 'signup' && (
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <button onClick={() => reset('password')} className="text-primary hover:underline font-medium">
                Sign in
              </button>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {mode !== 'magic_link' ? (
              <button onClick={() => reset('magic_link')} className="text-primary hover:underline">
                Or send me a magic link instead
              </button>
            ) : (
              <button onClick={() => reset('password')} className="text-primary hover:underline">
                Sign in with password instead
              </button>
            )}
          </p>
        </div>

      </div>
    </div>
  );
}
