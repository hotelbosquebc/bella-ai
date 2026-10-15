/**
 * Carrega as funcoes puras de um modulo TypeScript para teste, sem Nest.
 *
 * Por que existe: os testes transpilam o arquivo e removem os `import`, porque
 * trazer o modulo inteiro arrastaria o Nest, o Prisma e a conexao com o banco.
 * Isso funcionou enquanto tudo morava num arquivo so. Quando `assist.module.ts`
 * passou a importar de `common/links` e `common/contato`, os testes quebraram
 * com "blocoDeContato is not defined" - e o codigo estava certo.
 *
 * Aqui os imports de modulos NOSSOS sao resolvidos de verdade (recursivamente)
 * e injetados; so os de biblioteca (@nestjs, @prisma) continuam descartados.
 */
const fs = require('fs');
const path = require('path');
const ts = require(path.join(process.cwd(), 'node_modules/typescript'));

const cache = new Map();

function carregar(arquivoTs) {
  const absoluto = path.resolve(arquivoTs);
  if (cache.has(absoluto)) return cache.get(absoluto);

  let fonte = fs.readFileSync(absoluto, 'utf8');

  // Corta na primeira classe decorada: dali para baixo e Nest, nao funcao pura.
  const corte = fonte.search(/^@(Controller|Module|Injectable)/m);
  if (corte > 0) fonte = fonte.slice(0, corte);

  // Descobre o que vem de arquivos NOSSOS antes de remover os imports.
  const dependencias = {};
  const reImport = /^import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)';?$/gm;
  let m;
  while ((m = reImport.exec(fonte)) !== null) {
    const nomes = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
    const destino = path.resolve(path.dirname(absoluto), m[2] + '.ts');
    if (!fs.existsSync(destino)) continue;
    const mod = carregar(destino);
    for (const nome of nomes) if (nome in mod) dependencias[nome] = mod[nome];
  }

  fonte = fonte.replace(/^import .*$/gm, '');
  const js = ts.transpileModule(fonte, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const nomes = Object.keys(dependencias);
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', ...nomes, js)(
    mod.exports,
    mod,
    require,
    ...nomes.map((n) => dependencias[n]),
  );
  cache.set(absoluto, mod.exports);
  return mod.exports;
}

module.exports = { carregar };
