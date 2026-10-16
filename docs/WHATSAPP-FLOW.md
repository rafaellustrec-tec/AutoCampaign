# Criar campanha WhatsApp

O painel usa três etapas: conferir cliente e conta; informar oferta, imagens, orçamento diário e datas; revisar e salvar o rascunho.

A única conta Meta disponível é selecionada automaticamente. Quando existe uma campanha WhatsApp anterior cujo vínculo de conta continua disponível, o painel reaproveita Página, telefone e localização. O escopo vem das contas e campanhas retornadas pela API autorizada do cliente selecionado. Oferta, orçamento, datas e imagens não são copiados para uma nova campanha. Editar uma campanha mantém todos os seus campos.

Na primeira campanha, dados ausentes são pedidos em Configurações avançadas. Esta entrega não descobre nem confirma automaticamente a Página ou o número na Meta. A publicação continua exigindo a validação externa já existente. O nome é gerado a partir do cliente e da oferta; nome, mensagem, conta, Página, telefone, cidade, ID geográfico e país podem ser ajustados.

O upload usa a mesma API autenticada e confirmação de armazenamento da biblioteca. Apenas JPG, PNG e WebP de até 30 MB são aceitos. O usuário escolhe uma ou mais imagens; cada imagem corresponde a um anúncio no modelo existente.

A revisão mostra texto, destino, público, conta, imagens, moeda, fuso, período e orçamento. A estimativa é o orçamento diário multiplicado pelos dias inclusivos, não um limite total de gasto.

Salvar chama apenas o endpoint de rascunho. Não gera trabalho de publicação, não aprova a campanha e não chama a Meta. Aprovação e execução continuam separadas. ADS_PUBLISH_ENABLED=false e ADS_ACTIVATION_ENABLED=false permanecem na Vercel.

Validação: testes unitários de reaproveitamento e orçamento, suíte de integração PostgreSQL existente e teste de interface com dados e mutações simulados no navegador, incluindo erro de salvamento, campos ausentes, upload, revisão, isolamento visual entre clientes e layout móvel.
