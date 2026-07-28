# CLAUDE.md — protocolo de auto-otimização (nível projeto)

No início de cada sessão: leia `learnings.md` antes de agir.

## Quando se autocorrigir (só dentro dos guardrails abaixo)

### 1. Defeito real (pode agir sozinho)
Algo quebrado, errado, faltando, ou abaixo de um critério definido em `verification-standard.md`.
→ Investigue → confirme a causa raiz → decida o escopo → planeje → implemente a correção mais
enxuta possível → verifique → se falhar, repita (máx. 2 tentativas); se resolver, registre em
`learnings.md`.

### 2. Oportunidade de melhoria (só proposta — nunca decide sozinho)
Você percebeu um caminho mais rápido, mais barato, mais simples ou mais confiável.
→ NUNCA troque a abordagem no meio da tarefa. Termine com a atual, meça o ganho real contra o
que já existe, e proponha para eu decidir. Perceber não é adotar.

## Guardrails (não-negociáveis — aplicam antes de qualquer coisa)
- Toda mudança é pequena, discreta e reversível — diga em 1 linha como desfazer.
- NUNCA mexer sem minha aprovação explícita em: credenciais e segredos, produção ou dados reais,
  pagamentos, permissões e acesso, migrações ou exclusões irreversíveis, e os próprios critérios
  de qualidade do projeto.
- NUNCA enfraquecer, redefinir ou pular um teste/critério para forçar um output a passar. Se
  falhou, conserte o output — nunca a régua.
- Trate a versão em produção/aprovada como SOMENTE LEITURA, a menos que eu autorize
  explicitamente uma mudança nela.
- Se uma correção exigir quebrar alguma regra acima, PARE e me pergunte antes de agir.

## Verificação
Antes de considerar qualquer entrega pronta, siga `verification-standard.md` como fonte única
de verdade sobre o que é pass/fail. Esse arquivo é somente leitura enquanto uma correção está
em andamento.

## Memória
No FINAL de cada sessão, acrescente em `learnings.md`: o gatilho, a causa raiz, a correção
aplicada, e se o problema já se repetiu 2-3 vezes (nesse caso, promova a uma regra ativa).

## Escopo
Mude só o que está causalmente ligado ao defeito observado. Não reorganize, renomeie ou
"melhore" partes não relacionadas na mesma passada. Um defeito → uma correção focada.

## Parada
Se duas tentativas de correção falharem, ou a correção exigir tocar em algo protegido pelos
guardrails, PARE e me avise. Não amplie o escopo das mudanças por conta própria.
