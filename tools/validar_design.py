#!/usr/bin/env python3
"""Validação estática da documentação de design e seus vínculos com tasks v2.

Não executa navegador, não inspeciona screenshots e não aprova interface.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs/especificacao"
DESIGN = SPEC / "design"
REQUIRED_FILES = (
    "README.md", "tokens.json", "componentes.md", "telas/S01.md",
    "evolucao.md", "qualidade.md", "REVISAO_VISUAL_MODELO.md"
)
REQUIRED_TASK_CONTEXT = {
    "docs/especificacao/design/README.md",
    "docs/especificacao/design/tokens.json",
    "docs/especificacao/design/componentes.md",
    "docs/especificacao/design/qualidade.md"
}


def luminance(color: str) -> float:
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(fg: str, bg: str) -> float:
    x, y = sorted((luminance(fg), luminance(bg)))
    return (y + 0.05) / (x + 0.05)


def check() -> int:
    failures = []
    for name in REQUIRED_FILES:
        if not (DESIGN / name).is_file():
            failures.append("Arquivo ausente: design/" + name)

    tok = json.loads((DESIGN / "tokens.json").read_text(encoding="utf-8"))
    colors = tok["colors"]
    for name, value in colors.items():
        if not isinstance(value, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            failures.append("Token de cor inválido: " + name)
    for a, b in (
        ("text", "canvas"), ("text", "surface"), ("textMuted", "surface"),
        ("accentText", "accent"), ("positive", "positiveSurface"),
        ("negative", "negativeSurface"), ("warning", "warningSurface"),
    ):
        ratio = contrast(colors[a], colors[b])
        if ratio < 4.5:
            failures.append(f"Contraste {a}/{b}: {ratio:.2f}:1 inferior a 4.5:1")

    plan = json.loads((SPEC / "plano.json").read_text(encoding="utf-8"))
    interfaces = 0
    ids = set()
    for sprint in plan["sprints"]:
        for prompt in sprint["prompts"]:
            for relative in prompt["tasks"]:
                task = json.loads((SPEC / relative).read_text(encoding="utf-8"))
                if task["id"] in ids:
                    failures.append("Task duplicada: " + task["id"])
                ids.add(task["id"])
                if task["kind"] != "interface":
                    continue
                interfaces += 1
                actual = set(task["context"])
                for missing in sorted(REQUIRED_TASK_CONTEXT - actual):
                    failures.append(f"{task['id']}: sem contexto {missing}")
                specific = "docs/especificacao/design/telas/S01.md" if sprint["id"] == "S01" else "docs/especificacao/design/evolucao.md"
                if specific not in actual:
                    failures.append(f"{task['id']}: sem contexto {specific}")
                if not task.get("design", {}).get("review") or not task.get("design", {}).get("skills_selection"):
                    failures.append(f"{task['id']}: revisão ou seleção de skills ausente")
    if "S01-P02-T04" not in ids:
        failures.append("Task da fundação visual S01-P02-T04 ausente")
    if interfaces != 7:
        failures.append(f"Esperadas 7 tasks interface (S01–S06), encontradas: {interfaces}")
    if failures:
        for issue in failures:
            print("ERRO: " + issue)
        return 1
    print(f"Design OK: {len(REQUIRED_FILES)} documentos, {len(colors)} tokens de cor, {interfaces} tasks de interface, contrastes principais >=4.5:1")
    print("Nota: validação documental, não teste de aplicativo ou revisão visual.")
    return 0


if __name__ == "__main__":
    raise SystemExit(check())
