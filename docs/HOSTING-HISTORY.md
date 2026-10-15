# Cloudfy: inventário, implantação e piloto

## Deploy via Vibecoding Apps / CLI

O aplicativo `orbita` foi cadastrado com Node 22, instalação `npm ci`, build `npm run build` e saída automática. Esse cadastro ainda não comprova execução do servidor Next.js nem do worker.

Preparar o envio com `node scripts/prepare-cloudfy.mjs`. O comando cria uma pasta nova em `artifacts/cloudfy-<id>` usando uma lista explícita de arquivos. Rodar a CLI somente nessa pasta: a versão 1.0.1 exclui `node_modules`, `.git`, `.next` e `.cloudfy.json`, mas não exclui automaticamente `.env` ou `artifacts` da pasta de origem.

Na verificação de 15/10/2026, a CLI npm `@cloudfy.io/cli@1.0.1` usava `https://api.cloudfy.space/api/v1`, que retornava `Route not found`. A rota `https://api.cloudfy.space/api/apps/cli/whoami` autenticou corretamente o app. Foi corrigida somente a constante `API_URL` da cópia isolada da CLI em `artifacts/cloudfy-cli`, removendo `/v1`. Não alterar arquivos da aplicação para contornar esse problema.

A chave deve ficar apenas no arquivo local `.cloudfy.json`, ignorado pelo Git e pelo empacotamento da CLI. Não inserir a chave em comandos, logs, documentos ou variáveis de build do painel.

Depois do build, verificar `/demo`, `/api/me` (401 JSON sem sessão) e `/api/health` (503 JSON enquanto o banco não estiver configurado). Uma página estática disponível, sozinha, não confirma suporte ao backend. Manter publicação de anúncios bloqueada até concluir banco, credenciais, worker, n8n e certificação do piloto.

Primeiro envio de teste realizado via CLI: arquivo de aproximadamente 0,1 MB aceito; logs confirmaram validação, extração e início de `npm ci && npm run build`. O resultado final chegou em aproximadamente 624,5 segundos: `Build failed: Command failed: npm run build`, seguido de `Killed`. A execução do backend não foi alcançada. Isso sugere encerramento por recursos/tempo, sem confirmação da causa exata. A API também apresentou timeout durante a consulta e o domínio do app retornou `ENOTFOUND`. O identificador desse deployment é `5a130c7d-90bf-4ee6-94e2-bee1818b8c63`.

### Perfil de build com menor consumo

`npm run build` usa `scripts/build.mjs`: verifica TypeScript em um processo separado e só compila se ele passar. Em seguida usa Webpack com um worker, compilações sequenciais, cache de compilação e source maps desativados e as otimizações de memória do Next.js. Bibliotecas exclusivamente de servidor são mantidas externas ao bundle. A verificação duplicada do TypeScript pelo Next é omitida apenas quando o launcher já concluiu `tsc` com sucesso.

O limite padrão de heap é 512 MiB **por processo Node**, não um limite total de RSS do contêiner. `BUILD_HEAP_MB` pode ajustar esse teto, entre 256 e 4096. Logs de build registram versão do Node, limite do cgroup quando disponível, etapa e RSS/heap por processo. Eles não registram variáveis de ambiente nem credenciais. Base técnica: https://nextjs.org/docs/app/guides/memory-usage.

Para o pacote de deploy, usar `node scripts/prepare-cloudfy.mjs --slim` e, na pasta nova, `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund`. Isso remove Playwright e PostgreSQL temporário apenas do pacote enviado, mantendo as ferramentas e os testes no projeto de desenvolvimento. Não rodar a CLI na raiz do repositório.

Validação local deste perfil: os 16 testes unitários passaram; TypeScript passou com pico de RSS de 439 MiB; o processo principal do Next passou com pico de RSS de 389 MiB. São medições por processo, não o pico agregado. O smoke de produção confirmou `/` e `/demo` com HTTP 200 e `/api/me` com HTTP 401 JSON. O pacote slim passou em `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` e tem 137 registros no lockfile (150 no original). Segunda tentativa enviada em 15/10/2026, deployment `42d27ab7-05e6-42c6-a5e4-96e464ea13b2`.

