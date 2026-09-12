'use client';

import React, { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AmbientOrbs } from '@/components/synapse';
import { Zap, Mail, ArrowRight, ArrowLeft, Loader2, ShieldCheck, Film, CheckCircle2, Lock, User as UserIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Step = 'intro' | 'email' | 'otp' | 'register' | 'login';

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
  const [loading, setLoading] = useState(false);

  const handleSendOtp = useCallback(async () => {
    if (!email || !email.includes('@')) {
      toast({ title: 'Invalid email', description: 'Please enter a valid email address', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.ok) {
        setStep('otp');
        toast({ title: 'Code sent', description: 'Check your email for the 6-digit code' });
      } else {
        toast({ title: 'Failed', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to send OTP', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, toast]);

  const handleVerifyOtp = useCallback(async () => {
    if (!otp || otp.length < 6) {
      toast({ title: 'Invalid code', description: 'Enter the 6-digit code', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp }),
      });
      const data = await res.json();
      if (data.ok) {
        // Pre-fill display name from email
        if (!displayName) setDisplayName(email.split('@')[0]);
        setStep('register');
        toast({ title: 'Email verified!', description: 'Complete your registration' });
      } else {
        toast({ title: 'Verification failed', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Verification failed', variant: 'destructive' });
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
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, displayName, password }),
      });
      const data = await res.json();
      if (data.ok) {
        await refresh();
        toast({ title: 'Welcome!', description: 'Account created successfully' });
      } else {
        toast({ title: 'Registration failed', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Registration failed', variant: 'destructive' });
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: loginPassword }),
      });
      const data = await res.json();
      if (data.ok) {
        await refresh();
        toast({ title: 'Welcome back!', description: 'Logged in successfully' });
      } else {
        toast({ title: 'Login failed', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Login failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [email, loginPassword, refresh, toast]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative z-10">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-10 animate-fade-up">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-[0_0_20px_-5px_rgba(139,92,246,0.5)]">
              <Film className="w-5 h-5 text-white" />
            </div>
            <span className="font-serif-display text-2xl text-white">RailGuyEdits</span>
          </div>
          <p className="text-sm text-neutral-400">
            The editing-focused community & resource platform for Indian railway editors.
          </p>
        </div>

        {/* Card */}
        <div className="glass rounded-3xl p-8 animate-fade-up stagger-1">
          {step === 'intro' && (
            <div className="space-y-6">
              <div className="text-center">
                <h1 className="font-serif-display text-3xl text-white mb-2">
                  Welcome
                </h1>
                <p className="text-sm text-neutral-400">
                  Sign in to your account or create a new one.
                </p>
              </div>
              <button
                onClick={() => setStep('login')}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-medium text-sm hover:from-violet-400 hover:to-cyan-400 transition-all duration-300 ease-snap shadow-[0_0_20px_-5px_rgba(139,92,246,0.4)]"
              >
                <Lock className="w-4 h-4" />
                Sign in with password
              </button>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-600">or</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>
              <button
                onClick={() => setStep('email')}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-neutral-300 font-medium text-sm hover:bg-white/[0.05] hover:text-white transition-all duration-300 ease-snap"
              >
                <Mail className="w-4 h-4" />
                Create new account
              </button>
              <div className="flex items-center justify-center gap-1.5 pt-2 text-[10px] text-neutral-600">
                <ShieldCheck className="w-3 h-3" />
                <span>Secure email OTP verification via OnyxBase</span>
              </div>
            </div>
          )}

          {step === 'login' && (
            <div className="space-y-5">
              <button onClick={() => setStep('intro')} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-white transition-colors">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              <div>
                <h2 className="font-serif-display text-2xl text-white mb-1">Sign in</h2>
                <p className="text-xs text-neutral-500">Enter your email and password</p>
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-medium text-sm hover:from-violet-400 hover:to-cyan-400 disabled:opacity-50 transition-all duration-300 ease-snap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Lock className="w-4 h-4" /> Sign In</>}
              </button>
            </div>
          )}

          {step === 'email' && (
            <div className="space-y-5">
              <button onClick={() => setStep('intro')} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-white transition-colors">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              <div>
                <h2 className="font-serif-display text-2xl text-white mb-1">Verify email</h2>
                <p className="text-xs text-neutral-500">We'll send a 6-digit code to verify it's you</p>
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp(); }}
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={handleSendOtp}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-medium text-sm hover:from-violet-400 hover:to-cyan-400 disabled:opacity-50 transition-all duration-300 ease-snap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Mail className="w-4 h-4" /> Send Code</>}
              </button>
            </div>
          )}

          {step === 'otp' && (
            <div className="space-y-5">
              <button onClick={() => setStep('email')} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-white transition-colors">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              <div>
                <h2 className="font-serif-display text-2xl text-white mb-1">Enter code</h2>
                <p className="text-xs text-neutral-500">Sent to <span className="text-neutral-300">{email}</span></p>
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleVerifyOtp(); }}
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-2xl text-center text-white font-mono-display tracking-[0.5em] placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={handleVerifyOtp}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-medium text-sm hover:from-violet-400 hover:to-cyan-400 disabled:opacity-50 transition-all duration-300 ease-snap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> Verify</>}
              </button>
              <button onClick={handleSendOtp} className="w-full text-center text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors">
                Didn't receive it? Resend code
              </button>
            </div>
          )}

          {step === 'register' && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{email} verified</span>
              </div>
              <div>
                <h2 className="font-serif-display text-2xl text-white mb-1">Create account</h2>
                <p className="text-xs text-neutral-500">Complete your profile to finish registration</p>
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Username</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="railfan123"
                    className="w-full pl-9 pr-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Rail Fan"
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
                    className="w-full pl-9 pr-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                  />
                </div>
                <p className="text-[10px] text-neutral-600 mt-1.5">
                  Your password is stored securely by OnyxBase — used for account recovery
                </p>
              </div>
              <button
                onClick={handleRegister}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-medium text-sm hover:from-violet-400 hover:to-cyan-400 disabled:opacity-50 transition-all duration-300 ease-snap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create Account <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
