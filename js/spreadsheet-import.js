/* Leitura de planilhas (.xlsx/.xls/.csv) usando a biblioteca SheetJS,
   carregada via CDN em index.html como `window.XLSX`. Retorna a primeira
   aba como uma matriz de linhas (array de arrays), cabeçalho incluso. */

export function readSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        resolve(rows.filter((r) => r.some((cell) => String(cell).trim() !== "")));
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