Resultado da segunda tentativa: após 216 segundos, a plataforma avançou à validação do artefato e falhou com `Build output directory "dist" not found. Check your build configuration.` Não houve repetição do `Killed` nessa tentativa. O projeto gera `.next/standalone` para execução com Node, não um `dist` estático. Esse resultado indica que o novo bloqueio está no formato de publicação; ainda não comprova suporte ou ausência de suporte a SSR/rotas API. Não apontar `.next`/`.next/standalone` como diretório público sem confirmar a execução de `server.js` e o tratamento de arquivos de servidor. Nenhuma chave ou credencial de anúncios foi enviada. É necessário obter a configuração suportada para Next.js com servidor antes de outro deployment.

### Verificação efetiva do runtime

Foi examinado o código público da CLI 1.0.1 e dos módulos de Apps servidos por `cloudfy.space`. A CLI expõe somente deploy e status. O formulário envia build/install/output/root/node/env; não foi encontrado campo de comando de início, porta, container ou worker. A Deploy Key lê `whoami` e deployments, mas o GET administrativo do próprio app retorna 401; não foram tentadas formas de contornar essa restrição.

O teste mínimo `f8d04777-c82a-4a74-91e8-45e6e02c2e33` publicou uma página explicitamente identificada como diagnóstico e um script Node sem segredos. O pacote declarava `npm start` com uma rota JSON de identificação. O deploy ficou ativo em 9,2 segundos. Os logs mostraram upload para **Cloudflare Pages**, projeto `cloudfy-app-orbita`, URL versionada `https://0879095a.cloudfy-app-orbita.pages.dev`.

As consultas à URL versionada confirmaram: `/` responde a página de diagnóstico; a rota `/api/...` responde o mesmo HTML (fallback estático), não JSON; `/server.js` entrega o script como arquivo JavaScript, em vez de executá-lo. Logo, **o fluxo atual de Vibecoding Apps/CLI testado publica arquivos estáticos e não inicia o servidor Node declarado em `npm start`**. Isso não é uma afirmação sobre todos os produtos da Cloudfy. Não há modo de configurar o backend deste projeto nos campos/CLI observados.

O app público contém somente o diagnóstico, não o painel operacional. O domínio `orbita.apps.cloudfy.cloud` apresentou erro de handshake TLS durante a verificação, sem bypass de certificado. O n8n existente não foi alterado. Para manter a aplicação inteira na Cloudfy é necessário um serviço Node/Docker/SSH separado, se disponível, ou uma capacidade de runtime não exposta pela CLI atual. Alternativamente, hospedar web/API e worker em runtime compatível e manter n8n/PostgreSQL na Cloudfy. Não converter a aplicação inteira em export estático: login, callbacks OAuth, API, segredos e fila exigem backend.

Referência de compatibilidade: https://developers.cloudflare.com/pages/framework-guides/nextjs/ distingue export estático no Pages de Next.js full-stack no Workers. O deploy de Workers é outro mecanismo e não é oferecido pelos comandos identificados na CLI Cloudfy.

## Inventário antes da implantação

Registrar versão e plano do n8n, CPU/RAM, disco livre, concorrência disponível, versão/limites do PostgreSQL, domínios e TLS, política de backup com teste de restauração e capacidade S3. Não presumir que o banco interno do n8n pode ser reutilizado: criar banco `agency` e usuário próprio. PostgreSQL existente pode substituir o serviço `postgres` do Compose.

O painel, o worker e o n8n são processos independentes. A fila da aplicação é PostgreSQL e funciona sem Redis. Redis só é necessário se futuramente o próprio n8n usar queue mode. Ajustar `max:12` do pool levando em conta todas as réplicas e o limite do banco.

## Implantação

