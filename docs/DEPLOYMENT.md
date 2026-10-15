# Implantação — Meta WhatsApp sem n8n

## Serviços necessários

1. Web Next.js com HTTPS, executando continuamente o backend e as rotas `/api`.
2. Worker Node contínuo, comando `npm run worker`, sem porta pública.
3. PostgreSQL com banco e usuário exclusivos da aplicação.
4. Bucket privado compatível com S3.

Web e worker compartilham as mesmas variáveis de banco, criptografia, Meta e S3. Não configurar `N8N_*` nem `INTERNAL_API_TOKEN`: não são usados. Redis não é necessário para a fila atual. O pool padrão tem 12 conexões por processo (2 na Vercel), configurável por `DB_POOL_MAX`; dimensionar o limite do banco para o total de réplicas. Para preparação do painel na Vercel, consultar [VERCEL-SUPABASE.md](VERCEL-SUPABASE.md); a execução assíncrona ainda requer adaptação nesse ambiente.

## Docker

O Dockerfile possui targets `web` e `worker`; o target final padrão `release` inicia o web. O worker instala apenas dependências de produção, incluindo `tsx`, e tem os scripts de migração/provisionamento. Não há dependência de um serviço n8n.

1. Configurar `.env` com base em `.env.example`. Para Compose local, exportar `POSTGRES_PASSWORD` e apontar `DATABASE_URL` para `postgres:5432`, banco `agency`.
2. `docker compose build`.
3. `docker compose up -d postgres`.
4. `docker compose run --rm worker npm run db:migrate`.
5. Provisionar o administrador numa tarefa avulsa, fornecendo `INITIAL_PASSWORD` pelo gerenciador de segredos.
6. `docker compose up -d web worker`.
7. Configurar proxy HTTPS para a porta 3000 do web. `APP_URL` deve coincidir exatamente com a origem pública, sem barra final. Não usar cache para `/api`.

Pode-se reutilizar um PostgreSQL existente com acesso autorizado, TLS válido e banco separado. Nesse caso não iniciar o serviço de banco do Compose e ajustar as dependências do arquivo à instalação.

## Conexão Meta e arquivos

- Registrar o callback `https://SEU-DOMINIO/api/oauth/meta/callback` no aplicativo Meta.
- Configurar `META_APP_ID`, `META_APP_SECRET`, `META_API_VERSION` e as permissões requeridas. A versão da API é obrigatória e deve estar suportada pela conta/aplicação.
- O OAuth solicita `ads_read`, `ads_management`, `business_management`, `pages_show_list` e `pages_read_engagement`. Aplicações existentes podem exigir reconexão para consentir a nova permissão.
- Criar cliente no painel, autorizar a Meta e vincular explicitamente a conta do cliente. Preparar a página e o WhatsApp vinculado no gerenciador da Meta.
- Configurar S3 privado com CORS permitindo PUT somente a partir de `APP_URL`. Confirmar uploads antes de aprovar campanhas. A confirmação copia o arquivo para chave imutável e evita alterações por reuso da URL de upload.

## Piloto

Manter `ADS_PUBLISH_ENABLED=false` até validar autorizações, banco, armazenamento, fuso/moeda, número vinculado e o payload na versão escolhida da Meta. Depois habilitar apenas no ambiente piloto autorizado, tanto no web quanto no worker.

Revisar o orçamento e a proposta, aprovar a criação e conferir os três níveis pausados no gerenciador. Autorizar ativação separadamente. A configuração ACTIVE não garante aprovação editorial ou entrega. Categorias especiais, campanhas políticas, vídeos e configuração avançada de audiência ficam fora deste modelo inicial.

Critérios: usuário não acessa outro cliente; operador não ativa; versão editada exige aprovação nova; não há chamadas para n8n; tarefa repetida não duplica campanha; falha antes de mutação pode retentar; resposta perdida exige reconciliação; reinício do worker não repete resultados desconhecidos.

Não existe tela de reconciliação neste piloto. Em operação ambígua, conferir os objetos na Meta pelo marcador `orbita-<campaignId>-v<version>` e reconciliar os registros de operações/objetos em transação antes de liberar retentativa. Não apagar o histórico para contornar o bloqueio.

## Build e operação

`npm run build` executa TypeScript em separado e só depois compila com Webpack, um worker, caches/source maps de build desativados e heap padrão de 512 MiB **por processo**, não como limite total do contêiner. O valor é ajustável por `BUILD_HEAP_MB`. A checagem de tipos duplicada do Next só é omitida depois do sucesso do `tsc` no launcher.

Supervisionar web e worker com reinício automático, backups testados, logs com retenção, fila parada, tarefas failed e status de conexões. Erros AUTH_EXPIRED exigem reconexão. RATE_LIMIT e PROVIDER_UNAVAILABLE seguros usam backoff. AMBIGUOUS_RESULT bloqueia repetição automática.

`GET /api/health` retorna 200 JSON quando o banco responde e 503 quando não responde. `/api/me` sem sessão retorna 401 JSON. Essas rotas permitem distinguir backend funcional de hospedagem apenas estática.

O fluxo de Vibecoding Apps/CLI da Cloudfy testado anteriormente publicou arquivos no Cloudflare Pages, sem iniciar Node. Não enviar o servidor `.next` como pasta pública. Os detalhes e resultados antigos foram preservados em `HOSTING-HISTORY.md`. Nenhum novo deploy de produção faz parte desta adaptação local.
