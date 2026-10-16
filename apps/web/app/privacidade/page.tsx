import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidade — Hotel do Bosque',
  description:
    'Como o Hotel do Bosque trata os dados de quem conversa conosco por WhatsApp, Instagram e Facebook.',
};

// Página pública: fica fora do grupo (app), que é o que exige login.
// O revisor da Meta precisa abri-la sem nenhuma conta.

const estiloPagina: React.CSSProperties = {
  background: '#ffffff',
  color: '#1f2430',
  minHeight: '100vh',
  padding: '48px 20px 96px',
};

const estiloMiolo: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  fontFamily:
    'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  fontSize: 17,
  lineHeight: 1.7,
};

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 22, fontWeight: 600, margin: '40px 0 12px', lineHeight: 1.3 }}>
      {children}
    </h2>
  );
}

export default function Privacidade() {
  return (
    <main style={estiloPagina}>
      <article style={estiloMiolo}>
        <h1 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>
          Política de Privacidade
        </h1>
        <p style={{ color: '#5b6474', marginTop: 8 }}>
          Hotel do Bosque — Balneário Camboriú/SC
        </p>

        <div
          style={{
            background: '#f5f7fa',
            border: '1px solid #e3e8ef',
            borderRadius: 12,
            padding: '16px 20px',
            margin: '24px 0',
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          <strong>RS HOTELARIA LTDA</strong> — CNPJ 58.003.665/0001-39
          <br />
          Av. Brasil, 22 — Centro — Balneário Camboriú/SC — CEP 88.330-040
          <br />
          gerencia@hotelbosque.com.br &nbsp;|&nbsp; (47) 3367-0211
          <br />
          <span style={{ color: '#5b6474' }}>
            Última atualização: 17 de outubro de 2026
          </span>
        </div>

        <Titulo>1. Por que esta política existe</Titulo>
        <p>
          O Hotel do Bosque atende hóspedes e interessados por WhatsApp, Instagram
          Direct, Facebook Messenger e pelo nosso site. Para responder, usamos um
          assistente virtual chamado <strong>Bella</strong>, que trabalha junto com a
          nossa equipe.
        </p>
        <p>
          Esta página explica, em português claro, quais dados recebemos, o que
          fazemos com eles, com quem são compartilhados, por quanto tempo ficam
          guardados e como você pede para apagá-los. Ela segue a Lei Geral de
          Proteção de Dados (Lei nº 13.709/2018).
        </p>

        <Titulo>2. Que dados tratamos</Titulo>
        <p>
          Recebemos apenas o que você nos envia na conversa, mais o que a plataforma
          de mensagens nos entrega junto:
        </p>
        <ul>
          <li>
            <strong>O conteúdo das suas mensagens</strong> — texto, áudios, imagens e
            arquivos que você enviar.
          </li>
          <li>
            <strong>Seu identificador no canal</strong> — número de telefone no
            WhatsApp, ou o identificador da sua conta no Instagram e no Facebook.
          </li>
          <li>
            <strong>Seu nome de exibição</strong>, como aparece no aplicativo que você
            usa.
          </li>
          <li>
            <strong>Dados da sua hospedagem</strong>, quando você os informa: datas
            pretendidas, número de pessoas e idades das crianças (que usamos para
            calcular a categoria correta no sistema de reservas).
          </li>
        </ul>
        <p>
          <strong>Não pedimos e não queremos receber por mensagem:</strong> CPF, RG,
          dados de cartão, senhas ou informações de saúde. Se você enviar algum desses
          dados espontaneamente, eles serão apagados da conversa.
        </p>

        <Titulo>3. Para que usamos</Titulo>
        <ol>
          <li>
            <strong>Responder você</strong> — tirar dúvidas sobre o hotel e enviar o
            link do nosso sistema de reservas, onde você consulta valores e
            disponibilidade.
          </li>
          <li>
            <strong>Dar continuidade ao atendimento</strong> — para que, se você
            escrever de novo, não precise repetir tudo.
          </li>
          <li>
            <strong>Melhorar o atendimento</strong> — avaliamos, de forma agregada,
            onde o assistente erra, para corrigi-lo.
          </li>
        </ol>
        <p>
          <strong>
            Não usamos suas mensagens para publicidade, não vendemos seus dados e não
            os cedemos a terceiros para fins comerciais.
          </strong>
        </p>

        <Titulo>4. Inteligência artificial, dito com clareza</Titulo>
        <p>
          As respostas são geradas com apoio de inteligência artificial (modelos{' '}
          <strong>Google Gemini</strong>). Isso significa que o texto da conversa é
          enviado ao Google para processamento no momento em que preparamos a
          resposta. Áudios enviados por você podem ser transcritos pelo mesmo serviço.
        </p>
        <p>Três coisas que consideramos importantes dizer:</p>
        <ul>
          <li>
            <strong>Há sempre uma pessoa por trás.</strong> O assistente não fecha
            reservas, não processa pagamentos e não decide cancelamentos. Esses
            assuntos vão para a nossa equipe.
          </li>
          <li>
            <strong>Você pode falar com uma pessoa a qualquer momento</strong> — basta
            pedir, e o atendimento é transferido.
          </li>
          <li>
            <strong>O assistente não informa valores.</strong> Preço e disponibilidade
            você consulta no nosso sistema de reservas, pelo link que enviamos.
          </li>
        </ul>

        <Titulo>5. Com quem compartilhamos</Titulo>
        <p>Somente com quem é necessário para o atendimento funcionar:</p>
        <ul>
          <li>
            <strong>Meta</strong> (WhatsApp, Instagram, Facebook) — entregar e receber
            as mensagens.
          </li>
          <li>
            <strong>Google</strong> (Gemini) — gerar a resposta e transcrever áudios.
          </li>
          <li>
            <strong>Render</strong> e <strong>Supabase</strong> — hospedar o sistema e
            o banco de dados.
          </li>
          <li>
            <strong>Silbeck</strong> — sistema de reservas, quando você conclui uma
            reserva.
          </li>
        </ul>
        <p>
          Cada um desses tem política própria de privacidade e trata os dados sob
          contrato conosco. Também compartilhamos quando a lei exigir ou para exercer
          direitos em processo.
        </p>

        <Titulo>6. Por quanto tempo guardamos</Titulo>
        <ul>
          <li>
            <strong>Conversas:</strong> até 24 meses após o último contato.
          </li>
          <li>
            <strong>Dados de hospedagem efetivada:</strong> pelo prazo que a
            legislação fiscal e hoteleira exige.
          </li>
          <li>
            <strong>Registros usados para melhorar o atendimento:</strong> de forma
            agregada, sem identificar você.
          </li>
        </ul>
        <p>Passados esses prazos, os dados são apagados ou anonimizados.</p>

        <Titulo>7. Seus direitos</Titulo>
        <p>Você pode, a qualquer momento e sem custo:</p>
        <ul>
          <li>saber quais dados temos sobre você;</li>
          <li>corrigir dados errados ou incompletos;</li>
          <li>pedir a exclusão dos seus dados;</li>
          <li>revogar o consentimento e pedir que paremos de usá-los;</li>
          <li>levar seus dados para outro fornecedor;</li>
          <li>saber com quem compartilhamos.</li>
        </ul>
        <p>
          <strong>Como pedir:</strong> escreva para{' '}
          <a href="mailto:gerencia@hotelbosque.com.br?subject=LGPD">
            gerencia@hotelbosque.com.br
          </a>{' '}
          com o assunto &quot;LGPD&quot;. Respondemos em até 15 dias. Se precisar,
          também atendemos pelo telefone (47) 3367-0211, 24 horas.
        </p>

        <Titulo>8. Segurança</Titulo>
        <p>
          O acesso ao sistema é restrito à equipe do hotel, protegido por senha
          individual. As conexões são criptografadas e o banco de dados fica em
          ambiente com acesso controlado. Nenhum sistema é infalível: se houver
          incidente que possa trazer risco a você, comunicaremos você e a ANPD, como a
          lei determina.
        </p>

        <Titulo>9. Crianças e adolescentes</Titulo>
        <p>
          Não direcionamos o atendimento a menores de 18 anos. Quando uma reserva
          envolve crianças, tratamos apenas a idade — necessária para a acomodação e a
          tarifa correta —, informada pelo adulto responsável.
        </p>

        <Titulo>10. Mudanças nesta política</Titulo>
        <p>
          Se mudarmos algo relevante, atualizaremos a data no topo desta página.
          Recomendamos consultá-la de tempos em tempos.
        </p>

        <hr style={{ border: 0, borderTop: '1px solid #e3e8ef', margin: '40px 0 20px' }} />
        <p style={{ color: '#5b6474', fontSize: 15 }}>
          Dúvidas sobre esta política:{' '}
          <a href="mailto:gerencia@hotelbosque.com.br">gerencia@hotelbosque.com.br</a>
        </p>
      </article>
    </main>
  );
}
