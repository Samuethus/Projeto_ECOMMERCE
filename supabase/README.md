# Produção de conteúdo · Configuração do Supabase

O menu **Produção** do site abre um wizard que monta posts de Instagram (4:5, 1080 × 1350):

1. A pessoa da equipe faz login e envia a foto da modelo.
2. O navegador recorta a modelo da foto original. Rosto e corpo não passam pela IA.
3. A Edge Function `producao` pede ao Gemini uma análise do look: peças, 5 cores, tecidos e close-ups.
   A pessoa revisa e edita o resultado.
4. A função pede ao Gemini o **fundo** do moodboard (tecidos e polaroids, sem pessoa) e salva no Storage.
5. O navegador monta a arte final (fundo + cartão de cores + modelo recortada) e libera o download.

```
supabase/
  config.toml                              configuração mínima do CLI
  migrations/20261019120000_producao.sql   tabelas, RLS, função de limite e bucket
  functions/producao/index.ts              Edge Function (chama o Gemini)
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

### 3. Chave do Gemini
Crie uma chave em <https://aistudio.google.com/apikey>, num projeto do Google com faturamento ativo,
porque a geração de imagens é paga. No painel do Supabase, vá em **Edge Functions → Secrets** e adicione:

| Nome | Valor | Obrigatório |
|---|---|---|
| `GEMINI_API_KEY` | chave do Google AI Studio | sim |
| `GEMINI_IMAGE_MODEL` | modelo de imagem (padrão `gemini-3.1-flash-image-preview`) | não |
| `GEMINI_TEXT_MODEL` | modelo da análise (padrão `gemini-3.8-flash`) | não |
| `GEMINI_IMAGE_SIZE` | `1K`, `2K` ou `4K` (padrão `2K`; deixe vazio se o modelo não aceitar) | não |
| `ALLOWED_ORIGINS` | domínios do site separados por vírgula, ex. `https://margelle.com.br` | recomendado |

Os nomes dos modelos do Gemini mudam com frequência. Se o modelo configurado for descontinuado (erro 404),
a função escolhe sozinha o modelo "flash" equivalente mais novo disponível na sua conta. Para fixar um modelo,
use os secrets acima (lista oficial: <https://ai.google.dev/gemini-api/docs/models>).

### 4. Publicar a Edge Function
**Pelo painel:** em **Edge Functions → Deploy a new function → Via Editor**, use o nome `producao`,
cole o conteúdo de `functions/producao/index.ts` e publique. **Desligue** a opção **Verify JWT**
(Details → Function configuration): com as chaves novas do Supabase ela bloqueia as chamadas. A própria
função valida o login e a tabela `equipe`.

**Ou pelo CLI** (requer o [Supabase CLI](https://supabase.com/docs/guides/cli)):
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

- **Gemini:** cerca de US$ 0,04 a 0,15 por imagem gerada (confira a tabela atual do Google).
  A análise custa uma fração de centavo.
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
