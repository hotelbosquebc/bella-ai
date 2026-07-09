'use client';

import { useEffect, useState } from 'react';
import { HOTEL_ID } from '../../lib/config';
import { apiFetch } from '../../lib/api';

type Settings = {
  assistantName: string;
  personality: string;
  language: string;
  temperature: number;
  masterPrompt?: string | null;
  salesPrompt?: string | null;
  cancelPrompt?: string | null;
};

export default function BellaConfigPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
