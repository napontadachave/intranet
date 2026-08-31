/* =========================================================================
   Lista de permissões — usada pela tela Permissões (js/modules/permissoes.js)
   e consultada pela tela Usuários pra mostrar um resumo.

   A pedido seu: construída como uma lista EXTENSÍVEL por módulo, já
   pensando no crescimento do sistema — e não só os dois interruptores que
   o código já usa hoje. Por isso cada item tem um `emUso`:

   - `emUso: true`  → já existe uma verificação de verdade no código hoje
     (ver o arquivo/linha no comentário de cada uma). Ligar/desligar aqui
     tem efeito imediato nas telas.
   - `emUso: false` → é só a "vaga reservada" pra um controle que ainda não
     tem nenhuma tela checando — fica guardado no cadastro do usuário
     (campo `perms`) normalmente, mas não muda nada sozinho ainda. Quando
     alguma tela passar a checar, é só trocar o `emUso` pra `true` aqui e
     acrescentar o `if (usuario.perms?.chave) ...` correspondente — a
     estrutura de dados já está pronta, só falta o código consumir.

   Duas permissões continuam sendo o "topo" do sistema, como já eram antes
   desta tela existir: `admin` dá acesso a tudo (inclusive substitui as
   outras — ver `isAdmin()` em js/auth.js), e `view_all_users` é a única
   granular que já tinha 5 consumidores espalhados pelo código antes desta
   rodada. As demais abaixo são a preparação pedida — hoje sem efeito. */

export const PERMISSOES_DEFINICOES = [
  {
    modulo: "Acesso geral",
    itens: [
      {
        key: "admin",
        label: "Administrador (acesso total)",
        descricao: "Libera Configurações, Usuários, Permissões, e o efeito de \"ver todos\" nas telas abaixo — mesmo sem marcar as outras uma por uma.",
        emUso: true,
      },
      {
        key: "view_all_users",
        label: "Ver todos os usuários e registros",
        descricao: "Em Atendimentos, Leads Distribuídos, Negociações, Registros Diários e Análise 360° - Vendas: vê e filtra os dados de todo mundo, não só os próprios.",
        emUso: true,
      },
    ],
  },
  {
    modulo: "Negociações",
    itens: [
      { key: "negociacoes_excluir", label: "Excluir negociações", emUso: false },
      { key: "negociacoes_gerenciar_colunas", label: "Gerenciar colunas do kanban", emUso: false },
    ],
  },
  {
    modulo: "Atendimentos",
    itens: [
      { key: "leads_excluir", label: "Excluir leads / atendimentos", emUso: false },
    ],
  },
  {
    modulo: "Registros Diários",
    itens: [
      { key: "registros_excluir", label: "Excluir lançamentos de registros diários", emUso: false },
    ],
  },
  {
    modulo: "Configurações",
    itens: [
      { key: "config_importacao", label: "Importar planilhas (Análise 360°)", emUso: false },
      { key: "config_cadencias", label: "Gerenciar cadências e templates", emUso: false },
      { key: "config_filas", label: "Gerenciar filas de distribuição", emUso: false },
      { key: "config_notificacoes", label: "Gerenciar regras de notificação", emUso: false },
    ],
  },
  {
    modulo: "Administração",
    itens: [
      { key: "gerenciar_usuarios", label: "Gerenciar usuários e permissões", emUso: false },
    ],
  },
];

/** Lista achatada de todas as chaves — útil pra validar/filtrar sem
 *  precisar percorrer os grupos toda vez. */
export const TODAS_PERMISSOES = PERMISSOES_DEFINICOES.flatMap((g) => g.itens);

/* =========================================================================
   Visibilidade de módulos no menu — a pedido seu: além do que cada
   permissão libera fazer, dá pra escolher se um módulo aparece ou não no
   menu lateral de cada usuário.

   Gravado em `perms.modulosOcultos` — um objeto {idDoModulo: true} com só
   os módulos ESCONDIDOS (o padrão, quando a chave nem existe, é "visível"
   — assim ninguém que já estava usando o sistema perde acesso a nada só
   por essa tela ter sido criada; e um módulo novo que entrar no futuro já
   nasce visível pra todo mundo, até algum admin decidir escondê-lo de
   alguém específico).

   Os ids batem com os `id` de js/nav-config.js (mesmo item que aparece no
   menu). Consultado tanto por js/ui-shell.js (pra montar o menu) quanto
   por js/router.js (pra bloquear a navegação direta por #hash a um módulo
   escondido, não só escondê-lo visualmente). */

/** Três módulos que nunca podem ficar escondidos da PRÓPRIA pessoa que
 *  está editando — sem essa trava, um administrador poderia se esconder
 *  sem querer o acesso a Usuários/Permissões/Configurações e ficar sem
 *  como reverter isso sozinho (a não ser outro administrador liberando de
 *  volta, ou mexendo direto no banco). Mesmo espírito da trava que já
 *  existe pra não poder tirar a própria permissão de administrador. */
export const MODULOS_TRAVADOS_PARA_SI_MESMO = ["usuarios", "permissoes", "configuracoes"];

/** Visível por padrão (chave ausente ou explicitamente `false`); só fica
 *  escondido quando `perms.modulosOcultos[pageId] === true`. */
export function moduloVisivelPara(usuario, pageId) {
  if (!usuario) return false;
  return usuario.perms?.modulosOcultos?.[pageId] !== true;
}
