'use client';

import { useEffect, useState } from 'react';
import { HOTEL_ID } from '../../lib/config';
import { apiFetch } from '../../lib/api';

type Mode = 'on' | 'auto' | 'off';

type Settings = {
  mode: Mode;
  assistantName: string;
  personality: string;
  language: string;
  temperature: number;
  masterPrompt?: string | null;
  salesPrompt?: string | null;
  cancelPrompt?: string | null;
};

type Inscricao = { app: string; nome: string; campos: string[] };
type DiagMeta = {
  tokenDaPagina?: { valido: boolean; nome?: string; erro?: string };
  inscricoes?: Inscricao[] | { erro: string };
  instagram?: { username?: string } | { erro: string } | null;
  erro?: string;
};

/**
 * Instagram e Facebook recebendo mensagens?
 *
 * Em 21/10/2026 a Pagina estava inscrita no app so no campo "name": a Meta
 * nao entregava mensagem nenhuma, e o hospede via so a resposta automatica do
 * Business Suite. Aqui o dono ve se esta tudo certo e, se nao estiver, religa
 * com um clique.
 */
function CanaisDaMeta() {
  const [diag, setDiag] = useState<DiagMeta | null>(null);
  const [religando, setReligando] = useState(false);
  const [aviso, setAviso] = useState('');

  async function carregar() {
    try {
      const r = await apiFetch('/api/channels/diagnostico-meta', { cache: 'no-store' });
      setDiag(r.ok ? await r.json() : { erro: 'não foi possível consultar a Meta' });
    } catch {
      setDiag({ erro: 'não foi possível consultar a Meta' });
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const inscricoes = Array.isArray(diag?.inscricoes) ? diag!.inscricoes : [];
  const recebeMensagens = inscricoes.some((i) => (i.campos || []).includes('messages'));

  async function religar() {
    setReligando(true);
    setAviso('');
    try {
      const r = await apiFetch('/api/channels/religar-pagina', { method: 'POST' });
      const j = r.ok ? await r.json() : { ok: false, erro: 'o servidor recusou o pedido' };
      setAviso(j.ok ? 'Pronto! A Meta voltou a entregar as mensagens para a Bella.' : `Não deu certo: ${j.erro ?? 'erro desconhecido'}`);
      await carregar();
    } finally {
      setReligando(false);
    }
  }

  return (
    <div className="form-card">
      <strong>Instagram e Facebook</strong>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
        Para a Bella responder, a Meta precisa entregar as mensagens da Página para ela.
      </p>
      {!diag && <p className="muted">Consultando a Meta…</p>}
      {diag?.erro && <p className="muted">⚠️ {diag.erro}</p>}
      {diag && !diag.erro && (
        <>
          <p style={{ margin: '0 0 12px' }}>
            {recebeMensagens
              ? '🟢 Recebendo mensagens do Instagram e do Facebook.'
              : '🔴 A Meta NÃO está entregando as mensagens para a Bella. O hóspede recebe só a resposta automática.'}
          </p>
          {!recebeMensagens && (
            <button className="btn" onClick={religar} disabled={religando}>
              {religando ? 'Religando…' : 'Religar Instagram e Facebook'}
            </button>
          )}
        </>
      )}
      {aviso && <p style={{ marginTop: 10 }}>{aviso}</p>}
    </div>
  );
}

export default function BellaConfigPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingMode, setSavingMode] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/settings?hotelId=${HOTEL_ID}`, { cache: 'no-store' });
        if (res.ok) setS(await res.json());
      } catch {
        setS(null);
      }
    })();
  }, []);

  async function save() {
    if (!s) return;
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch(`/api/settings/${HOTEL_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Liga/desliga vale na hora: salva sozinho, sem depender do botão "Salvar".
   * Se o hóspede está esperando, o dono não pode ficar procurando onde confirmar.
   */
  async function setMode(mode: Mode) {
    setS((prev) => (prev ? { ...prev, mode } : prev));
    setSavingMode(true);
    try {
      await apiFetch(`/api/settings/${HOTEL_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } finally {
      setSavingMode(false);
    }
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  if (!s) return (<><h1>Central da Bella</h1><p className="muted">Carregando…</p></>);

  return (
    <>
      <h1>Central da Bella</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Controle a identidade e o comportamento da Bella. As mudanças valem para todos os canais.
      </p>

      <div className="form-card">
        <strong>Bella no atendimento</strong>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
          Vale na hora, sem precisar salvar. Em qualquer modo, no WhatsApp Web quem envia é sempre o atendente —
          a Bella apenas escreve a sugestão.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            ['on', '🟢 Ligada', 'Sugere em qualquer horário'],
            ['auto', '🌙 Automática', 'Só fora do horário de reservas'],
            ['off', '🔴 Desligada', 'Não sugere nem responde'],
          ] as [Mode, string, string][]).map(([valor, rotulo, ajuda]) => (
            <button
              key={valor}
              className="btn"
              onClick={() => setMode(valor)}
              disabled={savingMode}
              title={ajuda}
              style={{
                opacity: s.mode === valor ? 1 : 0.45,
                outline: s.mode === valor ? '2px solid #14502f' : 'none',
              }}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          {s.mode === 'auto' &&
            'Fora do expediente (seg-sex, 9h-12h e 14h30-17h30) a Bella prepara a resposta sozinha. No horário, o atendimento fica com a equipe. No Instagram e no Facebook ela responde sempre.'}
          {s.mode === 'on' && 'A Bella prepara sugestões o tempo todo, inclusive durante o expediente.'}
          {s.mode === 'off' && 'A Bella está parada. O botão de sugerir some da extensão e o servidor recusa pedidos.'}
        </p>
      </div>

      <CanaisDaMeta />

      <div className="form-card">
        <strong>Identidade</strong>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-field">
            <label>Nome da assistente</label>
            <input value={s.assistantName} onChange={(e) => set('assistantName', e.target.value)} />
          </div>
          <div className="form-field">
            <label>Idioma padrão</label>
            <select value={s.language} onChange={(e) => set('language', e.target.value)}>
              <option value="pt">Português</option>
              <option value="es">Espanhol</option>
              <option value="en">Inglês</option>
            </select>
          </div>
        </div>
        <div className="form-field">
          <label>Personalidade / tom de voz</label>
          <input value={s.personality} onChange={(e) => set('personality', e.target.value)} placeholder="Ex.: acolhedora, educada e natural" />
        </div>
        <div className="form-field">
          <label>Criatividade (temperatura): {Number(s.temperature).toFixed(1)}</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={s.temperature}
            onChange={(e) => set('temperature', Number(e.target.value))}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            0 = mais objetiva e previsível · 1 = mais criativa e variada
          </span>
        </div>
      </div>

      <div className="form-card">
        <strong>Prompts (avançado)</strong>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
          Deixe em branco para usar o comportamento padrão da Bella. Preencha só se quiser personalizar as instruções.
        </p>
        <div className="form-field">
          <label>Prompt Mestre (instruções gerais)</label>
          <textarea rows={5} value={s.masterPrompt ?? ''} onChange={(e) => set('masterPrompt', e.target.value)} placeholder="Instruções gerais que a Bella sempre segue…" />
        </div>
        <div className="form-field">
          <label>Prompt Comercial (vendas)</label>
          <textarea rows={3} value={s.salesPrompt ?? ''} onChange={(e) => set('salesPrompt', e.target.value)} />
        </div>
        <div className="form-field">
          <label>Prompt de Cancelamentos</label>
          <textarea rows={3} value={s.cancelPrompt ?? ''} onChange={(e) => set('cancelPrompt', e.target.value)} />
        </div>
      </div>

      <div className="toolbar">
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar configurações'}
        </button>
        {saved && <span className="badge green">Salvo!</span>}
      </div>
    </>
  );
}
