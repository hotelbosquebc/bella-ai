'use client';

import { useEffect, useState } from 'react';
import { HOTEL_ID } from '../../lib/config';
import { apiFetch } from '../../lib/api';

type Anexo = {
  id: string;
  title: string;
  mimeType: string;
  keywords: string;
  active: boolean;
};

/** 25 MB é o limite do servidor; em base64 o arquivo cresce ~33%. */
const LIMITE_MB = 18;

export default function AnexosPage() {
  const [lista, setLista] = useState<Anexo[]>([]);
  const [titulo, setTitulo] = useState('');
  const [palavras, setPalavras] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    const res = await apiFetch(`/api/attachments?hotelId=${HOTEL_ID}`, { cache: 'no-store' });
    if (res.ok) setLista(await res.json());
  }

  useEffect(() => {
    carregar();
  }, []);

  async function enviar() {
    setErro('');
    if (!arquivo || !titulo.trim() || !palavras.trim()) {
      setErro('Preencha o título, as palavras-chave e escolha o arquivo.');
      return;
    }
    if (arquivo.size > LIMITE_MB * 1024 * 1024) {
      setErro(`Arquivo muito grande (${(arquivo.size / 1024 / 1024).toFixed(1)} MB). O limite é ${LIMITE_MB} MB.`);
      return;
    }
    setEnviando(true);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = () => reject(new Error('Falha ao ler o arquivo'));
        fr.readAsDataURL(arquivo);
      });
      const res = await apiFetch('/api/attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: HOTEL_ID,
          title: titulo.trim(),
          mimeType: arquivo.type || 'application/octet-stream',
          data: base64,
          keywords: palavras,
        }),
      });
      if (!res.ok) {
        setErro('O servidor recusou o envio. Tente um arquivo menor.');
        return;
      }
      setTitulo('');
      setPalavras('');
      setArquivo(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enviar.');
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(a: Anexo) {
    if (!confirm(`Excluir "${a.title}"? A Bella deixa de enviar este arquivo.`)) return;
    await apiFetch(`/api/attachments/${a.id}`, { method: 'DELETE' });
    carregar();
  }

  return (
    <>
      <h1>Anexos da Bella</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Arquivos que a Bella anexa à sugestão quando o hóspede toca no assunto — por exemplo, a folha de regras dos
        pets. O envio continua manual: a Bella deixa pronto, o atendente confere e envia.
      </p>

      <div className="form-card">
        <strong>Adicionar arquivo</strong>
        <div className="form-row" style={{ marginTop: 12 }}>
          <div className="form-field">
            <label>Título (o hóspede não vê)</label>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Regras para Pets" />
          </div>
          <div className="form-field">
            <label>Palavras que disparam o anexo</label>
            <input
              value={palavras}
              onChange={(e) => setPalavras(e.target.value)}
              placeholder="pet, cachorro, gato, animal"
            />
          </div>
        </div>
        <div className="form-field">
          <label>Arquivo (imagem ou PDF, até {LIMITE_MB} MB)</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            Separe as palavras por vírgula. Se o hóspede escrever qualquer uma delas, a Bella anexa este arquivo.
          </span>
        </div>
        {erro && (
          <p style={{ color: '#c0392b', fontSize: 13, margin: '8px 0 0' }}>{erro}</p>
        )}
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="btn" onClick={enviar} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Adicionar anexo'}
          </button>
        </div>
      </div>

      <div className="form-card">
        <strong>Arquivos cadastrados ({lista.length})</strong>
        {!lista.length && (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Nenhum arquivo ainda.
          </p>
        )}
        {lista.map((a) => (
          <div
            key={a.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid #eee',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {a.mimeType.includes('pdf') ? '📄' : '🖼️'} {a.title}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                dispara com: {a.keywords}
              </div>
            </div>
            <a
              className="btn"
              href={`/api/attachments/${a.id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              Ver
            </a>
            <button className="btn" onClick={() => excluir(a)}>
              Excluir
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
