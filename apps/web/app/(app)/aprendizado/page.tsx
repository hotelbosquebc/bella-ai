'use client';

import { useCallback, useEffect, useState } from 'react';
import { HOTEL_ID } from '../../lib/config';
import { apiFetch } from '../../lib/api';

type Licao = {
  id: string;
  texto: string;
  tema: string | null;
  exemplos: number;
  status: string;
  createdAt: string;
};

/** Relatorio da auditoria diaria (pedido do dono, 26/10/2026). */
type Auditoria = {
  existe: boolean;
  quando?: string;
  resumo?: string;
  respostasConferidas?: number;
  graves?: number;
  porTipo?: Record<string, { gravidade: string; quantas: number; exemplos: { origem: string; trecho: string }[] }>;
  alucinacoes?: { trecho: string; afirmacao: string; motivo: string }[];
  conferenciaComABase?: string;
  decisoes?: { total: number; naoLidos: { motivo: string; n: number }[] };
  acoesSugeridas?: string[];
};

function QuadroAuditoria() {
  const [a, setA] = useState<Auditoria | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auditoria/ultima', { cache: 'no-store' });
      setA(res.ok ? await res.json() : { existe: false });
    } catch {
      setA({ existe: false });
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function rodarAgora() {
    setRodando(true);
    try {
      await apiFetch('/api/auditoria/rodar', { method: 'POST' });
      await carregar();
    } finally {
      setRodando(false);
    }
  }

  const tipos = Object.entries(a?.porTipo ?? {}).sort((x, y) => (x[1].gravidade === y[1].gravidade ? y[1].quantas - x[1].quantas : x[1].gravidade === 'grave' ? -1 : 1));

  return (
    <div className="form-card" style={a?.graves ? { borderLeft: '5px solid #dc2626' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ flex: 1 }}>Auditoria diária das respostas</strong>
        <button disabled={rodando} onClick={rodarAgora}>
          {rodando ? 'Conferindo… (pode levar 1 minuto)' : 'Conferir agora'}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
        Todo dia às 9h30 a Bella confere tudo o que escreveu nas últimas 24 horas: preço, promessas que ela não
        cumpre, rascunho vazado, links de fora, e afirmações que a base de conhecimento não sustenta. Ela só aponta —
        nada muda sozinho.
      </p>
      {!a && <p className="muted">Carregando…</p>}
      {a && !a.existe && <p className="muted">Ainda não rodou. Clique em “Conferir agora”.</p>}
      {a?.existe && (
        <>
          <p style={{ marginTop: 8 }}>
            <strong style={{ color: a.graves ? '#dc2626' : '#15803d' }}>
              {a.graves ? `⚠️ ${a.graves} problema(s) grave(s)` : '✅ Nada grave'}
            </strong>{' '}
            <span className="muted">
              em {a.respostasConferidas} respostas · {a.quando ? new Date(a.quando).toLocaleString('pt-BR') : ''}
            </span>
          </p>
          {(a.acoesSugeridas ?? []).map((t, i) => (
            <p key={i} style={{ fontSize: 14, margin: '4px 0' }}>👉 {t}</p>
          ))}
          {tipos.map(([tipo, g]) => (
            <div key={tipo} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
              <strong style={{ fontSize: 14, color: g.gravidade === 'grave' ? '#dc2626' : undefined }}>
                {g.gravidade === 'grave' ? '🔴' : '🟡'} {tipo}: {g.quantas}
              </strong>
              {g.exemplos.map((e, i) => (
                <div key={i} className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  ({e.origem}) “{e.trecho}”
                </div>
              ))}
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
            <strong style={{ fontSize: 14 }}>
              Afirmações que a base não sustenta: {(a.alucinacoes ?? []).length}
            </strong>
            <span className="muted" style={{ fontSize: 12 }}> · conferência com a base: {a.conferenciaComABase}</span>
            {(a.alucinacoes ?? []).map((h, i) => (
              <div key={i} style={{ fontSize: 13, marginTop: 4 }}>
                🔴 “{h.afirmacao}” — <span className="muted">{h.motivo}</span>
              </div>
            ))}
          </div>
          {(a.decisoes?.naoLidos ?? []).length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
              <strong style={{ fontSize: 14 }}>Pedidos que ela não conseguiu ler</strong>
              {(a.decisoes?.naoLidos ?? []).map((m, i) => (
                <div key={i} className="muted" style={{ fontSize: 13 }}>
                  {m.n}x — {m.motivo}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AprendizadoPage() {
  const [licoes, setLicoes] = useState<Licao[] | null>(null);
  const [mexendo, setMexendo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/assist/licoes?hotelId=${HOTEL_ID}`, { cache: 'no-store' });
      setLicoes(res.ok ? await res.json() : []);
    } catch {
      setLicoes([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decidir(id: string, status: string) {
    setMexendo(id);
    try {
      await apiFetch(`/api/assist/licoes/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await load();
    } finally {
      setMexendo(null);
    }
  }

  const pendentes = (licoes ?? []).filter((l) => l.status === 'pendente');
  const aprovadas = (licoes ?? []).filter((l) => l.status === 'aprovada');
  const recusadas = (licoes ?? []).filter((l) => l.status === 'recusada');

  function Cartao({ l, acoes }: { l: Licao; acoes: 'pendente' | 'aprovada' | 'recusada' }) {
    return (
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: 14 }}>{l.texto}</span>
          {l.exemplos > 1 && (
            <span className="muted" style={{ fontSize: 12 }}>visto {l.exemplos}x</span>
          )}
          {acoes !== 'aprovada' && (
            <button disabled={mexendo === l.id} onClick={() => decidir(l.id, 'aprovada')}>
              Aprovar
            </button>
          )}
          {acoes !== 'recusada' && (
            <button disabled={mexendo === l.id} onClick={() => decidir(l.id, 'recusada')}>
              {acoes === 'aprovada' ? 'Desligar' : 'Recusar'}
            </button>
          )}
        </div>
        {l.tema && <span className="muted" style={{ fontSize: 12 }}>{l.tema}</span>}
      </div>
    );
  }

  return (
    <>
      <h1>Aprendizado</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Todo dia a Bella compara o que ela sugeriu com o que a recepção realmente enviou. Onde o
        texto mudou de conteúdo, ela propõe uma regra. <strong>Nada entra no atendimento sem você
        aprovar aqui</strong> — e regras com valores ou que sugiram fechar reserva são barradas
        antes mesmo de chegar nesta tela.
      </p>

      <QuadroAuditoria />

      {!licoes && <p className="muted">Carregando…</p>}

      {licoes && (
        <>
          <div className="form-card">
            <strong>Esperando você decidir ({pendentes.length})</strong>
            {pendentes.length === 0 && (
              <p className="muted" style={{ marginTop: 8 }}>
                Nada pendente. Conforme a Bella for usada e corrigida, as lições aparecem aqui.
              </p>
            )}
            {pendentes.map((l) => <Cartao key={l.id} l={l} acoes="pendente" />)}
          </div>

          <div className="form-card">
            <strong>Valendo no atendimento ({aprovadas.length})</strong>
            {aprovadas.length === 0 && (
              <p className="muted" style={{ marginTop: 8 }}>Nenhuma regra aprovada ainda.</p>
            )}
            {aprovadas.map((l) => <Cartao key={l.id} l={l} acoes="aprovada" />)}
          </div>

          {recusadas.length > 0 && (
            <div className="form-card">
              <strong>Recusadas ({recusadas.length})</strong>
              <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                Ficam guardadas e inertes. Se mudar de ideia, dá para aprovar depois.
              </p>
              {recusadas.map((l) => <Cartao key={l.id} l={l} acoes="recusada" />)}
            </div>
          )}
        </>
      )}
    </>
  );
}
