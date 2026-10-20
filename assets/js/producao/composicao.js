/* MARGELLE · Produção — montagem da arte final (canvas)
   Camadas, de baixo para cima:
     1. fundo gerado pela IA (colagem rústica de papel, tecido e flores secas, ou só tecidos)
     2. polaroids com close-ups recortados da foto ORIGINAL (fiéis ao look)
     3. cartão de papel bege com as 5 pinceladas de cor (desenhado aqui, cores exatas)
     4. modelo recortada da foto ORIGINAL, centralizada, com sombra suave
   As proporções seguem as referências em docs/referenfica produção (formato 4:5). */

export const LAYOUT = {
  /* cartão de cores: fração da largura/altura da arte (à esquerda, entre as polaroids) */
  cartao: { x: 0.055, y: 0.168, w: 0.25, h: 0.355, rotacao: -3 },
  /* modelo: o corpo ocupa a faixa vertical entre as margens (5% em cima e embaixo),
     centralizada; larguraMax é só uma trava para poses muito abertas não saírem da arte */
  modelo: { margemTopo: 0.05, margemBase: 0.05, larguraMax: 0.92, centroX: 0.5 },
  papel: '#e6ddcd',
};

/* gerador pseudoaleatório com semente: o mesmo layout gera sempre o mesmo traço */
function aleatorio(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cobrir(ctx, img, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const escala = Math.max(w / iw, h / ih);
  const dw = iw * escala;
  const dh = ih * escala;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function hexParaRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function variar([r, g, b], f) {
  const k = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${k(r)}, ${k(g)}, ${k(b)})`;
}

/* papel com bordas levemente rasgadas e textura de fibras */
function desenharPapel(ctx, x, y, w, h, rnd) {
  const passo = 6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let px = x; px <= x + w; px += passo) ctx.lineTo(px, y + (rnd() - 0.5) * 2.2);
  for (let py = y; py <= y + h; py += passo) ctx.lineTo(x + w + (rnd() - 0.5) * 2.2, py);
  for (let px = x + w; px >= x; px -= passo) ctx.lineTo(px, y + h + (rnd() - 0.5) * 3.4);
  for (let py = y + h; py >= y; py -= passo) ctx.lineTo(x + (rnd() - 0.5) * 2.2, py);
  ctx.closePath();

  ctx.save();
  ctx.shadowColor = 'rgba(60, 42, 25, .28)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = LAYOUT.papel;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.clip();
  for (let i = 0; i < (w * h) / 40; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.18)' : 'rgba(120,96,70,.08)';
    ctx.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 1.6, 1);
  }
  ctx.restore();
}

/* pincelada de tinta: miolo sólido com pontas irregulares + textura de cerdas */
function desenharPincelada(ctx, x, y, w, h, hex, rnd) {
  const rgb = hexParaRgb(hex);
  const fatias = 18;
  const passoY = h / fatias;

  // 1) contorno da tinta: início e fim de cada fatia variam (pontas "secas")
  const esquerda = [];
  const direita = [];
  for (let i = 0; i <= fatias; i++) {
    const t = i / fatias;
    const borda = 1 - Math.sin(Math.PI * t);               // 1 nas bordas, 0 no meio
    esquerda.push(x + w * (0.01 + borda * 0.05 + rnd() * 0.035));
    direita.push(x + w * (0.99 - borda * 0.07 - rnd() * 0.06));
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(esquerda[0], y);
  for (let i = 0; i <= fatias; i++) ctx.lineTo(direita[i], y + i * passoY);
  for (let i = fatias; i >= 0; i--) ctx.lineTo(esquerda[i], y + i * passoY);
  ctx.closePath();
  ctx.fillStyle = variar(rgb, 1);
  ctx.fill();

  // 2) textura de cerdas dentro da tinta (variação sutil de tom)
  ctx.clip();
  ctx.lineCap = 'round';
  for (let py = 0; py < h; py += 1.6) {
    ctx.strokeStyle = variar(rgb, 0.9 + rnd() * 0.2);
    ctx.globalAlpha = 0.25 + rnd() * 0.25;
    ctx.lineWidth = 1 + rnd() * 1.6;
    const xi = x + rnd() * w * 0.3;
    ctx.beginPath();
    ctx.moveTo(xi, y + py);
    ctx.lineTo(xi + w * (0.4 + rnd() * 0.6), y + py + (rnd() - 0.5) * 1.2);
    ctx.stroke();
  }
  ctx.restore();

  // 3) fios soltos nas pontas, como pincel quase sem tinta
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const py = y + rnd() * h;
    const fatia = Math.min(fatias, Math.round((py - y) / passoY));
    const fim = direita[fatia];
    ctx.strokeStyle = variar(rgb, 0.95 + rnd() * 0.1);
    ctx.globalAlpha = 0.35 + rnd() * 0.4;
    ctx.lineWidth = 0.8 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(fim - w * 0.04, py);
    ctx.lineTo(fim + w * (0.01 + rnd() * 0.05), py + (rnd() - 0.5) * 1.5);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function desenharCartaoCores(ctx, W, H, cores) {
  const c = LAYOUT.cartao;
  const x = c.x * W, y = c.y * H, w = c.w * W, h = c.h * H;
  const rnd = aleatorio(20251019);

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((c.rotacao * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);

  desenharPapel(ctx, 0, 0, w, h, rnd);

  // pinceladas um pouco deslocadas para a esquerda, com bastante papel aparente em volta
  const margemEsq = w * 0.15;
  const margemDir = w * 0.17;
  const margemY = h * 0.075;
  const vao = h * 0.045;
  const alturaFaixa = (h - margemY * 2 - vao * (cores.length - 1)) / cores.length;
  cores.forEach((cor, i) => {
    desenharPincelada(ctx, margemEsq, margemY + i * (alturaFaixa + vao), w - margemEsq - margemDir, alturaFaixa, cor.hex, rnd);
  });
  ctx.restore();
}

/* ---------------------------------------------------------- polaroids */
/* posições: centro (fração da arte), largura da moldura (fração da largura), rotação (graus)
   e proporção da foto (largura/altura). Copiadas da arte de referência do "Padrão Creme/Bege":
   3 de cada lado, nas bordas; a modelo é desenhada por cima.
   `fixo` = close-up obrigatório em toda arte ("tecido": tecido ondulado na cor principal da roupa;
   "maos": mãos com as unhas na cor das da modelo). As demais recebem os detalhes escolhidos,
   na ordem de prioridade: o 1º (sapatos) vai embaixo à esquerda. */
export const POLAROIDS = [
  { x: 0.205, y: 0.845, w: 0.275, rot: -3, aspecto: 0.84 },                // embaixo à esquerda
  { x: 0.845, y: 0.77, w: 0.29, rot: 3, aspecto: 0.95 },                   // embaixo à direita
  { x: 0.838, y: 0.163, w: 0.3, rot: 4, aspecto: 0.95 },                   // alto à direita
  { x: 0.14, y: 0.617, w: 0.28, rot: 4, aspecto: 1.23 },                   // esquerda, abaixo do cartão
  { x: 0.866, y: 0.43, w: 0.235, rot: 2, aspecto: 0.78, fixo: 'maos' },    // direita, meio
  { x: 0.225, y: 0.082, w: 0.37, rot: 3, aspecto: 1.57, fixo: 'tecido' },  // alto à esquerda, saindo da borda
];
/* quantidade de polaroids que recebem os detalhes escolhidos na análise */
export const LIVRES = POLAROIDS.filter((p) => !p.fixo).length;
/* moldura (frações da largura): fina em cima e nas laterais, mais larga embaixo */
const MOLDURA = { lado: 0.045, base: 0.12, cor: '#ece4d4' };

/**
 * Recorta da foto ORIGINAL o detalhe indicado pela análise (close-up fiel ao look).
 * @param {HTMLCanvasElement} foto
 * @param {number[]} caixa [ymin, xmin, ymax, xmax] normalizada 0–1000
 * @param {number} [aspecto] largura/altura do recorte
 */
export function recortarDetalhe(foto, caixa, aspecto = 1) {
  const [y0, x0, y1, x1] = caixa.map((v) => Math.max(0, Math.min(1000, v)) / 1000);
  const W = foto.width, H = foto.height;
  let cx = ((x0 + x1) / 2) * W, cy = ((y0 + y1) / 2) * H;
  // folga de 15% e tamanho mínimo, para não ampliar demais (pixelado)
  let w = Math.max((x1 - x0) * W * 1.15, Math.min(W, H) * 0.16);
  let h = Math.max((y1 - y0) * H * 1.15, Math.min(W, H) * 0.16);
  if (w / h > aspecto) h = w / aspecto; else w = h * aspecto;
  w = Math.min(w, W); h = Math.min(h, H);
  const sx = Math.max(0, Math.min(W - w, cx - w / 2));
  const sy = Math.max(0, Math.min(H - h, cy - h / 2));

  const lado = 640;
  const c = document.createElement('canvas');
  c.width = lado;
  c.height = Math.round(lado / aspecto);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(foto, sx, sy, w, h, 0, 0, c.width, c.height);
  return c;
}

function desenharPolaroid(ctx, W, H, slot, imagem, rnd) {
  const w = slot.w * W;
  const lado = w * MOLDURA.lado;
  const fotoW = w - lado * 2;
  const fotoH = fotoW / slot.aspecto;
  const h = lado + fotoH + w * MOLDURA.base;
  const x0 = -w / 2, y0 = -h / 2;

  ctx.save();
  ctx.translate(slot.x * W, slot.y * H);
  ctx.rotate((slot.rot * Math.PI) / 180);
  ctx.shadowColor = 'rgba(50, 35, 20, .32)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = MOLDURA.cor;
  ctx.fillRect(x0, y0, w, h);
  ctx.shadowColor = 'transparent';

  // fibras discretas no papel da moldura
  for (let i = 0; i < (w * h) / 60; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.16)' : 'rgba(120,96,70,.07)';
    ctx.fillRect(x0 + rnd() * w, y0 + rnd() * h, 1 + rnd() * 1.4, 1);
  }

  // foto preenchendo a janela sem distorcer (corta o excesso no centro)
  const iw = imagem.naturalWidth || imagem.width;
  const ih = imagem.naturalHeight || imagem.height;
  const escala = Math.max(fotoW / iw, fotoH / ih);
  const sw = fotoW / escala, sh = fotoH / escala;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagem, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x0 + lado, y0 + lado, fotoW, fotoH);

  // leve brilho de papel fotográfico
  const brilho = ctx.createLinearGradient(x0, y0, w / 2, h / 2);
  brilho.addColorStop(0, `rgba(255,255,255,${0.06 + rnd() * 0.05})`);
  brilho.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = brilho;
  ctx.fillRect(x0 + lado, y0 + lado, fotoW, fotoH);
  ctx.restore();
}

export function desenharPolaroids(ctx, W, H, detalhes) {
  const rnd = aleatorio(4242);
  // detalhes[i] vai na POLAROIDS[i]; posição sem imagem fica vazia
  detalhes.slice(0, POLAROIDS.length).forEach((img, i) => {
    if (img) desenharPolaroid(ctx, W, H, POLAROIDS[i], img, rnd);
  });
}

/* Eixo vertical do corpo (px no recorte): média horizontal da cabeça e do tronco
   (faixa de 3% a 40% da altura). Bolsa, braço aberto ou cabelo solto de um lado
   não deslocam a modelo do centro da arte. */
const eixos = new WeakMap();
export function eixoDoCorpo(modelo) {
  if (eixos.has(modelo)) return eixos.get(modelo);
  const ctx = modelo.getContext('2d', { willReadFrequently: true });
  const y0 = Math.floor(modelo.height * 0.03);
  const y1 = Math.floor(modelo.height * 0.4);
  const { data, width } = ctx.getImageData(0, y0, modelo.width, y1 - y0);
  let soma = 0, peso = 0;
  for (let i = 3, px = 0; i < data.length; i += 4, px++) {
    const a = data[i];
    if (a > 128) {
      soma += (px % width) * a;
      peso += a;
    }
  }
  const eixo = peso ? soma / peso : modelo.width / 2;
  eixos.set(modelo, eixo);
  return eixo;
}

export function desenharModelo(ctx, W, H, modelo) {
  const m = LAYOUT.modelo;
  const eixo = eixoDoCorpo(modelo);
  // a largura máxima vale para cada lado a partir do eixo, para a modelo nunca sair do centro
  const meiaLargura = Math.max(eixo, modelo.width - eixo);
  const alturaUtil = H * (1 - m.margemTopo - m.margemBase);
  // escala única nos dois eixos: a modelo cresce ou diminui sem distorcer
  const escala = Math.min(alturaUtil / modelo.height, (m.larguraMax * W) / 2 / meiaLargura);
  const dw = modelo.width * escala;
  const dh = modelo.height * escala;
  const dx = m.centroX * W - eixo * escala;
  // centralizada na faixa útil (se a trava de largura reduzir a altura, as margens ficam iguais)
  const dy = m.margemTopo * H + (alturaUtil - dh) / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(40, 28, 18, .38)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 12;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(modelo, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Monta a arte final.
 * @param {{fundo: CanvasImageSource, modelo: HTMLCanvasElement, cores: {hex:string}[],
 *          detalhes?: HTMLCanvasElement[], largura:number, altura:number}} p
 * @returns {HTMLCanvasElement}
 */
export function comporArte({ fundo, modelo, cores, detalhes = [], largura, altura }) {
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  cobrir(ctx, fundo, largura, altura);
  desenharPolaroids(ctx, largura, altura, detalhes);
  desenharCartaoCores(ctx, largura, altura, cores);
  desenharModelo(ctx, largura, altura, modelo);
  return canvas;
}
