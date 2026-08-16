/* Calcula os pesos por tema a partir dos dados de prevalência levantados.
 *
 * Modelo: valor esperado do tema = (fatia da área na prova / nº de temas da
 * área) × fator de incidência do tema dentro da área. Depois disso, os pesos
 * 1-3 saem de tercis — não de opinião.
 */
import { SEMENTE } from "../logica.js";

/* ---------- fatia de cada área, por prova ----------
   ENAMED: análise de ~1.600 questões em 16-17 edições INEP (série Revalida +
   ENAMED), convergente entre SPR Med e Amo Resumos.
   SES-DF: Anexo II do edital oficial — 80 questões, 16 de cada uma das cinco
   áreas. Divisão exatamente igual. */
const FATIA = {
  enamed: {
    "Clínica Médica": 28,
    "Ginecologia e Obstetrícia": 21,
    "Cirurgia": 19,
    "Pediatria": 19,
    "Medicina Preventiva": 12,
    "Saúde Mental": 5,
    "Medicina de Família e Comunidade": 5,   // menos certo: área nova da matriz
  },
  sesdf: {
    "Clínica Médica": 20,
    "Cirurgia": 20,
    "Ginecologia e Obstetrícia": 20,
    "Pediatria": 20,
    "Medicina Preventiva": 20,
    // Não são áreas da SES-DF: o conteúdo entra dentro de Clínica e Preventiva.
    "Saúde Mental": 2,
    "Medicina de Família e Comunidade": 4,
  },
};

/* ---------- incidência do tema dentro da área ----------
   Alta = citado nas listas de mais cobrados (top-10 ENAMED, top-5 por área do
   Revalida, recortes de Preventiva). Baixa = não citado em fonte nenhuma. */
const ALTA = new Set([
  // Clínica — top-10 ENAMED + Sanar (infecto, endócrino, cardio) + Medway
  "Sepse e choque", "Diabetes mellitus e complicações agudas",
  "Síndromes coronarianas agudas", "Insuficiência cardíaca",
  "Pneumonias e derrame pleural", "Tuberculose", "HIV e infecções oportunistas",
  "Hipertensão arterial sistêmica", "Asma e DPOC", "Tireoidopatias",
  "Arritmias e fibrilação atrial", "AVC e emergências neurológicas",
  // Cirurgia — abdome agudo, vias biliares, trauma, tumores do TGI
  "Abdome agudo inflamatório", "Apendicite aguda", "Colecistite e coledocolitíase",
  "Trauma — ABCDE e ATLS", "Trauma abdominal e torácico",
  "Câncer gástrico e colorretal", "Pré e pós-operatório",
  // GO — infecções na gestação (tema nº1), parto, rastreio, contracepção
  "Pré-natal de baixo risco", "Infecções congênitas", "Trabalho de parto e partograma",
  "Rastreio e lesões do colo — HPV/NIC", "Contracepção",
  "Hemorragias da primeira metade", "Síndrome dos ovários policísticos",
  "Síndromes hipertensivas da gestação",
  // Pediatria — puericultura, neonatologia, vacinas, pneumo, gastro
  "Crescimento e desenvolvimento", "Reanimação neonatal", "Icterícia neonatal",
  "Calendário vacinal", "Pneumonia e bronquiolite", "Diarreia e desidratação",
  "Aleitamento materno",
  // Preventiva — ética (22% da área), MFC, SUS, epidemiologia, rastreamento
  "Ética médica e bioética", "SUS — princípios e Leis 8.080/8.142",
  "Atenção primária e ESF", "Tipos de estudo epidemiológico",
  "Testes diagnósticos — S, E, VPP, VPN", "Vigilância e notificação compulsória",
  "Medidas de associação e impacto",
  // Saúde Mental — depressão, suicídio, álcool, ansiedade
  "Transtornos depressivos", "Risco de suicídio e manejo da crise",
  "Álcool — intoxicação e abstinência", "Transtornos de ansiedade",
  // MFC — prevenção quaternária, crônicas na APS, método clínico
  "Prevenção quaternária e rastreamento", "Hipertensão e diabetes na atenção primária",
  "Método clínico centrado na pessoa",
]);

const BAIXA = new Set([
  "Leucemias e linfomas", "Cefaleias e epilepsia", "Distúrbios ácido-base",
  "Urologia — litíase e HPB", "Doença arterial e venosa periférica",
  "Hérnias da parede abdominal", "Queimaduras",
  "Climatério e terapia hormonal", "Endometriose",
  "ITU e refluxo vesicoureteral", "Doenças exantemáticas",
  "Saúde do trabalhador", "Indicadores de saúde",
  "Registro clínico orientado por problemas", "Territorialização e trabalho em equipe",
  "Transtornos por uso de substâncias", "RAPS e reforma psiquiátrica",
  "Transtorno afetivo bipolar",
]);

const fator = (nome) => (ALTA.has(nome) ? 1.6 : BAIXA.has(nome) ? 0.6 : 1.0);

/* ---------- cálculo ---------- */
const porArea = {};
for (const [area] of SEMENTE) porArea[area] = (porArea[area] ?? 0) + 1;

const valores = {};
for (const perfil of ["enamed", "sesdf"]) {
  valores[perfil] = SEMENTE.map(([area, nome]) =>
    (FATIA[perfil][area] / porArea[area]) * fator(nome));
}

// Tercis por perfil: o peso é posição relativa, não número absoluto.
const corte = (arr) => {
  const o = [...arr].sort((a, b) => a - b);
  return [o[Math.floor(o.length / 3)], o[Math.floor((o.length * 2) / 3)]];
};
const cortes = { enamed: corte(valores.enamed), sesdf: corte(valores.sesdf) };
const peso = (v, perfil) => (v >= cortes[perfil][1] ? 3 : v >= cortes[perfil][0] ? 2 : 1);

console.log("temas por área:", porArea);
console.log("cortes (tercis):", cortes);

const linhas = SEMENTE.map(([area, nome], i) => {
  const pe = peso(valores.enamed[i], "enamed");
  const ps = peso(valores.sesdf[i], "sesdf");
  return `["${area}","${nome}",${pe},${ps}],`;
});

console.log("\n--- mudanças em relação ao peso editorial atual ---");
let mudou = 0;
SEMENTE.forEach(([area, nome, e0, s0], i) => {
  const pe = peso(valores.enamed[i], "enamed");
  const ps = peso(valores.sesdf[i], "sesdf");
  if (pe !== e0 || ps !== s0) {
    mudou++;
    console.log(`${nome.padEnd(46)} ENAMED ${e0}→${pe}   SES-DF ${s0}→${ps}`);
  }
});
console.log(`\n${mudou} de ${SEMENTE.length} temas mudaram.`);

console.log("\n--- valor médio por tema, por área (ENAMED / SES-DF) ---");
for (const area of Object.keys(porArea)) {
  const idx = SEMENTE.map((s, i) => [s[0], i]).filter(([a]) => a === area).map(([, i]) => i);
  const m = (p) => (idx.reduce((s, i) => s + valores[p][i], 0) / idx.length).toFixed(2);
  console.log(`${area.padEnd(36)} ${m("enamed")}  /  ${m("sesdf")}`);
}

import { writeFileSync } from "node:fs";
writeFileSync(new URL("./semente.txt", import.meta.url), linhas.join("\n"));
