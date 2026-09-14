'use client';

import React, { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Logo } from '@/components/logo';
import { Mail, ArrowRight, ArrowLeft, Loader2, ShieldCheck, CheckCircle2, Lock, User as UserIcon, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Step = 'intro' | 'email' | 'otp' | 'register' | 'login' | 'forgot' | 'forgot-otp' | 'reset-password';

export function AuthScreen() {
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('intro');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // All auth calls are bounded: fail fast with a retry message instead of an eternal spinner.
  const AUTH_TIMEOUT_MS = 55000;
  async function authFetch(path: string, body: unknown): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AUTH_TIMEOUT_MS);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      return await res.json().catch(() => ({}));
    } catch {
      throw new Error('Request timed out — the server is slow, please retry.');
    } finally {
      clearTimeout(timer);
    }
  }

  const handleSendOtp = useCallback(async (purpose: 'registration' | 'password_reset') => {
    if (!email || !email.includes('@')) {
      toast({ title: 'Invalid email', description: 'Please enter a valid email address', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = await authFetch('/api/auth/otp/send', { email, purpose });
      if (data.ok) {
        setStep(purpose === 'password_reset' ? 'forgot-otp' : 'otp');
        toast({ title: 'Code sent', description: 'Check your email for the 6-digit code' });
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, toast]);

  const handleVerifyOtp = useCallback(async (purpose: 'registration' | 'password_reset') => {
    if (!otp || otp.length < 6) {
      toast({ title: 'Invalid code', description: 'Enter the 6-digit code', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = await authFetch('/api/auth/otp/verify', { email, code: otp, purpose });
      if (data.ok) {
        if (purpose === 'password_reset') {
          setStep('reset-password');
          toast({ title: 'Verified!', description: 'Enter your new password' });
        } else {
          if (!displayName) setDisplayName(email.split('@')[0]);
          setStep('register');
          toast({ title: 'Email verified!', description: 'Complete your registration' });
        }
      } else {
        toast({ title: 'Verification failed', description: data.error, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Verification failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, otp, displayName, toast]);

  const handleRegister = useCallback(async () => {
    if (!username || !displayName || !password) {
      toast({ title: 'Missing fields', description: 'All fields are required', variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: 'Weak password', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = await authFetch('/api/auth/register', { email, username, displayName, password });
      if (data.ok) {
        await refresh();
        toast({ title: 'Welcome!', description: 'Account created successfully' });
      } else {
        toast({ title: 'Registration failed', description: data.error, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Registration failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, username, displayName, password, refresh, toast]);

  const handleLogin = useCallback(async () => {
    if (!email || !loginPassword) {
      toast({ title: 'Missing fields', description: 'Email and password required', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = await authFetch('/api/auth/login', { email, password: loginPassword });
      if (data.ok) {
        await refresh();
        toast({ title: 'Welcome back!', description: 'Logged in successfully' });
      } else {
        toast({ title: 'Login failed', description: data.error, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Login failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, loginPassword, refresh, toast]);

  const handleResetPassword = useCallback(async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: 'Weak password', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Mismatch', description: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const data = await authFetch('/api/auth/reset-password', { email, password: newPassword });
      if (data.ok) {
        await refresh();
        toast({ title: 'Password reset!', description: 'You are now logged in' });
      } else {
        toast({ title: 'Reset failed', description: data.error, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Password reset failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, newPassword, confirmPassword, refresh, toast]);

  const inputCls = "w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:border-[#ef233c] focus:outline-none transition-all";
  const inputWithIconCls = "w-full pl-9 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:border-[#ef233c] focus:outline-none transition-all";
  const labelCls = "text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-500 block mb-2";
  const btnCls = "w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#ef233c] hover:bg-red-700 text-white font-bold text-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50";
  const backBtnCls = "flex items-center gap-1 text-xs text-zinc-500 hover:text-white transition-colors";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative z-10">
      {/* Red Noir background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#1a0505] to-black" />
        <div className="absolute top-0 left-0 w-[1px] h-[1px] bg-transparent stars-1 animate-stars-1" />
        <div className="absolute top-0 left-0 w-[2px] h-[2px] bg-transparent stars-2 animate-stars-2" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)',
          }}
        />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo / Brand */}
        <div className="text-center mb-10 animate-fade-up">
          <div className="inline-flex items-center gap-2 mb-6">
            <Logo size={40} />
            <span className="font-manrope font-bold text-2xl text-white">
              RGE <span className="text-[#ef233c]">Hub</span>
            </span>
          </div>
          <p className="text-sm text-zinc-400 font-inter">
            The editing-focused community & resource platform for Indian railway editors.
          </p>
        </div>

        {/* Card */}
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 animate-fade-up stagger-1">
          {step === 'intro' && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="text-3xl font-manrope font-semibold text-white mb-2">Welcome</h1>
                <p className="text-sm text-zinc-400 font-inter">Sign in to your account or create a new one.</p>
              </div>
              <button onClick={() => setStep('login')} className={btnCls}>
                <Lock className="w-4 h-4" /> Sign in with password
              </button>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[10px] font-manrope uppercase tracking-[0.2em] text-zinc-600">or</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>
              <button onClick={() => setStep('email')} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-white/5 border border-white/10 text-zinc-300 font-bold text-sm hover:bg-white/10 hover:text-white transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]">
                <Mail className="w-4 h-4" /> Create new account
              </button>
              <div className="flex items-center justify-center gap-1.5 pt-2 text-[10px] text-zinc-600">
                <ShieldCheck className="w-3 h-3" />
                <span>Secure email OTP verification via OnyxBase</span>
              </div>
            </div>
          )}

          {step === 'login' && (
            <div className="space-y-5">
              <button onClick={() => setStep('intro')} className={backBtnCls}><ArrowLeft className="w-3 h-3" /> Back</button>
              <div>
                <h2 className="text-2xl font-manrope font-semibold text-white mb-1">Sign in</h2>
                <p className="text-xs text-zinc-500 font-inter">Enter your email and password</p>
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }} className={inputCls} />
              </div>
              <button onClick={handleLogin} disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Lock className="w-4 h-4" /> Sign In</>}
              </button>
              <button onClick={() => setStep('forgot')} className="w-full text-center text-[11px] text-[#ef233c] hover:text-red-400 transition-colors">
                Forgot password? Request new password
              </button>
            </div>
          )}

          {step === 'email' && (
            <div className="space-y-5">
              <button onClick={() => setStep('intro')} className={backBtnCls}><ArrowLeft className="w-3 h-3" /> Back</button>
              <div>
                <h2 className="text-2xl font-manrope font-semibold text-white mb-1">Verify email</h2>
                <p className="text-xs text-zinc-500 font-inter">We'll send a 6-digit code to verify it's you</p>
              </div>
              <div>
                <label className={labelCls}>Email Address</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp('registration'); }} className={inputCls} />
              </div>
              <button onClick={() => handleSendOtp('registration')} disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Mail className="w-4 h-4" /> Send Code</>}
              </button>
            </div>
          )}

          {step === 'otp' && (
            <div className="space-y-5">
              <button onClick={() => setStep('email')} className={backBtnCls}><ArrowLeft className="w-3 h-3" /> Back</button>
              <div>
                <h2 className="text-2xl font-manrope font-semibold text-white mb-1">Enter code</h2>
                <p className="text-xs text-zinc-500 font-inter">Sent to <span className="text-zinc-300">{email}</span></p>
              </div>
              <div>
                <label className={labelCls}>Verification Code</label>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="000000" onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp('registration'); }} className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-2xl text-center text-white font-manrope tracking-[0.5em] placeholder:text-zinc-700 focus:border-[#ef233c] focus:outline-none transition-all" />
              </div>
              <button onClick={() => handleVerifyOtp('registration')} disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> Verify</>}
              </button>
              <button onClick={() => handleSendOtp('registration')} className="w-full text-center text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Didn't receive it? Resend code</button>
            </div>
          )}

          {step === 'register' && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /><span>{email} verified</span>
              </div>
              <div>
                <h2 className="text-2xl font-manrope font-semibold text-white mb-1">Create account</h2>
                <p className="text-xs text-zinc-500 font-inter">Complete your profile to finish registration</p>
              </div>
              <div>
                <label className={labelCls}>Username</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="railfan123" className={inputWithIconCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Display Name</label>
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Rail Fan" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }} className={inputWithIconCls} />
                </div>
                <p className="text-[10px] text-zinc-600 mt-1.5">Your password is stored securely by OnyxBase</p>
              </div>
              <button onClick={handleRegister} disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create Account <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          )}

          {step === 'forgot' && (
            <div className="space-y-5">
              <button onClick={() => setStep('login')} className={backBtnCls}><ArrowLeft className="w-3 h-3" /> Back to login</button>
              <div>
                <h2 className="text-2xl font-manrope font-semibold text-white mb-1">Reset password</h2>
                <p className="text-xs text-zinc-500 font-inter">Enter your account email — we'll send a verification code</p>
              </div>
              <div>
                <label className={labelCls}>Email Address</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp('password_reset'); }} className={inputCls} />
              </div>
              <button onClick={() => handleSendOtp('password_reset')} disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><KeyRound className="w-4 h-4" /> Send Reset Code</>}
              </button>
              <p className="text-[10px] text-zinc-600 text-center">If an account exists for this email, a reset code will be sent.</p>
            </div>
          )}

          {step === 'forgot-otp' && (
            <div className="space-y-5">
              <button onClick={() => setStep('forgot')} className={backBtnCls}><ArrowLeft className="w-3 h-3" /> Back</button>
              <div>
                <h2 className="text-2xl font-manrope font-semibold text-white mb-1">Enter reset code</h2>
                <p className="text-xs text-zinc-500 font-inter">Sent to <span className="text-zinc-300">{email}</span></p>
              </div>
              <div>
                <label className={labelCls}>Reset Code</label>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="000000" onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp('password_reset'); }} className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-2xl text-center text-white font-manrope tracking-[0.5em] placeholder:text-zinc-700 focus:border-[#ef233c] focus:outline-none transition-all" />
              </div>
              <button onClick={() => handleVerifyOtp('password_reset')} disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> Verify Code</>}
              </button>
              <button onClick={() => handleSendOtp('password_reset')} className="w-full text-center text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Didn't receive it? Resend code</button>
            </div>
          )}

          {step === 'reset-password' && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /><span>Code verified — set your new password</span>
              </div>
              <div>
                <h2 className="text-2xl font-manrope font-semibold text-white mb-1">New password</h2>
                <p className="text-xs text-zinc-500 font-inter">Choose a new password for your account</p>
              </div>
              <div>
                <label className={labelCls}>New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" className={inputWithIconCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" onKeyDown={(e) => { if (e.key === 'Enter') handleResetPassword(); }} className={inputWithIconCls} />
                </div>
              </div>
              <button onClick={handleResetPassword} disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><KeyRound className="w-4 h-4" /> Reset Password</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
