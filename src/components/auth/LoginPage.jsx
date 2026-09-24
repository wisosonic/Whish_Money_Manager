import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { APP_NAME, APP_TAGLINE } from '@/lib/branding';
import AppLogo from '@/components/layout/AppLogo';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-6" dir="rtl">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-3xl bg-white/10 backdrop-blur p-8 shadow-2xl border border-white/10">
        <div className="flex flex-col items-center text-center mb-6">
          <AppLogo className="w-20 h-20 shadow-lg mb-3" />
          <p className="text-2xl font-bold" dir="ltr">{APP_NAME}</p>
          <p className="text-slate-400 text-sm">{APP_TAGLINE}</p>
        </div>
        <h1 className="text-3xl font-bold mb-2">تسجيل الدخول</h1>
        <p className="text-slate-300 mb-6">أدخل بريدك الإلكتروني وكلمة المرور. تبقى مسجلاً حتى تضغط "خروج".</p>

        <label htmlFor="login-email" className="block text-sm text-slate-300 mb-2">البريد الإلكتروني</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl bg-white/10 border border-white/10 px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-sky-400"
          placeholder="name@example.com"
        />

        <label htmlFor="login-password" className="block text-sm text-slate-300 mb-2">كلمة المرور</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl bg-white/10 border border-white/10 px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-sky-400"
        />

        {error && <p className="text-sm text-red-300 mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-slate-950 font-bold py-3 transition"
        >
          {loading ? 'جاري الدخول...' : 'دخول'}
        </button>
      </form>
    </div>
  );
}
