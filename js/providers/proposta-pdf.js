/* =========================================================================
   Geração da "Proposta de Compra de Imóvel" em PDF, a partir dos dados já
   preenchidos no card da negociação — modelo NPC 01, fielmente reproduzido
   (mesmo texto de intermediação e das cláusulas 1, 2 e 3, que são sempre
   iguais, conforme combinado).

   A função é dividida em duas partes de propósito:
   - `buildPropostaTexto(card)` monta todo o texto (puro, sem tocar em PDF/
     DOM), o que permite testar a lógica de preenchimento isoladamente.
   - `gerarPropostaPDF(card)` usa o jsPDF (carregado via CDN em index.html,
     window.jspdf) para desenhar esse texto em um PDF e baixá-lo.
   ========================================================================= */

import { parseMoneyLoose, formatMoneyBR, formatEnderecoImovel } from "./kanban-defaults.js";

/* --------------------------- Valor por extenso --------------------------- */

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
const ESCALAS = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"], ["trilhão", "trilhões"]];

function grupo3PorExtenso(num) {
  if (num === 0) return "";
  if (num === 100) return "cem";
  const c = Math.floor(num / 100);
  const resto = num % 100;
  const partes = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 10) partes.push(UNIDADES[resto]);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
    else {
      const d = Math.floor(resto / 10), u = resto % 10;
      partes.push(u === 0 ? DEZENAS[d] : `${DEZENAS[d]} e ${UNIDADES[u]}`);
    }
  }
  return partes.join(" e ");
}

/** Escreve um inteiro por extenso (sem a palavra "reais"/"real"). */
export function extensoInteiro(n) {
  if (n === 0) return "zero";
  const grupos = [];
  let resto = n;
  while (resto > 0) { grupos.push(resto % 1000); resto = Math.floor(resto / 1000); }

  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    let texto;
    if (i === 1 && g === 1) texto = "mil";
    else {
      texto = grupo3PorExtenso(g);
      if (i > 0) texto += " " + (g === 1 ? ESCALAS[i][0] : ESCALAS[i][1]);
    }
    partes.push({ texto, valor: g });
  }

  let resultado = "";
  partes.forEach((p, idx) => {
    if (idx === 0) { resultado = p.texto; return; }
    const ultimo = idx === partes.length - 1;
    resultado += (ultimo && p.valor < 100) ? ` e ${p.texto}` : `, ${p.texto}`;
  });
  return resultado;
}

/** "500000" -> "quinhentos mil reais"; "1000000" -> "um milhão de reais"
 *  (regra do "de" antes de reais quando o valor é um milhão/bilhão exato,
 *  sem milhares/unidades restantes). */
export function valorPorExtenso(valorReais) {
  const inteiro = Math.floor(valorReais + 1e-9);
  const centavos = Math.round((valorReais - inteiro) * 100);
  const precisaDe = inteiro >= 1000000 && inteiro % 1000000 === 0;
  let texto = extensoInteiro(inteiro) + (precisaDe ? " de " : " ") + (inteiro === 1 ? "real" : "reais");
  if (centavos > 0) texto += " e " + extensoInteiro(centavos) + (centavos === 1 ? " centavo" : " centavos");
  return texto;
}

/* ------------------------------ Textos fixos ------------------------------ */

export const INTERMEDIACAO_TEXTO = "A presente negociação é intermediada pela imobiliária NA PONTA DA CHAVE, inscrita no CNPJ nº 32.250.936/0001-67, CRECI nº 33.008-J, com sede na Rua Continental, nº 598 – Jardim do Mar – São Bernardo do Campo - SP, neste ato representada por seu responsável legal, Gregory Willy da Silva Nobre, brasileiro, casado, corretor de imóveis, portador da cédula de identidade RG nº 24.969.395-1, inscrito no CPF nº 351.854.888-32 e CRECI 158265-F.";

export const CLAUSULAS_TEXTO = [
  "1. A presente proposta, foi aceita pelas partes e tem caráter irrevogável e irretratável, devendo ser ratificada por meio de Instrumento Particular de Compromisso de Compra e Venda, após a apresentação das certidões negativas em nome dos vendedores e do imóvel. (due diligence)",
  "2. Havendo qualquer irregularidade irreversível na documentação dos vendedores, do imóvel ou na documentação pessoal do comprador, a presente proposta será cancelada, sem ônus para ambas as partes.",
  "3. A parte que desistir do negócio por motivo injustificado, pagará uma multa compensatória no valor de 10% do valor do bem, bem como arcará com a comissão da imobiliária, conforme ajustado.",
];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/* --------------------------- Montagem dos textos --------------------------- */

