# Imagens do site — guia de substituição

As imagens atuais são **placeholders em baixa resolução**, recortadas do layout de referência
(`docs/referencia-layout-margelle.png`). Os textos que estavam "queimados" nas fotos foram removidos,
porque no site eles são HTML.

## Padrão de nomes

```
<nº da seção>-<seção>__<posição>-<descrição>.<ext>
```

O número indica a ordem da seção na página (de cima para baixo). Para trocar uma imagem, **substitua o
arquivo mantendo o mesmo nome**. O HTML e o CSS não precisam mudar.

## Inventário

Tamanho final recomendado = medida no layout × 3,83 (layout de 1440px em telas retina @2x).
O CSS usa `object-fit: cover`, então a proporção é o que importa: imagens com outra proporção serão cortadas.

| Arquivo | Onde aparece | Proporção (L×A) | Tamanho atual | Tamanho final recomendado |
|---|---|---|---|---|
| `01-hero__fundo-foto-modelo.jpg` | Hero (topo): foto principal, que aparece através das letras MARGELLE | 714 × 572 (≈ 5:4) | 714×572 | 2734×2190 |
| `01-hero__recorte-modelo-sobre-titulo.png` | Hero: recorte da modelo (PNG transparente) que fica **na frente** do título | 714 × 572, mesmo enquadramento da foto acima | 714×572 | 2734×2190 |
| `02-categorias__card-1-suits.jpg` | Product categories: 1º card (SUITS) | 172 × 324 (≈ 0,53) | 172×324 | 660×1240 |
| `02-categorias__card-2-bottoms.jpg` | Product categories: 2º card (BOTTOMS) | 172 × 324 | 172×324 | 660×1240 |
| `02-categorias__card-3-tops.jpg` | Product categories: 3º card (TOPS) | 172 × 324 | 173×324 | 660×1240 |
| `02-categorias__card-4-dresses.jpg` | Product categories: 4º card (DRESSES) | 172 × 324 | 173×324 | 660×1240 |
| `03-inspirada__foto-1-fundo-esquerda.jpg` | Inspired by the Modern Woman: foto de trás, à esquerda | 213 × 322 | 213×322 | 816×1233 |
| `03-inspirada__foto-2-frente-direita.jpg` | Inspired by the Modern Woman: foto da frente, sobreposta | 210 × 305 | 210×305 | 804×1168 |
| `04-lookbook__banner-season-2025.jpg` | Banner LOOK BOOK / SEASON 2025 | 710 × 414 (≈ 12:7) | 710×414 | 2720×1586 |
| `05-servicos__card-1-stylist-assistance.jpg` | Our Services: 1º card | 234 × 260 (9:10) | 234×260 | 896×996 |
| `05-servicos__card-2-made-to-measure.jpg` | Our Services: 2º card | 234 × 260 | 234×260 | 896×996 |
| `05-servicos__card-3-made-for-you.jpg` | Our Services: 3º card | 234 × 260 | 233×260 | 896×996 |

## Observações

- **Hero (duas camadas):** a foto de fundo só aparece dentro das letras MARGELLE e abaixo delas.
  O PNG de recorte põe a cabeça da modelo na frente das letras. As duas imagens precisam ter o
  **mesmo tamanho e o mesmo enquadramento**. O PNG pode ser o recorte da modelo inteira; basta ter
  fundo transparente.
- **Áreas livres:** deixe espaço sem detalhes importantes onde entram os textos:
  - base dos cards de categoria (nomes SUITS, BOTTOMS…);
  - cantos superiores e canto inferior direito do banner Look Book;
  - lado direito do hero.
- **Mobile:** no celular, o banner Look Book é cortado em 4:5 (foco um pouco à esquerda do centro).
- **Formatos:** fotos em JPG (qualidade 80–85) ou WebP; o recorte do hero em PNG ou WebP com transparência.
  Se mudar a extensão, atualize o caminho no `index.html`.
