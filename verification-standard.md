# verification-standard.md — Fio
# [deterministic, re-runnable, read-only while an output is being fixed]

## Acceptance criteria (pass/fail, never scores)

### Navegação e UI
- Todo botão, link e ícone clicável executa a ação esperada — nenhum "morto" (sem handler).
- Nenhum elemento sobrepõe outro (texto sobre imagem, botão cobrindo campo, etc).
- O fluxo compromissos → tarefas → documentos funciona de ponta a ponta sem travar em nenhuma etapa.
- Testado e funcional em tela de celular (viewport estreito) — já que o Fio é mobile-first.

### Módulo financeiro (importação CSV/XML)
- Um arquivo CSV/XML de exemplo importa sem erro no console.
- O total somado dos lançamentos importados bate exatamente com o total do arquivo original.
- Nenhum lançamento duplicado após importar o mesmo arquivo duas vezes (ou o sistema bloqueia/avisa a duplicata).
- Datas e valores aparecem no formato e moeda corretos (sem erro de parsing tipo vírgula/ponto trocados).

### Persistência de dados (localStorage)
- Dados inseridos continuam presentes após recarregar a página (F5).
- Fechar e reabrir o navegador não apaga dados salvos.
- Limite de armazenamento do localStorage não é excedido silenciosamente (se chegar perto do limite, o app avisa, não perde dado sem avisar).

### Deploy (GitHub Pages)
- A versão publicada carrega sem erro no console do navegador.
- Nenhuma referência quebrada (CSS, JS, imagem) na versão publicada.

## How to run the check
1. Abrir o app publicado (ou local) num navegador com o console de desenvolvedor aberto.
2. Percorrer manualmente o fluxo compromissos → tarefas → documentos, clicando em cada botão visível.
3. Importar um arquivo CSV/XML de teste (usar um arquivo real do Fio, não fictício) e conferir o total contra o arquivo original.
4. Recarregar a página e confirmar que os dados persistem.
5. Repetir os passos 2-4 numa tela estreita (simulando celular) usando o modo responsivo do navegador.
6. Sempre que possível, um segundo revisor com contexto limpo (outra sessão do Claude, sem ver o código que fez a mudança) repete os passos 1-5 de forma independente.

## Baseline
- A última versão publicada no GitHub Pages que passou em todos os critérios acima é o baseline.
- Qualquer nova mudança que fizer o app regredir em relação a esse baseline (algo que funcionava e parou de funcionar) é tratado como FAIL, mesmo que a nova funcionalidade pedida esteja funcionando.

## Output of a check run
- PASS/FAIL por critério, listado individualmente (não uma nota geral).
- Em caso de FAIL: anexar a evidência (print, mensagem de erro, ou comando rodado) + descrição do defeito em `learnings.md`, depois disparar o ciclo de correção do `CLAUDE.md`.
