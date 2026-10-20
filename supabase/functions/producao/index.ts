// =============================================================================
// MARGELLE · Edge Function "producao"
// -----------------------------------------------------------------------------
// Ações (POST JSON, usuário autenticado e cadastrado em public.equipe):
//   { acao: "status" }                          → limite diário e uso de hoje
//   { acao: "analisar", imagem }                → peças, 5 cores, tecidos e close-ups
//   { acao: "gerar", imagem, ref, analise }     → fundo de tecidos do moodboard (conta no limite)
//   { acao: "closeup", detalhe, ref, descricao, aspecto?, tipo?, cor? } → close-up NOVO para a polaroid
//                                                (tipo "tecido" | "maos" = close-ups fixos)
//
// `imagem` = { mime: "image/jpeg" | "image/png" | "image/webp", data: "<base64>" }
// `ref` / `detalhe` = mesma forma, já reduzidos pelo site a menos de 512×512 (exigência do FLUX.2 klein)
//
// A modelo NÃO é gerada pela IA: o site recorta a foto original e a coloca sobre a arte.
// Fundo e close-ups são gerados no FLUX.2 [klein] da Cloudflare Workers AI (cota diária
// gratuita), usando a foto do look como referência. Com GERADOR_FUNDO=gemini o fundo
// usa o Gemini de imagem (exige faturamento ativo).
// =============================================================================

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.117.2";

// ---------------------------------------------------------------- configuração
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Modelos preferidos. Se o Google descontinuar algum, a função escolhe sozinha
// o modelo equivalente mais novo disponível na conta (veja `chamarModelo`).
const GEMINI_TEXT_MODEL = Deno.env.get("GEMINI_TEXT_MODEL") || "gemini-3.8-flash";
const GEMINI_IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") || "gemini-3.1-flash-image-preview";
const GEMINI_IMAGE_SIZE = Deno.env.get("GEMINI_IMAGE_SIZE") ?? "2K"; // vazio = padrão do modelo

const GERADOR_FUNDO = (Deno.env.get("GERADOR_FUNDO") || "cloudflare").toLowerCase();
// aceita o ID puro ou a URL do painel colada por engano (dash.cloudflare.com/<id>/...)
const CF_ACCOUNT_ID = (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "").match(/[0-9a-f]{32}/i)?.[0] ?? "";
const CF_API_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";
const CF_IMAGE_MODEL = Deno.env.get("CF_IMAGE_MODEL") || "@cf/black-forest-labs/flux-2-klein-4b";
// "teste" (padrão) = imagens menores e menos referências, para gastar menos da cota gratuita.
// "alta" = qualidade original (fundo 1024×1280, close-ups ~768×864 com a foto do look como referência).
const CF_QUALIDADE = (Deno.env.get("CF_QUALIDADE") || "teste").toLowerCase() === "alta" ? "alta" : "teste";
const CF_ESCALA = CF_QUALIDADE === "alta" ? 1 : 0.625; // fator linear; área ≈ 39% no modo teste
const CF_CLOSEUP_COM_LOOK = CF_QUALIDADE === "alta";
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
const TEMPORARIOS = new Set([429, 500, 503, 504]);

// ---------------------------------------------------------------- tipos
type Imagem = { mime: string; data: string };

type Analise = {
  foto_adequada: boolean;
  problemas: string[];
  pecas: { nome: string; descricao: string }[];
  cores: { nome: string; hex: string }[];
  tecidos_fundo: string[];
  /* tecido/estampa mais marcante da roupa (base dos detalhes do "Padrão Creme/Bege") */
  tecido_principal?: string;
  /* escolhido no site: "creme" (padrão) ou "tecidos" */
  estilo_fundo?: "creme" | "tecidos";
  /* caixa = [ymin, xmin, ymax, xmax] normalizada 0–1000 sobre a foto enviada */
  closeups: { descricao: string; caixa: number[] }[];
  /* área limpa do tecido principal (referência do close-up fixo de tecido ondulado) */
  tecido_caixa?: number[];
  /* cor das unhas (close-up fixo de mãos) */
  unhas?: { hex: string; nome: string; caixa: number[] };
};

