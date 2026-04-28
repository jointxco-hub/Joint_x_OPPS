import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('password');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const { checkAppState } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'magic') {
        if (!supabase) throw new Error('Supabase is not configured.');
        const { error } = await supabase.auth.signInWithOtp({ email });
        if (error) throw error;
        setMagicSent(true);
      } else {
        if (!supabase) throw new Error('Supabase is not configured.');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await checkAppState();
        navigate(params.get('next') || '/Dashboard', { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    }
    setLoading(false);
  };

  if (magicSent) {
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
            We sent a magic link to <span className="font-semibold text-foreground">{email}</span>.<br />Click it to sign in — no password needed.
          </p>
          <button
            onClick={() => { setMagicSent(false); setEmail(''); }}
            className="mt-6 text-sm text-primary hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

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

        <h2 className="text-2xl font-bold text-foreground mb-1">Sign in</h2>
        <p className="text-sm text-muted-foreground mb-7">
          {mode === 'password' ? 'Enter your email and password to continue.' : 'Enter your email and we\'ll send a sign-in link.'}
        </p>

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

          {mode === 'password' && (
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
            {loading
              ? 'Signing in…'
              : mode === 'magic'
              ? 'Send magic link'
              : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button
            onClick={() => { setMode(m => m === 'password' ? 'magic' : 'password'); setError(''); }}
            className="text-sm text-primary hover:underline"
          >
            {mode === 'password' ? 'Sign in with magic link instead' : 'Sign in with password instead'}
          </button>
        </div>
      </div>
    </div>
  );
}
