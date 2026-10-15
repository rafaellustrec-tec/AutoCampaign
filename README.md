# Órbita — campanhas Meta para WhatsApp

Painel interno da agência para configurar e criar campanhas de conversas no WhatsApp. **Sem n8n:** o worker da aplicação lê a fila PostgreSQL e chama diretamente a Marketing API da Meta.

## Primeira versão

Cliente → conta Meta → imagens → briefing → proposta → aprovação da estrutura → criação pausada → conferência → autorização de ativação.

- Uma conta Meta e um WhatsApp por campanha. Telefone com DDI; o destino `wa.me` é gerado e conferido contra o telefone aprovado.
- Imagens JPEG/PNG/WebP de até 30 MB. Um anúncio por imagem. Vídeos, formulários Meta e Google não são aceitos na criação desta fase.
- Modelo: `OUTCOME_ENGAGEMENT`, destino `WHATSAPP`, otimização `CONVERSATIONS`, orçamento diário no conjunto, cidade por chave oficial, idade 18–65, posicionamentos automáticos e nenhuma categoria especial. A configuração aparece na proposta.
- O worker verifica se o número está vinculado à página antes de criar objetos. Permissões e elegibilidade reais continuam dependendo da Meta.
- Campanha, conjunto e anúncios são criados pausados. Alterar o briefing incrementa a versão e exige nova aprovação. Ativar é uma ação explícita do aprovador.
- Aprovação editorial e entrega da plataforma são distintas do status configurado. A primeira integração real ainda exige certificação em conta piloto; `ADS_PUBLISH_ENABLED=false` é o padrão.

## Executar

Requisitos: Node 22 ou 24, PostgreSQL 17+, bucket S3 privado. **Dois processos contínuos:** web e worker. Uma hospedagem de arquivos estáticos não executa a aplicação.

1. `npm ci`
2. Copiar `.env.example` para `.env.local` e configurar banco, URL pública, chave de criptografia, Meta e S3. Segredos ficam apenas no ambiente do servidor.
3. Gerar `ENCRYPTION_KEY` com 32 bytes em base64: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Guardar essa chave com os backups; sem ela não será possível ler as conexões existentes.
4. Migrar: `node --env-file=.env.local --import tsx scripts/migrate.ts`.
5. Definir temporariamente `INITIAL_PASSWORD` (12 caracteres ou mais) no ambiente e executar `node --env-file=.env.local --import tsx scripts/create-user.ts email@agencia.com Rafael admin`. Remover a variável depois. Não há usuário padrão.
6. Painel: `npm run dev`.
7. Worker em outro processo: `node --env-file=.env.local --import tsx scripts/worker.ts`.

Em hospedagem que já exporta as variáveis, usar `npm run db:migrate`, `npm run user:create -- email nome admin` e `npm run worker` diretamente. O Next carrega `.env.local`; scripts CLI dependem do `--env-file` ou das variáveis exportadas.

`/demo` é uma demonstração identificada, sem gravações. O formulário pode ser aberto para inspeção, mas o envio fica desabilitado na demonstração.

## Execução e recuperação

O worker reivindica tarefas com `SKIP LOCKED`, obtém lock exclusivo por tarefa, revalida a aprovação, renova o lease e registra a conclusão. Não exige webhook nem token de orquestrador e não oferece endpoints HTTP de execução remota.

Cada mutação externa registra a intenção antes da chamada e grava os identificadores retornados. Resposta perdida ou execução expirada bloqueia a repetição e exige reconciliação. HTTP 429/indisponibilidade antes de mutações ambíguas recebem backoff, até cinco tentativas. Reconexão e configurações inválidas exigem ação humana. Erros exibem códigos sem tokens.

Perfis: operador cadastra/configura e solicita criação; aprovador aprova estrutura e ativação; administrador acumula as funções e gerencia conexões/acessos. Todos os acessos são isolados por cliente.

## Verificar

- `npm test`: regras, validação do WhatsApp e payloads.
- `npm run test:postgres`: PostgreSQL temporário e Meta simulada; testa o conector e o worker completos, criação/ativação, concorrência, quota, autorização, número não vinculado e resposta perdida. Nenhuma conta real é utilizada.
- `npm run test:integration`: mesma suíte com `TEST_DATABASE_URL` apontando a um banco de testes.
- `npm run build`: TypeScript seguido de build Webpack com um worker e heap de 512 MiB por processo.
- `node scripts/smoke-production.mjs`: páginas e API do build local.
- `node --import tsx scripts/check-ui.ts`: interface em Chrome instalado, com `UI_BASE_URL` configurável (padrão porta 3217).

Instalação em produção: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Preparação Vercel/Supabase: [docs/VERCEL-SUPABASE.md](docs/VERCEL-SUPABASE.md). Contrato do painel: [docs/API.md](docs/API.md).

Relatórios e conectores Google antigos foram preservados como base para evolução, mas não participam da criação deste piloto. Não há migração destrutiva nem remoção de dados legados. Automações/workflows do n8n foram retirados. O histórico das tentativas anteriores de hospedagem está em `docs/HOSTING-HISTORY.md` e não é o procedimento vigente.