class HttpError extends Error {
  constructor(public status: number, message: string, public statusIA?: number) {
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
- tecido_principal: the single most distinctive fabric/print of the main garment, described for an image generator
  (e.g. "algodão off-white com estampa de cavalos caramelo", "seda marrom com bolinhas brancas").
- tecido_caixa: bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000 of a clean, flat area of the main garment
  fabric (no skin, no accessories), at least 150 units wide and tall.
- unhas: the nail polish of the model. hex = #RRGGBB sampled from the painted nails as they appear in the photo;
  nome = short colour name in Portuguese (e.g. "nude rosado", "vermelho", "francesinha");
  caixa = bounding box of the hand that best shows the nails. If the nails are not visible, guess the most likely
  polish for this look (e.g. a nude) and return caixa as an empty list.
- closeups: 4 or 5 details of the look that will be CROPPED from this photo for polaroid close-ups.
  The first 4 items of the list are used in the final art, so ORDER MATTERS.
  Do NOT include nails nor a plain fabric swatch: those two close-ups are always made separately.
  FIRST look for these priority details, in this order, and include every one that is clearly visible in the photo:
    1. shoes ("sapatos");
    2. earrings ("brincos");
    3. necklace ("colar");
    4. bag and its hardware ("bolsa");
    5. bracelet or watch ("pulseira/relógio");
    6. rings ("anéis");
    7. bows ("laços");
    8. brooches and other accessories — belt, hair clip, scarf ("broches/adereços");
    9. dress or skirt hem ("barra do vestido/saia");
    10. sleeve — cuff, puff, ruffle, buttons ("manga").
  Put the priority details found at the top of the list, in the order above.
  ONLY IF fewer than 4 priority details are visible, complete the list with other details of the look
  (e.g. "estampa da blusa", "textura do jeans"), preferring accessories and textures.
  Never include a detail that is not clearly visible, and avoid the face. For each one give:
    descricao: short label;
    caixa: bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000 over this image, tight around the detail
    (for prints/textures choose a clean area of the garment, at least 120 units wide and tall).
`.trim();

/* Fundo: sem pessoas nem objetos. Polaroids, cartão de cores e modelo são montados no site.
   estilo "creme"   → colagem rústica creme/bege: papel rasgado, trama natural, flores secas
                      e dobras do tecido principal do look nas bordas
   estilo "tecidos" → colagem com os tecidos listados na análise (editáveis) */
function promptFundo(a: Analise, comReferencia = false): string {
  const comum = `
Soft professional studio lighting, gentle shadows between the layers, warm neutral editorial aesthetic,
high-end fashion e-commerce look, photorealistic, sharp detail.
The centre of the frame shows mostly calm fabric, so a photo of a model can be placed on top later.
No people, no faces, no hands, no mannequins, no clothes being worn, no shoes, no bags, no jewellery,
no accessories, no objects, no photos, no polaroids, no cards, no text, no logos.`;

  if (a.estilo_fundo !== "tecidos") {
    const destaque = (a.tecido_principal || a.tecidos_fundo[0] || "the main print of the outfit").trim();
    const ref = comReferencia
      ? "Use image 0 ONLY as reference for the main garment fabric and its print; never reproduce the person.\n"
      : "";
    return `
${ref}Rustic handmade flat-lay fashion moodboard background, vertical composition, seen from above,
in a warm CREAM AND BEIGE palette that mixes fabric, paper and dried flowers, like a scrapbook collage.
Base: warm cream textured paper and raw natural linen covering the whole frame.
Layered on top, mostly towards the edges and corners:
- large torn paper pieces with ragged fibrous edges in ivory, sand and beige, plus one or two kraft-brown torn pieces
  in the lower right area, overlapping at different angles;
- a patch of chunky natural woven jute / bouclé knit texture in the upper-left corner, continuing down the left edge;
- soft draped folds of the main garment fabric: ${destaque} — same colour, print and texture as the outfit —
  along the right edge, in the top-right corner and in the bottom-right corner, about 15 to 20% of the frame;
- a few delicate sprigs of dried baby's breath and tiny white wildflowers with thin olive-brown stems,
  lying flat near the left edge (middle and bottom) and near the right edge.
The centre of the frame stays calm and light (plain cream paper and soft torn paper), so a photo of a model
can be placed on top later. Keep the overall image light, warm and creamy; avoid dark or saturated areas.
Soft professional studio lighting, gentle realistic shadows under the paper and fabric layers,
photorealistic, sharp texture detail, high-end fashion e-commerce look.
No people, no faces, no hands, no mannequins, no clothes being worn, no shoes, no bags, no jewellery,
no accessories, no other objects, no photos, no polaroids, no cards, no paint swatches, no text, no logos.`.trim();
  }

  const tecidos = a.tecidos_fundo.join("; ");
  const ref = comReferencia
    ? "Use image 0 ONLY as reference for the colours, prints and materials of the outfit — " +
      "recreate those fabrics as loose swatches; never reproduce the person.\n"
    : "";
  return `
${ref}Flat-lay fashion moodboard background, vertical composition, seen from above.
Large overlapping, softly draped and folded fabric swatches filling the entire frame edge to edge: ${tecidos}.
Realistic macro fabric textures (weave, frayed edges, leather grain, prints).
${comum}`.trim();
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
    tecido_principal: { type: "STRING" },
    closeups: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          descricao: { type: "STRING" },
          caixa: { type: "ARRAY", items: { type: "INTEGER" } },
        },
        required: ["descricao", "caixa"],
      },
    },
    tecido_caixa: { type: "ARRAY", items: { type: "INTEGER" } },
    unhas: {
      type: "OBJECT",
      properties: {
        hex: { type: "STRING" },
        nome: { type: "STRING" },
        caixa: { type: "ARRAY", items: { type: "INTEGER" } },
      },
      required: ["hex", "nome", "caixa"],
    },
  },
  required: [
    "foto_adequada", "problemas", "pecas", "cores", "tecidos_fundo", "tecido_principal", "closeups",
    "tecido_caixa", "unhas",
  ],
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
  x.estilo_fundo = x.estilo_fundo === "tecidos" ? "tecidos" : "creme";
  if (!Array.isArray(x.tecidos_fundo)) x.tecidos_fundo = [];
  if (x.estilo_fundo === "tecidos" && !lista(x.tecidos_fundo, 1, 6)) {
    throw new HttpError(400, "Informe de 1 a 6 tecidos para o fundo.");
  }
  x.tecido_principal = String(x.tecido_principal ?? "").slice(0, 200);
  if (!Array.isArray(x.pecas)) x.pecas = [];
  if (!Array.isArray(x.closeups)) x.closeups = [];
  return x;
}

function bytesParaBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ParaBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------- Gemini
// deno-lint-ignore no-explicit-any
async function chamarGemini(modelo: string, body: unknown): Promise<any> {
  if (!GEMINI_API_KEY) throw new HttpError(500, "GEMINI_API_KEY não configurada na função.");
  const corpo = JSON.stringify(body);
  let res: Response;
  // deno-lint-ignore no-explicit-any
  let data: any;
  // erros temporários (sobrecarga/limite de taxa): até 3 tentativas com espera crescente
  for (let tentativa = 1; ; tentativa++) {
    res = await fetch(`${GEMINI_URL}/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: corpo,
    });
    data = await res.json().catch(() => ({}));
    if (!TEMPORARIOS.has(res.status) || semCota(res.status, data) || tentativa === 3) break;
    console.warn(`Gemini ${modelo} respondeu ${res.status}; nova tentativa ${tentativa + 1}/3`);
    await new Promise((r) => setTimeout(r, tentativa * 2000));
  }
  if (!res.ok) {
    console.error("Gemini erro", modelo, res.status, JSON.stringify(data).slice(0, 2000));
    const detalhe = String(data?.error?.message ?? "").slice(0, 400);
    if (semCota(res.status, data)) {
      throw new HttpError(
        402,
        `Sem cota na API do Gemini para o modelo ${modelo}. A geração de imagens exige faturamento ativo ` +
          `na chave (Google AI Studio → Billing). Detalhe: ${detalhe}`,
        res.status,
      );
    }
    throw new HttpError(502, `Falha no serviço de IA (${res.status}, ${modelo}). ${detalhe}`.trim(), res.status);
  }
  if (data?.promptFeedback?.blockReason) {
    throw new HttpError(422, `A IA recusou a solicitação (${data.promptFeedback.blockReason}).`);
  }
  return data;
}

