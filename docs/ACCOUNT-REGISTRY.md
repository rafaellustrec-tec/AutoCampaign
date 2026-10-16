# Lista geral de contas

Administradores conectam Meta ou Google sem selecionar um cliente. O callback salva
a autorização criptografada, importa as contas autorizadas e abre Conexões. A Meta
só retorna os ativos liberados no consentimento; para ampliar a lista, repetir o
consentimento selecionando os ativos desejados. Autorizações anteriores podem ser
importadas pelo botão Atualizar contas, sem uma nova autorização.

## Persistência e autorização

`ad_accounts` é o inventário da agência: `client_id=NULL` significa conta salva ainda
sem cliente. `connections.client_id` e `oauth_states.client_id` também podem ser
nulos. Vínculos existentes são preservados pela migração e por todas as reimportações.
Nome, ID externo, moeda, fuso, disponibilidade e última leitura são salvos. Credenciais
ficam somente em `connections`, criptografadas, sem exposição por APIs de listagem.

O inventário e as autorizações globais são exclusivos de administradores. Operadores
e aprovadores continuam consultando apenas contas dos clientes permitidos. Contas
não disponíveis não podem ser vinculadas nem utilizadas para criar campanhas.
As tabelas permanecem no schema privado com RLS; não foram concedidos novos acessos
a `anon` ou `authenticated`.

## Importação e recuperação

A consulta percorre as páginas do provedor antes de salvar o snapshot completo em
uma transação. Upsert por plataforma/ID externo evita duplicatas e não altera cliente.
Falhas de rede, quota ou metadados incompletos preservam a lista anterior. Ao concluir
uma leitura completa, contas ausentes naquela autorização ficam indisponíveis, sem
apagar campanhas ou seus vínculos. Outra autorização válida pode recuperá-las.

Cada autorização usa uma reserva de importação de dez minutos para evitar corridas.
Importação interrompida pode ser retomada por Atualizar contas depois dessa reserva.
Status e erro sanitizado são salvos; nenhuma resposta contendo token vai para o browser.
O callback preserva a autorização mesmo se a importação falhar, permitindo repetir a
consulta. Limites do piloto: 100 páginas Meta, 10.000 contas por importação, 300 segundos
por requisição na Vercel. Não há polling ou sincronização periódica automática nesta entrega.

## Vínculo em lote

Selecione contas e aplique um cliente ao grupo, ou escolha clientes por linha. Salvar
vínculos em lote recebe até 500 pares `{accountId,clientId}`. A transação valida todos
os clientes/contas e bloqueia linhas em ordem estável. Qualquer conflito, autorização
revogada ou conta indisponível rejeita o lote inteiro. Repetir o mesmo lote não duplica
vínculos/auditoria. Não é permitido mover conta já vinculada para outro cliente.

Importar e vincular contas não cria nem ativa campanhas. Manter
`ADS_PUBLISH_ENABLED=false` e `ADS_ACTIVATION_ENABLED=false` durante a validação.

## Testes

Testes com PostgreSQL isolado cobrem mais de cem contas, duplicatas, reautorização,
falhas, concorrência, recuperação, lotes para clientes diferentes, rollback e perfis.
OAuth global é exercitado com provedor simulado, incluindo importação automática,
renovação de token e revogação. A validação publicada deve conferir a importação real
sem chamar endpoints de mutação de campanhas nas plataformas.
