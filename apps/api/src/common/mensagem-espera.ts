/**
 * "Estou verificando" antes da resposta de verdade, no atendimento automatico.
 *
 * Pedido do dono (22/10/2026): "o importante e responder". Com a IA gratuita
 * congestionada a resposta leva de 5 a 30 segundos, ou mais, e o silencio
 * parece abandono. A mensagem de espera chega na hora e avisa que a resposta
 * vem.
 *
 * O texto NAO promete valores nem disponibilidade: a Bella nao informa preco,
 * e a consulta de vaga nao existe nesse caminho. Diz so que esta verificando.
 *
 * Primeira mensagem do dia para o contato: a apresentacao vai aqui, porque a
 * resposta seguinte ja nao se apresenta de novo (ela ve que falou hoje).
 */
export type IdiomaEspera = 'pt' | 'es' | 'en';

const TEXTOS: Record<IdiomaEspera, { oi: string; espera: string }> = {
  pt: {
    oi: 'Olá! Sou a Bella, assistente online do Hotel do Bosque.',
    espera: 'Só um instante, estou verificando e já te respondo! 🌿',
  },
  es: {
    oi: '¡Hola! Soy Bella, asistente online del Hotel do Bosque.',
    espera: '¡Un momento, estoy verificando y ya le respondo! 🌿',
  },
  en: {
    oi: "Hello! I'm Bella, the Hotel do Bosque online assistant.",
    espera: "Just a moment, I'm checking and will reply shortly! 🌿",
  },
};

/** Idioma provavel da mensagem. Na duvida, portugues. */
export function idiomaDaMensagem(texto: string): IdiomaEspera {
  const t = (texto || '').toLowerCase();
  const es = (t.match(/\b(hola|gracias|quisiera|quiero saber|habitaci[óo]n|personas|noches|precio|disponibilidad|buenas|buenos d[íi]as|cu[áa]nto|tienen|somos|nosotros|ni[ñn]os)(?![a-zà-ÿ])|¿|¡/g) || []).length;
  const en = (t.match(/\b(hello|hi|thanks|thank you|room|rooms|price|night|nights|available|availability|booking|would like|how much|we are|people)(?![a-zà-ÿ])/g) || []).length;
  const pt = (t.match(/\b(ol[áa]|obrigad[oa]|gostaria|quarto|pessoas|di[áa]rias?|valor|disponibilidade|bom dia|boa tarde|boa noite|quanto|voc[êe]s|n[óo]s|crian[çc]as?)(?![a-zà-ÿ])/g) || []).length;
  if (es > pt && es >= en) return 'es';
  if (en > pt && en > es) return 'en';
  return 'pt';
}

export function mensagemDeEspera(idioma: IdiomaEspera, apresentar: boolean): string {
  const t = TEXTOS[idioma] ?? TEXTOS.pt;
  return apresentar ? `${t.oi}\n\n${t.espera}` : t.espera;
}

/** A mensagem e uma das de espera (em qualquer idioma, com ou sem apresentacao)? */
export function ehMensagemDeEspera(texto: string): boolean {
  return Object.values(TEXTOS).some((t) => (texto || '').trim().endsWith(t.espera));
}
