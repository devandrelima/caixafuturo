# Critérios de aceite visual e UX

## Inspeção obrigatória em cada task de interface
1. **Fidelidade:** comparar com README/tokens/tela correspondente: fundo creme, sidebar areia, cards claros arredondados, acento dourado contido, textos grafite, espaço negativo e toques cartoonescos originais **somente onde agregam**. Sem copiar marcas ou mascotes. Sem estilos inline arbitrários que criem paletas paralelas.
2. **Larguras:** capturas reais em **390×844** (mobile), **768×1024** (tablet) e **1440×900** (desktop), em viewport de navegador, sem rolagem horizontal da página. Se não houver navegador/captura disponível, registrar **não verificado**, sem alegar aprovação visual.
3. **Navegação:** foco aparente, Tab/Shift+Tab em ordem lógica, Enter/Espaço nos botões, Escape fecha diálogo/menu e devolve foco; acessibilidade do menu mobile; nenhuma ação aparentemente clicável é inerte.
4. **Contraste:** texto normal >=4.5:1, texto grande >=3:1, sinais e gráficos importantes >=3:1 sobre o fundo; texto de botão primário grafite sobre dourado. Ícones acompanhados de rótulo acessível. **Não depender de verde/vermelho como único sinal**.
5. **Dinheiro e datas:** valor BRL legível, datas da data-base claras, saldo real informado e saldo futuro projetado distintos; data/valor do déficit correlacionados ao motor. Nenhum número estático de demo no dashboard.
6. **Estados reais:** vazio, preenchido, erro por campo, importação inválida, reimportação/duplicação, erro de armazenamento, sucesso, sem risco, alerta abaixo do mínimo, saldo negativo, loading/saving e demo sintética identificada.
7. **Ergonomia:** controles interativos >=44px, texto base 16px, tabela legível com rolagem contida em mobile, zoom do navegador 200%, `prefers-reduced-motion` respeitado.
8. **Performance e dependências:** evitar imagens pesadas, vídeos, animações infinitas, fontes CDN obrigatórias, UI framework sem motivo. Não adicionar pacote de UI ou gráficos sem justificar no relatório da task.
9. **Roteiro E2E de S01:** primeiro acesso → escolher demo → saldo e risco esperado → ver origem na tabela/calendário → cadastrar ou editar uma conta → gráfico muda → importar CSV inválido → erro por linha → importar CSV válido duas vezes → segundo lote não duplica → recarregar navegador → dados permanecem.

## Evidência verificável
Cada task UI registra habilidades disponíveis e seleção/fallback. Capturas de tela de três viewports e estados de risco ficam em `docs/evidencias/` ou como artefatos de CI identificados no relatório, **somente após realmente capturadas**. Revisar lado a lado com guia e salvar checklist com: critério, aprovado/reprovado/não verificado, evidência, responsável e correção. Medição de cobertura automatizada **não substitui** inspeção visual. A sprint não é declarada aprovada antes de feedback humano e testes.

## Critérios objetivos de bloqueio
- Valor ou risco mostrado diverge do domínio.
- CTA de importação simula sucesso sem gravar.
- Menu ou modal não acessível por teclado.
- Tela mobile exige scroll horizontal para alcançar navegação/CTAs.
- Contraste insuficiente em informação crítica.
- Mascote/ícones/branding copiados das referências, ou visual predominantemente infantil.
- UI exibe páginas de funcionalidades futuras como se estivessem prontas.
