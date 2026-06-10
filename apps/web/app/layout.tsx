import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bella AI — Hotel do Bosque',
  description: 'Plataforma omnichannel de atendimento, reservas e CRM inteligente para hotelaria',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
