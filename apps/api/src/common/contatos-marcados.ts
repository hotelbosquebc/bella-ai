/**
 * Quem e quem entre os contatos marcados (guias de grupos e excursoes).
 *
 * O mesmo numero chega escrito de varios jeitos: "+55 15 99655-6525" no
 * WhatsApp Web, "5515996556525" na API, "(15) 9655-6525" digitado no painel,
 * com ou sem o nono digito. A comparacao e feita na forma canonica: DDD + os
 * 8 ultimos digitos. Identificador de Instagram/Facebook nao e telefone e e
 * comparado inteiro.
 */
export function telefoneCanonico(valor: string | null | undefined): string {
  let d = String(valor || '').replace(/\D/g, '');
  if (!d) return '';
  // Telefone brasileiro: com DDI 55 tem 12 ou 13 digitos.
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) d = d.slice(2);
  // DDD + 9 + 8 digitos -> DDD + 8 digitos (o nono digito nem sempre vem).
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d;
}

/** Nome para comparar: sem acento, sem caixa, espacos simples. */
export function nomeCanonico(valor: string | null | undefined): string {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ContatoParaComparar {
  identificador?: string | null;
  nome?: string | null;
}

/**
 * O contato bate com algum marcado? Telefone vale quando tem cara de
 * telefone (8 digitos ou mais); nome so vale inteiro - "Ana" nao marca
 * todas as Anas.
 */
export function contatoMarcado<T extends ContatoParaComparar>(
  marcados: T[],
  quem: { identificador?: string | null; nome?: string | null },
): T | null {
  const tel = telefoneCanonico(quem.identificador);
  const idCru = String(quem.identificador || '').trim();
  const nome = nomeCanonico(quem.nome);
  for (const m of marcados) {
    const mTel = telefoneCanonico(m.identificador);
    if (tel.length >= 8 && mTel.length >= 8 && tel === mTel) return m;
    if (idCru && m.identificador && idCru === String(m.identificador).trim()) return m;
    if (nome && m.nome && nome === nomeCanonico(m.nome)) return m;
  }
  return null;
}
