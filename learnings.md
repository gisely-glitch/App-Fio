# learnings.md — memória da sessão (ler primeiro, escrever por último)

## Protocolo
- LEIA este arquivo no início de cada sessão, antes de agir.
- Siga qualquer regra ativa listada abaixo.
- No FINAL da sessão, ACRESCENTE uma entrada para qualquer coisa que falhou, foi corrigida, ou merece ser lembrada.
- Mantenha as entradas enxutas: gatilho, causa raiz, correção, e se virou regra.

## Regras ativas
(promovida aqui depois que um defeito se repete 2-3 vezes — retire regras obsoletas)
- [nenhuma ainda] — ver observação "watch-list" na entrada 2026-07-26 (demo/importar.ps1):
  bug de `@(Get-Content | ConvertFrom-Json)` aninhando array em PowerShell 5.1, visto 1x
  até agora. Promover a regra ativa se se repetir mais 1-2 vezes.

## Log de sessões
### [DATA] — [título curto do problema]
- Gatilho: [o que estava sendo feito quando o problema apareceu]
- Causa raiz: [por que aconteceu]
- Correção: [a menor correção durável aplicada]
- Virou regra?: [promova para "Regras ativas" acima se essa for a 2ª-3ª ocorrência do mesmo problema]

### 2026-07-26 — criação do hello.txt (teste de auto-otimização)
- Gatilho: pedido para criar hello.txt com texto de teste e verificar via protocolo.
- Causa raiz: N/A (tarefa de verificação, não correção de defeito).
- Verificação: verification-standard.md ainda é um template sem critérios preenchidos
  (apenas placeholders "[Define the checks...]"). Na ausência de critérios formais, apliquei
  checagem objetiva mínima: (1) arquivo existe no caminho esperado, (2) conteúdo em bytes
  bate exatamente com "teste de auto-otimização funcionando" (UTF-8, confirmado via xxd,
  38 bytes, acentos ç/ã corretos). Resultado: PASS.
- Correção: nenhuma correção necessária — criação bem-sucedida na primeira tentativa.
- Virou regra?: não. Observação registrada apenas: verification-standard.md precisa ser
  preenchido com critérios reais antes que "seguir o protocolo de verificação" tenha
  significado formal — sinalizado ao usuário nesta sessão.

### 2026-07-26 — reverificação do hello.txt após verification-standard.md ser preenchido
- Gatilho: usuário preencheu verification-standard.md com critérios reais (específicos do
  app "Fio": navegação/UI, importação CSV/XML, localStorage, deploy GitHub Pages) e pediu
  para reaplicar a verificação no hello.txt.
- Causa raiz: N/A.
- Verificação: nenhum dos critérios do verification-standard.md se aplica a hello.txt —
  o arquivo não faz parte do app Fio, não é UI, não envolve importação CSV/XML, não usa
  localStorage e não é deploy. Não há seção "arquivos avulsos/texto" no standard. Em vez de
  forçar um mapeamento artificial para produzir um PASS/FAIL formal (o que violaria a regra
  de não redefinir critérios para forçar um output a passar), mantenho como resultado válido
  apenas a checagem objetiva já feita na sessão anterior: arquivo existe e conteúdo bate
  byte a byte com o texto esperado (38 bytes, UTF-8, acentos corretos). Resultado: N/A
  (critérios do standard não se aplicam) — checagem anterior permanece PASS por seus
  próprios méritos.
- Correção: nenhuma — nada a corrigir.
- Virou regra?: não. Observação: se o standard deveria cobrir arquivos avulsos fora do
  escopo do Fio, isso precisa ser decidido e adicionado pelo usuário — não presumido aqui.

### 2026-07-26 — demo/ criada e checada contra critérios de "Módulo financeiro"
- Gatilho: usuário pediu pasta demo/ com CSV de exemplo (3 lançamentos) + script de
  importação/soma, e verificação via verification-standard.md.
- Arquivos criados: demo/lancamentos.csv (delimitador ';', valores pt-BR com vírgula
  decimal: 150,50 / 1200,00 / 99,90) e demo/importar.ps1 (PowerShell — Node e Python não
  estão disponíveis no PATH deste ambiente).
