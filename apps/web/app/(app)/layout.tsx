import Link from 'next/link';
import ThemeToggle from '../components/ThemeToggle';
import LogoutButton from '../components/LogoutButton';
import AuthGuard from '../components/AuthGuard';

const NAV = [
  { href: '/dashboard', label: '📊 Dashboard' },
  { href: '/inbox', label: '💬 Caixa de Entrada' },
  { href: '/crm', label: '🗂️ CRM / Pipeline' },
  { href: '/contacts', label: '👤 Contatos' },
  { href: '/quick-replies', label: '⚡ Respostas Rápidas' },
  { href: '/bella', label: '🌿 Central da Bella' },
  { href: '/knowledge', label: '📚 Conhecimento' },
  { href: '/policies', label: '📋 Políticas' },
  { href: '/audit', label: '🔍 Auditoria' },
  { href: '/analytics', label: '📈 Analytics' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="shell">
        <aside className="sidebar">
          <div className="logo">Bella AI 🌿</div>
          <nav>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </aside>
        <main className="content">{children}</main>
      </div>
    </AuthGuard>
  );
}
