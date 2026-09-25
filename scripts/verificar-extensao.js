/**
 * Confere a extensao antes de empacotar.
 *
 * Existe por causa de 23/09/2026: uma edicao minha apagou 213 linhas do
 * content.js - os botoes de anexo, o modulo de audio inteiro e a deteccao de
 * mensagem enviada - e foi para a maquina do hotel. A sintaxe continuava
 * valida, entao `node --check` passou e nada acusou. O dono descobriu pelo
 * botao "Erros" do Chrome, dois dias depois.
 *
 * Verifica tres coisas:
 *   1. sintaxe;
 *   2. que todo identificador USADO tambem e DECLARADO (o erro acima era
 *      exatamente isto: "audiosLidos is not defined");
 *   3. que o arquivo nao encolheu de repente.
 *
 * Uso: node scripts/verificar-extensao.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'whatsapp-extension');
const problemas = [];

/** Identificadores que a extensao precisa ter - some um, o painel quebra. */
const OBRIGATORIOS = [
  'audiosLidos', 'incluirAudios', 'motivoAudio', 'textoDoAudio', 'transcricoes',
  'mostrarAnexos', 'anexar', 'inserirArquivo', 'campoAceitaDocumento',
  'ultimaNossaConhecida', 'verificarEnvio', 'registrarEnvio',
  'scrapeConversation', 'sugerir', 'carregarModo', 'mesmoContato', 'direcaoPeloId',
];

for (const arquivo of ['content.js', 'background.js', 'options.js']) {
  const caminho = path.join(dir, arquivo);
  const codigo = fs.readFileSync(caminho, 'utf8');

  try {
    new vm.Script(codigo, { filename: arquivo });
  } catch (e) {
    problemas.push(`${arquivo}: erro de sintaxe - ${e.message}`);
    continue;
  }

  if (arquivo === 'content.js') {
    for (const id of OBRIGATORIOS) {
      // String.raw: escrito como texto comum, o \b vira caractere de controle e
      // a verificacao aprova tudo - foi o que aconteceu na primeira versao.
      const declarado = new RegExp(String.raw`(?:function|const|let|var)\s+` + id + String.raw`\b`).test(codigo);
      const usado = new RegExp(String.raw`\b` + id + String.raw`\b`).test(codigo);
      if (usado && !declarado) problemas.push(`content.js: "${id}" e usado mas NAO e declarado`);
      if (!usado) problemas.push(`content.js: "${id}" sumiu do arquivo`);
    }
    const linhas = codigo.split(/\r?\n/).length;
    if (linhas < 1000) problemas.push(`content.js encolheu para ${linhas} linhas - algo foi apagado sem querer`);
  }
}

const manifesto = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
if (!manifesto.version) problemas.push('manifest.json sem versao');

if (problemas.length) {
  console.error('EXTENSAO COM PROBLEMA - nao empacotar:');
  for (const p of problemas) console.error('  - ' + p);
  process.exit(1);
}
console.log(`extensao ok (versao ${manifesto.version})`);
