import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import XOSGateScreen from './XOSGateScreen';

// Same sign-in behavior as the original XOSAdminShell (email/password +
// Google OAuth via supabase.auth) - unchanged, just extracted into its
// own component now that the shell is routed. AuthContext has no
// onAuthStateChange listener, so checkAppState() must be called
// explicitly after a successful password sign-in or isAuthenticated
// never flips - this matches the original component's behavior exactly.
export default function XOSSignIn() {
  const { checkAppState } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState('');
  const [signingInWithEmail, setSigningInWithEmail] = useState(false);
  const [signingInWithGoogle, setSigningInWithGoogle] = useState(false);

  const signInWithGoogle = async () => {
    if (!supabase) {
      setSignInError('Sign-in is not configured for this workspace.');
      return;
    }
    setSignInError('');
    setSigningInWithGoogle(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) {
      setSignInError(error.message || 'Google sign-in failed.');
      setSigningInWithGoogle(false);
    }
  };

  const signInWithPassword = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setSignInError('Sign-in is not configured for this workspace.');
      return;
    }
    setSignInError('');
    setSigningInWithEmail(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setSignInError(error.message || 'Email sign-in failed.');
      setSigningInWithEmail(false);
      return;
    }
    await checkAppState();
    window.location.replace(`${window.location.origin}/`);
  };

  const loading = signingInWithEmail || signingInWithGoogle;

  return (
    <XOSGateScreen
      title="Sign In Required"
      message="Sign in with an account that has access to this client workspace."
      action={
        <div className="mt-6 space-y-4">
          <form onSubmit={signInWithPassword} className="space-y-3">
            <label className="block text-sm font-medium text-zinc-700">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </label>
            <label className="block text-sm font-medium text-zinc-700">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingInWithEmail ? 'Signing in…' : 'Sign in with email'}
            </button>
          </form>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200" />
            or
            <span className="h-px flex-1 bg-zinc-200" />
          </div>
          <button
            type="button"
            onClick={signInWithGoogle}
            disabled={loading}
            className="inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingInWithGoogle ? 'Opening Google…' : 'Continue with Google'}
          </button>
          {signInError && <p className="text-sm text-red-600" role="alert">{signInError}</p>}
        </div>
      }
    />
  );
}
