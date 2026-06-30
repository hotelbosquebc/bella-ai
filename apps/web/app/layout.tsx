import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bella AI — Hotel do Bosque',
  description: 'Plataforma omnichannel de atendimento, reservas e CRM inteligente para hotelaria',
};

// Aplica o tema salvo antes da pintura, evitando flash de tema errado.
const themeScript = `(function(){try{var t=localStorage.getItem('bella_theme');if(t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
