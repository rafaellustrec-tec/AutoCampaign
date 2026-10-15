# Deploy do painel na Vercel com Supabase

## Estado da preparação

O repositório possui configuração de build Next.js para Vercel. Quando `VERCEL=1`, o Next usa a saída padrão da plataforma; Docker continua usando `standalone`.

Isso prepara o **painel e a API**. O worker contínuo atual ainda não foi convertido em Vercel Workflows. Não habilitar `ADS_PUBLISH_ENABLED` neste deploy até implementar e validar essa execução. Importar o repositório na Vercel não inicia `npm run worker`.

## GitHub e Vercel

1. Usar um repositório privado exclusivo. Publicar somente arquivos do projeto; `.env*`, `artifacts/`, `.cloudfy.json`, `.vercel/` e `.supabase/` estão ignorados.
2. Importar esse repositório na Vercel, preset Next.js, diretório raiz do projeto, Node 24 (compatível com o ambiente validado). `vercel.json` define instalação e build.
3. Usar Preview com banco de testes separado. Não fornecer credenciais Meta ou banco de produção a previews de branches não confiáveis.
4. Configurar as variáveis de `.env.example` no servidor. `APP_URL` precisa ser a origem HTTPS estável do ambiente, sem barra final. Manter `ADS_PUBLISH_ENABLED=false`.
5. Não executar migrações nem criar usuários no comando de build. Essas operações são feitas uma vez, contra o ambiente identificado e autorizado.

## Supabase: banco

Usar projeto exclusivo para a aplicação. O sistema usa `pg` e autenticação própria; não precisa de chave `anon`, `service_role` ou Supabase Auth no navegador.

As migrações criam tabelas no schema padrão, incluindo `public.users`, que é diferente de `auth.users`. Antes de migrar, desabilitar a Data API do projeto exclusivo ou remover o schema da aplicação dos schemas expostos. Não expor essas tabelas via REST/GraphQL sem políticas RLS; as permissões por cliente atuais são aplicadas pelo backend Next.js. Não alterar a Data API de um projeto compartilhado com outros sistemas.

Para o painel na Vercel, copiar a URL do **Transaction pooler** em Connect no dashboard e usar em `DATABASE_URL`, com TLS e certificado válidos. Não desabilitar validação de certificado. Não usar prepared statements nomeados. O limite local é de duas conexões por instância na Vercel, configurável por `DB_POOL_MAX`; considerar a soma de instâncias no dimensionamento do banco.

Para migração, usar uma conexão direta ou Session pooler acessível pela máquina de provisionamento. O worker nativo atual também exige conexão direta/Session pooler por usar advisory lock de sessão; não executá-lo no Transaction pooler.

Provisionar com Node 24 e variáveis secretas em `.env.local` ignorado:

```powershell
node --env-file=.env.local --import tsx scripts/migrate.ts
node --env-file=.env.local --import tsx scripts/create-user.ts email@agencia.com Rafael admin
```

O segundo comando exige `INITIAL_PASSWORD` temporária no ambiente. Remover depois de criar o administrador.

## Supabase: imagens

Criar bucket privado `agency-assets`, limitado aos formatos e tamanhos aceitos pelo painel. Gerar credenciais S3 no dashboard e configurar somente no servidor:

- `S3_ENDPOINT`: endpoint S3 fornecido pelo projeto (termina em `/storage/v1/s3`).
- `S3_REGION`: região informada pelo Supabase.
- `S3_BUCKET`: `agency-assets`.
- `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`: credenciais S3; não substituir por chave pública ou `service_role`.

O navegador envia imagens por URLs assinadas. Validar PUT, HEAD, cópia para chave definitiva e GET com o armazenamento real antes de aceitar materiais no piloto. A compatibilidade S3 do Supabase não significa suporte irrestrito a todas as opções do AWS SDK.

## Validação após publicar

- `/` mostra login e `/demo` identifica a demonstração.
- `/api/me` sem sessão responde 401 em JSON.
- Login do administrador e cadastro de cliente funcionam no banco correto.
- Upload e confirmação de imagem funcionam sem tornar o bucket público.
- Criar e revisar briefing, gerar proposta e aprovar estrutura funcionam.
- Solicitar publicação permanece bloqueado até disponibilizar a execução assíncrona.

Depois: adaptar as tarefas a Workflows, manter aprovação por versão e registro de cada mutação Meta, testar falhas e retentativas e só então executar uma criação pausada com conta piloto.

Referências: [conexões PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), [compatibilidade S3](https://supabase.com/docs/guides/storage/s3/compatibility), [configuração Vercel](https://vercel.com/docs/project-configuration), [Workflows](https://vercel.com/docs/workflows).
