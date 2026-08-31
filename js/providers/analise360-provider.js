/* =========================================================================
   Importação das planilhas do Univen para a Análise 360°.

   Portado fielmente da versão 1.0 (mesmas coleções, mesmo formato de dados,
   mesma estratégia de armazenamento) para que qualquer ferramenta que já
   lia esses dados no Firestore continue funcionando sem nenhuma mudança —
   inclusive os dados que já estão lá hoje, de antes desta migração.

   Por que Cloud Firestore, e não o Realtime Database (usado pelo resto do
   app, ver sync.js): a planilha de imóveis tem milhares de linhas, e uma
   árvore JSON única e gigante no Realtime Database deixava a gravação (e o
   próprio login, que baixa a árvore inteira) lenta e instável. Aqui cada
   conjunto de dados vira uma coleção de documentos pequenos ("chunk_0",
   "chunk_1", ...), o que é uma operação muito mais leve.

   Como pedido: importar uma planilha nova substitui SÓ os dados daquele
   mesmo tipo — as outras três coleções não são tocadas. Cada relatório do
   Univen já vem com o histórico completo até a data da exportação, então
   cada envio novo é a versão mais atual e substitui a anterior por inteiro
   (não é um "acrescentar linhas").
   ========================================================================= */

import { firestore } from "../firebase-config.js";

/* ------------------------- leitura robusta de planilha ------------------------- */

/* Duas correções feitas na v1.0 depois de problemas reais com exportações
   do Univen:
   1) Alguns relatórios "em Excel" são, na verdade, uma tabela HTML salva com
      extensão .xlsx/.xls (não um .xlsx binário de verdade — que é um ZIP).
      Lendo os bytes crus sem decodificar como texto nesse caso, o SheetJS
      pode interpretar a acentuação errado. Por isso checamos a assinatura
      do arquivo (ZIP começa com "PK") e, se não for ZIP, decodificamos os
      bytes como texto nós mesmos antes de entregar ao SheetJS.
   2) Em vez de deixar o SheetJS montar os objetos (modo "objeto"), lemos a
      planilha como matriz bruta e casamos cada valor com o cabeçalho da
      MESMA posição de coluna — evita um desalinhamento observado em
      planilhas com colunas mescladas/cabeçalho irregular, onde um valor que
      devia cair em "Bairro" aparecia em "Cidade". */
