// =============================================================================
// MARGELLE · Edge Function "producao"
// -----------------------------------------------------------------------------
// Ações (POST JSON, usuário autenticado e cadastrado em public.equipe):
//   { acao: "status" }                          → limite diário e uso de hoje
//   { acao: "analisar", imagem }                → peças, 5 cores, tecidos e close-ups
//   { acao: "gerar", imagem, analise }          → fundo do moodboard (sem a modelo)
//
// `imagem` = { mime: "image/jpeg" | "image/png" | "image/webp", data: "<base64>" }
//
// A modelo NÃO é gerada pela IA: o site recorta a foto original e a posiciona
// sobre o fundo gerado, preservando rosto e corpo sem alterações.
// =============================================================================

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.117.2";

// ---------------------------------------------------------------- configuração
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_TEXT_MODEL = Deno.env.get("GEMINI_TEXT_MODEL") || "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") || "gemini-3.1-flash-image-preview";
const GEMINI_IMAGE_SIZE = Deno.env.get("GEMINI_IMAGE_SIZE") ?? "2K"; // vazio = padrão do modelo
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim());

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// Projetos novos usam chaves `sb_secret_...` (SUPABASE_SECRET_KEYS, em JSON);
// projetos antigos usam a JWT `service_role`. Aceita as duas.
function primeiraChave(json: string | undefined): string {
  if (!json) return "";
  try {
    const obj = JSON.parse(json) as Record<string, string>;
    return obj.default ?? Object.values(obj)[0] ?? "";
  } catch {
    return "";
  }
}
const SUPABASE_SECRET_KEY = primeiraChave(Deno.env.get("SUPABASE_SECRET_KEYS")) ||
  (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const BUCKET = "producoes";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MIME_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// ---------------------------------------------------------------- tipos
type Imagem = { mime: string; data: string };

type Analise = {
  foto_adequada: boolean;
  problemas: string[];
  pecas: { nome: string; descricao: string }[];
  cores: { nome: string; hex: string }[];
  tecidos_fundo: string[];
  closeups: string[];
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- prompts
const PROMPT_ANALISE = `
You are a fashion art director preparing an Instagram moodboard post.
Analyse the attached photo of a model and answer ONLY with JSON following the schema.
Write every text value in Brazilian Portuguese.

- foto_adequada: true only if the photo shows ONE person, full body (head to feet), standing, reasonably sharp.
- problemas: short list of issues that make the photo unsuitable (empty list if none).
- pecas: each garment, shoe, bag and piece of jewelry, with a short visual description (colour, material, print).
- cores: EXACTLY 5 main colours taken exclusively from the clothes, shoes, bag and jewelry
  (never from skin, hair or background). Order from most to least dominant. "hex" must be a #RRGGBB value
  sampled from the garment as it appears in the photo. For metallic jewelry use the metal colour.
- tecidos_fundo: 3 to 5 fabric/material textures for the collage background, derived from the look
  (e.g. "seda marrom com bolinhas brancas", "jeans azul claro", "linho bege desfiado", "couro vinho").
  Include at least one neutral beige linen/cotton texture.
- closeups: 4 or 5 macro close-up details of the look for polaroid photos
  (e.g. "textura do jeans", "estampa de bolinhas da blusa", "alça e ferragem da bolsa", "scarpin nude", "pulseira dourada").
`.trim();

function promptGeracao(a: Analise): string {
  const tecidos = a.tecidos_fundo.join("; ");
  const closeups = a.closeups.map((c, i) => `${i + 1}) ${c}`).join("; ");
  const pecas = a.pecas.map((p) => `${p.nome} (${p.descricao})`).join("; ");

  return `
Create the BACKGROUND of a high-fashion editorial moodboard collage, vertical 4:5, for an Instagram post.

ABSOLUTE RULES:
- Do NOT draw any person, face, body, hands, mannequin or silhouette anywhere in the image.
- Keep the central vertical band (from about 32% to 68% of the width, full height) free of polaroids and objects:
  only the fabric background must be visible there, because the original model photo will be placed on top later.
- Keep the left-centre area (about 6% to 32% of the width and 18% to 55% of the height) free of polaroids:
  a colour-swatch card will be placed there later. Fabric background only.
- No text, no letters, no logos, no watermarks.

BACKGROUND COMPOSITION:
An artistic fashion collage of large, overlapping, softly draped fabric textures that fill the whole frame:
${tecidos}.

MOODBOARD ELEMENTS:
3 to 5 Polaroid-style photo cut-outs placed near the corners and outer edges (top-right, right side, bottom-right,
bottom-left), slightly rotated, with thin and very subtle borders in beige paper colour and soft drop shadows.
Each polaroid shows a macro close-up of one detail of the look worn in the reference photo: ${closeups}.
The garments and accessories in the close-ups must be faithful to the reference photo (same colour, print,
material and hardware). Look pieces for reference: ${pecas}.
The reference photo is ONLY a guide for garments and accessories — never reproduce the person.

STYLE AND LIGHTING:
Professional studio lighting, soft shadows, warm neutral aesthetic, clean fashion e-commerce look,
photorealistic, high resolution.
`.trim();
}

const SCHEMA_ANALISE = {
  type: "OBJECT",
  properties: {
    foto_adequada: { type: "BOOLEAN" },
    problemas: { type: "ARRAY", items: { type: "STRING" } },
    pecas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { nome: { type: "STRING" }, descricao: { type: "STRING" } },
        required: ["nome", "descricao"],
      },
    },
    cores: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { nome: { type: "STRING" }, hex: { type: "STRING" } },
        required: ["nome", "hex"],
      },
    },
    tecidos_fundo: { type: "ARRAY", items: { type: "STRING" } },
    closeups: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["foto_adequada", "problemas", "pecas", "cores", "tecidos_fundo", "closeups"],
};

