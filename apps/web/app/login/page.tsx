'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError('E-mail ou senha inválidos.');
      return;
    }
    const data = await res.json();
    localStorage.setItem('bella_token', data.token);
    router.push('/dashboard');
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Bella AI 🌿</h1>
        <p>Plataforma de atendimento do Hotel do Bosque</p>
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Senha</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p style={{ color: '#b3261e' }}>{error}</p>}
        <button className="primary" type="submit">Entrar</button>
        <p style={{ marginTop: 16, textAlign: 'center' }}>
          <a href="#" style={{ color: 'var(--green)' }}>Esqueci minha senha</a>
        </p>
      </form>
    </div>
  );
}