/** Monta o bloco de qualificação de uma pessoa (vendedor ou comprador),
 *  linha a linha, no mesmo formato do modelo NPC 01. Quando a pessoa reside
 *  no próprio imóvel negociado, usa o endereço do imóvel (se já preenchido)
 *  em vez do texto genérico, já que a proposta pede o endereço de fato. */
function pessoaParaLinhas(p, card) {
  const enderecoResidencia = p.mesmoEndereco !== "nao"
    ? (formatEnderecoImovel(card) || "Mesmo endereço do imóvel negociado")
    : (p.endereco || "");
  return [
    `Nome: ${p.nome || ""}`,
    `Nacionalidade: ${p.nacionalidade || ""}`,
    `Estado Civil: ${p.estadoCivil || ""}`,
    `Profissão: ${p.profissao || ""}`,
    `RG nº: ${p.rg || ""}`,
    `CPF nº: ${p.cpf || ""}`,
    `Endereço: ${enderecoResidencia}`,
  ];
}

function blocosPessoas(lista, card) {
  const multiplos = lista.length > 1;
  return lista.map((p, i) => ({
    titulo: multiplos ? `${i + 1}.` : null,
    linhas: pessoaParaLinhas(p, card),
  }));
}

function imovelTexto(card) {
  const partes = [];
  const endereco = formatEnderecoImovel(card);
  if (endereco) partes.push(`localizado em ${endereco}`);
  if (card.matriculaImovel) partes.push(`registrado sob a matrícula nº ${card.matriculaImovel}`);
  if (card.inscricaoImobiliaria) partes.push(`inscrição imobiliária (IPTU) nº ${card.inscricaoImobiliaria}`);
  if (!partes.length) return "[DESCRIÇÃO DO IMÓVEL]";
  return `Imóvel ${partes.join(", ")}.`;
}

function condicoesPagamentoTexto(card) {
  const validas = (card.paymentConditions || []).filter((p) => p.forma || parseMoneyLoose(p.valor) > 0);
  if (!validas.length) return "[DESCREVER FORMA DE PAGAMENTO – recursos próprios / financiamento / FGTS, etc.]";
  return validas.map((p) => {
    const partes = [p.forma || "Condição de pagamento"];
    const v = parseMoneyLoose(p.valor);
    if (v > 0) partes.push(`no valor de ${formatMoneyBR(v)}`);
    if (p.observation) partes.push(`(${p.observation})`);
    return partes.join(" ");
  }).join("; ") + ".";
}

/** Monta o texto completo da proposta a partir do card, e sinaliza quais
 *  campos essenciais ainda não foram preenchidos (para avisar quem for
 *  gerar o PDF) — sem impedir a geração, já que o próprio modelo original
 *  usa colchetes como "[VALOR]" para o que falta preencher. */
export function buildPropostaTexto(card) {
  const valor = parseMoneyLoose(card.valorVenda);
  const camposFaltando = [];
  if (!valor) camposFaltando.push("Valor da venda");
  if (!(card.vendedores || []).some((p) => p.nome)) camposFaltando.push("Nome do(a) vendedor(a)");
  if (!(card.compradores || []).some((p) => p.nome)) camposFaltando.push("Nome do(a) comprador(a)");
  if (!formatEnderecoImovel(card)) camposFaltando.push("Endereço completo do imóvel");
  if (!card.matriculaImovel) camposFaltando.push("Matrícula do imóvel");
  if (!card.inscricaoImobiliaria) camposFaltando.push("Inscrição imobiliária (IPTU)");
  if (!(card.paymentConditions || []).some((p) => p.forma || parseMoneyLoose(p.valor) > 0)) camposFaltando.push("Condições de pagamento");

  const hoje = new Date();

  return {
    titulo: "PROPOSTA DE COMPRA DE IMÓVEL",
    vendedores: blocosPessoas(card.vendedores || [], card),
    compradores: blocosPessoas(card.compradores || [], card),
    imovel: imovelTexto(card),
    intermediacao: INTERMEDIACAO_TEXTO,
    propostaCondicoes: valor
      ? `O valor ajustado para a presente proposta é de ${formatMoneyBR(valor)} (${valorPorExtenso(valor)}), a ser pago da seguinte forma: ${condicoesPagamentoTexto(card)}`
      : `O valor ajustado para a presente proposta é de R$ [VALOR] ([VALOR POR EXTENSO]), a ser pago da seguinte forma: ${condicoesPagamentoTexto(card)}`,
    clausulas: CLAUSULAS_TEXTO,
    dataLocal: `São Bernardo do Campo, ${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}.`,
    camposFaltando,
  };
}

/* ------------------------------- Geração PDF ------------------------------- */

