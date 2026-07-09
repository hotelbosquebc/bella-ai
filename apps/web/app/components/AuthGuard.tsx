'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Bloqueia o painel sem sessão: sem token salvo, redireciona ao login. */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('bella_token')) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;
  return <>{children}</>;
}
