#!/usr/bin/env python3
"""Valida fronteiras declaradas das tasks e risco cross-origin da S02.

Validação estática: não aplica permissões reais sobre agentes ou arquivos.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs/especificacao"

def task(path: str) -> dict:
    return json.loads((SPEC / path).read_text(encoding="utf-8"))

def check() -> int:
    issues: list[str] = []
    t02 = task("sprints/S01/tasks/T05.json")
    t03 = task("sprints/S01/tasks/T06.json")
    s02 = task("sprints/S02/tasks/T02.json")
    s02_ui = task("sprints/S02/tasks/T04.json")
    demo = "src/demo/restaurant.ts"
    demo_test = "src/demo/__tests__/restaurant.test.ts"
    app = "src/app/App.tsx"
    expected_t02 = {demo, demo_test, app, "README.md"}
    if not expected_t02.issubset(set(t02["writes"])):
        issues.append("S01 T02 deve possuir fixture, teste da fixture, App e README em writes")
    if "docs/especificacao/contratos/demo-s01.md" not in t02["context"]:
        issues.append("S01 T02 sem contrato de dados da demonstração")
    if not any(demo_test in x for x in t02["tests"]):
        issues.append("S01 T02 sem comando para teste unitário da fixture")
    if t02["id"] not in t03["depends_on"]:
        issues.append("S01 T03 precisa depender da T02")
    for file in (demo, demo_test, app):
        if file not in t03.get("reads", []):
            issues.append(f"S01 T03 precisa ler o artefato criado pela T02: {file}")
    allowed_t03 = {
        "tests/e2e/cash-flow.spec.ts",
        "docs/evidencias/s01.md",
        "docs/evidencias/s01-visual.md",
    }
    if set(t03["writes"]) != allowed_t03:
        issues.append("S01 T03 deve escrever somente E2E, revisão visual e evidências")
    if set(t02["writes"]) & set(t03["writes"]):
        issues.append("S01 T02 e T03 têm conflito de escrita")
    docker = task("sprints/S01/tasks/T08.json")
    if docker["id"] != "S01-P02-T05":
        issues.append("S01 T08.json deve ser S01-P02-T05 (Docker)")
    for required in ("Dockerfile", "compose.yaml", ".dockerignore", "docker/nginx.conf", "README.md"):
        if required not in docker["writes"]:
            issues.append(f"Task Docker sem {required} em writes")
    if any(w.startswith("src/") for w in docker["writes"]):
        issues.append("Task Docker não pode escrever em src/")
    if docker["id"] not in t03["depends_on"]:
        issues.append("S01 T03 precisa depender da task Docker")
    if "S01-P02-T04" not in docker["depends_on"]:
        issues.append("Task Docker precisa depender da fundação visual (S01-P02-T04)")
    if set(docker["writes"]) & set(t03["writes"]):
        issues.append("Task Docker e T03 têm conflito de escrita")
    pending = "docs/especificacao/pendencias/S02-conciliacao-recebiveis.md"
    if not (ROOT / pending).is_file():
        issues.append("Pendência de conciliação da S02 ausente")
    for name, value in (("S02-P01-T02", s02), ("S02-P02-T02", s02_ui)):
        if pending not in value.get("context", []):
            issues.append(f"{name} não carrega pendência de conciliação em contexto")
    s02_text = (SPEC / "sprints/S02/README.md").read_text(encoding="utf-8")
    if "PEND-S02-001" not in s02_text:
        issues.append("S02 README sem identificação da pendência")
    if issues:
        for issue in issues:
            print("ERRO: " + issue)
        return 1
    print("Fronteiras OK: Docker isolado em infraestrutura; T02 possui dataset e integração; T03 apenas QA/E2E/evidências; PEND-S02-001 rastreada.")
    print("Nota: a CLI não impõe permissões reais de arquivos aos executores.")
    return 0

if __name__ == "__main__":
    raise SystemExit(check())
