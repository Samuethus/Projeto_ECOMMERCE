# Produção de conteúdo · Configuração do Supabase

O menu **Produção** do site abre um wizard que monta posts de Instagram (4:5, 1080 × 1350):

1. A pessoa da equipe faz login e envia a foto da modelo.
2. O navegador recorta a modelo da foto original. Rosto e corpo não passam pela IA.
3. A Edge Function `producao` pede ao **Gemini** (plano gratuito) a análise do look: peças, 5 cores,
   tecidos e a posição dos detalhes na foto. A pessoa revisa, edita, escolhe os close-ups e o estilo do fundo:
   - **Padrão Creme/Bege** (padrão): tecidos creme e bege predominantes, com detalhes do tecido principal da roupa;
   - **Padrão Tecidos**: colagem com os tecidos do look, editáveis.
4. A função gera, no **FLUX.2 [klein]** da **Cloudflare Workers AI** (cota diária gratuita) e usando a foto
   como referência, o **fundo de tecidos** inspirado no look e um **close-up novo** de cada detalhe escolhido.
5. O navegador monta a arte final: fundo, polaroids com os close-ups, cartão de cores e modelo recortada.
   Depois, libera o download. Se algum close-up falhar, entra um recorte da foto no lugar.

Custo atual: **zero**, dentro das cotas gratuitas do Gemini (análise), da Cloudflare (fundo) e do Supabase.

```
supabase/
  config.toml                              configuração mínima do CLI
  migrations/20261019120000_producao.sql   tabelas, RLS, função de limite e bucket
  functions/producao/index.ts              Edge Function (Gemini + Cloudflare Workers AI)
assets/js/producao/
  config.js      URL e chave pública do projeto  ← preencher
  wizard.js      interface do wizard
  api.js         login, chamadas à função e Storage
  recorte.js     remoção de fundo no navegador
  composicao.js  montagem da arte final
  imagem.js      utilitários de imagem
assets/css/producao.css                    estilos do wizard
```

## Passo a passo

### 1. Criar o projeto
Em <https://supabase.com/dashboard>, crie um projeto. Anote o **Project ref** (aparece na URL do painel)
e, em **Project Settings → API**, a **Project URL** e a chave **anon** (ou **publishable**).

### 2. Criar as tabelas e o bucket
Abra o **SQL Editor**, cole o conteúdo de `migrations/20261019120000_producao.sql` e execute.
Isso cria:
- `equipe`: quem pode usar a Produção e o limite diário de cada pessoa;
- `producoes`: histórico das gerações;
- `producoes_hoje()`: contagem de gerações do dia;
- o bucket privado `producoes`, com as regras de acesso.

### 3. Chaves das IAs (gratuitas)
**Gemini (análise do look):** crie uma chave em <https://aistudio.google.com/apikey>.
O plano gratuito basta, sem faturamento.

**Cloudflare Workers AI (fundo de tecidos):**
1. Crie uma conta gratuita em <https://dash.cloudflare.com/sign-up>.
2. Copie o **Account ID**: ele aparece em *Workers & Pages* → *Overview*, na lateral direita, ou na URL
   do painel (`dash.cloudflare.com/<ACCOUNT_ID>/...`).
3. Crie um token em *My Profile → API Tokens → Create Token*, usando o modelo **"Workers AI"**.
   A permissão necessária é *Account · Workers AI · Read*.

No painel do Supabase, vá em **Edge Functions → Secrets** e adicione:

| Nome | Valor | Obrigatório |
|---|---|---|
| `GEMINI_API_KEY` | chave do Google AI Studio | sim |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID da Cloudflare | sim |
| `CLOUDFLARE_API_TOKEN` | token com permissão Workers AI | sim |
| `ALLOWED_ORIGINS` | domínios do site separados por vírgula | recomendado |
| `GEMINI_TEXT_MODEL` | modelo da análise (padrão `gemini-3.8-flash`) | não |
| `CF_IMAGE_MODEL` | modelo de imagem (padrão `@cf/black-forest-labs/flux-2-klein-4b`, que aceita fotos de referência) | não |
| `CF_QUALIDADE` | `teste` (padrão: imagens ~62% menores por lado e close-ups sem a foto do look como referência, para poupar cota) ou `alta` (qualidade original) | não |
| `GERADOR_FUNDO` | `cloudflare` (padrão, gratuito) ou `gemini` (pago, exige faturamento) | não |
| `GEMINI_IMAGE_MODEL` / `GEMINI_IMAGE_SIZE` | usados só com `GERADOR_FUNDO=gemini` | não |

Os nomes dos modelos do Gemini mudam com frequência. Se o modelo configurado for descontinuado (erro 404),
a função escolhe sozinha o modelo "flash" equivalente mais novo disponível na sua conta.