// ---------------------------------------------------------------- utilitários
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function validarImagem(img: unknown): Imagem {
  const i = img as Imagem;
  if (!i || typeof i.data !== "string" || typeof i.mime !== "string") throw new HttpError(400, "Imagem não enviada.");
  if (!MIME_ACEITOS.has(i.mime)) throw new HttpError(400, "Formato de imagem não suportado (use JPG, PNG ou WebP).");
  if (i.data.length * 0.75 > MAX_IMAGE_BYTES) throw new HttpError(413, "Imagem muito grande. Envie até 6 MB.");
  return i;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function validarAnalise(a: unknown): Analise {
  const x = a as Analise;
  const lista = (v: unknown, min: number, max: number) =>
    Array.isArray(v) && v.length >= min && v.length <= max && v.every((s) => typeof s === "string" && s.trim());
  if (!x || !Array.isArray(x.cores) || x.cores.length !== 5 || !x.cores.every((c) => HEX.test(c?.hex ?? ""))) {
    throw new HttpError(400, "A paleta precisa ter exatamente 5 cores válidas.");
  }
  if (!lista(x.tecidos_fundo, 1, 6)) throw new HttpError(400, "Informe de 1 a 6 tecidos para o fundo.");
  if (!lista(x.closeups, 1, 6)) throw new HttpError(400, "Informe de 1 a 6 detalhes para os close-ups.");
  if (!Array.isArray(x.pecas)) x.pecas = [];
  return x;
}

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------- Gemini
// deno-lint-ignore no-explicit-any
async function chamarGemini(modelo: string, body: unknown): Promise<any> {
  if (!GEMINI_API_KEY) throw new HttpError(500, "GEMINI_API_KEY não configurada na função.");
  const res = await fetch(`${GEMINI_URL}/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Gemini erro", res.status, JSON.stringify(data).slice(0, 2000));
    throw new HttpError(502, `Falha no serviço de IA (${res.status}). ${data?.error?.message ?? ""}`.trim());
  }
  if (data?.promptFeedback?.blockReason) {
    throw new HttpError(422, `A IA recusou a solicitação (${data.promptFeedback.blockReason}).`);
  }
  return data;
}

async function analisar(img: Imagem): Promise<Analise> {
  const data = await chamarGemini(GEMINI_TEXT_MODEL, {
    contents: [{ role: "user", parts: [{ text: PROMPT_ANALISE }, { inline_data: { mime_type: img.mime, data: img.data } }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: SCHEMA_ANALISE },
  });
  const texto = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  try {
    const analise = JSON.parse(texto) as Analise;
    analise.cores = (analise.cores ?? []).slice(0, 5).map((c) => ({ nome: c.nome, hex: c.hex.toLowerCase() }));
    return analise;
  } catch {
    console.error("Resposta de análise inválida", texto.slice(0, 1000));
    throw new HttpError(502, "A IA devolveu uma análise inválida. Tente novamente.");
  }
}

async function gerarFundo(img: Imagem, analise: Analise): Promise<Imagem> {
  const imageConfig: Record<string, string> = { aspectRatio: "4:5" };
  if (GEMINI_IMAGE_SIZE) imageConfig.imageSize = GEMINI_IMAGE_SIZE;

  const data = await chamarGemini(GEMINI_IMAGE_MODEL, {
    contents: [{
      role: "user",
      parts: [{ text: promptGeracao(analise) }, { inline_data: { mime_type: img.mime, data: img.data } }],
    }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig },
  });

  // a imagem pode não ser a primeira "part"
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    if (inline?.data) return { mime: inline.mimeType ?? inline.mime_type ?? "image/png", data: inline.data };
  }
  const motivo = data?.candidates?.[0]?.finishReason ?? "sem imagem na resposta";
  throw new HttpError(502, `A IA não gerou a imagem (${motivo}). Tente novamente.`);
}

// ---------------------------------------------------------------- acesso
async function autenticar(req: Request, admin: SupabaseClient): Promise<User> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Faça login para usar a Produção.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    console.error("Falha ao validar sessão", error?.message);
    throw new HttpError(401, "Sessão expirada. Faça login novamente.");
  }
  return data.user;
}

async function carregarCota(admin: SupabaseClient, userId: string) {
  const { data: membro, error } = await admin.from("equipe").select("nome, limite_diario").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("Erro ao consultar equipe", error);
    throw new HttpError(500, `Erro ao consultar a equipe: ${error.message}`);
  }
  if (!membro) throw new HttpError(403, "Seu usuário não tem acesso à Produção.");
  const { data: usadas, error: e2 } = await admin.rpc("producoes_hoje", { p_user: userId });
  if (e2) {
    console.error("Erro em producoes_hoje", e2);
    throw new HttpError(500, `Erro ao consultar o limite diário: ${e2.message}`);
  }
  return { nome: membro.nome as string, limite: membro.limite_diario as number, usadas: (usadas as number) ?? 0 };
}

// ---------------------------------------------------------------- handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { erro: "Método não permitido." });

  try {
    if (!SUPABASE_SECRET_KEY) throw new HttpError(500, "Chave secreta do Supabase indisponível na função.");
    const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await autenticar(req, admin);
    const cota = await carregarCota(admin, user.id);
    const body = await req.json().catch(() => ({}));

    switch (body.acao) {
      case "status":
        return json(req, 200, { nome: cota.nome, limite: cota.limite, usadas: cota.usadas });

      case "analisar": {
        const img = validarImagem(body.imagem);
        const analise = await analisar(img);
        return json(req, 200, { analise });
      }

      case "gerar": {
        if (cota.usadas >= cota.limite) {
          throw new HttpError(429, `Limite diário de ${cota.limite} imagens atingido. Tente novamente amanhã.`);
        }
        const img = validarImagem(body.imagem);
        const analise = validarAnalise(body.analise);
        const fundo = await gerarFundo(img, analise);

        const id = crypto.randomUUID();
        const ext = fundo.mime === "image/jpeg" ? "jpg" : fundo.mime === "image/webp" ? "webp" : "png";
        const fundoPath = `${user.id}/${id}/fundo.${ext}`;

        const up = await admin.storage.from(BUCKET).upload(fundoPath, base64ParaBytes(fundo.data), {
          contentType: fundo.mime,
          upsert: false,
        });
        if (up.error) console.error("Falha ao salvar fundo", up.error.message);

        const ins = await admin.from("producoes").insert({
          id,
          user_id: user.id,
          analise,
          modelo_ia: GEMINI_IMAGE_MODEL,
          fundo_path: up.error ? null : fundoPath,
        });
        if (ins.error) console.error("Falha ao registrar produção", ins.error.message);

        return json(req, 200, {
          id,
          fundo,
          restantes: Math.max(0, cota.limite - cota.usadas - 1),
        });
      }

      default:
        throw new HttpError(400, "Ação inválida.");
    }
  } catch (err) {
    if (err instanceof HttpError) return json(req, err.status, { erro: err.message });
    console.error(err);
    return json(req, 500, { erro: "Erro inesperado. Tente novamente." });
  }
});
