"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { Input } from "@/components/ui/primitives";

interface Faq { q: string; a: string }
interface Group { id: string; title: string; items: Faq[]; ownerOnly?: boolean }

const GROUPS: Group[] = [
  {
    id: "pdv", title: "PDV e caixa", items: [
      { q: "Como faço uma venda?", a: "Abra o caixa (aviso na barra inferior do PDV), leia o código de barras ou pesquise o produto, confira o carrinho e finalize em Receber. Atalhos: F2 buscar, F3 catálogo, F4 cliente, F8 suspender venda, F9 receber." },
      { q: "O PDV diz “Caixa fechado”. E agora?", a: "Toque em Abrir caixa na barra inferior e informe o valor inicial. Só perfis com permissão de abrir caixa veem essa opção: operador de caixa, gerente e administrador." },
      { q: "A internet caiu. Posso continuar vendendo?", a: "Sim, se o PDV já foi aberto com internet neste aparelho. Aparece o aviso “Sem internet — modo offline” e as vendas ficam guardadas no aparelho, com cupom “OFFLINE”. Ao voltar a conexão elas são enviadas sozinhas, sem duplicar. Crediário, abrir caixa e suspender venda precisam de internet." },
      { q: "Como cancelo uma venda feita errada?", a: "Em Vendas → Consultar vendas, abra a venda e use cancelar. É preciso a permissão de cancelamento (gerente ou administrador). O cancelamento devolve o estoque e é registrado na auditoria." },
      { q: "Por que não consigo dar desconto?", a: "O desconto depende de permissão e de um limite máximo por usuário, definido pelo administrador em Usuários. Peça a um gerente ou administrador para ajustar o limite." },
      { q: "Para que servem suprimento e sangria?", a: "Suprimento é entrada de dinheiro no caixa (troco). Sangria é retirada (recolhimento). Ambos ficam registrados em Movimentação de caixa e entram na conferência do fechamento." },
      { q: "Como fecho o caixa?", a: "Em Movimentação de caixa, feche o caixa aberto e informe o valor contado. O sistema mostra a diferença entre o esperado e o contado." },
    ],
  },
  {
    id: "estoque", title: "Produtos e estoque", items: [
      { q: "Como cadastro um produto?", a: "Produtos → Cadastro de produtos → Novo. Informe nome, unidade, preço de venda e, se quiser, código de barras. O preço de custo só aparece para quem tem permissão." },
      { q: "Como dou entrada de mercadoria?", a: "Duas formas: receba um pedido em Compras → Pedidos de compra (atualiza estoque e financeiro) ou lance uma entrada manual em Produtos → Movimentação de estoque." },
      { q: "Como cadastro um fornecedor pelo CNPJ?", a: "Em Fornecedores → Novo Fornecedor, digite o CNPJ. Ao completar os 14 números, o sistema busca razão social, fantasia, endereço, telefone e e-mail na base pública e preenche o formulário. Confira os dados e complete contato e condição de pagamento. Se a consulta falhar, preencha à mão." },
      { q: "Como imprimo um pedido de compra?", a: "Em Compras, use o ícone de impressora na linha do pedido ou o botão Imprimir dentro do pedido. Também dá para Salvar e imprimir ao criar. O formato é o mesmo do comprovante de venda (80 mm) e também gera PDF." },
      { q: "O saldo está errado. Como corrijo?", a: "Use um ajuste em Movimentação de estoque, ou faça um Inventário para contar e aprovar as diferenças. Todo ajuste fica registrado com usuário e data." },
      { q: "Posso vender com estoque zerado?", a: "Depende da configuração “permitir estoque negativo”, em Configurações. Se estiver desligada, o PDV bloqueia a quantidade acima do saldo." },
    ],
  },
  {
    id: "compras", title: "Compras e financeiro", items: [
      { q: "Como registro uma compra?", a: "Compras → Pedidos de compra → Novo pedido. Escolha o fornecedor e os itens. Ao receber (total ou parcial), o estoque é atualizado e os títulos a pagar são gerados." },
      { q: "Como dou baixa em uma conta?", a: "Financeiro → abra o título → Baixar, informando valor, data e forma de pagamento. Baixas podem ser estornadas por quem tem permissão de gestão financeira." },
      { q: "O sistema emite nota fiscal?", a: "Não. O PDV emite comprovante não fiscal. A emissão de NFC-e/NF-e é uma etapa futura e independente." },
    ],
  },
  {
    id: "usuarios", title: "Usuários e perfis", items: [
      { q: "Quais são os perfis?", a: "Administrador: acesso total. Gerente: operação, compras, financeiro e relatórios. Operador de caixa: PDV, caixa e clientes, sem custo nem financeiro. Estoquista: produtos, estoque, inventário e recebimento de compras." },
      { q: "Esqueci minha senha. E agora?", a: "Na tela de login, toque em Esqueci a senha e informe e-mail, CPF, nome completo (maiúsculas e acentos não importam) e data de nascimento. Depois de 5 tentativas erradas a recuperação trava por 30 minutos. Se não conseguir, o administrador da empresa gera uma senha provisória em Sistema → Usuários." },
      { q: "Por que o sistema pediu para trocar a senha?", a: "Senhas provisórias (de usuário novo ou redefinida pelo administrador) precisam ser trocadas no primeiro acesso. Depois, você pode alterar a senha quando quiser pelo link Alterar senha, ao lado do seu nome." },
      { q: "Como adiciono um funcionário?", a: "Sistema → Usuários → Solicitar usuário. Informe nome, e-mail e perfil do colaborador. A autorização é feita pelo administrador da plataforma (ou por você, se ele liberar) dentro do limite de usuários contratado. Ao autorizar, o sistema mostra uma senha provisória para entregar ao colaborador (não envia e-mail). Na mesma tela você acompanha as vendas de cada colaborador." },
      { q: "Como bloqueio um funcionário que saiu?", a: "Sistema → Usuários → desative o vínculo. O acesso é cortado na hora. A empresa sempre precisa ter ao menos um administrador ativo." },
      { q: "Esqueci minha senha.", a: "O sistema não envia e-mail de recuperação. Fale com o fornecedor do Mercato, que gera uma senha provisória para o administrador. Os demais usuários pedem ao administrador da empresa." },
    ],
  },
  {
    id: "acesso", title: "Acesso e licença", items: [
      { q: "Mostra “licença vencida” ou “acesso bloqueado”.", a: "O acesso da empresa depende de licença ativa. Regularize o pagamento com o fornecedor do Mercato; o acesso volta assim que ele renovar." },
      { q: "Cadastrei minha empresa e não consigo entrar.", a: "Todo cadastro novo fica aguardando liberação. O acesso começa depois que o fornecedor confirmar o pagamento e liberar." },
      { q: "A tela avisa que a licença vence em breve.", a: "A faixa amarela aparece nos últimos 7 dias. Renove com antecedência para não interromper as vendas." },
    ],
  },
  {
    id: "dono", title: "Para o dono do sistema", ownerOnly: true, items: [
      { q: "Como libero um cliente novo?", a: "Sistema → Clientes e licenças → filtro Aguardando liberação → Liberar → +30 dias, +90 dias ou +12 meses. Anote o pagamento no campo de observação: fica no histórico." },
      { q: "Como renovo?", a: "Abra o cliente e toque em +30 dias. A soma parte do vencimento atual, ou de hoje se já venceu." },
      { q: "Como bloqueio um cliente inteiro?", a: "No cliente, toque em Bloquear acesso agora. Vale na hora, até para quem está logado. Reativar acesso desfaz." },
      { q: "Como mudo o perfil ou bloqueio só um usuário do cliente?", a: "Abra o cliente e, em Usuários desta empresa, troque o perfil ou toque em Bloquear. A licença da empresa não muda." },
      { q: "O cliente esqueceu a senha.", a: "No cliente, toque em Gerar senha provisória. A senha aparece uma única vez e é do administrador da empresa; as sessões abertas dele são encerradas." },
      { q: "Quero criar um cliente sem ele se cadastrar.", a: "Novo cliente: informe empresa e administrador, plano e dias de acesso. O sistema mostra e-mail e senha provisória uma única vez." },
      { q: "Mostrar meu WhatsApp na mensagem de bloqueio.", a: "No Render, em Environment, crie NEXT_PUBLIC_SUPPORT_CONTACT com o seu contato e faça um novo deploy." },
    ],
  },
];

