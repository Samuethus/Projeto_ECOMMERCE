/* MARGELLE · Produção — comunicação com o Supabase (login, função e storage) */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { CONFIG } from './config.js';

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export async function sessaoAtual() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function entrar(email, senha) {
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
}

export async function sair() {
  await supabase.auth.signOut();
}

async function chamar(acao, payload = {}) {
  const { data, error } = await supabase.functions.invoke(CONFIG.funcao, { body: { acao, ...payload } });
  if (error) {
    // o corpo de erro da função traz a mensagem amigável em { erro }
    let mensagem = 'Não foi possível concluir. Tente novamente.';
    try {
      const corpo = await error.context?.json?.();
      if (corpo?.erro) mensagem = corpo.erro;
    } catch { /* mantém mensagem padrão */ }
    throw new Error(mensagem);
  }
  return data;
}

export const status = () => chamar('status');
export const analisar = (imagem) => chamar('analisar', { imagem });
export const gerar = (imagem, analise) => chamar('gerar', { imagem, analise });

/* Salva a arte final no Storage e registra no histórico (melhor esforço) */
export async function salvarFinal(producaoId, blob) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return;
  const path = `${u.user.id}/${producaoId}/final.jpg`;
  const up = await supabase.storage.from(CONFIG.bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw up.error;
  await supabase.from('producoes').update({ final_path: path }).eq('id', producaoId);
}