A cota gratuita da Cloudflare (10.000 "neurons" por dia, renovada às 00:00 UTC) rende pouco no FLUX.2 [klein]:
em qualidade `alta` cada imagem custa cerca de 2.000 neurons, ou seja, ~5 imagens por dia (cada arte = 1 fundo + até
5 close-ups). Por isso o padrão é `CF_QUALIDADE=teste`, que reduz bastante o custo por imagem. Para voltar à qualidade
original, crie o segredo `CF_QUALIDADE` com o valor `alta` (não precisa alterar o código). Quando a cota acaba, o wizard
avisa e a geração volta a funcionar no dia seguinte.

### 4. Publicar a Edge Function
**Pelo painel:** em **Edge Functions → Deploy a new function → Via Editor**, use o nome `producao`,
cole o conteúdo de `functions/producao/index.ts` e publique. **Desligue** a opção **Verify JWT**
(Details → Function configuration): com as chaves novas do Supabase ela bloqueia as chamadas. A própria
função valida o login e a tabela `equipe`.

**Automático pelo GitHub (recomendado):** o workflow `.github/workflows/supabase-funcao.yml` publica a função
a cada push que altera `supabase/functions/`. Para ativar:
1. Crie um token pessoal em <https://supabase.com/dashboard/account/tokens>.
2. No GitHub, vá em **Settings → Secrets and variables → Actions → New repository secret**,
   com o nome `SUPABASE_ACCESS_TOKEN` e o token como valor.

**Pelo computador:** coloque `SUPABASE_ACCESS_TOKEN=sbp_...` no `.env` e rode
`python scripts/publicar_funcao.py`. É preciso ter o [Supabase CLI](https://supabase.com/docs/guides/cli).

**Ou pelo CLI manualmente:**
```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase functions deploy producao --no-verify-jwt
supabase secrets set GEMINI_API_KEY=<chave>
```

### 5. Cadastrar a equipe
1. Em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**.
   Assim ninguém consegue criar conta pelo site.
2. Em **Authentication → Users → Add user**, crie o usuário com e-mail e senha e marque **Auto Confirm**.
3. No SQL Editor, autorize o usuário:
   ```sql
   insert into public.equipe (user_id, nome, limite_diario)
   select id, 'Nome da pessoa', 20 from auth.users where email = 'pessoa@empresa.com';
   ```

### 6. Ligar o site ao projeto
Em `assets/js/producao/config.js`, preencha `supabaseUrl` e `supabaseAnonKey`.
Essa chave é pública. **Nunca** coloque ali a `service_role` nem a chave do Gemini.

### 7. Publicar e testar
O site é publicado no **GitHub Pages** pelo workflow `.github/workflows/pages.yml`, a cada push na `main`:

- Endereço: <https://samuethus.github.io/Projeto_ECOMMERCE/>
- Produção direto: <https://samuethus.github.io/Projeto_ECOMMERCE/#producao>

Configuração única no GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
O workflow publica só o `index.html` e a pasta `assets/`. As pastas `docs/`, `supabase/` e `scripts/`
ficam fora do site.

No Supabase:
- em **Edge Functions → Secrets**, defina
  `ALLOWED_ORIGINS=https://samuethus.github.io,http://localhost:8000`;
- em **Authentication → URL Configuration**, use como *Site URL*
  `https://samuethus.github.io/Projeto_ECOMMERCE/`.

Para testar no computador antes de publicar, sirva a pasta do projeto com `python -m http.server 8000`
e abra <http://localhost:8000/#producao>. O wizard usa módulos JavaScript, que **não funcionam abrindo
o `index.html` com duplo clique** (`file://`).

## Custos e limites

- **Gemini (análise):** dentro do plano gratuito, com limites de uso por minuto e por dia.
- **Cloudflare (fundo):** dentro da cota diária gratuita do Workers AI.
- **Limite diário:** cada pessoa da equipe tem um limite (`equipe.limite_diario`, padrão 20).
  "Gerar outra versão" conta como uma nova geração.
- **Supabase:** o plano gratuito atende o volume esperado. Projetos gratuitos são pausados
  após cerca de 7 dias sem uso; reative pelo painel ou use o plano Pro.

## Recorte da modelo (licença)

O recorte usa a biblioteca [`@imgly/background-removal`](https://github.com/imgly/background-removal-js),
que roda no navegador e não tem custo por imagem. Na primeira utilização, ela baixa um modelo de cerca de
40 MB, que depois fica em cache.

A licença da biblioteca é **AGPL-3.0**. Para uso comercial, avalie a licença comercial da IMG.LY
ou troque o arquivo `assets/js/producao/recorte.js` por uma API de recorte, como remove.bg ou Photoroom.
O restante do wizard não precisa mudar.