export default function AjudaPage() {
  const { session } = useSession();
  const [term, setTerm] = useState("");
  const [group, setGroup] = useState("all");
  const owner = Boolean(session?.isPlatformAdmin);

  const groups = useMemo(() => {
    const t = term.trim().toLocaleLowerCase("pt-BR");
    return GROUPS.filter((g) => (!g.ownerOnly || owner) && (group === "all" || g.id === group))
      .map((g) => ({ ...g, items: g.items.filter((i) => !t || `${i.q} ${i.a}`.toLocaleLowerCase("pt-BR").includes(t)) }))
      .filter((g) => g.items.length > 0);
  }, [term, group, owner]);

  const visibleGroups = GROUPS.filter((g) => !g.ownerOnly || owner);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Ajuda rápida</h1>
        <p className="text-xs text-slate-500">Respostas curtas para as dúvidas mais comuns do dia a dia</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input aria-label="Buscar nas perguntas" placeholder="Digite sua dúvida: caixa, desconto, senha, licença…" value={term} onChange={(e) => setTerm(e.target.value)} className="!pl-9" />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Assunto">
        {[{ id: "all", title: "Todos" }, ...visibleGroups].map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} onClick={() => setGroup(g.id)}
            className={`min-h-9 border px-3 text-[11px] ${group === g.id ? "border-sky-500 bg-sky-50 font-semibold text-sky-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
            {g.title}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="border border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-500">Nada encontrado para “{term}”. Tente outra palavra ou fale com o fornecedor do Mercato.</p>
      ) : groups.map((g) => (
        <section key={g.id} className="border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</h2>
          <div className="divide-y divide-slate-100">
            {g.items.map((i) => (
              <details key={i.q} className="group px-4 py-3" open={term.trim().length > 0 ? true : undefined}>
                <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                  {i.q}
                  <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{i.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
