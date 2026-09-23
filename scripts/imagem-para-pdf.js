/**
 * Converte uma imagem num PDF de uma pagina, do tamanho exato da imagem.
 *
 * Por que isto existe: as "Regras para Pets" e as "Normas do Hotel" estavam
 * guardadas como PNG. O WhatsApp COMPRIME o que entra como foto, e as duas
 * folhas chegavam ilegiveis em miniatura - reclamacao de agosto e de novo em
 * 18 e 23/09/2026. PDF o WhatsApp nao comprime, entao virar PDF resolve o
 * problema na origem, sem depender de qual campo da tela a extensao encontra.
 *
 * Monta o PDF na mao (sem dependencia nova): a imagem entra como JPEG via
 * DCTDecode, que e o unico filtro de imagem que o PDF aceita sem reescrever os
 * pixels. Uma pagina, do tamanho da imagem, sem margem.
 */
const sharp = require('sharp');

/** Deslocamento em bytes de cada objeto, para a tabela xref. */
function montarPdf(jpeg, largura, altura) {
  const partes = [];
  const deslocamentos = [];
  let total = 0;
  const por = (buf) => { partes.push(buf); total += buf.length; };
  const texto = (s) => por(Buffer.from(s, 'latin1'));
  const objeto = (n, corpo, fluxo) => {
    deslocamentos[n] = total;
    texto(`${n} 0 obj\n${corpo}\n`);
    if (fluxo) { texto('stream\n'); por(fluxo); texto('\nendstream\n'); }
    texto('endobj\n');
  };

  texto('%PDF-1.4\n');
  objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objeto(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objeto(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largura} ${altura}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  objeto(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  const desenho = Buffer.from(`q ${largura} 0 0 ${altura} 0 0 cm /Im0 Do Q`, 'latin1');
  objeto(5, `<< /Length ${desenho.length} >>`, desenho);

  const inicioXref = total;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n++) xref += String(deslocamentos[n]).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  texto(xref);

  return Buffer.concat(partes);
}

/**
 * @param {Buffer} imagem  PNG ou JPEG original
 * @param {number} larguraMaxima  limite de pixels; folha de texto nao precisa
 *   de mais que isso para ficar legivel ampliada, e o arquivo fica menor
 */
async function imagemParaPdf(imagem, larguraMaxima = 2200) {
  const meta = await sharp(imagem).metadata();
  const redimensiona = meta.width > larguraMaxima;
  const canvas = sharp(imagem).flatten({ background: '#ffffff' }); // PNG com transparencia vira fundo branco
  const jpeg = await (redimensiona ? canvas.resize({ width: larguraMaxima }) : canvas)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const info = await sharp(jpeg).metadata();
  return montarPdf(jpeg, info.width, info.height);
}

module.exports = { imagemParaPdf };