/* 429 por cota esgotada/inexistente (ex.: plano gratuito sem acesso a imagens) não é passageiro */
// deno-lint-ignore no-explicit-any
function semCota(status: number, data: any): boolean {
  const msg = String(data?.error?.message ?? "").toLowerCase();
  return status === 429 && (msg.includes("quota") || (data?.error?.status === "RESOURCE_EXHAUSTED" && msg.includes("limit")));
}

// ---- escolha automática de modelo ------------------------------------------
type TipoModelo = "texto" | "imagem";

const MODELOS: Record<TipoModelo, { preferido: string; padrao: RegExp }> = {
  texto: { preferido: GEMINI_TEXT_MODEL, padrao: /^gemini-(\d+(?:\.\d+)?)-flash(-preview)?$/ },
  imagem: { preferido: GEMINI_IMAGE_MODEL, padrao: /^gemini-(\d+(?:\.\d+)?)-flash-image(-preview)?$/ },
};

// modelo efetivamente em uso (fica em memória enquanto a função estiver "quente")
const emUso: Partial<Record<TipoModelo, string>> = {};

async function listarModelos(): Promise<string[]> {
  const res = await fetch(`${GEMINI_URL}?pageSize=1000`, { headers: { "x-goog-api-key": GEMINI_API_KEY } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Falha ao listar modelos", res.status, JSON.stringify(data).slice(0, 500));
    return [];
  }
  // deno-lint-ignore no-explicit-any
  return (data.models ?? []).filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
    // deno-lint-ignore no-explicit-any
    .map((m: any) => String(m.name).replace(/^models\//, ""));
}

/* maior versão primeiro; na mesma versão, a estável antes da preview */
function melhorModelo(nomes: string[], padrao: RegExp): string | undefined {
  return nomes
    .map((n) => ({ n, m: n.match(padrao) }))
    .filter((x) => x.m)
    .sort((a, b) => parseFloat(b.m![1]) - parseFloat(a.m![1]) || Number(!!a.m![2]) - Number(!!b.m![2]))[0]?.n;
}

// deno-lint-ignore no-explicit-any
async function chamarModelo(tipo: TipoModelo, body: unknown): Promise<{ data: any; modelo: string }> {
  const atual = emUso[tipo] ?? MODELOS[tipo].preferido;
  try {
    return { data: await chamarGemini(atual, body), modelo: atual };
  } catch (err) {
    if (!(err instanceof HttpError) || !err.statusIA || err.status === 402) throw err;
    const descontinuado = err.statusIA === 404;
    const sobrecarregado = TEMPORARIOS.has(err.statusIA);
    if (!descontinuado && !sobrecarregado) throw err;

    // 404 → o equivalente mais novo; sobrecarga → o melhor modelo diferente do atual
    const candidatos = (await listarModelos()).filter((n) => n !== atual);
    const substituto = melhorModelo(candidatos, MODELOS[tipo].padrao);
    if (!substituto) throw err;
    console.warn(`Modelo ${atual} ${descontinuado ? "indisponível" : "sobrecarregado"}; usando ${substituto}`);
    if (descontinuado) emUso[tipo] = substituto; // sobrecarga é passageira: não troca de vez
    try {
      return { data: await chamarGemini(substituto, body), modelo: substituto };
    } catch (err2) {
      if (err2 instanceof HttpError && err2.status !== 402 && err2.statusIA && TEMPORARIOS.has(err2.statusIA)) {
        throw new HttpError(
          503,
          `O serviço de IA está sobrecarregado no momento (${atual} e ${substituto}). Aguarde 1 minuto e tente novamente.`,
        );
      }
      throw err2;
    }
  }
}

async function analisar(img: Imagem): Promise<Analise> {
  const { data } = await chamarModelo("texto", {
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

async function gerarFundo(img: Imagem, ref: Imagem | null, analise: Analise): Promise<{ fundo: Imagem; modelo: string }> {
  if (GERADOR_FUNDO === "gemini") return await gerarFundoGemini(img, analise);
  const largura = Math.round((1024 * CF_ESCALA) / 16) * 16;
  const altura = Math.round((1280 * CF_ESCALA) / 16) * 16;
  const fundo = await chamarCloudflare(promptFundo(analise, !!ref), ref ? [ref] : [], largura, altura);
  return { fundo, modelo: CF_IMAGE_MODEL };
}

/* Close-up de polaroid: imagem NOVA gerada a partir do detalhe recortado (imagem 0)
   e da foto do look inteiro (imagem 1), fiel a cor, material, estampa e ferragens.
   `aspecto` (largura/altura) = proporção da polaroid onde o close-up será colocado.
   tipo "tecido" → tecido ondulado na cor principal; "maos" → mãos com as unhas na cor `cor`. */
type TipoCloseup = "detalhe" | "tecido" | "maos";

function promptCloseup(tipo: TipoCloseup, descricao: string, cor: string, comLook: boolean): string {
  if (tipo === "tecido") {
    return `
Editorial macro close-up photograph of softly rippling, wavy draped fabric filling the whole frame: ${descricao}.
The fabric colour is exactly ${cor || "the main colour of the garment"}, the main colour of the garment in image 0,
with the same material, sheen, weave and print. Deep soft folds and gentle flowing waves catching the light.
Soft natural studio light, shallow depth of field, warm neutral tones, high-end fashion e-commerce look, photorealistic.
No people, no body parts, no objects, no text, no logos, no watermark, no frame or border.
`.trim();
  }
  if (tipo === "maos") {
    return `
Editorial close-up photograph of a woman's elegant, relaxed hands, cropped tightly${
      comLook ? ", with exactly the same skin tone as the model in image 1" : ""}.
Well-groomed manicured nails painted in exactly this colour: ${cor}, same shade, finish and nail shape
as the nails in image 0. Anatomically correct hands, five fingers each, natural pose, gently resting on or holding
the fabric of the outfit${comLook ? " shown in image 1" : ""}; rings or bracelets only if worn in the photo.
Soft natural studio light, shallow depth of field, warm neutral tones, high-end fashion e-commerce look, photorealistic.
Never show a face. No text, no logos, no watermark, no frame or border.
`.trim();
  }
  return `
Editorial macro close-up photograph of: ${descricao}.
Reproduce it exactly as it appears in image 0${comLook ? " (worn in the outfit shown in image 1)" : ""}:
same colours, material, print, texture, stitching and metal hardware. Fill the frame with the detail.
When it is a garment print or texture, show the fabric draped or folded in soft light.
When it is jewellery, a bag or shoes, it may be worn on the body or placed on fabric, cropped tightly.
Soft natural studio light, shallow depth of field, warm neutral tones, high-end fashion e-commerce look, photorealistic.
Never show a full face. No text, no logos, no watermark, no frame or border.
`.trim();
}

async function gerarCloseup(
  detalhe: Imagem,
  look: Imagem | null,
  descricao: string,
  aspecto: number,
  tipo: TipoCloseup = "detalhe",
  cor = "",
): Promise<Imagem> {
  // no modo teste a foto do look não vai como referência (cada imagem de entrada consome cota)
  if (!CF_CLOSEUP_COM_LOOK) look = null;
  const prompt = promptCloseup(tipo, descricao, cor, !!look);
  // mesma área de 768×864 (reduzida por CF_ESCALA), na proporção pedida, em múltiplos de 16
  const area = 768 * 864 * CF_ESCALA * CF_ESCALA;
  const largura = Math.round(Math.sqrt(area * aspecto) / 16) * 16;
  const altura = Math.round(Math.sqrt(area / aspecto) / 16) * 16;
  return await chamarCloudflare(prompt, look ? [detalhe, look] : [detalhe], largura, altura);
}

/* Cloudflare Workers AI (cota diária gratuita).
   FLUX.2 [klein]: multipart com até 4 imagens de referência (< 512×512) e tamanho livre.
   Outros modelos (ex.: FLUX.1 schnell): JSON só com texto, 1024×1024. */
async function chamarCloudflare(prompt: string, refs: Imagem[], largura: number, altura: number): Promise<Imagem> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new HttpError(500, "CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN não configurados na função.");
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_IMAGE_MODEL}`;
  const multipart = CF_IMAGE_MODEL.includes("flux-2");

  const montarCorpo = (): BodyInit => {
    if (!multipart) return JSON.stringify({ prompt, steps: 8 });
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", String(largura));
    form.append("height", String(altura));
    refs.slice(0, 4).forEach((r, i) => {
      form.append(`input_image_${i}`, new Blob([base64ParaBytes(r.data)], { type: r.mime }), `ref${i}.jpg`);
    });
    return form;
  };

  let res: Response | undefined;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    res = await fetch(url, {
      method: "POST",
      headers: multipart
        ? { Authorization: `Bearer ${CF_API_TOKEN}` }
        : { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: montarCorpo(),
    });
    if (!TEMPORARIOS.has(res.status) || res.status === 429 || tentativa === 3) break;
    console.warn(`Cloudflare respondeu ${res.status}; nova tentativa ${tentativa + 1}/3`);
    await new Promise((r) => setTimeout(r, tentativa * 2000));
  }

  const tipo = res!.headers.get("Content-Type") ?? "";
  // alguns modelos (ex.: SDXL) devolvem a imagem binária; os FLUX devolvem JSON com base64
  if (res!.ok && tipo.startsWith("image/")) {
    return { mime: tipo.split(";")[0], data: bytesParaBase64(new Uint8Array(await res!.arrayBuffer())) };
  }
  const data = await res!.json().catch(() => ({}));
  if (!res!.ok || !data?.success || !data?.result?.image) {
    const detalhe = String(data?.errors?.[0]?.message ?? res!.statusText ?? "").slice(0, 300);
    console.error("Cloudflare erro", res!.status, JSON.stringify(data).slice(0, 1000));
    if (res!.status === 429 || /neuron|allocation|quota|limit/i.test(detalhe)) {
      throw new HttpError(429, `Cota diária gratuita da Cloudflare esgotada. Tente novamente amanhã. (${detalhe})`);
    }
    if (res!.status === 401 || res!.status === 403) {
      throw new HttpError(500, `Token da Cloudflare inválido ou sem permissão para Workers AI. (${detalhe})`);
    }
    throw new HttpError(502, `Falha ao gerar a imagem na Cloudflare (${res!.status}). ${detalhe}`.trim());
  }
  return { mime: "image/jpeg", data: data.result.image };
}

/* Gemini (pago): usa a foto como referência de cores e materiais. */
async function gerarFundoGemini(img: Imagem, analise: Analise): Promise<{ fundo: Imagem; modelo: string }> {
  const imageConfig: Record<string, string> = { aspectRatio: "4:5" };
  if (GEMINI_IMAGE_SIZE) imageConfig.imageSize = GEMINI_IMAGE_SIZE;

  const { data, modelo } = await chamarModelo("imagem", {
    contents: [{
      role: "user",
      parts: [
        { text: `${promptFundo(analise)}\nUse the attached photo only as reference for fabric colours and materials.` },
        { inline_data: { mime_type: img.mime, data: img.data } },
      ],
    }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig },
  });

  // a imagem pode não ser a primeira "part"
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData ?? p.inline_data;
    if (inline?.data) {
      return { fundo: { mime: inline.mimeType ?? inline.mime_type ?? "image/png", data: inline.data }, modelo };
    }
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

      case "closeup": {
        // não conta no limite diário (faz parte da mesma produção), mas exige cota disponível
        if (cota.usadas >= cota.limite) {
          throw new HttpError(429, `Limite diário de ${cota.limite} imagens atingido. Tente novamente amanhã.`);
        }
        const detalhe = validarImagem(body.detalhe);
        const ref = body.ref ? validarImagem(body.ref) : null;
        const descricao = String(body.descricao ?? "").trim().slice(0, 200);
        if (!descricao) throw new HttpError(400, "Descreva o detalhe do close-up.");
        const pedido = Number(body.aspecto);
        const aspecto = Number.isFinite(pedido) ? Math.min(2, Math.max(0.5, pedido)) : 768 / 864;
        const tipo: TipoCloseup = body.tipo === "tecido" || body.tipo === "maos" ? body.tipo : "detalhe";
        const cor = String(body.cor ?? "").trim().slice(0, 60);
        const imagem = await gerarCloseup(detalhe, ref, descricao, aspecto, tipo, cor);
        return json(req, 200, { imagem });
      }

      case "gerar": {
        if (cota.usadas >= cota.limite) {
          throw new HttpError(429, `Limite diário de ${cota.limite} imagens atingido. Tente novamente amanhã.`);
        }
        const img = validarImagem(body.imagem);
        const ref = body.ref ? validarImagem(body.ref) : null;
        const analise = validarAnalise(body.analise);
        const { fundo, modelo } = await gerarFundo(img, ref, analise);

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
          modelo_ia: modelo,
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