function escreverParagrafo(doc, texto, x, y, maxWidth, lineHeight) {
  const linhas = doc.splitTextToSize(texto, maxWidth);
  linhas.forEach((linha) => {
    if (y > 277) { doc.addPage(); y = 20; }
    doc.text(linha, x, y);
    y += lineHeight;
  });
  return y;
}

/** Logo usado no cabeçalho da proposta impressa (fundo claro, com a tag-line
 *  "Seu lar, nossa missão") — é a mesma imagem que já vinha no cabeçalho do
 *  modelo em Word, extraída para arquivo próprio porque o logo usado no
 *  topo/menu da intranet (`assets/logo.png`) foi feito para fundo escuro e
 *  fica com o texto "invisível" em cima do branco do PDF. Carregada uma vez
 *  e reaproveitada nas próximas gerações na mesma sessão. */
// Resolvida a partir da localização deste módulo (não da página que o
// importou) para funcionar tanto no app publicado quanto nas páginas de
// teste em test/, que vivem em pastas diferentes.
const LOGO_PROPOSTA_URL = new URL("../../assets/logo-documentos.png", import.meta.url).href;
let logoDataUrlPromise = null;
function carregarLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch(LOGO_PROPOSTA_URL)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("logo não encontrado"))))
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("falha ao ler o logo"));
        reader.readAsDataURL(blob);
      }))
      .catch(() => null); // sem logo não impede a geração do restante da proposta
  }
  return logoDataUrlPromise;
}

/** Gera e baixa o PDF da proposta preenchida com os dados do card.
 *  Retorna a lista de campos faltando (mesmo depois de gerar o PDF, pra
 *  quem chamou poder avisar o usuário). Lança se o jsPDF não tiver
 *  carregado (falha de rede ao buscar o script no CDN, por exemplo). */
export async function gerarPropostaPDF(card) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("Biblioteca de geração de PDF não carregou. Verifique sua conexão e tente novamente.");
  }
  const texto = buildPropostaTexto(card);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margemX = 20;
  const largura = 210 - margemX * 2;
  let y = 15;

  const logoDataUrl = await carregarLogoDataUrl();
  if (logoDataUrl) {
    const logoLargura = 55.5;
    const logoAltura = logoLargura * (262 / 761); // mesma proporção do logo original
    doc.addImage(logoDataUrl, "PNG", 105 - logoLargura / 2, y, logoLargura, logoAltura);
    y += logoAltura + 6;
  } else {
    y = 22;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(texto.titulo, 105, y, { align: "center" });
  y += 12;

  doc.setFontSize(11);

  function secao(rotulo, corpoFn) {
    doc.setFont("helvetica", "bold");
    y = escreverParagrafo(doc, rotulo, margemX, y, largura, 5.5);
    doc.setFont("helvetica", "normal");
    y = corpoFn(y);
    y += 4;
  }

  secao("VENDEDOR(ES):", (yy) => {
    texto.vendedores.forEach((bloco) => {
      if (bloco.titulo) { yy = escreverParagrafo(doc, bloco.titulo, margemX, yy, largura, 5.5); }
      bloco.linhas.forEach((linha) => { yy = escreverParagrafo(doc, linha, margemX, yy, largura, 5.5); });
      yy += 2;
    });
    return yy;
  });

  secao("COMPRADOR(ES):", (yy) => {
    texto.compradores.forEach((bloco) => {
      if (bloco.titulo) { yy = escreverParagrafo(doc, bloco.titulo, margemX, yy, largura, 5.5); }
      bloco.linhas.forEach((linha) => { yy = escreverParagrafo(doc, linha, margemX, yy, largura, 5.5); });
      yy += 2;
    });
    return yy;
  });

  secao("IMÓVEL:", (yy) => escreverParagrafo(doc, texto.imovel, margemX, yy, largura, 5.5));
  secao("INTERMEDIAÇÃO:", (yy) => escreverParagrafo(doc, texto.intermediacao, margemX, yy, largura, 5.5));
  secao("PROPOSTA E CONDIÇÕES:", (yy) => escreverParagrafo(doc, texto.propostaCondicoes, margemX, yy, largura, 5.5));

  texto.clausulas.forEach((clausula) => {
    y = escreverParagrafo(doc, clausula, margemX, y, largura, 5.5);
    y += 3;
  });

  y += 8;
  doc.text(texto.dataLocal, margemX + largura, y, { align: "right" });

  const nomeArquivo = `Proposta - ${card.title || "negociacao"}.pdf`.replace(/[\\/:*?"<>|]/g, "-");
  doc.save(nomeArquivo);
  return texto.camposFaltando;
}
