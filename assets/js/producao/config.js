/* MARGELLE · Produção — configuração do Supabase
   Preencha com os dados do projeto (Supabase → Project Settings → API).
   A chave "anon"/"publishable" é pública por natureza: o acesso real é
   controlado pelo login, pelas regras RLS e pela tabela `equipe`.
   NUNCA coloque aqui a chave service_role nem a chave do Gemini. */
export const CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'SUA-CHAVE-ANON-OU-PUBLISHABLE',
  funcao: 'producao',
  bucket: 'producoes',

  /* Arte final (Instagram 4:5) */
  saida: { largura: 1080, altura: 1350, qualidadeJpg: 0.92 },

  /* Foto enviada à IA: maior lado em px (menos tráfego e custo) */
  envioMaxLado: 1600,
  /* Foto usada no recorte da modelo: maior lado em px */
  recorteMaxLado: 2200,
  /* Altura mínima aceita para a foto da modelo */
  fotoMinAltura: 900,
};

export const configurado = () =>
  !CONFIG.supabaseUrl.includes('SEU-PROJETO') && !CONFIG.supabaseAnonKey.startsWith('SUA-');
