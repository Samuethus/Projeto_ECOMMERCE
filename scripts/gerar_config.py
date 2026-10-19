"""Grava a URL e a chave pública do Supabase (lidas do .env) em assets/js/producao/config.js.

Uso:  python scripts/gerar_config.py

Recusa chaves secretas (service_role / sb_secret_): elas dariam acesso total ao banco
e não podem ir para o site.
"""
import base64
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENV = RAIZ / ".env"
CONFIG = RAIZ / "assets" / "js" / "producao" / "config.js"


def ler_env(caminho: Path) -> dict:
    if not caminho.exists():
        sys.exit(f"Arquivo {caminho.name} não encontrado. Copie .env.example para .env e preencha.")
    valores = {}
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        valores[chave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def chave_secreta(chave: str) -> bool:
    if chave.startswith("sb_secret_"):
        return True
    partes = chave.split(".")
    if len(partes) == 3:  # chave JWT antiga: confere o papel
        try:
            corpo = partes[1] + "=" * (-len(partes[1]) % 4)
            return json.loads(base64.urlsafe_b64decode(corpo)).get("role") == "service_role"
        except Exception:
            return False
    return False


def main() -> None:
    env = ler_env(ENV)
    url = env.get("SUPABASE_URL", "")
    chave = env.get("SUPABASE_ANON_KEY", "")

    if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", url.rstrip("/")):
        sys.exit("SUPABASE_URL inválida. Formato esperado: https://<ref>.supabase.co")
    if not chave or "SUA-CHAVE" in chave:
        sys.exit("SUPABASE_ANON_KEY não preenchida.")
    if chave_secreta(chave):
        sys.exit("Essa é uma chave SECRETA (service_role). Use a chave anon/publishable.")

    texto = CONFIG.read_text(encoding="utf-8")
    texto, n1 = re.subn(r"supabaseUrl: '[^']*'", f"supabaseUrl: '{url.rstrip('/')}'", texto)
    texto, n2 = re.subn(r"supabaseAnonKey: '[^']*'", f"supabaseAnonKey: '{chave}'", texto)
    if n1 != 1 or n2 != 1:
        sys.exit("Não encontrei os campos supabaseUrl/supabaseAnonKey em config.js.")
    CONFIG.write_text(texto, encoding="utf-8", newline="\n")
    print(f"config.js atualizado para {url}")


if __name__ == "__main__":
    main()
