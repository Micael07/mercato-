# Mercato · Guia visual da interface comercial

## Direção

Interface operacional de ERP e ponto de venda, inspirada na referência fornecida pelo usuário: navegação horizontal, menus suspensos, barra de módulo azul-clara, grade de itens e fechamento lateral. Sem copiar marca, conteúdo ou regras fiscais do exemplo.

## Cores

| Aplicação | Cor |
| --- | --- |
| Azul principal / seleção | `#0789C4` |
| Ação de venda / botão primário | `#0795CB` |
| Ciano de nova operação | `#03B5DC` |
| Cabeçalho de módulo | `#DBF0FB` |
| Fundo de trabalho | `#F2F5F7` |
| Painéis | `#FFFFFF` |
| Bordas | `#D6E0E6` |
| Texto | `#405360` |
| Sucesso e adicionar quantidade | `#16A168` |
| Remoção / situação crítica | `#E05249` |
| Impressão / atenção | `#EFA10C` |

Não usar gradientes. Verde, vermelho e laranja identificam ações específicas, não enfeites.

## Tipografia e densidade

- Roboto para navegação, formulários e conteúdo.
- JetBrains Mono apenas para códigos quando necessário.
- Valores monetários com algarismos tabulares e formato brasileiro.
- Texto de operação entre 11 e 13 px; títulos de módulo de 16 px.
- Campos e botões de 33 px, versão compacta de 28 px.
- Cantos de 2 px; sem sombras em painéis de cadastro. Menus e diálogos podem ter sombra discreta.

## Navegação

- Barra superior identifica empresa, CNPJ em monitores largos, estabelecimento e operador.
- Módulos: Visão geral, Compras, Vendas, Produtos, Financeiro, Relatórios, Sistema e Sair.
- Itens respeitam permissões. O menu não substitui a autorização no servidor.
- Menus abrem por mouse/toque e permitem setas e Escape. Ctrl+K localiza módulos.
- Ao trocar contexto com uma venda em edição, pedir confirmação antes de descartar itens.

## Ponto de venda

- Busca por descrição, SKU, código interno ou código de barras.
- Itens em tabela à esquerda, dados e resumo à direita; em celular, fechamento abaixo.
- Cliente opcional: consumidor final não exige cadastro.
- Número da venda só aparece após ser atribuído pelo servidor; não inventar série fiscal.
- Não copiar IVA ou taxas da imagem: as regras brasileiras dependem da configuração e do módulo fiscal.
- PDV consulta `/api/pos/products`, que não seleciona custo nem margem.
- Novo, Receber, Imprimir, Suspender e Retomar devem executar ações reais.
- F2 busca, F3 produtos, F4 cliente, F8 suspende e F9 recebe.
- Comprovante continua sendo não fiscal; PDF/80 mm não significa integração com equipamento fiscal.

## Marca

Os SVGs editáveis permanecem em `public/brand/`, com o símbolo existente em azul/ciano e versões horizontal clara/escura. O favicon está em `src/app/icon.svg`.

## Validação visual

A suíte Playwright em `e2e/` verifica a interface com dados de homologação e gera capturas em `test-results/` (não versionadas). Ela não deve ser executada contra produção.
