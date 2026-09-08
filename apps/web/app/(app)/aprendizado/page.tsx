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
