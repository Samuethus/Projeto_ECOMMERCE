/* MARGELLE · Produção — utilitários de imagem (carregar, redimensionar, base64) */

export function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
    img.src = src;
  });
}

export async function arquivoParaImagem(arquivo) {
  const url = URL.createObjectURL(arquivo);
  try {
    return await carregarImagem(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/* Redesenha a imagem limitando o maior lado; devolve um canvas */
export function redimensionar(img, maxLado) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const escala = Math.min(1, maxLado / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * escala);
  canvas.height = Math.round(h * escala);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasParaBlob(canvas, tipo = 'image/jpeg', qualidade = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao exportar a imagem.'))), tipo, qualidade));
}

/* { mime, data } no formato esperado pela Edge Function */
export function canvasParaPayload(canvas, qualidade = 0.88) {
  const dataUrl = canvas.toDataURL('image/jpeg', qualidade);
  return { mime: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

export function payloadParaSrc({ mime, data }) {
  return `data:${mime};base64,${data}`;
}

export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
