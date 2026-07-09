'use client';

import { logout } from '../lib/api';

export default function LogoutButton() {
  return (
    <button className="theme-toggle" onClick={logout} title="Encerrar sessão">
      🚪 Sair
    </button>
  );
}
