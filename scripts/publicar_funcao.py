"""Publica a Edge Function `producao` no Supabase a partir deste computador.

Uso:  python scripts/publicar_funcao.py [caminho/do/supabase.exe]

Lê SUPABASE_ACCESS_TOKEN e SUPABASE_URL do .env (o ref do projeto vem da URL).
Requer o Supabase CLI: https://supabase.com/docs/guides/cli
"""
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def ler_env() -> dict:
    valores = {}
    for linha in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in linha and not linha.lstrip().startswith("#"):
            chave, valor = linha.split("=", 1)
            valores[chave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def main() -> None:
    env = ler_env()
    token = env.get("SUPABASE_ACCESS_TOKEN", "")
    if not token.startswith("sbp_"):
        sys.exit("SUPABASE_ACCESS_TOKEN ausente no .env (crie em supabase.com/dashboard/account/tokens).")
    ref = re.match(r"https://([a-z0-9]+)\.supabase\.co", env.get("SUPABASE_URL", ""))
    if not ref:
        sys.exit("SUPABASE_URL inválida no .env.")

    cli = sys.argv[1] if len(sys.argv) > 1 else shutil.which("supabase")
    if not cli:
        sys.exit("Supabase CLI não encontrado. Informe o caminho: python scripts/publicar_funcao.py <supabase.exe>")

    subprocess.run(
        [cli, "functions", "deploy", "producao", "--project-ref", ref.group(1), "--no-verify-jwt", "--use-api"],
        cwd=RAIZ,
        env={**os.environ, "SUPABASE_ACCESS_TOKEN": token},
        check=True,
    )


if __name__ == "__main__":
    main()