- Verificação (critérios "Módulo financeiro" do verification-standard.md):
  - CSV importa sem erro no console: PASS (rodou 2x sem exception/stderr).
  - Total bate com o arquivo original: PASS — soma manual 150,50+1200,00+99,90=1450,40;
    script retornou "R$ 1.450,40" / TOTAL_RAW:1450.4.
  - Sem duplicata ao importar 2x: N/A — script é stateless (não persiste lançamentos em
    nenhum storage), então não há onde uma duplicata poderia se acumular; script não
    implementa lógica de bloqueio/aviso de duplicata. Não marcado como PASS para não
    redefinir o critério artificialmente.
  - Formato de data/moeda correto: PASS — datas DD/MM/AAAA, valores "R$ 1.450,40"
    (vírgula decimal, ponto de milhar, sem inversão).
- Correção: nenhuma — nada falhou.
- Virou regra?: não. Observação: critério de duplicata pressupõe um sistema com
  persistência (como o Fio real); para testá-lo de verdade é preciso um script/app que
  grave o estado entre execuções, não um script de importação avulso e stateless.

### 2026-07-26 — deduplicação real implementada em demo/importar.ps1 (critério 3 fechado)
- Gatilho: usuário pediu para implementar deduplicação real (mesma data + mesmo valor =
  bloqueado/avisado, não contado 2x) e reexecutar o verification-standard.md.
- Correção implementada: adicionado demo/ledger.json como estado persistido entre
  execuções. Cada lançamento gera chave "data|valor(F2)"; se a chave já está no ledger,
  o script emite Write-Warning e ignora o lançamento no total; senão, adiciona ao ledger
  e ao total acumulado.
- Defeito real encontrado e corrigido durante a implementação (2 tentativas):
  - Tentativa 1: `$ledger = @(Get-Content $ledgerPath -Raw | ConvertFrom-Json)` — bug
    real do PowerShell 5.1: quando o JSON raiz é um array, ConvertFrom-Json emite esse
    array como UM ÚNICO objeto no pipeline; o `@()` externo, aplicado sobre o pipeline
    inteiro (não sobre uma variável já materializada), embrulha esse único objeto de novo,
    produzindo um array aninhado (Count=1, cujo único item é o array de 3). Resultado:
    nenhuma chave era reconhecida no reload e a duplicata nunca era detectada (rodei 2x
    e o total dobrou silenciosamente pra R$ 2.900,80 na primeira tentativa — ver evidência
    abaixo).
  - Causa raiz: `@()` em volta de uma expressão de pipeline (`@(A | B)`) não tem o mesmo
    efeito que `@()` em volta de uma variável já atribuída (`$x = A | B; @($x)`) quando o
    comando final do pipeline já retorna um array como saída única.
  - Correção aplicada: separar em duas linhas — `$ledgerCarregado = Get-Content ... |
    ConvertFrom-Json` e depois `$ledger = @($ledgerCarregado)`.
  - Virou regra ativa: não ainda (1ª ocorrência) — anotado na watch-list em "Regras
    ativas" acima; promover de verdade se esse padrão de bug aparecer mais 1-2 vezes.
- Reverificação dos 4 critérios do "Módulo financeiro" (3 execuções seguidas do mesmo CSV,
  ledger resetado antes do teste):
  - CSV importa sem erro no console: PASS.
  - Total bate com o arquivo original: PASS — 1ª execução: R$ 1.450,40 (3 novos).
  - Sem duplicata ao importar 2x: PASS (antes N/A) — 2ª e 3ª execuções: 3 avisos de
    duplicata, 0 novos, total permanece R$ 1.450,40 (não dobrou). Critério fechado de
    verdade, com evidência de estado persistente entre execuções.
  - Formato de data/moeda correto: PASS — mantido (DD/MM/AAAA, R$ 1.450,40).
- Resultado final: 4/4 PASS.

## Regras ativas
- Em scripts PowerShell 5.1 que releem JSON persistido: nunca escrever
  `@(Get-Content $p -Raw | ConvertFrom-Json)` diretamente. Sempre materializar em uma
  variável primeiro (`$x = Get-Content $p -Raw | ConvertFrom-Json`) e só então envolver
  com `@($x)` — senão um array JSON de nível raiz pode ficar aninhado (Count=1 contendo
  o array real dentro), quebrando silenciosamente qualquer comparação/deduplicação
  baseada nesse array.
