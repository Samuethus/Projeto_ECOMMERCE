-- =============================================================================
-- MARGELLE · Produção de conteúdo para Instagram
-- Tabelas, permissões (RLS) e bucket de armazenamento usados pelo wizard
-- "Produção" e pela Edge Function `producao`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Equipe autorizada
--    Só usuários listados aqui conseguem usar a Produção (a função confere).
--    Cadastre com:  insert into public.equipe (user_id, nome) values ('<uuid>', 'Nome');
-- -----------------------------------------------------------------------------
create table if not exists public.equipe (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  nome           text not null,
  limite_diario  integer not null default 20 check (limite_diario >= 0),
  criado_em      timestamptz not null default now()
);

alter table public.equipe enable row level security;

-- cada pessoa só enxerga o próprio cadastro (o site usa para mostrar o limite)
drop policy if exists "equipe: ler o próprio cadastro" on public.equipe;
create policy "equipe: ler o próprio cadastro"
  on public.equipe for select
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2. Histórico de produções
--    A função grava uma linha a cada imagem gerada; o site atualiza
--    `final_path` depois que a arte final é montada e salva.
-- -----------------------------------------------------------------------------
create table if not exists public.producoes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  criado_em   timestamptz not null default now(),
  analise     jsonb not null,
  modelo_ia   text not null,
  fundo_path  text,
  final_path  text
);

create index if not exists producoes_user_dia_idx on public.producoes (user_id, criado_em desc);

alter table public.producoes enable row level security;

drop policy if exists "producoes: ler as próprias" on public.producoes;
create policy "producoes: ler as próprias"
  on public.producoes for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "producoes: registrar arte final" on public.producoes;
create policy "producoes: registrar arte final"
  on public.producoes for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- inserções são feitas apenas pela Edge Function (service role), sem policy de insert

-- -----------------------------------------------------------------------------
-- 3. Quantas imagens o usuário gerou hoje (fuso de São Paulo)
-- -----------------------------------------------------------------------------
create or replace function public.producoes_hoje(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.producoes
  where user_id = p_user
    and criado_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
$$;

revoke all on function public.producoes_hoje(uuid) from public, anon, authenticated;
grant execute on function public.producoes_hoje(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Storage: bucket privado `producoes`
--    Estrutura:  <user_id>/<producao_id>/fundo.png   (gravado pela função)
--                <user_id>/<producao_id>/final.jpg   (enviado pelo site)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('producoes', 'producoes', false, 15728640, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "producoes: ler arquivos da própria pasta" on storage.objects;
create policy "producoes: ler arquivos da própria pasta"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'producoes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "producoes: enviar arquivos para a própria pasta" on storage.objects;
create policy "producoes: enviar arquivos para a própria pasta"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'producoes' and (storage.foldername(name))[1] = auth.uid()::text);
