'use client';

import React, { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { NavigationPill, AmbientOrbs, ShinyBorderButton } from '@/components/synapse';
import { Zap, Mail, ArrowRight, ArrowLeft, Loader2, ShieldCheck, Film, CheckCircle2 } from 'lucide-react';
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
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

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
        setOtpSent(true);
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
  }, [email, otp, toast]);

  const handleRegister = useCallback(async () => {
    if (!username || !displayName || !apiKey) {
      toast({ title: 'Missing fields', description: 'All fields are required', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, displayName, apiKey }),
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
  }, [email, username, displayName, apiKey, refresh, toast]);

  const handleLogin = useCallback(async () => {
    if (!apiKey) {
      toast({ title: 'Missing API key', description: 'Enter your OnyxBase API key', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
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
  }, [apiKey, refresh, toast]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative z-10">
      <NavigationPill />

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
                  Sign in with your OnyxBase API key, or create a new account.
                </p>
              </div>
              <button
                onClick={() => setStep('login')}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-medium text-sm hover:from-violet-400 hover:to-cyan-400 transition-all duration-300 ease-snap shadow-[0_0_20px_-5px_rgba(139,92,246,0.4)]"
              >
                <Zap className="w-4 h-4" />
                I have an API key
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
                <span>Powered by OnyxBase — secure email OTP verification</span>
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
                <p className="text-xs text-neutral-500">Enter your OnyxBase API key</p>
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">OnyxBase API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="kv_live_..."
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white font-mono-display placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={handleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white font-medium text-sm hover:from-violet-400 hover:to-cyan-400 disabled:opacity-50 transition-all duration-300 ease-snap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Zap className="w-4 h-4" /> Sign In</>}
              </button>
              <p className="text-[10px] text-neutral-600 text-center">
                Get your free key at <span className="text-violet-400">onyxbase-phi.vercel.app</span>
              </p>
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
              <div>
                <h2 className="font-serif-display text-2xl text-white mb-1">Create account</h2>
                <p className="text-xs text-neutral-500">Email verified ✓ — complete your profile</p>
              </div>
              <div>
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="railfan123"
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
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
                <label className="text-[10px] font-mono-display uppercase tracking-[0.2em] text-neutral-500 block mb-2">OnyxBase API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="kv_live_..."
                  className="w-full px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5 text-sm text-white font-mono-display placeholder:text-neutral-700 focus:border-violet-500/30 focus:outline-none transition-colors"
                />
                <p className="text-[10px] text-neutral-600 mt-1.5">
                  Get a free key at onyxbase-phi.vercel.app — used for file storage
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
