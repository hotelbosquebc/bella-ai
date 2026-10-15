/**
 * Os dados de contato do hotel, num lugar so.
 *
 * Estavam escritos a mao em cada caminho, e divergiram: a mensagem dos canais
 * dizia que o setor atende "das 14h30 as 17h30", enquanto o atalho /dados que a
 * recepcao manda todo dia diz "das 14h as 17h30". Meia hora de diferenca indo
 * para o hospede, dependendo de por onde ele escreveu.
 *
 * Pedido do dono (15/10/2026): quando o hospede quiser falar com uma pessoa, a
 * Bella deve informar o HORARIO e o TELEFONE FIXO. Vira texto pronto, e nao
 * instrucao: o telefone ja estava na base de conhecimento e mesmo assim so
 * aparecia quando o modelo resolvia busca-lo. Mesma licao do link e do preco.
 */
export const TELEFONE_RECEPCAO = '(47) 3367-0211';
export const HORARIO_RESERVAS = 'segunda a sexta, das 9h às 12h e das 14h às 17h30 (exceto feriados)';

/** Instrucao para o modelo incluir contato na entrega ao humano. */
export function blocoDeContato(dentroDoHorario: boolean): string {
  return dentroDoHorario
    ? ` O setor de reservas está atendendo AGORA: diga que um atendente assume em instantes. ` +
      `Informe TAMBÉM, na mesma mensagem, o telefone da recepção 24h: ${TELEFONE_RECEPCAO} — ` +
      `escreva o número exatamente assim, ele não é opcional.`
    : ` O setor de reservas NÃO está atendendo agora. Diga o horário dele (${HORARIO_RESERVAS}) ` +
      `e ofereça a recepção 24h pelo telefone ${TELEFONE_RECEPCAO} — escreva o número exatamente assim, ` +
      `ele não é opcional. NÃO prometa retorno imediato nem diga que alguém vai responder em seguida.`;
}

/** Mensagem PRONTA de entrega ao humano, usada no atendimento automatico. */
export function mensagemDeEntregaAoHumano(dentroDoHorario: boolean): string {
  if (dentroDoHorario) {
    return (
      'Claro! Vou encaminhar você para um de nossos atendentes, que assume o seu atendimento em instantes. ' +
      `Se preferir falar agora, a nossa recepção atende 24 horas pelo telefone ${TELEFONE_RECEPCAO}. 🌿`
    );
  }
  return (
    `No momento o nosso setor de reservas está fora do horário de atendimento (${HORARIO_RESERVAS}). ` +
    `Para falar agora com uma pessoa, ligue para a nossa recepção no telefone ${TELEFONE_RECEPCAO} — ` +
    'temos recepcionista 24 horas por dia. ' +
    'Se preferir, deixe a sua mensagem por aqui que respondemos no próximo horário de atendimento. 🌿'
  );
}
