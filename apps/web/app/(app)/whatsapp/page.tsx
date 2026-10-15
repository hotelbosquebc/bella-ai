'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

/**
 * Conectar o WhatsApp do hotel — por COEXISTÊNCIA.
 *
 * O número (47) 3367-0211 continua no celular e no WhatsApp Web, e passa a
 * funcionar também pela API. Não é migração: nada sai do aplicativo.
 *
 * Esta tela abre o Cadastro Incorporado da Meta (versão 4 — as versões 2 e 3
 * ficaram obsoletas em 15/10/2026). O fluxo todo acontece na janela da Meta:
 * ela pede o número, mostra um código, o dono confirma no aplicativo e cola o
 * código. Nós só recebemos o resultado no fim.
 */

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '';
const CONFIG_ID = process.env.NEXT_PUBLIC_META_SIGNUP_CONFIG_ID || '';
const GRAPH = 'v21.0';

type Resultado = {
  wabaId?: string;
  phoneNumberId?: string;
  etapa?: string;
};

export default function WhatsAppPage() {
  const [sdkPronto, setSdkPronto] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Carrega o SDK da Meta uma vez.
  useEffect(() => {
    if (!APP_ID) return;
    window.fbAsyncInit = function () {
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: GRAPH });
      setSdkPronto(true);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, []);

  // A janela da Meta vai avisando em que etapa o cadastro está, e no fim
  // devolve a conta de mensagens e o número. Guardamos para mandar à API
  // junto do código.
  useEffect(() => {
    function aoReceber(event: MessageEvent) {
      if (!String(event.origin).endsWith('facebook.com')) return;
      try {
        const dados = JSON.parse(event.data);
        if (dados.type !== 'WA_EMBEDDED_SIGNUP') return;
        setResultado((r) => ({
          ...(r || {}),
          wabaId: dados.data?.waba_id ?? r?.wabaId,
          phoneNumberId: dados.data?.phone_number_id ?? r?.phoneNumberId,
          etapa: dados.data?.current_step ?? dados.event ?? r?.etapa,
        }));
        if (dados.event === 'CANCEL') setErro('Cadastro cancelado antes de terminar.');
      } catch {
        /* mensagem que não é JSON — a Meta manda algumas; ignorar */
      }
    }
    window.addEventListener('message', aoReceber);
    return () => window.removeEventListener('message', aoReceber);
  }, []);

  function conectar() {
    setErro('');
    setMensagem('');
    if (!window.FB) return setErro('O SDK da Meta não carregou. Recarregue a página.');
    window.FB.login(
      async (resposta: any) => {
        const codigo = resposta?.authResponse?.code;
        if (!codigo) {
          setErro('A Meta não devolveu o código. O cadastro não foi concluído.');
          return;
        }
        setEnviando(true);
        try {
          const r = await apiFetch('/api/channels/whatsapp/onboarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: codigo,
              wabaId: resultado?.wabaId,
              phoneNumberId: resultado?.phoneNumberId,
            }),
          });
          const dados = await r.json();
          if (!r.ok) throw new Error(dados?.message || 'Falha ao concluir a conexão.');
          setMensagem(dados.instrucao || 'Conexão concluída.');
        } catch (e: any) {
          setErro(e.message || 'Falha ao concluir a conexão.');
        } finally {
          setEnviando(false);
        }
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  const faltaConfigurar = !APP_ID || !CONFIG_ID;

  return (
    <>
      <h1>Conectar o WhatsApp</h1>

      <div className="panel" style={{ maxWidth: 760 }}>
        <p>
          O número do hotel continua funcionando no celular e no WhatsApp Web, exatamente como hoje — grupos,
          chamadas e etiquetas inclusive. A conexão apenas permite que a Bella atenda por ele também.
        </p>
        <p className="muted" style={{ marginTop: 12 }}>
          Durante o processo, a Meta vai pedir o número, mostrar um código e enviar uma mensagem no seu WhatsApp.
          Você toca em <strong>Conectar</strong> no aplicativo, confirma o compartilhamento do histórico e cola o
          código. Tudo acontece na janela da Meta.
        </p>

        {faltaConfigurar ? (
          <div className="badge amber" style={{ display: 'block', marginTop: 16, padding: 12, lineHeight: 1.6 }}>
            Ainda falta configurar o app na Meta. São necessárias duas variáveis no painel do site:
            <br />
            <code>NEXT_PUBLIC_META_APP_ID</code> e <code>NEXT_PUBLIC_META_SIGNUP_CONFIG_ID</code>.
          </div>
        ) : (
          <button className="btn" style={{ marginTop: 20 }} onClick={conectar} disabled={!sdkPronto || enviando}>
            {enviando ? 'Concluindo…' : sdkPronto ? 'Conectar o WhatsApp do hotel' : 'Carregando…'}
          </button>
        )}

        {resultado?.etapa && (
          <p className="muted" style={{ marginTop: 16 }}>
            Etapa atual: {resultado.etapa}
          </p>
        )}
        {mensagem && (
          <div className="badge" style={{ display: 'block', marginTop: 16, padding: 12, lineHeight: 1.6 }}>
            {mensagem}
          </div>
        )}
        {erro && (
          <div className="badge amber" style={{ display: 'block', marginTop: 16, padding: 12 }}>
            {erro}
          </div>
        )}
      </div>
    </>
  );
}
