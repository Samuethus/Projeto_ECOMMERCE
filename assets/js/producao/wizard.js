/* MARGELLE · Produção — wizard (menu "Produção")
   Fluxo: acesso → 01 foto → 02 recorte + análise (editável) → 03 geração + download.
   Supabase e o recorte só são carregados quando o wizard é aberto. */
import { CONFIG, configurado } from './config.js';
import { arquivoParaImagem, redimensionar, canvasParaPayload, payloadParaSrc, carregarImagem, canvasParaBlob, baixar } from './imagem.js';
import { comporArte } from './composicao.js';

const raiz = document.getElementById('producao');
if (raiz) iniciar(raiz);

function iniciar(raiz) {
  const $ = (sel, el = raiz) => el.querySelector(sel);
  const $$ = (sel, el = raiz) => [...el.querySelectorAll(sel)];

  const estado = {
    api: null,
    recorte: null,
    foto: null,          // canvas da foto (para o recorte)
    envio: null,         // { mime, data } enviado à IA
    modelo: null,        // canvas da modelo recortada
    analise: null,
    producaoId: null,
    arte: null,          // canvas final
    limite: null,        // gerações por dia
    ocupado: false,
  };
  let ultimoFoco = null;

  /* ---------------------------------------------------------- navegação */
  const PASSOS_NUMERADOS = ['foto', 'analise', 'arte'];

  function irPara(passo) {
    $$('[data-passo]').forEach((s) => { s.hidden = s.dataset.passo !== passo; });
    $('[data-passos]').hidden = !PASSOS_NUMERADOS.includes(passo);
    const atual = PASSOS_NUMERADOS.indexOf(passo);
    $$('[data-passo-indicador]').forEach((li, i) => {
      li.classList.toggle('is-active', i === atual);
      li.classList.toggle('is-done', i < atual);
    });
    limparErros();
    const foco = $(`[data-passo="${passo}"] input, [data-passo="${passo}"] button:not([disabled])`);
    foco?.focus({ preventScroll: true });
  }

  function erro(msg, passo) {
    const alvo = passo ? $(`[data-passo="${passo}"] [data-erro]`) : $$('[data-passo]').find((s) => !s.hidden)?.querySelector('[data-erro]');
    if (alvo) alvo.textContent = msg;
  }
  const limparErros = () => $$('[data-erro]').forEach((e) => { e.textContent = ''; });

  /* ---------------------------------------------------------- abrir / fechar */
  async function abrir() {
    ultimoFoco = document.activeElement;
    raiz.hidden = false;
    document.body.style.overflow = 'hidden';

    if (!configurado()) return irPara('indisponivel');

    try {
      estado.api ??= await import('./api.js');
      estado.recorte ??= await import('./recorte.js');
      estado.recorte.preaquecer();
    } catch {
      erro('Não foi possível carregar a Produção. Verifique sua conexão.', 'acesso');
      return irPara('acesso');
    }

    const sessao = await estado.api.sessaoAtual();
    if (!sessao) return irPara('acesso');
    const falha = await carregarUsuario(sessao);
    irPara(estado.arte ? 'arte' : 'foto');
    if (falha) erro(falha);
  }

  function fechar() {
    raiz.hidden = true;
    document.body.style.overflow = '';
    ultimoFoco?.focus?.();
  }

  document.querySelectorAll('[data-producao-open]').forEach((el) =>
    el.addEventListener('click', (e) => { e.preventDefault(); abrir(); }));
  $$('[data-producao-close]').forEach((el) => el.addEventListener('click', fechar));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !raiz.hidden && !estado.ocupado) fechar();
  });
  if (location.hash === '#producao') abrir();

  /* ---------------------------------------------------------- acesso */
  async function carregarUsuario(sessao) {
    $('[data-usuario]').hidden = false;
    $('[data-usuario-nome]').textContent = sessao.user.email;
    try {
      const s = await estado.api.status();
      $('[data-usuario-nome]').textContent = s.nome;
      estado.limite = s.limite;
      atualizarCota(s.limite - s.usadas);
      return null;
    } catch (e) {
      return e.message;
    }
  }

  function atualizarCota(restantes) {
    $('[data-cota]').textContent = estado.limite != null ? `${restantes}/${estado.limite} hoje` : '';
    $('[data-restantes]').textContent = `Você ainda pode gerar ${restantes} ${restantes === 1 ? 'imagem' : 'imagens'} hoje.`;
  }

  $('[data-form-login]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.reportValidity()) return;
    const botao = f.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await estado.api.entrar(f.email.value.trim(), f.senha.value);
      f.reset();
      const falha = await carregarUsuario(await estado.api.sessaoAtual());
      irPara('foto');
      if (falha) erro(falha);
    } catch (err) {
      erro(err.message, 'acesso');
    } finally {
      botao.disabled = false;
    }
  });

  $('[data-sair]').addEventListener('click', async () => {
    await estado.api?.sair();
    $('[data-usuario]').hidden = true;
    reiniciar();
    irPara('acesso');
  });

  /* ---------------------------------------------------------- 01 · foto */
  const inputArquivo = $('[data-arquivo]');
  const dropzone = $('[data-dropzone]');

  async function receberArquivo(arquivo) {
    limparErros();
    const botao = $('[data-acao="analisar"]');
    botao.disabled = true;
    if (!arquivo || !/^image\/(jpeg|png|webp)$/.test(arquivo.type)) {
      return erro('Envie uma imagem JPG, PNG ou WebP.', 'foto');
    }
    try {
      const img = await arquivoParaImagem(arquivo);
      const w = img.naturalWidth, h = img.naturalHeight;
      if (h < CONFIG.fotoMinAltura) return erro(`A foto precisa ter pelo menos ${CONFIG.fotoMinAltura} px de altura.`, 'foto');
      if (w >= h) return erro('Use uma foto vertical, com a modelo de corpo inteiro.', 'foto');

      estado.foto = redimensionar(img, CONFIG.recorteMaxLado);
      estado.envio = canvasParaPayload(redimensionar(img, CONFIG.envioMaxLado));
      estado.modelo = null;
      estado.analise = null;

      const preview = $('[data-preview]');
      preview.src = estado.foto.toDataURL('image/jpeg', 0.85);
      preview.hidden = false;
      $('[data-dropzone-hint]').hidden = true;
      dropzone.classList.add('has-image');
      botao.disabled = false;
    } catch (err) {
      erro(err.message, 'foto');
    }
  }

  inputArquivo.addEventListener('change', () => receberArquivo(inputArquivo.files[0]));
  ['dragenter', 'dragover'].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove('is-over')));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); receberArquivo(e.dataTransfer.files[0]); });

  /* ---------------------------------------------------------- 02 · recorte + análise */
  async function analisar() {
    irPara('analise');
    const editor = $('[data-editor]');
    const progresso = $('[data-progresso]');
    const botaoGerar = $('[data-acao="gerar"]');
    botaoGerar.disabled = true;

    if (estado.modelo && estado.analise) {   // já analisado: só mostra o editor
      progresso.hidden = true;
      editor.hidden = false;
      botaoGerar.disabled = false;
      return;
    }

    const botaoRepetir = $('[data-acao="reanalisar"]');
    botaoRepetir.hidden = true;
    editor.hidden = true;
    progresso.hidden = false;
    $$('[data-progresso-item]').forEach((p) => p.classList.remove('is-done', 'is-error'));
    estado.ocupado = true;

    const pct = $('[data-progresso-pct]');
    const marcar = (item, classe) => $(`[data-progresso-item="${item}"]`).classList.add(classe);

    try {
      // o recorte é reaproveitado ao tentar de novo (só a análise é refeita)
      const recorte = estado.modelo
        ? Promise.resolve(estado.modelo)
        : estado.recorte.recortarModelo(estado.foto, (f) => { pct.textContent = `${Math.round(f * 100)}%`; });
      const [modelo, resposta] = await Promise.all([
        recorte
          .then((m) => { marcar('recorte', 'is-done'); pct.textContent = ''; estado.modelo = m; return m; })
          .catch((e) => { marcar('recorte', 'is-error'); throw e; }),
        estado.api.analisar(estado.envio)
          .then((r) => { marcar('analise', 'is-done'); return r; })
          .catch((e) => { marcar('analise', 'is-error'); throw e; }),
      ]);
      estado.modelo = modelo;
      estado.analise = resposta.analise;
      preencherEditor();
      progresso.hidden = true;
      editor.hidden = false;
      botaoGerar.disabled = false;
    } catch (err) {
      erro(err.message || 'Falha na análise. Tente novamente.', 'analise');
      botaoRepetir.hidden = false;
    } finally {
      estado.ocupado = false;
    }
  }

  function preencherEditor() {
    const a = estado.analise;
    $('[data-recorte]').src = estado.modelo.toDataURL('image/png');

    const alerta = $('[data-alerta]');
    alerta.hidden = a.foto_adequada !== false;
    alerta.textContent = a.foto_adequada === false
      ? `Atenção: ${a.problemas?.join('; ') || 'a foto pode não ser adequada'}. Você pode continuar ou trocar a foto.`
      : '';

    const paleta = $('[data-paleta]');
    paleta.innerHTML = '';
    a.cores.forEach((cor, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <input type="color" value="${cor.hex}" aria-label="Cor ${i + 1}" data-cor-hex>
        <input type="text" value="" aria-label="Nome da cor ${i + 1}" data-cor-nome>`;
      li.querySelector('[data-cor-nome]').value = cor.nome;
      paleta.appendChild(li);
    });

    $('[data-tecidos]').value = a.tecidos_fundo.join('\n');
    $('[data-closeups]').value = a.closeups.join('\n');
  }

  function lerEditor() {
    const linhas = (sel) => $(sel).value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const cores = $$('[data-paleta] li').map((li) => ({
      hex: li.querySelector('[data-cor-hex]').value,
      nome: li.querySelector('[data-cor-nome]').value.trim() || li.querySelector('[data-cor-hex]').value,
    }));
    return { ...estado.analise, cores, tecidos_fundo: linhas('[data-tecidos]'), closeups: linhas('[data-closeups]') };
  }

  /* ---------------------------------------------------------- 03 · geração */
  async function gerar() {
    const analise = lerEditor();
    if (!analise.tecidos_fundo.length || !analise.closeups.length) {
      return erro('Informe ao menos um tecido e um close-up.', 'analise');
    }
    estado.analise = analise;
    estado.arte = null;
    irPara('arte');

    const img = $('[data-arte]');
    const carregando = $('[data-gerando]');
    const botoes = $$('[data-acao="baixar-jpg"], [data-acao="baixar-png"], [data-acao="regerar"]');
    img.hidden = true;
    carregando.hidden = false;
    botoes.forEach((b) => { b.disabled = true; });
    estado.ocupado = true;

    try {
      const r = await estado.api.gerar(estado.envio, analise);
      estado.producaoId = r.id;
      atualizarCota(r.restantes);
      const fundo = await carregarImagem(payloadParaSrc(r.fundo));
      estado.arte = comporArte({
        fundo,
        modelo: estado.modelo,
        cores: analise.cores,
        largura: CONFIG.saida.largura,
        altura: CONFIG.saida.altura,
      });
      img.src = estado.arte.toDataURL('image/jpeg', 0.9);
      img.hidden = false;
      botoes.forEach((b) => { b.disabled = false; });
      salvarNoHistorico();
    } catch (err) {
      erro(err.message || 'Falha ao gerar a arte.', 'arte');
      $('[data-acao="regerar"]').disabled = false;
    } finally {
      carregando.hidden = true;
      estado.ocupado = false;
    }
  }

  async function salvarNoHistorico() {
    try {
      const blob = await canvasParaBlob(estado.arte, 'image/jpeg', CONFIG.saida.qualidadeJpg);
      await estado.api.salvarFinal(estado.producaoId, blob);
    } catch (e) {
      console.warn('Arte não foi salva no histórico:', e);
    }
  }

  async function baixarArte(tipo) {
    if (!estado.arte) return;
    const jpg = tipo === 'jpg';
    const blob = await canvasParaBlob(estado.arte, jpg ? 'image/jpeg' : 'image/png', CONFIG.saida.qualidadeJpg);
    const data = new Date().toISOString().slice(0, 10);
    baixar(blob, `margelle-producao-${data}-${(estado.producaoId || '').slice(0, 8)}.${tipo}`);
  }

  function reiniciar() {
    Object.assign(estado, { foto: null, envio: null, modelo: null, analise: null, producaoId: null, arte: null });
    inputArquivo.value = '';
    const preview = $('[data-preview]');
    preview.hidden = true;
    preview.removeAttribute('src');
    $('[data-dropzone-hint]').hidden = false;
    dropzone.classList.remove('has-image');
    $('[data-acao="analisar"]').disabled = true;
  }

  /* ---------------------------------------------------------- ações */
  const acoes = {
    analisar,
    reanalisar: analisar,
    gerar,
    regerar: gerar,
    'voltar-foto': () => irPara('foto'),
    'voltar-analise': () => analisar(),
    'baixar-jpg': () => baixarArte('jpg'),
    'baixar-png': () => baixarArte('png'),
    nova: () => { reiniciar(); irPara('foto'); },
  };
  raiz.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-acao]');
    if (botao && !botao.disabled && !estado.ocupado) acoes[botao.dataset.acao]?.();
  });
}
