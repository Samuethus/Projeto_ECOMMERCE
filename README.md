# Margelle — Landing page

Landing page estática (HTML + CSS + JS, sem build) que reproduz o layout de referência
`docs/referencia-layout-margelle.png`.

## Estrutura

```
index.html                 página
assets/
  css/styles.css           estilos (tokens, componentes, seções, responsivo)
  css/producao.css         estilos do wizard "Produção"
  js/main.js               menu lateral, cabeçalho fixo e newsletter
  js/producao/             wizard "Produção" (geração de posts para Instagram)
  images/                  imagens do site, nomeadas pela posição na página
    LEIA-ME.md             inventário, proporções e tamanhos recomendados
docs/
  referencia-layout-margelle.png   layout original (fonte da verdade visual)
  referenfica produção/            referências e prompt do moodboard de Instagram
supabase/                  backend da Produção (banco, storage e Edge Function)
  README.md                passo a passo de configuração
```

Site publicado: <https://samuethus.github.io/Projeto_ECOMMERCE/> (atualiza a cada push na `main`).
Para visualizar localmente, abra o `index.html` no navegador. Para usar o menu **Produção**, sirva a pasta
com `python -m http.server 8000` e acesse <http://localhost:8000>. O wizard usa módulos JavaScript,
que não funcionam via `file://`. A configuração do backend está em [supabase/README.md](supabase/README.md).

## Guia de estilo

**Cores** (tokens em `:root` no `styles.css`)

| Token | Valor | Uso |
|---|---|---|
| `--color-page` | `#f5f5f5` | fundo da página; letras vazadas do rodapé |
| `--color-surface` | `#dedad9` | fundo do rodapé |
| `--color-muted` | `#dad7d6` | títulos display e script em cinza claro |
| `--color-rule` | `#cfcbca` | linhas e sublinhado do input |
| `--color-ink` | `#3d3a3a` | títulos pequenos, ícones, botão sólido |
| `--color-ink-soft` | `#4a4646` | texto corrido |

**Tipografia** (Google Fonts)

- **League Gothic** (eixo `wdth` em 88): MARGELLE, nomes das categorias, INSPIRED BY THE, LOOK BOOK,
  SEASON 2025 e títulos dos serviços. Sempre em caixa-alta. O `line-height` é igual à altura das
  maiúsculas (0,735em), para alinhar os textos pelo topo e pela base das letras.
- **Yellowtail**: títulos em script (Product categories, Modern Woman, Our Services, Prêt-à-porter, Pre-Fall).
- **Fira Sans**: textos, links e botões.

**Sistema de medidas**

O layout de referência tem 752px de largura. No desktop, cada medida é escrita como `calc(N * var(--u))`,
em que `1u` corresponde a 1px do layout. Assim a página guarda as proporções do modelo em qualquer largura,
até o limite de 1440px. Abaixo de 768px o layout vira uma coluna, com tamanhos de leitura mínimos.

## Próximos passos

- Trocar as imagens placeholder pelas definitivas (veja `assets/images/LEIA-ME.md`).
- Ligar os links aos destinos reais e o formulário de newsletter a um serviço de e-mail.
