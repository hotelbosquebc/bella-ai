'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('bella_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('bella_theme', 'light');
    }
  }

  return (
    <button className="theme-toggle" onClick={toggle} title="Alternar modo claro/escuro">
      {dark ? '☀️ Modo claro' : '🌙 Modo escuro'}
    </button>
  );
}