function pareceZipBinario(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function decodificarTexto(bytes) {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (utf8.indexOf("�") === -1) return utf8;
  try {
    const win1252 = new TextDecoder("windows-1252").decode(bytes);
    if (win1252.indexOf("�") === -1) return win1252;
  } catch (e) { /* mantém o resultado em utf-8 mesmo assim */ }
  return utf8;
}

function matrizParaLinhas(matriz) {
  if (!matriz || !matriz.length) return [];
  const vistos = {};
  const cabecalhos = matriz[0].map((h, i) => {
    let nome = String(h == null ? "" : h).trim() || `Coluna${i + 1}`;
    if (vistos[nome]) { vistos[nome]++; nome = `${nome}_${vistos[nome]}`; }
    else vistos[nome] = 1;
    return nome;
  });
  return matriz.slice(1)
    .filter((linha) => linha && linha.some((v) => v != null && String(v).trim() !== ""))
    .map((linha) => {
      const obj = {};
      cabecalhos.forEach((h, i) => { obj[h] = linha[i] == null ? "" : linha[i]; });
      return obj;
    });
}

/** Lê a primeira aba do arquivo e devolve um array de objetos {cabeçalho: valor}. */
export function lerPlanilhaAnalise360(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = (ev) => {
      try {
        const bytes = new Uint8Array(ev.target.result);
        const fonte = pareceZipBinario(bytes) ? bytes : decodificarTexto(bytes);
        const wb = typeof fonte === "string"
          ? window.XLSX.read(fonte, { type: "string", cellDates: true })
          : window.XLSX.read(fonte, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const matriz = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
        resolve(matrizParaLinhas(matriz));
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ------------------------------ utilitários de valor ------------------------------ */

function paraNumero(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function paraData(v) {
  if (!v) return null;
  let d;
  if (v instanceof Date) d = v;
  else {
    const s = String(v).trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    else { const parsed = new Date(s); if (!isNaN(parsed)) d = parsed; }
  }
  return d && !isNaN(d) ? d : null;
}

function paraDataISO(v) {
  const d = paraData(v);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizarNomeColuna(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Acha uma coluna da planilha por "parecença" de nome, ignorando acento,
 *  maiúscula/minúscula e espaçamento. */
function acharColunaFlex(row, candidatos) {
  const chaves = Object.keys(row || {});
  for (const chave of chaves) {
    if (candidatos.indexOf(normalizarNomeColuna(chave)) >= 0) return row[chave];
  }
  return "";
}

const PREPOSICOES = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1 };
function normalizarChave(v) {
  let s = String(v || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  s = s.toLowerCase().split(" ").map((w, i) => (i > 0 && PREPOSICOES[w] ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  return s.replace(/[.#$/[\]]/g, "-");
}

function contarPor(rows, campo) {
  const out = {};
  rows.forEach((r) => { const k = normalizarChave(r[campo]) || "(Em branco)"; out[k] = (out[k] || 0) + 1; });
  return out;
}

/* ------------------------- normalização de cada tipo de planilha ------------------------- */

/** "Negociações fechadas" — mantém só o essencial de cada linha. */
function trimNegociacoes(rows) {
  return rows.map((r) => ({
    data: paraDataISO(r["Data Fechamento"]) || paraDataISO(r["Data Status"]),
    valorNegociado: paraNumero(r["Valor Negociado"]),
    valorComissao: paraNumero(r["Valor Comissão"]),
    responsavel: String(r["Responsável pelo Negócio"] || "").trim(),
    tipo: String(r["Tipo da Negociação"] || "").trim(),
  }));
}

/** "Atendimentos" (usado para Vendas) — mesma normalização da v1.0. */
function trimAtendimentos(rows) {
  return rows.map((r) => ({
    data: paraDataISO(r["Data atendimento"]),
    dataCadastro: paraDataISO(r["Data Cadastro"]) || paraDataISO(r["Data de Cadastro"]) || paraDataISO(r["Data do Cadastro"]) || paraDataISO(r["Data atendimento"]),
    corretor: String(r["Corretor"] || "").trim(),
    midia: String(r["Mídia"] || "").trim(),
    etapa: String(r["Etapa"] || "").trim(),
    cliente: String(r["Cliente"] || r["Nome"] || r["Nome do Cliente"] || "").trim(),
    telefone: String(r["Telefones"] || r["Telefone"] || r["Telefone Cliente"] || r["Celular"] || "").trim(),
    imoveisInteresse: String(r["Imóveis de interesse"] || acharColunaFlex(r, ["imoveisdeinteresse", "imovelinteresse", "imoveldeinteresse", "imoveisinteresse", "imoveisinteressado", "imovelinteressado"]) || "").trim(),
  }));
}

/** Imóveis (ativos/inativos) — versão "crua", uma linha por imóvel. */
function trimImoveis(rows) {
  return rows.map((r) => ({
    tipo: String(r["Tipo"] || "").trim(),
    cidade: String(r["Cidade"] || "").trim(),
    bairro: String(r["Bairro"] || "").trim(),
    finalidade: String(r["Finalidade"] || "").trim(),
    valorVenda: paraNumero(r["Valor Venda"]),
    valorLocacao: paraNumero(r["Valor Locação"]),
    referencia: String(r["Referência"] || acharColunaFlex(r, ["referencia", "ref", "codigo", "codigoimovel"]) || "").trim(),
  }));
}

function agregarImoveis(rows, modo) {
  let linhasContagem = rows;
  if (modo === "venda") linhasContagem = rows.filter((r) => r.valorVenda > 0);
  else if (modo === "locacao") linhasContagem = rows.filter((r) => r.valorLocacao > 0);
  const valoresVenda = [], valoresLocacao = [];
  rows.forEach((r) => { if (r.valorVenda > 0) valoresVenda.push(r.valorVenda); if (r.valorLocacao > 0) valoresLocacao.push(r.valorLocacao); });
  const soma = (arr) => arr.reduce((a, b) => a + b, 0);
  return {
    total: linhasContagem.length,
    porTipo: contarPor(linhasContagem, "tipo"),
    porCidade: contarPor(linhasContagem, "cidade"),
    porBairro: contarPor(linhasContagem, "bairro"),
    porFinalidade: contarPor(linhasContagem, "finalidade"),
    ticketMedioVenda: valoresVenda.length ? soma(valoresVenda) / valoresVenda.length : 0,
    ticketMedioLocacao: valoresLocacao.length ? soma(valoresLocacao) / valoresLocacao.length : 0,
  };
}

/* ---------------------- compressão das linhas de imóveis ---------------------- */

/* Guardar "São Bernardo do Campo" escrito por extenso em milhares de linhas
 *  pesa à toa, já que só existem algumas dezenas de cidades/bairros/tipos
 *  diferentes no total — aqui trocamos o texto repetido por um índice num
 *  dicionário pequeno gravado uma vez só. Só um detalhe de armazenamento: o
 *  resto do código sempre trabalha com o formato "por extenso". */
function comprimirLinhasImoveis(linhas) {
  const dicTipos = [], idxTipos = {};
  const dicCidades = [], idxCidades = {};
  const dicBairros = [], idxBairros = {};
  const dicFinalidades = [], idxFinalidades = {};
  function idxDe(valor, dic, idx) {
    const chave = valor || "";
    if (!Object.prototype.hasOwnProperty.call(idx, chave)) { idx[chave] = dic.length; dic.push(chave); }
    return idx[chave];
  }
  const itens = (linhas || []).map((r) => ({
    t: idxDe(r.tipo, dicTipos, idxTipos),
    c: idxDe(r.cidade, dicCidades, idxCidades),
    b: idxDe(r.bairro, dicBairros, idxBairros),
    f: idxDe(r.finalidade, dicFinalidades, idxFinalidades),
    v: r.valorVenda || 0,
    l: r.valorLocacao || 0,
    ref: r.referencia || "",
  }));
  return { dic: { tipos: dicTipos, cidades: dicCidades, bairros: dicBairros, finalidades: dicFinalidades }, itens };
}

function descomprimirLinhasImoveis(compacto) {
  if (!compacto || !Array.isArray(compacto.itens)) return [];
  const dic = compacto.dic || {};
  const tipos = dic.tipos || [], cidades = dic.cidades || [], bairros = dic.bairros || [], finalidades = dic.finalidades || [];
  return compacto.itens.map((it) => ({
    tipo: tipos[it.t] || "",
    cidade: cidades[it.c] || "",
    bairro: bairros[it.b] || "",
    finalidade: finalidades[it.f] || "",
    valorVenda: it.v || 0,
    valorLocacao: it.l || 0,
    referencia: it.ref || "",
  }));
}

/* ------------------------- camada de armazenamento no Firestore ------------------------- */

const TAMANHO_CHUNK = 500;
const LOTE_FIRESTORE = 450; // folga em relação ao limite de 500 operações por batch do Firestore

function dividirEmChunks(arr, tamanho) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += tamanho) chunks.push(arr.slice(i, i + tamanho));
  return chunks;
}

/** Grava "itens" numa coleção do Firestore, dividida em chunks, e apaga
 *  qualquer chunk antigo que tenha sobrado de um envio anterior maior que
 *  este. `progresso(feito,total)` é opcional, usado só para status na tela. */
async function gravarColecaoEmChunks(nomeColecao, itens, metaExtra, progresso) {
  const col = firestore.collection(nomeColecao);
  const snapshotAntigo = await col.get();
  const idsAntigos = snapshotAntigo.docs.map((d) => d.id).filter((id) => id.indexOf("chunk_") === 0);

  const chunksNovos = dividirEmChunks(itens || [], TAMANHO_CHUNK);
  const operacoes = [];
  chunksNovos.forEach((chunk, i) => operacoes.push({ tipo: "set", id: `chunk_${i}`, dados: { itens: chunk } }));
  idsAntigos.forEach((id) => {
    const indice = Number(id.replace("chunk_", ""));
    if (!(indice < chunksNovos.length)) operacoes.push({ tipo: "delete", id });
  });
  operacoes.push({ tipo: "set", id: "_meta", dados: { totalChunks: chunksNovos.length, totalItens: (itens || []).length, ...(metaExtra || {}) } });

  for (let i = 0; i < operacoes.length; i += LOTE_FIRESTORE) {
    const lote = firestore.batch();
    operacoes.slice(i, i + LOTE_FIRESTORE).forEach((op) => {
      const ref = col.doc(op.id);
      if (op.tipo === "delete") lote.delete(ref); else lote.set(ref, op.dados);
    });
    await lote.commit();
    if (progresso) progresso(Math.min(i + LOTE_FIRESTORE, operacoes.length), operacoes.length);
  }
}

async function lerColecaoEmChunks(nomeColecao) {
  const col = firestore.collection(nomeColecao);
  const snap = await col.get();
  const metaDoc = snap.docs.find((d) => d.id === "_meta");
  const meta = metaDoc ? metaDoc.data() : null;
  const chunks = snap.docs
    .filter((d) => d.id.indexOf("chunk_") === 0)
    .sort((a, b) => Number(a.id.replace("chunk_", "")) - Number(b.id.replace("chunk_", "")));
  let itens = [];
  chunks.forEach((d) => { const dados = d.data(); if (dados && Array.isArray(dados.itens)) itens = itens.concat(dados.itens); });
  return { itens, meta };
}

async function gravarImoveisFirestore(nomeColecao, linhasVerbosas, metaExtra, progresso) {
  const comprimido = comprimirLinhasImoveis(linhasVerbosas || []);
  await gravarColecaoEmChunks(nomeColecao, comprimido.itens, { dic: comprimido.dic, ...(metaExtra || {}) }, progresso);
}

async function lerImoveisFirestore(nomeColecao) {
  const resultado = await lerColecaoEmChunks(nomeColecao);
  if (!resultado.meta) return { linhas: [], meta: null };
  const linhas = descomprimirLinhasImoveis({ dic: resultado.meta.dic, itens: resultado.itens });
  return { linhas, meta: resultado.meta };
}

/** Só a "_meta" de cada coleção (sem baixar os chunks inteiros) — usado para
 *  mostrar "última atualização" na tela de Configurações sem gastar leitura
 *  à toa. */
async function lerMeta(nomeColecao) {
  try {
    const doc = await firestore.collection(nomeColecao).doc("_meta").get();
    return doc.exists ? doc.data() : null;
  } catch (e) {
    return null;
  }
}

/* ------------------------------- API pública ------------------------------- */

/** Um item por tipo de planilha aceito na importação — usado tanto para
 *  montar a tela quanto para processar o arquivo certo com a regra certa.
 *  Os nomes das coleções são os MESMOS já usados desde a v1.0: dados que já
 *  estão no Firestore de produção continuam sendo lidos/substituídos
 *  corretamente por esta tela nova. */
export const ANALISE360_TIPOS = [
  { id: "negociacoes", label: "Negociações fechadas", colecao: "analise360Negociacoes", imoveis: false },
  { id: "atendimentosVendas", label: "Atendimentos — Vendas", colecao: "analise360AtendimentosVendas", imoveis: false },
  { id: "imoveisAtivos", label: "Imóveis ativos", colecao: "analise360ImoveisAtivos", imoveis: true },
  { id: "imoveisInativos", label: "Imóveis inativos", colecao: "analise360ImoveisInativos", imoveis: true },
];

/** Busca a "_meta" das 4 coleções de uma vez, para mostrar o status atual
 *  ("última atualização em X por Y, N itens") na tela de Configurações. */
export async function lerStatusAnalise360() {
  const metas = await Promise.all(ANALISE360_TIPOS.map((t) => lerMeta(t.colecao)));
  const status = {};
  ANALISE360_TIPOS.forEach((t, i) => { status[t.id] = metas[i]; });
  return status;
}

/** Lê o arquivo, normaliza as linhas conforme o tipo e grava no Firestore —
 *  SUBSTITUINDO só a coleção desse tipo. `progresso(feito,total)` opcional. */
export async function importarPlanilhaAnalise360(tipoId, file, { nome } = {}, progresso) {
  const tipo = ANALISE360_TIPOS.find((t) => t.id === tipoId);
  if (!tipo) throw new Error(`Tipo de planilha desconhecido: ${tipoId}`);
  if (!window.XLSX) throw new Error("Biblioteca de planilhas não carregou. Verifique sua conexão e tente novamente.");
  if (!firestore) throw new Error("Firestore não está disponível.");

  const linhas = await lerPlanilhaAnalise360(file);
  const agora = new Date().toISOString();
  const metaExtra = { atualizadoEm: agora, atualizadoPor: nome || "" };

  let totalItens;
  if (tipo.imoveis) {
    const trimmed = trimImoveis(linhas);
    const agregados = { geral: agregarImoveis(trimmed), venda: agregarImoveis(trimmed, "venda"), locacao: agregarImoveis(trimmed, "locacao") };
    await gravarImoveisFirestore(tipo.colecao, trimmed, { ...metaExtra, agregados }, progresso);
    totalItens = trimmed.length;
  } else {
    const trimmed = tipo.id === "negociacoes" ? trimNegociacoes(linhas) : trimAtendimentos(linhas);
    await gravarColecaoEmChunks(tipo.colecao, trimmed, metaExtra, progresso);
    totalItens = trimmed.length;
  }
  return { totalItens, atualizadoEm: agora, atualizadoPor: nome || "" };
}

// Exportadas para o futuro módulo de leitura/relatório da Análise 360°
// (ainda não portado) reaproveitar sem reimplementar nada disso.
export { lerColecaoEmChunks, lerImoveisFirestore };
