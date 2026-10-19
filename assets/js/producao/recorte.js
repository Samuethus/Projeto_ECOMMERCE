/* MARGELLE · Produção — recorte da modelo (remoção de fundo no navegador)
   Usa @imgly/background-removal, que roda localmente (sem custo de API).
   Na primeira execução o navegador baixa o modelo de IA (~40 MB, fica em cache).
   ATENÇÃO À LICENÇA: a biblioteca é AGPL-3.0; para uso comercial avalie a
   licença comercial da IMG.LY ou troque este módulo por uma API paga
   (remove.bg, Photoroom etc.). A interface `recortarModelo` permanece a mesma. */

const MODULO = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
let carregando = null;

function biblioteca() {
  carregando ??= import(MODULO);
  return carregando;
}

/* Pré-carrega a biblioteca enquanto o usuário ainda está escolhendo a foto */
export function preaquecer() {
  biblioteca().catch(() => { carregando = null; });
}

/**
 * Remove o fundo da foto e devolve um canvas recortado justo na silhueta.
 * @param {HTMLCanvasElement} canvas foto da modelo (já redimensionada)
 * @param {(fracao:number)=>void} [aoProgredir]
 */
export async function recortarModelo(canvas, aoProgredir) {
  const { removeBackground } = await biblioteca();
  const entrada = await new Promise((r) => canvas.toBlob(r, 'image/png'));

  const blob = await removeBackground(entrada, {
    model: 'isnet_quint8',
    output: { format: 'image/png', quality: 1 },
    progress: (chave, atual, total) => {
      if (aoProgredir && total) aoProgredir(Math.min(1, atual / total));
    },
  });

  const bitmap = await createImageBitmap(blob);
  return aparar(bitmap);
}

/* Corta as bordas transparentes (bounding box do canal alfa) */
function aparar(bitmap) {
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);

  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('Não foi possível identificar a modelo na foto.');

  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
