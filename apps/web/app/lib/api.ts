'use client';

/**
 * fetch autenticado do painel: anexa o JWT salvo no login e, se a sessão
 * expirar (401), redireciona para a tela de login.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('bella_token') : null;
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('bella_token');
    window.location.href = '/login';
  }
  return res;
}

export function logout() {
  localStorage.removeItem('bella_token');
  window.location.href = '/login';
}
