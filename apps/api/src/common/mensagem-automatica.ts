/**
 * O texto enviado foi uma MENSAGEM AUTOMATICA do hotel?
 *
 * A extensao compara a sugestao da Bella com a proxima mensagem que sai da
 * conta - e nem toda mensagem que sai foi escrita pelo atendente. O WhatsApp
 * Business dispara sozinho a saudacao e a mensagem de ausencia, e o atalho
 * /dados e colado varias vezes por dia.
 *
 * Contando essas como "o que o atendente preferiu enviar", a medicao conclui
 * que a recepcao reescreveu a resposta - quando na verdade um robo falou por
 * cima. Em 60 dias isso inflou "reescreveu do zero" e "encurtou muito" ao
 * ponto de 80%, e a leitura ficou inutil.
 *
 * Reconhecemos pelos trechos fixos desses textos, que nao mudam.
 */
const MARCAS_DE_AUTOMATICA = [
  /esta é uma mensagem autom[áa]tica/i,
  /hor[áa]rio de atendimento:/i,
  /seja bem-?vindo\(a\)/i,
  /para verificarmos os valores e disponibilidade por gentileza me informe/i,
  /hotel do bosque resevas/i,
  /redes sociais:/i,
  /estamos à disposição! ?⭐/i,
  // Roteiro de reserva pelo WhatsApp e pedaco do /dados (analise de 26/10/2026:
  // 21 e 5 envios iguais contados como "a recepcao descartou a Bella").
  /solicita[çc][ãa]o de reserva realizada/i,
  /caso tenha crian[çc]as menores de 10 anos,? gentileza informar/i,
];

/**
 * Texto que saiu IGUAL varias vezes no periodo e modelo - promocao, lista de
 * transmissao, resposta rapida -, nao resposta aquela conversa.
 *
 * Analise de 26/10/2026: 72 das 196 "divergencias" da semana eram textos
 * repetidos (a promocao do cafe saiu 10 vezes, o roteiro de reserva 21). Cada
 * um contava como "a recepcao reescreveu a Bella do zero" e inflava a medicao
 * que decide quando ligar o automatico.
 */
export function chaveDeModelo(texto: string): string {
  return (texto || '').replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase();
}

export function modelosRepetidos(enviados: string[], minimo = 3): Set<string> {
  const conta = new Map<string, number>();
  for (const e of enviados) {
    const k = chaveDeModelo(e);
    if (k) conta.set(k, (conta.get(k) || 0) + 1);
  }
  return new Set([...conta].filter(([, n]) => n >= minimo).map(([k]) => k));
}

export function ehMensagemAutomatica(texto: string): boolean {
  const t = texto || '';
  if (!t.trim()) return true; // sem texto nao diz nada sobre correcao
  return MARCAS_DE_AUTOMATICA.some((r) => r.test(t));
}
