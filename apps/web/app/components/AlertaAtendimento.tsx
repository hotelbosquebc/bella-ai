'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';

/**
 * Alerta de "a Bella pediu ajuda", em QUALQUER tela do painel.
 *
 * Pedido do dono (21/10/2026): no Instagram e no Facebook a Bella responde
 * sozinha, e so o que ela nao souber vai para uma pessoa - e esse pedido
 * precisa TOCAR e PISCAR, para a equipe saber na hora que tem de intervir.
 * Antes o aviso era so um numero no titulo da Caixa de Entrada: com o painel
 * aberto em outra tela, ou a aba em segundo plano, ninguem via.
 *
 * Toca so quando aparece um pedido NOVO (uma conversa que nao estava na lista
 * da ultima consulta). O titulo da aba fica piscando ate a pessoa voltar para
 * a janela; a faixa fica ate nao haver mais conversa esperando.
 */
type Conversa = { id: string; escalationReason?: string | null };

const INTERVALO = 15000;

function bipe() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Tres bipes curtos: chama atencao sem ser sirene.
    [0, 0.35, 0.7].forEach((t) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      vol.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      vol.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.3);
    });
    setTimeout(() => ctx.close && ctx.close(), 1500);
  } catch {
    /* sem audio (navegador bloqueou): a faixa e o titulo continuam avisando */
  }
}

export default function AlertaAtendimento() {
  const [esperando, setEsperando] = useState<Conversa[]>([]);
  const conhecidas = useRef<Set<string> | null>(null);
  const piscaTitulo = useRef<ReturnType<typeof setInterval> | null>(null);

  function pararDePiscar() {
    if (piscaTitulo.current) {
      clearInterval(piscaTitulo.current);
      piscaTitulo.current = null;
    }
  }

  function comecarAPiscar() {
    if (piscaTitulo.current) return;
    const original = document.title.replace(/^🔔 .*? \| /, '');
    let alterna = false;
    piscaTitulo.current = setInterval(() => {
      alterna = !alterna;
      document.title = alterna ? '🔔 Bella pediu ajuda | ' + original : original;
    }, 1000);
  }

  useEffect(() => {
    let vivo = true;

    async function consultar() {
      try {
        const res = await apiFetch('/api/conversations', { cache: 'no-store' });
        if (!res.ok) return;
        const lista: Conversa[] = await res.json();
        const pedindo = lista.filter((c) => c.escalationReason);
        if (!vivo) return;
        setEsperando(pedindo);

        const ids = new Set(pedindo.map((c) => c.id));
        // Primeira consulta so aprende o que ja estava esperando: abrir o
        // painel nao deve disparar alarme por pedido antigo.
        if (conhecidas.current === null) {
          conhecidas.current = ids;
          if (ids.size) comecarAPiscar();
          return;
        }
        const novos = [...ids].filter((id) => !conhecidas.current!.has(id));
        conhecidas.current = ids;
        if (novos.length) {
          bipe();
          comecarAPiscar();
        }
        if (!ids.size) pararDePiscar();
      } catch {
        /* rede instavel: tenta de novo no proximo ciclo */
      }
    }

    consultar();
    const t = setInterval(consultar, INTERVALO);
    // Voltou para a janela: a pessoa viu. O titulo para de piscar; a faixa
    // continua enquanto houver conversa esperando.
    const aoFocar = () => pararDePiscar();
    window.addEventListener('focus', aoFocar);
    return () => {
      vivo = false;
      clearInterval(t);
      window.removeEventListener('focus', aoFocar);
      pararDePiscar();
    };
  }, []);

  if (!esperando.length) return null;

  return (
    <div className="alerta-atendimento" role="alert">
      <style>{`
        .alerta-atendimento {
          position: fixed; top: 16px; right: 16px; z-index: 1000;
          max-width: min(420px, calc(100vw - 32px));
          background: #b42318; color: #fff; border-radius: 12px;
          padding: 12px 16px; box-shadow: 0 8px 24px rgba(0,0,0,.3);
          display: flex; gap: 12px; align-items: center;
          animation: alerta-pisca 1s ease-in-out infinite;
        }
        .alerta-atendimento a {
          background: #fff; color: #b42318; font-weight: 700; border-radius: 8px;
          padding: 6px 12px; text-decoration: none; white-space: nowrap;
        }
        @keyframes alerta-pisca { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
        @media (prefers-reduced-motion: reduce) { .alerta-atendimento { animation: none; } }
      `}</style>
      <span style={{ fontSize: 22 }}>🔔</span>
      <span style={{ flex: 1 }}>
        <strong>
          {esperando.length === 1 ? '1 conversa precisa de você' : `${esperando.length} conversas precisam de você`}
        </strong>
        <br />
        <small>{esperando[0].escalationReason}</small>
      </span>
      <Link href="/inbox">Abrir</Link>
    </div>
  );
}