1. Criar banco separado e backups. Configurar variáveis com o gerenciador de segredos da hospedagem. Para banco externo, usar a conexão TLS indicada pelo provedor, com validação do certificado.
2. Configurar bucket privado e CORS permitindo somente `APP_URL`, método PUT, headers de conteúdo. Ativar limites de armazenamento e expurgo de uploads pendentes. Não tornar o bucket público.
3. Configurar aplicações OAuth com callbacks exatos `/api/oauth/meta/callback` e `/api/oauth/google/callback`. Obter as permissões e acesso à API necessários. Definir versões suportadas em `META_API_VERSION` (ex.: `vXX.0`) e `GOOGLE_ADS_API_VERSION` (ex.: `vXX`). O código não fornece uma versão padrão.
4. Rodar migrações em tarefa única com target `worker`, comando `npm run db:migrate`. Criar administrador por CLI. Nunca criar usuário ou senha padrão automaticamente.
5. Publicar target `web` atrás de proxy HTTPS, sem cache em `/api/`. `APP_URL` precisa ser a origem pública exata. Publicar target `worker` sem porta pública. Definir limites de CPU/memória e logs com retenção.
6. Importar os workflows, cadastrar Header Auth e URLs. Definir tokens distintos em `INTERNAL_API_TOKEN` e `N8N_WEBHOOK_TOKEN`. O mesmo token interno deve ser a credencial de saída HTTP do n8n.
7. Validar autenticação, autorização, backup e conexão S3 antes de habilitar publicações. A coleta só é ativada após comparar os dados com as plataformas.

O Compose é uma referência de implantação, não um inventário confirmado da Cloudfy. Para usá-lo: definir `POSTGRES_PASSWORD` no ambiente e `DATABASE_URL=postgresql://agency:<senha>@postgres:5432/agency` no `.env`; depois `docker compose build`, `docker compose up -d postgres`, `docker compose run --rm worker npm run db:migrate` e iniciar web/worker. Criar usuário via tarefa avulsa com `INITIAL_PASSWORD` fornecida pelo gerenciador de segredos.

## Certificação e critérios de aceite

- Dois clientes piloto, um com Meta formulário e outro com Meta WhatsApp/Google Pesquisa. Conferir IDs geográficos, página, formulário, materiais e conversões previamente configurados. Categorias especiais e políticas de saúde devem ser revisadas pela equipe antes do piloto.
- Demonstrar que operador não ativa, aprovador não edita e usuário de um cliente não acessa outro por URL/API.
- Editar rascunho/proposta aprovada: versão incrementa e aprovação anterior não autoriza criação.
- Executar Google `validateOnly` em conta de teste; criar a estrutura com campanha pausada. Meta deve permanecer pausada nos três níveis.
- Em caso de política editorial, conferir motivos diretamente na plataforma. O status ACTIVE do painel indica configuração autorizada, não garantia de entrega.
- Interromper worker após mutação: operação ambígua bloqueia replay. Conferir os objetos no gerenciador pelo marcador `orbita-<campaignId>-v<version>`. Administrador deve reconciliar `provider_operations.result` e `external_objects` em transação antes de retentar. Ainda não há tela de reconciliação; não apagar registros para desbloquear uma execução.
- Simular expiração, HTTP 429, falha de upload e resposta perdida. Alertar em falhas de jobs e sync_runs via workflow de monitoramento da agência; a interface também mostra execuções com falha. Um canal externo de alertas não está configurado pelo projeto.
- Crescer gradualmente (2 → 10 → carteira), medindo tempo de fila, limites por conta e taxa de falhas. Worker padrão serial para reduzir pressão nas APIs; paralelismo somente após medir capacidade e quotas.
- Comparar fechamento mensal com Meta/Google/Reportei no mesmo fuso, moeda, janela e definição de conversão. Meta `lead` não inclui automaticamente conversas WhatsApp. Valores ausentes permanecem ausentes; denominadores zero aparecem sem indicador calculado.

## Custos e pendências de produto

Medir hospedagem incremental, armazenamento/transferência S3, manutenção das APIs e horas poupadas. Não há IA paga nesta versão. Não há verificação automática dos recursos da Cloudfy sem acesso ao provedor.

Antes de substituir Reportei: adicionar os indicadores WhatsApp exigidos, backfill histórico e certificação da sincronização editorial, além da validação de um mês completo. Não há envio automático de relatórios a clientes nesta versão.
