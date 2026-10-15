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
];

export function ehMensagemAutomatica(texto: string): boolean {
  const t = texto || '';
  if (!t.trim()) return true; // sem texto nao diz nada sobre correcao
  return MARCAS_DE_AUTOMATICA.some((r) => r.test(t));
}
