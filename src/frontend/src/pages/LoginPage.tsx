import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import {
  BusFront,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  ArrowLeft,
  ShieldCheck,
  Send,
} from 'lucide-react';

interface LoginPageProps {
  onForgotPassword?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = () => {
  const { login } = useAuth();
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot / Reset password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Feedback states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);

  // ── Handle Login ───────────────────────────────────────────
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  // ── Handle Request Reset Code ──────────────────────────────
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) {
      setError('Please enter your admin email address.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const resp = await authAPI.forgotPassword(forgotEmail);
      const code = resp.data?.resetCode || resp.data?.resetToken;
      if (code) {
        setResetToken(code);
        setDemoCode(code);
      }
      setSuccessMsg(resp.data?.message || '6-digit verification code sent successfully.');
      setMode('reset');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to request reset code.');
    } finally {
      setLoading(false);
    }
  };

  // ── Handle Reset Password with Code ────────────────────────
  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please verify.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const resp = await authAPI.resetPassword(resetToken.trim(), newPassword);
      setSuccessMsg(resp.data?.message || 'Password reset successfully! Please log in.');
      setEmail(forgotEmail || email);
      setPassword('');
      setResetToken('');
      setNewPassword('');
      setConfirmPassword('');
      setDemoCode(null);
      setMode('login');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid or expired verification code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #090d16 0%, #111827 50%, #0b0f19 100%)' }}
    >
      {/* Background glow aesthetics */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-32 -right-32 w-[32rem] h-[32rem] rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-32 -left-32 w-[32rem] h-[32rem] rounded-full opacity-15 blur-3xl"
          style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)' }}
        />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 shadow-lg shadow-indigo-500/20"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            <BusFront size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">OncabShuttle</h1>
          <p className="text-slate-400 text-xs mt-0.5">Fleet & Operator Management Portal</p>
        </div>

        {/* Card Container */}
        <div
          className="rounded-2xl p-7 shadow-2xl transition-all"
          style={{
            background: 'rgba(23, 31, 48, 0.85)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
          }}
        >
          {/* Status Notifications */}
          {error && (
            <div
              className="flex items-center gap-2 p-3 rounded-xl mb-4 text-xs font-medium"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
              }}
            >
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div
              className="flex items-center gap-2 p-3 rounded-xl mb-4 text-xs font-medium"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#34d399',
              }}
            >
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* ──────────────────────────────────────────────────────────
              VIEW 1: SIGN IN FORM
          ─────────────────────────────────────────────────────────── */}
          {mode === 'login' && (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white">Sign in to Admin Dashboard</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Enter your credentials to manage routes, buses, and trips.
                </p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@oncabshuttle.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl text-white placeholder-slate-500 outline-none text-sm transition-all"
                      style={{
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
                      onBlur={(e) => (e.target.style.borderColor = 'rgba(99, 102, 241, 0.25)')}
                      disabled={loading}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-300">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotEmail(email);
                        setError('');
                        setSuccessMsg('');
                        setMode('forgot');
                      }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm transition-all"
                      style={{
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        color: 'white',
                        outline: 'none',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
                      onBlur={(e) => (e.target.style.borderColor = 'rgba(99, 102, 241, 0.25)')}
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-2.5 px-4 rounded-xl font-medium text-white text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition-all"
                  style={{
                    background: loading
                      ? 'rgba(99, 102, 241, 0.6)'
                      : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Sign In to Dashboard'
                  )}
                </button>
              </form>
            </>
          )}

          {/* ──────────────────────────────────────────────────────────
              VIEW 2: FORGOT PASSWORD (REQUEST CODE)
          ─────────────────────────────────────────────────────────── */}
          {mode === 'forgot' && (
            <>
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setSuccessMsg('');
                    setMode('login');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3"
                >
                  <ArrowLeft size={14} /> Back to Sign In
                </button>
                <div className="flex items-center gap-2 text-indigo-400 mb-1">
                  <KeyRound size={20} />
                  <h2 className="text-lg font-semibold text-white">Reset Admin Password</h2>
                </div>
                <p className="text-xs text-slate-400">
                  Enter your registered admin email address. We will generate a 6-digit verification code.
                </p>
              </div>

              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Admin Email Address
                  </label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="admin@oncabshuttle.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl text-white placeholder-slate-500 outline-none text-sm transition-all"
                      style={{
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
                      onBlur={(e) => (e.target.style.borderColor = 'rgba(99, 102, 241, 0.25)')}
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-xl font-medium text-white text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition-all"
                  style={{
                    background: loading
                      ? 'rgba(99, 102, 241, 0.6)'
                      : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Generating Code...
                    </>
                  ) : (
                    <>
                      <Send size={15} />
                      Send Verification Code
                    </>
                  )}
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError('');
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                  >
                    Already have a 6-digit code? Reset now
                  </button>
                </div>
              </form>
            </>
          )}

          {/* ──────────────────────────────────────────────────────────
              VIEW 3: ENTER CODE & SET NEW PASSWORD
          ─────────────────────────────────────────────────────────── */}
          {mode === 'reset' && (
            <>
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setSuccessMsg('');
                    setMode('forgot');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mb-3"
                >
                  <ArrowLeft size={14} /> Back to Email Step
                </button>
                <div className="flex items-center gap-2 text-emerald-400 mb-1">
                  <ShieldCheck size={20} />
                  <h2 className="text-lg font-semibold text-white">Create New Password</h2>
                </div>
                <p className="text-xs text-slate-400">
                  Enter the 6-digit verification code and choose a new secure password.
                </p>
              </div>

              {demoCode && (
                <div
                  className="p-3 rounded-xl mb-4 text-xs"
                  style={{
                    background: 'rgba(99, 102, 241, 0.15)',
                    border: '1px dashed rgba(99, 102, 241, 0.5)',
                  }}
                >
                  <span className="text-slate-300 block mb-1">Active Verification Code:</span>
                  <span className="font-mono text-base font-bold text-indigo-300 tracking-widest bg-slate-900/60 px-2.5 py-1 rounded-md inline-block">
                    {demoCode}
                  </span>
                </div>
              )}

              <form onSubmit={handleResetSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    6-Digit Verification Code
                  </label>
                  <input
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value.trim())}
                    placeholder="e.g. 123456"
                    maxLength={32}
                    className="w-full px-4 py-2.5 rounded-xl text-center font-mono text-lg font-semibold tracking-widest text-white placeholder-slate-500 outline-none transition-all"
                    style={{
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
                    onBlur={(e) => (e.target.style.borderColor = 'rgba(99, 102, 241, 0.3)')}
                    disabled={loading}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    New Password (min 8 characters)
                  </label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm transition-all"
                      style={{
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        color: 'white',
                        outline: 'none',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
                      onBlur={(e) => (e.target.style.borderColor = 'rgba(99, 102, 241, 0.25)')}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm transition-all"
                      style={{
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        color: 'white',
                        outline: 'none',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
                      onBlur={(e) => (e.target.style.borderColor = 'rgba(99, 102, 241, 0.25)')}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-2.5 px-4 rounded-xl font-medium text-white text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition-all"
                  style={{
                    background: loading
                      ? 'rgba(99, 102, 241, 0.6)'
                      : 'linear-gradient(135deg, #10b981, #059669)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Updating Password...
                    </>
                  ) : (
                    'Reset & Save New Password'
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          © {new Date().getFullYear()} OncabShuttle. Secure Multi-Device Session Management.
        </p>
      </div>
    </div>
  );
};
