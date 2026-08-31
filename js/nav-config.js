/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0 — Estrutura de navegação
   Mantém as mesmas áreas do sistema atual (para não confundir a equipe
   trocando tudo de lugar), reorganizadas em grupos mais claros, no
   estilo do menu por módulos do Univen. Páginas marcadas com `status:
   "wip"` ainda não foram portadas nesta primeira fase — aparecem no
   menu (para mostrar o roadmap) mas abrem uma tela de "em construção".
   ========================================================================= */

export const NAV_SECTIONS = [
  {
    label: "Geral",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "grid" },
      { id: "institucional", label: "Institucional", icon: "home", status: "wip" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { id: "leads", label: "Atendimentos", icon: "target" },
      { id: "leads_distribuidos", label: "Leads Distribuídos", icon: "flow" },
      { id: "negociacoes", label: "Negociações", icon: "kanban" },
      { id: "respostas_rapidas", label: "Respostas rápidas", icon: "reply" },
      { id: "registro_vendas", label: "Registro Diário - Vendas", icon: "trending" },
      { id: "analise360", label: "Análise 360° - Vendas", icon: "radar" },
    ],
  },
  {
    label: "Locação",
    items: [
      { id: "registro_captacao", label: "Registro Diário - Captação", icon: "clipboard" },
      { id: "registro_atendimento", label: "Registro Diário - Atendimento e Visitas", icon: "pin" },
    ],
  },
  {
    label: "Comunicação",
    items: [
      { id: "comunicados", label: "Comunicados", icon: "megaphone", status: "wip" },
      { id: "agenda", label: "Agenda", icon: "calendar", status: "wip" },
      { id: "aniversariantes", label: "Aniversariantes", icon: "gift", status: "wip" },
    ],
  },
  {
    label: "Pessoas",
    items: [
      { id: "avaliacao_desempenho", label: "Avaliação de Desempenho", icon: "star", status: "wip" },
      { id: "reconhecimentos", label: "Reconhecimentos", icon: "award", status: "wip" },
      { id: "chamados", label: "Chamados", icon: "ticket", status: "wip" },
    ],
  },
  {
    label: "Capacitação",
    items: [
      { id: "treinamentos", label: "Treinamentos", icon: "book", status: "wip" },
      { id: "playbook", label: "Playbook", icon: "layers", status: "wip" },
      { id: "processos", label: "Processos", icon: "flow", status: "wip" },
      { id: "biblioteca", label: "Biblioteca NPC", icon: "archive", status: "wip" },
    ],
  },
  {
    label: "Administração",
    items: [
      { id: "usuarios", label: "Usuários", icon: "users" },
      { id: "permissoes", label: "Permissões", icon: "lock" },
      { id: "configuracoes", label: "Configurações", icon: "settings" },
    ],
  },
];

export function findNavItem(pageId) {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((i) => i.id === pageId);
    if (item) return item;
  }
  return null;
}
