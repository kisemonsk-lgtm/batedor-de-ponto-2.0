/* =========================================================
   Ponto Digital — CAS Construtora de Armazéns e Silos
   Dados salvos no navegador (localStorage)
   ========================================================= */
(function () {
  "use strict";

  const CHAVE = "cas-ponto-v1";
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                 "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const MESES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  /* nomes reais com semana começando no DOMINGO (getDay 0 = domingo) */
  const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const SEMANA_EXT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  /* versão da lista oficial do funcionarios.js — é usada já no carregamento */
  const LISTA_VERSAO = 9;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const hoje = new Date();
  const HOJE_ISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

  /* ---------------- estado ---------------- */
  let estado = carregar();
  let diaSelecionado = hoje.getDate();
  let editandoId = null;

  function carregar() {
    try {
      const bruto = localStorage.getItem(CHAVE);
      if (bruto) {
        const dados = JSON.parse(bruto);
        if (dados && Array.isArray(dados.funcionarios) && dados.funcionarios.length) {
          // NÃO chama sincronizarListaInicial aqui: quem foi excluído não pode voltar
          dados.listaVersao = LISTA_VERSAO;
          const pronto = normalizar(dados);
          if (pronto.registrosImportados !== 1) {
            importarRegistrosOficiais(pronto);
            pronto.registrosImportados = 1;   // roda uma única vez por aparelho
          }
          return pronto;
        }
      }
      // lista principal vazia ou corrompida: tenta o backup automático
      const reserva = lerBackupFuncionarios();
      if (reserva) {
        console.warn("Restaurando lista de funcionários do backup automático");
        return normalizar({ funcionarios: reserva, registros: {}, config: {} });
      }
    } catch (e) { console.warn("Falha ao ler dados salvos", e); }
    const novo = normalizar({
      funcionarios: FUNCIONARIOS_INICIAIS.map(([nome, funcao], i) => ({
        id: "f" + (i + 1), nome, funcao, ativo: true
      })),
      registros: {},
      config: { horaEntrada: "07:00", horaSaida: "16:30", cargaDiaria: 8, tolerancia: 5, valorHora: 0, diasUteis: 22, fator: 50, horaPadrao: "07:00", saidaPadrao: "16:30", almocoPadrao: "11:30", retornoPadrao: "13:00", horaExtra: "18:00" }
    });
    // primeira abertura (ou dados perdidos): traz os lançamentos oficiais já conhecidos
    importarRegistrosOficiais(novo);
    novo.registrosImportados = 1;
    return novo;
  }

  function lerBackupFuncionarios() {
    try {
      const bruto = localStorage.getItem("cas-ponto-funcionarios");
      if (!bruto) return null;
      const d = JSON.parse(bruto);
      if (d && Array.isArray(d.lista) && d.lista.length) return d.lista;
    } catch (e) {}
    return null;
  }

  function normalizar(d) {
    d.funcionarios = (d.funcionarios || []).map((f, i) => {
      const o = {
        id: f.id || "f" + (i + 1),
        nome: String(f.nome || "").trim(),
        funcao: String(f.funcao || "").trim(),
        ativo: f.ativo !== false
      };
      if (f.novo) o.novo = true;      // mantém a marca "novo" de quem foi cadastrado na tela
      return o;
    });
    // quem foi excluído numa tela (ou em outro aparelho) não volta
    const exc = d.excluidos || {};
    if (Object.keys(exc).length) {
      d.funcionarios = d.funcionarios.filter((f) => {
        const e = exc[f.id];
        if (!e) return true;
        return !!(f.recriadoEm && f.recriadoEm > (e.em || 0));
      });
    }
    d.registros = d.registros || {};
    // o carimbo (at) de cada lançamento é mantido: é ele que decide quem vence na nuvem
    d.config = Object.assign({ horaEntrada: "07:00", horaSaida: "16:30", cargaDiaria: 8, tolerancia: 5, valorHora: 0, diasUteis: 22, fator: 50, horaPadrao: "07:00", saidaPadrao: "16:30", almocoPadrao: "11:30", retornoPadrao: "13:00", horaExtra: "18:00" }, d.config || {});
    return d;
  }

  /* ---- backup automático da lista de funcionários (nunca se perde) ---- */
  function backupFuncionarios(imediato) {
    const lista = (estado.funcionarios || []).map((f) => ({ id: f.id, nome: f.nome, funcao: f.funcao, ativo: f.ativo }));
    try {
      localStorage.setItem("cas-ponto-funcionarios", JSON.stringify({ quando: new Date().toISOString(), lista }));
    } catch (e) {}
    // também guarda uma cópia em arquivo (quando o navegador permitir)
    try {
      const blob = new Blob([JSON.stringify({ funcionarios: lista }, null, 2)], { type: "application/json" });
      localStorage.setItem("cas-ponto-funcionarios-arquivo", JSON.stringify({ tamanho: blob.size }));
    } catch (e) {}
  }

  /* ---- atualiza a lista salva quando sai versão nova do funcionarios.js ---- */
  /* só ADICIONA quem entrou na lista; não apaga nem altera quem já está */
  /** importa os lançamentos de 26 a 31/10/2026 (arquivo oficial), casando pelo nome */
  function importarRegistrosOficiais(d) {
    if (typeof REGISTROS_IMPORTADOS === "undefined") return d;
    const chave = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    const idPorNome = new Map(d.funcionarios.map((f) => [chave(f.nome), f.id]));
    let n = 0;
    Object.keys(REGISTROS_IMPORTADOS).forEach((dia) => {
      const doDia = REGISTROS_IMPORTADOS[dia];
      Object.keys(doDia).forEach((fid) => {
        const f = d.funcionarios.find((x) => x.id === fid)
          || d.funcionarios.find((x) => chave(x.nome) === chave((doDia[fid] && doDia[fid].nome) || ""));
        const alvo = f ? f.id : null;
        if (!alvo) return;
        d.registros[dia] = d.registros[dia] || {};
        if (d.registros[dia][alvo]) return;          // já lançado: não sobrescreve
        const r = Object.assign({}, doDia[fid]);
        delete r.nome;
        d.registros[dia][alvo] = r;
        n++;
      });
    });
    if (n) console.info(n + " lançamento(s) importado(s) de outubro");
    return d;
  }

  function sincronizarListaInicial(d) {
    if (!d || d.listaVersao === LISTA_VERSAO) return d;
    const chave = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    const oficiais = FUNCIONARIOS_INICIAIS.map(([nome, funcao]) => ({ nome, funcao, ch: chave(nome) }));
    const porChave = new Map(oficiais.map((o) => [o.ch, o]));
    const antigos = d.funcionarios.slice();
    const usados = new Set(antigos.map((f) => f.id));
    const novo = [];

    // 1) mantém a mesma pessoa (mesmo id, casando pelo nome normalizado)
    oficiais.forEach((o) => {
      const achado = antigos.find((f) => chave(f.nome) === o.ch && !novo.some((x) => x.id === f.id));
      if (achado) {
        achado.nome = o.nome;                 // nome oficial
        if (o.funcao) achado.funcao = o.funcao;
        achado.ativo = achado.ativo !== false;
        novo.push(achado);
      }
    });

    // 2) completa com quem está na lista oficial e ainda não entrou
    let proximo = 1;
    oficiais.forEach((o) => {
      if (novo.some((f) => chave(f.nome) === o.ch)) return;
      while (usados.has("f" + proximo)) proximo++;
      const id = "f" + proximo;
      usados.add(id);
      novo.push({ id, nome: o.nome, funcao: o.funcao, ativo: true });
    });

    // 3) reordena pela lista oficial (a ordem das folhas segue a lista)
    const ordemOficial = new Map(oficiais.map((o, i) => [o.ch, i]));
    novo.sort((x, y) => {
      const ix = ordemOficial.has(chave(x.nome)) ? ordemOficial.get(chave(x.nome)) : 9999;
      const iy = ordemOficial.has(chave(y.nome)) ? ordemOficial.get(chave(y.nome)) : 9999;
      return ix - iy;
    });

    // 4) quem não está na lista oficial fica no fim, como inativo (nada é apagado)
    antigos.forEach((f) => {
      if (novo.some((x) => x.id === f.id)) return;
      if (porChave.has(chave(f.nome))) return;
      f.ativo = false;
      novo.push(f);
    });

    d.funcionarios = novo;
    d.listaVersao = LISTA_VERSAO;
    return d;
  }

  let salvarTimer = null;
  /** grava SÓ no navegador (usado quando a nuvem já tem a versão boa) */
  function salvarLocal() {
    clearTimeout(salvarTimer);
    try {
      estado.atualizadoEm = Date.now();
      localStorage.setItem(CHAVE, JSON.stringify(estado));
      backupFuncionarios();
    } catch (e) { console.warn("Não foi possível salvar neste navegador", e); }
  }

  function salvar(imediato) {
    clearTimeout(salvarTimer);
    const status = $("#statusSalvo");
    status.textContent = "salvando…";
    status.classList.add("pendente");
    const gravar = () => {
      try {
        estado.atualizadoEm = Date.now();
        localStorage.setItem(CHAVE, JSON.stringify(estado));
        backupFuncionarios();
        status.textContent = "salvo";
        status.classList.remove("pendente");
        if (window.CASNuvem) window.CASNuvem.agendarSalvar(estado);
      } catch (e) {
        status.textContent = "erro ao salvar";
        toast("Não foi possível salvar os dados neste navegador.");
      }
    };
    if (imediato) gravar(); else salvarTimer = setTimeout(gravar, 400);
  }

  /* ---------------- utilidades ---------------- */
  const pad = (n) => String(n).padStart(2, "0");
  // m é 0..11 (janeiro = 0), como em todo o app
  const chaveData = (a, m, d) => `${a}-${pad(m + 1)}-${pad(d)}`;
  const diasNoMes = (a, m) => new Date(a, m + 1, 0).getDate();
  const nomeDia = (a, m, d) => new Date(a, m, d).getDay();  // m é 0..11

  function minutos(hhmm) {
    if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return null;
    const [h, mi] = hhmm.split(":").map(Number);
    if (isNaN(h) || isNaN(mi)) return null;
    return h * 60 + mi;
  }
  function paraHoras(min) {
    if (min === null || isNaN(min)) return "";
    const sinal = min < 0 ? "-" : "";
    const abs = Math.abs(min);
    return `${sinal}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
  }
  function fmtDataCurta(a, m, d) { return `${pad(d)}/${pad(m + 1)}/${a}`; }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("on"), 2200);
  }

  /* ---------------- cálculos ---------------- */
  /** registro sem nenhum dado lançado */
  function rVazio(r) {
    return !r || (!r.e && !r.sa && !r.r && !r.s && !r.obs && !r.marca && !r.extra && !r.fator);
  }

  function reg(fid, a, m, d) {
    const k = chaveData(a, m, d);
    const dia = estado.registros[k];
    if (!dia) return null;
    if (dia[fid]) return dia[fid];
    // compatibilidade: se o dia estiver guardado como um único registro (sem separar por pessoa)
    if (dia.e !== undefined || dia.s !== undefined || dia.marca !== undefined) {
      const dono = dia.fid || dia.id;
      if (!dono || dono === fid) return dia;
    }
    return null;
  }

  function garantirReg(fid, a, m, d) {
    const k = chaveData(a, m, d);
    if (!estado.registros[k]) estado.registros[k] = {};
    if (!estado.registros[k][fid]) estado.registros[k][fid] = { e: "", sa: "", r: "", s: "", obs: "", marca: "", extra: "", fator: "" };
    const r = estado.registros[k][fid];
    r.at = Date.now();          // carimbo: diz qual aparelho lançou por último
    return r;
  }

  /** minutos trabalhados; null quando não há dados suficientes */
  function minutosTrabalhados(r, cargaDia) {
    if (!r) return null;
    const e = minutos(r.e), sa = minutos(r.sa), ret = minutos(r.r), s = minutos(r.s);
    if (e === null || s === null) return null;
    let total = s - e;
    const carga = cargaDia || cargaDiariaMin();
    // dia de expediente curto (sábado): conta só a manhã, sem descontar almoço
    if (carga < cargaDiariaMin()) return Math.max(0, Math.min(total, carga));
    if (ret !== null && sa !== null && ret > sa && s > sa) total -= (ret - sa);
    else if (sa !== null && ret === null && s > sa) total -= 60; // saiu para almoço e não voltou: desconta 1h
    return total;
  }

  /** carga diária em minutos (config pode ter 7.33 para 7h20) */
  function cargaDiariaMin() {
    const v = Number(estado.config.cargaDiaria) || 7;
    return Math.round(v * 60);
  }

  /* ---------------- horas extras ---------------- */
  /** "2:00", "2h", "1,5", "1.5" -> minutos */
  function lerHoraExtra(txt) {
    if (txt === null || txt === undefined) return null;
    let t = String(txt).trim().toLowerCase().replace(/h$/, "").replace(",", ".").replace(/\s+/g, "");
    if (!t) return null;
    let m;
    if ((m = t.match(/^(\d+):([0-5]?\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
    if ((m = t.match(/^(\d+)$/))) return Number(m[1]) * 60; // "2" = 2 horas
    if ((m = t.match(/^(\d+)[.,](\d{1,2})$/))) {
      const h = Number(m[1]);
      const frac = Number("0." + m[2]);
      return Math.round((h + frac) * 60);
    }
    return null;
  }
  function fmtHoraExtra(min) { return min ? paraHoras(min) : ""; }

  /** minutos extras do dia: usa o campo extra; se vazio, calcula pela saída real */
  function minutosExtras(r, cargaDia) {
    if (!r || r.marca) return 0;
    const manual = lerHoraExtra(r.extra);
    if (manual !== null) return manual;
    const carga = cargaDia || cargaDiariaMin();
    const min = minutosTrabalhados(r, carga);
    if (min === null) return 0;
    return Math.max(0, min - carga);
  }
  /** carga do dia: sábado = 4h30 (07:00–11:30) */
  function cargaDoDia(a, m, d) {
    if (d && new Date(a, m, d).getDay() === 6) return 270; // sábado: 07:00–11:30 = 4h30
    return cargaDiariaMin();
  }
  function fatorDe(r) {
    const f = r && r.fator ? Number(r.fator) : Number(estado.config.fator);
    return f === 100 ? 100 : 50;
  }
  /** horas normais e extras do mês de um funcionário */
  function totaisMes(fid, a, m, ateDia) {
    const total = ateDia || diasNoMes(a, m);
    let normais = 0, extras = 0, extras50 = 0, extras100 = 0, presentes = 0;
    for (let d = 1; d <= total; d++) {
      const r = reg(fid, a, m, d);
      if (!r) continue;
      const sit = situacao(r);
      if (["F", "AT", "FE", "FO", "FZ", "vazio"].includes(sit)) continue;
      const carga = cargaDoDia(a, m, d);
      const min = minutosTrabalhados(r, carga);
      if (min === null) continue;
      presentes++;
      const ex = minutosExtras(r, carga);
      const normal = Math.min(min, carga);
      normais += normal;
      extras += ex;
      if (fatorDe(r) === 100) extras100 += ex; else extras50 += ex;
    }
    const valorHora = Number(estado.config.valorHora) || 0;
    const valor = (extras50 / 60) * valorHora * 1.5 + (extras100 / 60) * valorHora * 2;
    return { normais, extras, extras50, extras100, valor, presentes };
  }

  /** marcados no Ponto do dia */

  /* ================= lançamento em massa: início de trabalho ================= */
  /* funcionários que começaram DEPOIS (lista da foto) — os demais começam em 26/10 */
  const INICIO_TRABALHO = {
    "rian": "2026-10-28", "vladimir": "2026-10-28",
    "kleniton": "2026-10-29", "klenitom": "2026-10-29",
    "anderson": "2026-11-03", "anderson souza": "2026-11-03",
    "edemilson": "2026-11-09",
    "dione": "2026-11-10", "diones": "2026-11-10",
    "ramon": "2026-11-11", "ramom": "2026-11-11", "ramão": "2026-11-11",
    "robson": "2026-11-12", "jose robson": "2026-11-12", "josé robson": "2026-11-12"
  };
  const INICIO_PADRAO = "2026-10-26";
  /* feriados nacionais no período (não trabalha) */
  const FERIADOS = ["2026-11-02", "2026-11-15", "2026-11-20"];

  /* horários usados no lançamento em massa (podem ser trocados na tela) */
  const HORARIOS_PADRAO = { e: "07:00", sa: "11:30", r: "13:00", s: "16:30", sabado: "11:30" };

  function chaveNome(nome) {
    return (nome || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  function dataISO(a, m, d) {
    return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  /** data de início de cada funcionário (nome parecido com a chave de INICIO_TRABALHO) */
  function inicioDoFuncionario(f) {
    const ch = chaveNome(f.nome);
    let inicio = null;
    Object.keys(INICIO_TRABALHO).forEach((k) => {
      if (ch.includes(k)) inicio = INICIO_TRABALHO[k];
    });
    return inicio || INICIO_PADRAO;
  }

  /** "YYYY-MM-DD" -> Date local */
  function dataDeISO(iso) {
    const [a, m, d] = String(iso).split("-").map(Number);
    return new Date(a, (m || 1) - 1, d || 1);
  }

  /** hoje, sem horas */
  function hojeZero() {
    const h = new Date();
    return new Date(h.getFullYear(), h.getMonth(), h.getDate());
  }

  /** data ISO da tela (input type=date) */
  function dataInputISO(sel) {
    const v = $(sel) ? $(sel).value : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  }

  /** data de hoje em ISO (fuso local) */
  function hojeISO() {
    const h = hojeZero();
    return `${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}`;
  }

  /** horários digitados na tela (com o padrão quando vazio) */
  function horariosLancamento() {
    const ler = (sel, padrao) => { const v = $(sel) ? $(sel).value : ""; return /^\d{1,2}:\d{2}$/.test(v) ? v : padrao; };
    return {
      e: ler("#lpEntrada", HORARIOS_PADRAO.e),
      sa: ler("#lpSaidaAlmoco", HORARIOS_PADRAO.sa),
      r: ler("#lpRetorno", HORARIOS_PADRAO.r),
      s: ler("#lpSaida", HORARIOS_PADRAO.s),
      sabado: ler("#lpSaidaSabado", HORARIOS_PADRAO.sabado)
    };
  }

  /**
   * Lança dia(s) de trabalho para os funcionários escolhidos.
   * deISO/ateISO: período (inclusive). soFuncionarios: Set de ids (vazio = todos).
   * padraoInicio: data usada quando o funcionário não tem data própria em INICIO_TRABALHO.
   */
  function lancarPeriodo(deISO, ateISO, soFuncionarios, padraoInicio) {
    const de = deISO ? dataDeISO(deISO) : null;
    const ate = ateISO ? dataDeISO(ateISO) : hojeZero();
    const h = horariosLancamento();
    const hoje = hojeZero();
    let total = 0, nomes = 0;
    estado.funcionarios.forEach((f) => {
      if (soFuncionarios && soFuncionarios.size && !soFuncionarios.has(f.id)) return;
      let inicio = padraoInicio ? dataDeISO(padraoInicio) : dataDeISO(inicioDoFuncionario(f));
      if (de && inicio < de) inicio = de;
      nomes++;
      for (let data = new Date(inicio); data <= ate; data.setDate(data.getDate() + 1)) {
        const a = data.getFullYear(), m = data.getMonth() + 1, d = data.getDate();
        if (data > hoje) continue;
        if (data.getDay() === 0) continue;                  // domingo = folga
        if (FERIADOS.includes(dataISO(a, m, d))) continue;  // feriado
        const r = garantirReg(f.id, a, m, d);
        if (r.marca === "F" || r.marca === "FE") continue;  // respeita falta/férias já lançadas
        r.e = h.e; r.sa = h.sa; r.r = h.r;
        r.s = data.getDay() === 6 ? h.sabado : h.s;
        r.marca = ""; r.extra = ""; r.fator = "";
        total++;
      }
    });
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`Lançados ${total} dia(s) de trabalho para ${nomes} funcionário(s).`);
    return total;
  }

  /** botão antigo: do início de cada um até hoje, em todos os meses do caminho */
  function lancarDoInicioAteHoje() {
    const hoje = hojeZero();
    let total = 0;
    const a0 = new Date(hoje);
    a0.setMonth(a0.getMonth() - 6);
    estado.funcionarios.forEach((f) => {
      const inicio = dataDeISO(inicioDoFuncionario(f));
      for (let data = new Date(inicio); data <= hoje; data.setDate(data.getDate() + 1)) {
        const a = data.getFullYear(), m = data.getMonth() + 1, d = data.getDate();
        if (data.getDay() === 0) continue;
        if (FERIADOS.includes(dataISO(a, m, d))) continue;
        const r = garantirReg(f.id, a, m, d);
        if (r.marca === "F" || r.marca === "FE") continue;
        r.e = HORARIOS_PADRAO.e; r.sa = HORARIOS_PADRAO.sa; r.r = HORARIOS_PADRAO.r;
        r.s = data.getDay() === 6 ? HORARIOS_PADRAO.sabado : HORARIOS_PADRAO.s;
        r.marca = ""; r.extra = ""; r.fator = "";
        total++;
      }
    });
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`Lançados ${total} dia(s) de trabalho (do início até hoje).`);
  }

  function idsSelecionados() {
    if (!Array.isArray(estado.selecionados)) estado.selecionados = [];
    return new Set(estado.selecionados);
  }

  function situacao(r) {
    if (!r) return "vazio";
    if (r.marca) return r.marca;              // F, AT, FE, FO
    if (r.e) return "ok";
    return "vazio";
  }

  /* ---------------- filtros, grupos e ordenação ---------------- */
  /** setor de cada função (usado na ordem por setor) */
  const GRUPOS_FUNCAO = {
    "Gerente administrativo": "Administrativo",
    "Comprador": "Administrativo",
    "TST adm": "Administrativo",
    "Almoxarife": "Administrativo",
    "Técnico de Segurança do Trabalho": "Segurança e Técnica",
    "Mestre de obras": "Segurança e Técnica",
    "Operador de retroescavadeira": "Segurança e Técnica",
    "Motorista de caminhão": "Segurança e Técnica",
    "Pedreiro": "Produção de campo",
    "Servente de obras": "Produção de campo",
    "Servente": "Produção de campo",
    "Carpinteiro": "Produção de campo",
    "Armador de ferragens": "Produção de campo",
    "Soldador": "Produção de campo",
    "Montador": "Produção de campo",
    "Auxiliar de montagem": "Produção de campo"
  };
  const ORDEM_GRUPOS = ["Administrativo", "Segurança e Técnica", "Produção de campo", "Outros"];

  function grupoDe(f) { return GRUPOS_FUNCAO[f.funcao] || "Outros"; }

  const cmp = (a, b) => String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base" });

  /** lista filtrada e ordenada conforme o seletor "Ordenar por" */
  function funcionariosFiltrados() {
    const busca = $("#busca").value.trim().toLowerCase();
    const funcao = $("#filtroFuncao").value;
    const filtroSel = $("#filtroSel").value;
    const ordem = ($("#ordem") && $("#ordem").value) || "cadastro";
    const sel = new Set(estado.selecionados || []);

    const lista = estado.funcionarios.filter((f) => {
      if (busca && !(f.nome + " " + f.funcao).toLowerCase().includes(busca)) return false;
      if (funcao && f.funcao !== funcao) return false;
      if (filtroSel === "sel" && !sel.has(f.id)) return false;
      if (filtroSel === "nosel" && sel.has(f.id)) return false;
      return true;
    });

    const num = (f) => estado.funcionarios.findIndex((x) => x.id === f.id) + 1;

    if (ordem === "nome") {
      lista.sort((a, b) => cmp(a.nome, b.nome) || num(a) - num(b));
    } else if (ordem === "funcao") {
      lista.sort((a, b) => cmp(a.funcao, b.funcao) || cmp(a.nome, b.nome) || num(a) - num(b));
    } else if (ordem === "setor") {
      lista.sort((a, b) => {
        const ga = ORDEM_GRUPOS.indexOf(grupoDe(a)), gb = ORDEM_GRUPOS.indexOf(grupoDe(b));
        if (ga !== gb) return ga - gb;
        const fa = cmp(a.funcao, b.funcao);
        if (fa) return fa;
        return cmp(a.nome, b.nome) || num(a) - num(b);
      });
    } else {
      lista.sort((a, b) => num(a) - num(b));
    }
    return lista;
  }

  /* ---------------- selects de data ---------------- */
  function montarSelectsData() {
    const sMes = $("#mes"), sAno = $("#ano");
    sMes.innerHTML = MESES.map((n, i) => `<option value="${i}">${n}</option>`).join("");
    const anos = [];
    for (let a = hoje.getFullYear() - 3; a <= hoje.getFullYear() + 2; a++) anos.push(a);
    sAno.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join("");
    const lembrado = lerMesEscolhido();
    sMes.value = lembrado ? lembrado.m - 1 : hoje.getMonth();
    sAno.value = lembrado ? lembrado.a : hoje.getFullYear();
    diaSelecionado = hoje.getDate();
    montarDias();
    sMes.addEventListener("change", () => { ajustarDiaAoMes(); });
    sAno.addEventListener("change", () => { ajustarDiaAoMes(); });
    $("#dia").addEventListener("change", (e) => {
      diaSelecionado = Number(e.target.value);
      renderDia(); renderResumo(); renderMes(); renderTitulos();
    });
  }

  function ajustarDiaAoMes() {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    const h = new Date();
    diaSelecionado = (a === h.getFullYear() && m === h.getMonth() + 1) ? h.getDate() : 1;
    montarDias();
    gravarMesEscolhido(a, m + 1);
    const novo = `${a}-${pad(m + 1)}-${pad(diaSelecionado)}`;
    if ($("#lpDe")) $("#lpDe").value = novo;          // o lançamento segue o mês escolhido no topo
    if ($("#lpAte")) $("#lpAte").value = novo;
    renderDia(); renderResumo(); renderMes(); renderTitulos();
  }

  /* ---- memória do mês escolhido (não volta sozinho para outro mês) ---- */
  const CHAVE_MES = "cas-ponto-mes";
  function lerMesEscolhido() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE_MES) || "null");
      if (d && d.a >= 2000 && d.m >= 1 && d.m <= 12) return d;
    } catch (e) {}
    return null;
  }
  function gravarMesEscolhido(a, m) {
    try { localStorage.setItem(CHAVE_MES, JSON.stringify({ a, m })); } catch (e) {}
  }

  /** muda o mês/ano na tela e redesenha tudo */
  function irParaMesAno(iso) {
    const [a, m] = String(iso).split("-").map(Number);
    if ($("#ano")) $("#ano").value = String(a);
    if ($("#mes")) $("#mes").value = String(m - 1);
    // quando o mês vem de uma data, o dia é o da data (não "hoje" nem 1)
    const dia = Number(String(iso).split("-")[2]) || 1;
    ajustarDiaAoMes();
    diaSelecionado = Math.min(dia, diasNoMes(a, m));
    montarDias();
    renderDia(); renderResumo(); renderMes(); renderTitulos();
    return { a, m };
  }

  function montarDias() {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    const total = diasNoMes(a, m);
    const h = new Date();
    const ehMesAtual = a === h.getFullYear() && m === h.getMonth() + 1;
    if (ehMesAtual) diaSelecionado = h.getDate();          // mês de hoje: abre no dia de hoje
    if (diaSelecionado > total) diaSelecionado = total;
    if (diaSelecionado < 1) diaSelecionado = 1;
    $("#dia").innerHTML = Array.from({ length: total }, (_, i) => {
      const d = i + 1;
      const wd = SEMANA[nomeDia(a, m, d)];
      return `<option value="${d}">${pad(d)} — ${wd}</option>`;
    }).join("");
    $("#dia").value = diaSelecionado;
  }

  function renderTitulos() {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    $("#tituloDia").textContent = `Ponto do dia — ${pad(diaSelecionado)}/${pad(m + 1)}/${a} (${SEMANA_EXT[nomeDia(a, m, diaSelecionado)]}, ${MESES[m]})`;
    const total = diasNoMes(a, m);
    $("#tituloMes").textContent = `Folha do mês — ${MESES[m]} / ${a}`;
    $("#diasInfo").textContent = `Dias 1 a ${total} • ${MESES[m]}/${a}`;
  }

  /* ---------------- PRESENÇA: QUEM VEIO / QUEM FALTOU ---------------- */
  function horaPadrao() {
    const el = $("#horaPadrao");
    return (el && el.value) || estado.config.horaPadrao || "07:00";
  }

  function garantirConfigPresenca() {
    const c = estado.config;
    if (Number(c.cargaDiaria) === 7) c.cargaDiaria = 8;
    
    
    if (c.almocoPadrao === "12:00") c.almocoPadrao = "11:30";
    if (c.retornoPadrao === "12:30") c.retornoPadrao = "13:00";
    if (!c.horaPadrao) c.horaPadrao = "07:00";
    if (!c.almocoPadrao) c.almocoPadrao = "11:30";
    if (!c.retornoPadrao) c.retornoPadrao = "13:00";
    if (!c.saidaPadrao) c.saidaPadrao = "16:30";
    if (!c.horaExtra) c.horaExtra = "18:00";
  }

  /** marca como PRESENTE: horários fixos (entrada, almoço e retorno) — só a saída varia */
  function marcarPresente(fid, a, m, d, hora) {
    const r = garantirReg(fid, a, m, d);
    const c = estado.config;
    const sabado = new Date(a, m, d).getDay() === 6;   // m é 0..11 (novembro = 10)
    r.e = hora || horaPadrao();        // 07:00
    if (sabado) { r.sa = ""; r.r = ""; } else { r.sa = c.almocoPadrao; r.r = c.retornoPadrao; }
    r.s = r.s || (sabado ? "11:30" : (c.saidaPadrao || "16:30"));   // sábado: até 11:30
    r.marca = "";
    return r;
  }

  /** marca como FALTA (não veio) */
  function marcarFalta(fid, a, m, d) {
    const r = garantirReg(fid, a, m, d);
    r.e = r.sa = r.r = r.s = "";
    r.marca = "F";
    return r;
  }

  function atualizarInfoPresenca() {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const sel = idsSelecionados();
    let vieram = 0, faltaram = 0, semReg = 0;
    estado.funcionarios.forEach((f) => {
      const r = reg(f.id, a, m, d);
      const sit = situacao(r);
      if (sit === "F") faltaram++;
      else if (sit === "ok") vieram++;
      else semReg++;
    });
    const info = $("#pbInfo");
    if (info) {
      info.innerHTML = `<b>${vieram}</b> vieram · <b class="pf">${faltaram}</b> faltaram · <b>${semReg}</b> sem registro · <b>${sel.size}</b> marcados na lista`;
    }
  }

  /** registra a saída de quem foi embora em um horário fixo (16:00, 18:00…) */
  function marcarSaidaSelecionados(horaSaida) {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const sel = idsSelecionados();
    if (!sel.size) {
      // nenhum marcado: aplica em TODOS os que já têm entrada lançada no dia
      const comEntrada = estado.funcionarios.filter((f) => {
        const r = reg(f.id, a, m, d);
        return r && r.e && !r.marca;
      });
      if (!comEntrada.length) {
        toast("Marque quem saiu (☑) ou registre a entrada primeiro.");
        return;
      }
      let n2 = 0;
      const base = estado.config;
      comEntrada.forEach((f) => {
        const r = garantirReg(f.id, a, m, d);
        r.e = r.e || base.horaPadrao || "07:00";
        r.sa = r.sa || base.almocoPadrao || "11:30";
        r.r = r.r || base.retornoPadrao || "13:00";
        r.s = horaSaida;
        n2++;
      });
      salvar(true);
      renderDia(); renderResumo(); renderMes();
      toast(`Saída ${horaSaida} aplicada em todos os ${n2} que já tinham entrada.`);
      return;
    }
    const c = estado.config;
    let n = 0;
    estado.funcionarios.forEach((f) => {
      if (!sel.has(f.id)) return;
      const r = garantirReg(f.id, a, m, d);
      r.e = horaPadrao();                 // 07:00 (automático)
      r.sa = c.almocoPadrao;              // 11:30 (automático)
      r.r = c.retornoPadrao;              // 13:00 (automático)
      r.s = horaSaida;                    // único horário que muda
      r.marca = "";
      n++;
    });
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`Saída ${horaSaida} registrada para ${n} funcionário(s).`);
  }

  /** marca ocorrência (F, AT, FE, FO, FZ) nos funcionários selecionados */
  function marcarOcorrenciaSelecionados(tipo) {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const sel = idsSelecionados();
    if (!sel.size) { toast("Marque primeiro os funcionários na lista (☑)."); return; }
    const rotulos = { F: "falta", AT: "atestado", FE: "férias", FO: "folga", FZ: "feriado" };
    let n = 0;
    estado.funcionarios.forEach((f) => {
      if (!sel.has(f.id)) return;
      const r = garantirReg(f.id, a, m, d);
      r.e = r.sa = r.r = r.s = "";
      r.marca = tipo;
      r.obs = rotulos[tipo] || "";
      n++;
    });
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`${n} funcionário(s) marcados como ${rotulos[tipo] || tipo}.`);
  }

  /* ---------------- ABA: PONTO DO DIA ---------------- */
  function renderDia() {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const tbody = $("#tabelaDia tbody");
    const lista = funcionariosFiltrados();
    const sel = new Set(estado.selecionados || []);
    tbody.innerHTML = "";

    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="11" style="padding:28px;text-align:center;color:#6b7280">Nenhum funcionário encontrado com esses filtros.</td></tr>`;
      return;
    }

    lista.forEach((f) => {
      const num = estado.funcionarios.findIndex((x) => x.id === f.id) + 1;
      const r = reg(f.id, a, m, d) || {};
      const tr = document.createElement("tr");
      tr.dataset.id = f.id;
      if (sel.has(f.id)) tr.classList.add("linha-sel");
      if (!f.ativo) tr.style.opacity = ".55";

      const marcaOpts = [["", "—"], ["F", "F"], ["AT", "AT"], ["FE", "FE"], ["FO", "FO"], ["FZ", "FZ"]].map(([v, rot]) =>
        `<option value="${v}" ${(r.marca || "") === v ? "selected" : ""}>${rot}</option>`).join("");

      tr.innerHTML = `
        <td class="c-sel"><input type="checkbox" data-sel ${sel.has(f.id) ? "checked" : ""}></td>
        <td class="c-num">${num}</td>
        <td class="c-nome">${escapar(f.nome)}${f.ativo ? "" : ' <span style="color:#9aa1ac">(inativo)</span>'}</td>
        <td class="c-func">${escapar(f.funcao)}</td>
        <td class="c-h"><input type="time" data-campo="e" value="${r.e || ""}" aria-label="Entrada"></td>
        <td class="c-h"><input type="time" data-campo="sa" value="${r.sa || ""}" aria-label="Saída almoço"></td>
        <td class="c-h"><input type="time" data-campo="r" value="${r.r || ""}" aria-label="Retorno"></td>
        <td class="c-h"><input type="time" data-campo="s" value="${r.s || ""}" aria-label="Saída"></td>
        <td class="c-h"><input type="text" data-campo="extra" value="${escapar(r.extra || "")}" placeholder="+0:00" aria-label="Horas extras"></td>
        <td class="c-h horas" data-horas></td>
        <td class="c-obs" style="display:flex;gap:6px;align-items:center">
          <select data-campo="marca" style="width:64px" aria-label="Ocorrência">${marcaOpts}</select>
          <input type="text" data-campo="obs" value="${escapar(r.obs || "")}" placeholder="observação…" aria-label="Observação">
        </td>`;
      tbody.appendChild(tr);
      pintarHoras(tr, r, a, m, d);
    });
    atualizarInfoPresenca();
    renderResumo();                              // mantém os cartões de cima sempre em dia
  }

  function pintarHoras(tr, r, a, m, d) {
    if (a === undefined) {                       // compatibilidade: descobre a data na tela
      a = Number($("#ano").value); m = Number($("#mes").value); d = diaSelecionado;
    }
    const cel = tr.querySelector("[data-horas]");
    if (!cel) return;
    const sit = situacao(r);
    if (sit === "F") { cel.innerHTML = '<span class="marca f">FALTA</span>'; return; }
    if (["AT", "FE", "FO", "FZ"].includes(sit)) {
      cel.innerHTML = `<span class="marca ${sit.toLowerCase()}">${sit}</span>`;
      return;
    }
    const carga = cargaDoDia(a, m, d);
    const min = minutosTrabalhados(r, carga);
    const ex = minutosExtras(r);
    cel.innerHTML = paraHoras(min) + (ex > 0 ? `<div class="extra-mini">+${paraHoras(ex)}</div>` : "");
    cel.className = "c-h horas " + (min >= carga || ex > 0 ? "extra" : "falta");
  }

  function escapar(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* eventos da tabela do dia (delegação) */
  $("#tabelaDia").addEventListener("change", (ev) => {
    const tr = ev.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;

    if (ev.target.hasAttribute("data-sel")) {
      estado.selecionados = estado.selecionados || [];
      const i = estado.selecionados.indexOf(id);
      if (ev.target.checked && i < 0) estado.selecionados.push(id);
      if (!ev.target.checked && i >= 0) estado.selecionados.splice(i, 1);
      tr.classList.toggle("linha-sel", ev.target.checked);
      salvar(true); renderResumo(); atualizarInfoPresenca();
      return;
    }

    const campo = ev.target.dataset.campo;
    if (!campo) return;
    const r = garantirReg(id, a, m, d);
    r[campo] = ev.target.value;
    if (campo === "s" && ev.target.value && !r.marca) {
      r.e = r.e || horaPadrao();
      r.sa = r.sa || estado.config.almocoPadrao;
      r.r = r.r || estado.config.retornoPadrao;
    }
    if (campo === "marca" && ev.target.value) { r.e = r.sa = r.r = r.s = ""; }
    if (campo === "marca" && ev.target.value === "FO" && !r.obs) r.obs = "folga";
    if (campo === "marca" && ev.target.value === "FZ" && !r.obs) r.obs = "feriado";
    if (campo === "marca" && ev.target.value === "FE" && !r.obs) r.obs = "férias";
    if (campo === "marca" && ev.target.value === "AT" && !r.obs) r.obs = "atestado";
    if (campo === "marca" && ev.target.value === "F" && !r.obs) r.obs = "falta";
    if (["e", "sa", "r", "s"].includes(campo) && ev.target.value) r.marca = "";
    if (rVazio(r) && estado.registros[chaveData(a, m, d)]) {
      delete estado.registros[chaveData(a, m, d)][id];
    }
    ev.target.blur();                 // solta o campo antes de redesenhar a tabela
    salvar();
    pintarHoras(tr, reg(id, a, m, d) || {});
    renderResumo(); renderMes(); renderExtra(); renderIndividual();
  });

  $("#selTodosDia").addEventListener("change", (e) => {
    const lista = funcionariosFiltrados();
    estado.selecionados = e.target.checked ? lista.map((f) => f.id) : [];
    salvar(true); renderDia(); renderResumo();
  });

  $("#btnTudoPresente").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const sel = new Set(estado.selecionados || []);
    const alvo = sel.size ? funcionariosFiltrados().filter((f) => sel.has(f.id)) : funcionariosFiltrados();
    if (!alvo.length) { toast("Nenhum funcionário selecionado."); return; }
    const agora = new Date();
    const hora = pad(agora.getHours()) + ":" + pad(agora.getMinutes());
    alvo.forEach((f) => {
      const r = garantirReg(f.id, a, m, d);
      if (!r.e && !r.marca) r.e = hora;
    });
    salvar(true); renderDia(); renderResumo(); renderMes();
    toast(`Entrada ${hora} lançada para ${alvo.length} funcionário(s).`);
  });

  $("#btnRegistrarPresenca").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const sel = idsSelecionados();
    if (!sel.size) { toast("Marque primeiro quem veio (☑ na lista)."); return; }
    const hora = horaPadrao();
    let n = 0;
    estado.funcionarios.forEach((f) => {
      if (!sel.has(f.id)) return;
      marcarPresente(f.id, a, m, d, hora);
      n++;
    });
    estado.config.horaPadrao = hora;
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`Ponto registrado para ${n} funcionário(s) — entrada ${hora}.`);
  });

  $("#btnFecharDia").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const sel = idsSelecionados();
    const wd = nomeDia(a, m, d);
    const nomeSem = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][wd];
    const lista = estado.funcionarios.filter((f) => !sel.has(f.id));
    if (!lista.length) { toast("Todos estão selecionados — ninguém para marcar como falta."); return; }
    if (!confirm(`Marcar FALTA em ${lista.length} funcionário(s) não selecionado(s) em ${pad(d)}/${pad(m + 1)}/${a} (${nomeSem})?`)) return;

    lista.forEach((f) => marcarFalta(f.id, a, m, d));
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`${lista.length} falta(s) registrada(s).`);
  });

  function renderSaidas() {
    const c = estado.config;
    if ($("#cfgSaida")) $("#cfgSaida").value = c.saidaPadrao || "16:30";
    if ($("#cfgExtra")) $("#cfgExtra").value = c.horaExtra || "18:00";
    if ($("#lblSaidaPadrao")) $("#lblSaidaPadrao").textContent = c.saidaPadrao || "16:30";
    if ($("#horaSaidaCustom") && !$("#horaSaidaCustom").value) $("#horaSaidaCustom").value = c.saidaPadrao || "16:30";
  }
  $("#cfgSaida").addEventListener("change", (ev) => {
    estado.config.saidaPadrao = ev.target.value || "16:30";
    estado.config.horaSaida = estado.config.saidaPadrao;
    salvar(true); renderSaidas();
    toast(`Saída padrão: ${estado.config.saidaPadrao}.`);
  });
  $("#cfgExtra").addEventListener("change", (ev) => {
    estado.config.horaExtra = ev.target.value || "18:00";
    salvar(true); renderSaidas();
    toast(`Hora extra até ${estado.config.horaExtra}.`);
  });

  /* ---- lançar período escolhido na tela ---- */
  function renderLancarPeriodo() {
    const hoje = hojeZero();
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const diaAtual = (() => {                     // data que já está na tela (mês/ano/dia escolhidos)
      const a = Number($("#ano") && $("#ano").value), m = Number($("#mes") && $("#mes").value) + 1;
      if (!a || !m) return iso(hoje);
      return `${a}-${pad(m)}-${pad(Math.min(diaSelecionado || 1, diasNoMes(a, m)))}`;
    })();
    if ($("#lpDe") && !$("#lpDe").value) $("#lpDe").value = diaAtual;
    if ($("#lpAte")) $("#lpAte").value = diaAtual;    // "até" já vem com o dia escolhido no topo
    if ($("#lpAte")) $("#lpAte").max = iso(hoje);
    if ($("#lpDe")) $("#lpDe").max = iso(hoje);
    if ($("#lpEntrada") && !$("#lpEntrada").value) $("#lpEntrada").value = HORARIOS_PADRAO.e;
    if ($("#lpSaidaAlmoco") && !$("#lpSaidaAlmoco").value) $("#lpSaidaAlmoco").value = HORARIOS_PADRAO.sa;
    if ($("#lpRetorno") && !$("#lpRetorno").value) $("#lpRetorno").value = HORARIOS_PADRAO.r;
    if ($("#lpSaida") && !$("#lpSaida").value) $("#lpSaida").value = HORARIOS_PADRAO.s;
    if ($("#lpSaidaSabado") && !$("#lpSaidaSabado").value) $("#lpSaidaSabado").value = HORARIOS_PADRAO.sabado;
  }

  function executarLancarPeriodo() {
    const de = dataInputISO("#lpDe");
    const ate = dataInputISO("#lpAte");
    if (!de) { toast("Escolha a data de início."); return; }
    if (!ate) { toast("Escolha a data final."); return; }
    if (dataDeISO(de) > dataDeISO(ate)) { toast("A data de início é depois da data final."); return; }
    const sel = idsSelecionados();
    const escopo = sel.size ? `${sel.size} selecionado(s)` : `TODOS os ${estado.funcionarios.length} funcionários`;
    const h = horariosLancamento();
    const msg = `Lançar trabalho de ${de.split("-").reverse().join("/")} até ${ate.split("-").reverse().join("/")}\n` +
      `para ${escopo}?\n\n${h.e}–${h.sa} / ${h.r}–${h.s} (sábado até ${h.sabado})\n` +
      `Sem domingos e sem feriados. Os dias já lançados serão substituídos.`;
    if (!confirm(msg)) return;
    lancarPeriodo(de, ate, sel, null);
    // não mexe no mês escolhido na tela: o usuário fica onde ele selecionou
  }

  if ($("#btnLancarEscolhido")) $("#btnLancarEscolhido").addEventListener("click", executarLancarPeriodo);
  renderLancarPeriodo();
  $("#btnSaidaPadrao").addEventListener("click", () => marcarSaidaSelecionados(estado.config.saidaPadrao || "16:30"));
  $("#btnSaida16").addEventListener("click", () => { marcarSaidaSelecionados("16:00"); });
  $("#btnSaida18").addEventListener("click", () => { marcarSaidaSelecionados(estado.config.horaExtra || "18:00"); });
  $("#btnSaidaCustom").addEventListener("click", () => {
    const h = $("#horaSaidaCustom").value;
    if (!h) { toast("Digite a hora de saída."); return; }
    marcarSaidaSelecionados(h);
  });
  $("#btnMarcarFolga").addEventListener("click", () => marcarOcorrenciaSelecionados("FO"));
  $("#btnMarcarFeriado").addEventListener("click", () => marcarOcorrenciaSelecionados("FZ"));

  /* hora do retorno do almoço: alimenta o preenchimento automático */
  function renderRetorno() { const el = $("#cfgRetorno"); if (el) el.value = estado.config.retornoPadrao || "13:00"; }
  $("#cfgRetorno").addEventListener("change", (ev) => {
    estado.config.retornoPadrao = ev.target.value || "13:00";
    estado.config.horaSaida = estado.config.horaSaida || "16:30";
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`Retorno do almoço: ${estado.config.retornoPadrao}.`);
  });

  $("#horaPadrao").addEventListener("change", (ev) => {
    estado.config.horaPadrao = ev.target.value || "07:00";
    salvar(true);
  });

  $("#btnLimparDia").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    if (!confirm(`Apagar todos os registros de ${pad(d)}/${pad(m + 1)}/${a}?`)) return;
    if (estado.registros[chaveData(a, m, d)]) delete estado.registros[chaveData(a, m, d)];
    salvar(true); renderDia(); renderResumo(); renderMes();
    toast("Registros do dia apagados.");
  });

  /* ---------------- ABA: FOLHA DO MÊS ---------------- */
  function renderMes() {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    const total = diasNoMes(a, m);
    const lista = funcionariosFiltrados();
    const thead = $("#tabelaMes thead"), tbody = $("#tabelaMes tbody");

    let cab = `<tr><th class="c-num">Nº</th><th style="text-align:left">Funcionário</th>`;
    for (let d = 1; d <= total; d++) {
      const wd = nomeDia(a, m, d);
      const ehHoje = (a === hoje.getFullYear() && m === hoje.getMonth() && d === hoje.getDate());
      cab += `<th class="${wd === 0 ? "domingo" : ""} ${ehHoje ? "hoje" : ""}" title="${pad(d)}/${pad(m + 1)}/${a}">
        <div>${pad(d)}</div><div style="font-size:9px;opacity:.7">${SEMANA[wd]}</div></th>`;
    }
    cab += `<th>Total</th><th>Saldo</th><th>Extras</th></tr>`;
    thead.innerHTML = cab;

    const carga = cargaDiariaMin();
    let linhas = "";

    const ordemAtual = ($("#ordem") && $("#ordem").value) || "cadastro";
    let grupoAnterior = null;

    lista.forEach((f) => {
      const num = estado.funcionarios.findIndex((x) => x.id === f.id) + 1;
      let totalMin = 0, extrasMin = 0, diasUteis = 0, celulas = "";

      if (ordemAtual === "setor") {
        const g = grupoDe(f);
        if (g !== grupoAnterior) {
          grupoAnterior = g;
          linhas += `<tr class="linha-grupo"><td colspan="${total + 5}">${escapar(g)}</td></tr>`;
        }
      }

      for (let d = 1; d <= total; d++) {
        const r = reg(f.id, a, m, d);
        const sit = situacao(r);
        const wd = nomeDia(a, m, d);
        const cls = ["dia-cel"];
        if (wd === 0) cls.push("domingo");
        let texto = "";

        if (sit === "ok" || (r && r.e && !r.marca)) {
          const min = minutosTrabalhados(r, cargaDoDia(a, m, d));
          const ex = minutosExtras(r, cargaDoDia(a, m, d));
          if (min !== null) { totalMin += min; extrasMin += ex; texto = paraHoras(min).replace(":00", "h") + (ex > 0 ? `<sup class="ex-sup">+${paraHoras(ex)}</sup>` : ""); }
          else texto = r.e;
          cls.push("ok");
          if (ex > 0) cls.push("tem-extra");
        } else if (sit === "F") { texto = "F"; cls.push("falta"); }
        else if (sit === "AT") { texto = "AT"; cls.push("at"); }
        else if (sit === "FE") { texto = "FE"; cls.push("fe"); }
        else if (sit === "FO") { texto = "FO"; cls.push("fo"); }
        else if (sit === "FZ") { texto = "FZ"; cls.push("fz"); }
        else { texto = "·"; cls.push("vazio"); }

        if (wd !== 0 && sit !== "vazio") diasUteis++;
        celulas += `<td class="${cls.join(" ")}" data-dia="${d}" title="${pad(d)}/${pad(m + 1)} — clique para lançar">${texto}</td>`;
      }

      // carga real do mês: dia útil 8h, sábado 4h30, domingos e feriados fora
      let cargaMes = 0;
      for (let dd = 1; dd <= total; dd++) {
        const wd2 = nomeDia(a, m, dd);
        if (wd2 === 0) continue;
        if (FERIADOS.includes(dataISO(a, m, dd))) continue;
        cargaMes += cargaDoDia(a, m, dd);
      }
      const saldo = totalMin - cargaMes;
      linhas += `<tr data-id="${f.id}">
        <td class="c-num">${num}</td>
        <td class="nome">${escapar(f.nome)}</td>
        ${celulas}
        <td class="total">${paraHoras(totalMin) || "0:00"}</td>
        <td class="total ${saldo > 0 ? "saldo-pos" : saldo < 0 ? "saldo-neg" : ""}">${paraHoras(saldo)}</td>
        <td class="total ${extrasMin > 0 ? "total-extra" : ""}">${extrasMin ? "+" + paraHoras(extrasMin) : "0:00"}</td>
      </tr>`;
    });

    if (!linhas) linhas = `<tr><td colspan="${total + 5}" style="padding:28px;text-align:center;color:#6b7280">Nenhum funcionário encontrado.</td></tr>`;
    tbody.innerHTML = linhas;
  }

  $("#tabelaMes").addEventListener("click", (ev) => {
    const cel = ev.target.closest("td[data-dia]");
    if (!cel) return;
    diaSelecionado = Number(cel.dataset.dia);
    $("#dia").value = diaSelecionado;
    trocarTab("dia");
    renderDia(); renderResumo(); renderTitulos();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ---------------- RESUMO ---------------- */
  function renderResumo() {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const lista = funcionariosFiltrados();
    const sel = new Set(estado.selecionados || []);
    let presentes = 0, problemas = 0, totalMin = 0, folgas = 0;

    estado.funcionarios.forEach((f) => {
      const r = reg(f.id, a, m, d);
      const sit = situacao(r);
      if (sit === "ok") { presentes++; const min = minutosTrabalhados(r, cargaDoDia(a, m, d)); if (min) totalMin += min; }
      if (sit === "F") problemas++;
      if (sit === "FO" || sit === "FZ") folgas++;
    });

    const selDia = $("#dia");
    if (selDia && d && String(selDia.value) !== String(d)) selDia.value = String(d);
    $("#rData").textContent = fmtDataCurta(a, m, d);
    $("#rTotal").textContent = lista.length;
    // se um filtro está escondendo funcionários, avisa na tela em vez de parecer "sumiram"
    const filtroAtivo = ($("#busca").value || "").trim() || $("#filtroFuncao").value
      || ($("#filtroSel").value && $("#filtroSel").value !== "todos");
    const dica = $("#dicaFiltro");
    if (dica) {
      if (filtroAtivo && lista.length !== estado.funcionarios.length) {
        dica.innerHTML = `Mostrando <b>${lista.length}</b> de ${estado.funcionarios.length} funcionários por causa do filtro. ` +
          `<button class="btn mini ghost" type="button" id="btnLimparFiltros">Limpar filtros</button>`;
        dica.classList.remove("oculto");
      } else {
        dica.innerHTML = "";
        dica.classList.add("oculto");
      }
    }
    $("#rSel").textContent = sel.size;
    $("#rPres").textContent = presentes;
    $("#rFalta").textContent = problemas;
    $("#rHoras").textContent = paraHoras(totalMin) || "0:00";
  }


  /** CSS usado na impressão da folha individual */
  function estiloImpressao() {
    const base = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((l) => `@import url("${l.href}");`).join("\n");
    return `${base}
      @page { size: A4 portrait; margin: 10mm 10mm 8mm 10mm; }
      html, body { background: #fff !important; color: #000 !important; margin: 0; padding: 0; }
      body { font-family: "Segoe UI", Roboto, Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; }
      .folha-individual { border: none !important; box-shadow: none !important; padding: 0 !important;
        margin: 0 auto !important; max-width: 190mm !important; width: 100% !important; break-after: auto !important; page-break-after: auto !important; }
      .fi-topo { border-bottom: 2px solid #000; }
      .fi-topo img { width: 26mm; }
      table.fi-tabela th, table.fi-tabela td { border: 1px solid #000 !important; }
      table.fi-tabela th { background: #fff !important; color: #000 !important; font-size: 6.6pt; }
      table.fi-tabela td { padding: .8mm 1.2mm; font-size: 8.2pt; line-height: 1.15; }
      .folha-individual { padding: 0 !important; }
      table.fi-tabela tr.linha-dom td { background: #fff !important; color: #444 !important; }
      table.fi-tabela tfoot td { background: #f0f0f0 !important; }
      .fi-empresa span, .fi-campos span, .fi-resumo span, .fi-ass, .fi-rodape { color: #333 !important; }
      .fi-campos b, .fi-resumo b { color: #000 !important; }
      .fi-resumo { border: 1px solid #999 !important; }
      .fi-assinaturas { margin-top: 7mm; }
      .fi-ass span { border-top: 1px solid #000; height: 8mm; }
      .folha-individual td.falta, .folha-individual td.at, .folha-individual td.fe, .folha-individual td.fo { color: #000 !important; }`;
  }


  /* ---------------- PDF ---------------- */
  const CSS_FOLHA = `
    @page { size: A4 portrait; margin: 10mm; }
    html, body { background: #fff !important; color: #000 !important; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Roboto, Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased; }
    .folha-individual { border: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; max-width: 190mm !important; width: 190mm !important; background: #fff !important; color: #000 !important; }
    .fi-topo { display: flex; align-items: center; gap: 6mm; border-bottom: 1.5px solid #000; padding-bottom: 2.5mm; }
    .fi-topo img { width: 20mm; }
    .fi-empresa { flex: 1; display: flex; flex-direction: column; }
    .fi-empresa strong { font-size: 11.5pt; }
    .fi-empresa .fi-doc { font-size: 8pt; font-weight: 700; letter-spacing: .8px; margin-top: .5mm; }
    .fi-mes { text-align: right; }
    .fi-mes-txt { font-size: 11pt; font-weight: 700; }
    .fi-num { font-size: 9pt; color: #444; margin-top: 1mm; }
    .fi-campos { display: flex; flex-wrap: wrap; gap: 2mm 8mm; padding: 2.5mm 0; border-bottom: 1px solid #000; margin-bottom: 2mm; }
    .fi-campos div { display: flex; flex-direction: column; }
    .fi-campos .fi-campo-nome { flex: 1 1 100%; }
    .fi-campos span { font-size: 6.4pt; text-transform: uppercase; letter-spacing: .4px; color: #444; }
    .fi-campos b { font-size: 9.5pt; font-weight: 600; }
    table.fi-tabela { width: 100%; border-collapse: collapse; font-size: 8.2pt; }
    table.fi-tabela th, table.fi-tabela td { border: 1px solid #000; padding: .8mm 1.2mm; text-align: center; line-height: 1.15; }
    table.fi-tabela th { font-size: 6.6pt; text-transform: uppercase; background: #f0f0f0; color: #000; }
    table.fi-tabela td.d-num, table.fi-tabela td.d-sem { width: 12mm; }
    table.fi-tabela td.d-sem { color: #444; font-size: 7.2pt; }
    table.fi-tabela td.d-tot, table.fi-tabela td.d-ex { width: 16mm; font-weight: 600; }
    table.fi-tabela td.d-oc { text-align: left; }
    table.fi-tabela tfoot td { background: #f0f0f0; font-weight: 700; }
    table.fi-tabela tr.linha-dom td { color: #555; }
    .fi-tot-rot { text-align: right !important; font-size: 8pt; }
    .fi-resumo { display: flex; flex-wrap: wrap; gap: 2mm 5mm; margin-top: 2.5mm; padding: 1.6mm 2.4mm; border: 1px solid #999; font-size: 8.4pt; align-items: center; }
    .fi-resumo span { display: inline-flex; gap: 1.2mm; align-items: baseline; }
    .fi-resumo i { font-style: normal; font-size: 6.4pt; text-transform: uppercase; color: #444; }
    .fi-resumo b { font-size: 9pt; }
    .fi-resumo .fi-data { margin-left: auto; }
    table.fi-assinaturas { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 8mm 0; margin-top: 9mm; }
    table.fi-assinaturas td.fi-ass { width: 50%; text-align: center; vertical-align: bottom; font-size: 7.6pt; color: #333; padding: 0; border: 0; }
    .fi-ass span { display: block; border-top: 1px solid #000; margin-bottom: 1.2mm; height: 10mm; }
    .folha-individual td.falta, .folha-individual td.at, .folha-individual td.fe,
    .folha-individual td.fo, .folha-individual td.fz { color: #000 !important; font-weight: 700; }
  `;

  /** monta a folha em um contêiner fora da tela para gerar o PDF */
  function montarFolhaOculta(html) {
    const caixa = document.createElement("div");
    caixa.id = "caixaPDF";
    caixa.style.cssText = "position:fixed;left:-10000px;top:0;width:190mm;background:#fff;color:#000;z-index:-1";
    caixa.innerHTML = `<style>${CSS_FOLHA}</style>${html}`;
    document.body.appendChild(caixa);
    return caixa;
  }

  /** gera o PDF da folha do funcionário escolhido */
  async function gerarPDFFolha() {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    const id = preencherSelectFunc();
    const f = estado.funcionarios.find((x) => x.id === id);
    if (!f) { toast("Escolha um funcionário."); return; }

    if (!window.html2canvas || !window.jspdf) { toast("Biblioteca de PDF não carregou — usando a impressão do navegador."); window.print(); return; }

    const num = estado.funcionarios.findIndex((x) => x.id === f.id) + 1;
    const caixa = montarFolhaOculta(folhaHTML(f, num, a, m));
    toast("Gerando PDF…");

    try {
      // aguarda a logo carregar
      await Promise.all(Array.from(caixa.querySelectorAll("img")).map((img) =>
        img.complete ? Promise.resolve() : new Promise((ok) => { img.onload = img.onerror = ok; })));

      const tela = await window.html2canvas(caixa, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      const { jsPDF } = window.jspdf;
      // o PDF sai no tamanho escolhido: A4, A5 ou cartão 3 × 4 cm
      const papel = estado.config.papel || "a4";
      const formato = papel === "cartao" ? [30, 40] : (papel === "a5" ? "a5" : "a4");
      const pdf = new jsPDF({ unit: "mm", format: formato, orientation: "portrait" });
      const larguraPagina = pdf.internal.pageSize.getWidth(), alturaPagina = pdf.internal.pageSize.getHeight();
      const margem = papel === "cartao" ? 1 : (papel === "a5" ? 5 : 8);
      const larg = larguraPagina - margem * 2;
      const alt = (tela.height * larg) / tela.width;

      if (alt <= alturaPagina - margem * 2) {
        pdf.addImage(tela.toDataURL("image/jpeg", 0.95), "JPEG", margem, margem, larg, alt);
      } else {
        // não deveria acontecer (folha cabe em 1 página), mas garante a quebra correta
        const alturaUtil = alturaPagina - margem * 2;
        let restante = tela.height, y = 0;
        while (restante > 0) {
          const alturaRecorte = Math.min(restante, (alturaUtil * tela.width) / larg);
          const canvas = document.createElement("canvas");
          canvas.width = tela.width;
          canvas.height = alturaRecorte;
          canvas.getContext("2d").drawImage(tela, 0, y, tela.width, alturaRecorte, 0, 0, tela.width, alturaRecorte);
          pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", margem, margem,
            larg, (alturaRecorte * larg) / tela.width);
          restante -= alturaRecorte; y += alturaRecorte;
          if (restante > 0) pdf.addPage();
        }
      }

      const nomeArquivo = `folha-ponto-${f.nome.split(" ")[0].toLowerCase()}-${String(num).padStart(2, "0")}-${pad(m + 1)}-${a}.pdf`;
      pdf.save(nomeArquivo);
      toast("PDF salvo.");
    } catch (e) {
      console.error(e);
      toast("Não foi possível gerar o PDF — use Imprimir e escolha “Salvar como PDF”.");
    } finally {
      caixa.remove();
    }
  }

  /** PDF/impressão de TODOS os cartões de ponto num arquivo só (pode atravessar meses) */
  async function gerarPDFTodos() {
    if (!window.html2canvas || !window.jspdf) {
      toast("Biblioteca de PDF não carregou — usando a impressão do navegador.");
      window.print();
      return;
    }
    const de = ($("#indDe") && $("#indDe").value) || INICIO_PADRAO;
    const ate = ($("#indAte") && $("#indAte").value) || isoDeHoje();
    if (de > ate) { toast("A data inicial não pode ser maior que a final."); return; }

    const sel = idsSelecionados();
    const alvo = sel.size ? estado.funcionarios.filter((f) => sel.has(f.id)) : estado.funcionarios.slice();
    if (!alvo.length) { toast("Nenhum funcionário para gerar."); return; }

    const { jsPDF } = window.jspdf;
    const papelTodos = estado.config.papel || "a4";
    const formatoTodos = papelTodos === "cartao" ? [30, 40] : (papelTodos === "a5" ? "a5" : "a4");
    const pdf = new jsPDF({ unit: "mm", format: formatoTodos, orientation: "portrait" });
    const larguraPagina = pdf.internal.pageSize.getWidth(), alturaPagina = pdf.internal.pageSize.getHeight();
    const margem = papelTodos === "cartao" ? 1 : (papelTodos === "a5" ? 5 : 8);
    const larg = larguraPagina - margem * 2;
    const alturaUtil = alturaPagina - margem * 2;

    // todos os meses que o período atravessa
    const meses = [];
    let cursor = new Date(dataDeISO(de).getFullYear(), dataDeISO(de).getMonth(), 1);
    const fim = dataDeISO(ate);
    while (cursor <= fim) {
      meses.push({ a: cursor.getFullYear(), m: cursor.getMonth() + 1 });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    toast(`Gerando PDF de ${alvo.length} folha(s)…`);
    let primeira = true;

    try {
      for (const f of alvo) {
        const num = estado.funcionarios.findIndex((x) => x.id === f.id) + 1;
        for (const { a, m } of meses) {
          const html = folhaHTML(f, num, a, m, { de, ate });
          const caixa = montarFolhaOculta(html);
          await Promise.all(Array.from(caixa.querySelectorAll("img")).map((img) =>
            img.complete ? Promise.resolve() : new Promise((ok) => { img.onload = img.onerror = ok; })));
          const tela = await window.html2canvas(caixa, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
          caixa.remove();

          const alt = (tela.height * larg) / tela.width;
          if (!primeira) pdf.addPage();
          primeira = false;

          if (alt <= alturaUtil) {
            pdf.addImage(tela.toDataURL("image/jpeg", 0.9), "JPEG", margem, margem, larg, alt);
          } else {
            let restante = tela.height, y = 0, pag = 0;
            while (restante > 0) {
              const alturaRecorte = Math.min(restante, (alturaUtil * tela.width) / larg);
              const canvas = document.createElement("canvas");
              canvas.width = tela.width;
              canvas.height = alturaRecorte;
              canvas.getContext("2d").drawImage(tela, 0, y, tela.width, alturaRecorte, 0, 0, tela.width, alturaRecorte);
              if (pag > 0) pdf.addPage();
              pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", margem, margem,
                larg, (alturaRecorte * larg) / tela.width);
              restante -= alturaRecorte; y += alturaRecorte; pag++;
            }
          }
        }
      }
      const nome = `folhas-ponto-${de}-a-${ate}.pdf`;
      pdf.save(nome);
      toast(`PDF com ${alvo.length} folha(s) salvo.`);
    } catch (e) {
      console.error(e);
      toast("Não foi possível gerar o PDF — use Imprimir e escolha “Salvar como PDF”.");
    }
  }

  /** PDF das abas de tabela (dia, mês, extras): usa a impressão do navegador */
  function imprimirOuPDF(aba) {
    const alvo = ["mes", "extra"].includes(aba) ? aba : "dia";
    if (alvo === "mes") renderMes();
    if (alvo === "extra") renderExtra();
    const anterior = $(".tab.ativo").dataset.tab;
    $$(".painel").forEach((p) => p.classList.toggle("oculto", p.id !== "tab-" + alvo));
    window.print();
    setTimeout(() => trocarTab(anterior), 300);
  }

  $("#btnPDF").addEventListener("click", () => {
    const aba = $(".tab.ativo").dataset.tab;
    if (aba === "individual") { gerarPDFFolha(); return; }
    imprimirOuPDF(aba);
  });

  $("#btnIndPDF").addEventListener("click", gerarPDFFolha);
  window.__folha = { folhaHTML: folhaHTML, CSS_FOLHA: CSS_FOLHA, totaisPeriodo: totaisPeriodo,
    funcionarios: FUNCIONARIOS_INICIAIS,
    setRegistros: function (r) { Object.assign(estado.registros, r); },
    setConfig: function (c) { estado.config = Object.assign(estado.config || {}, c); },
    regT: function (fid) { return JSON.stringify(reg(fid, 2026, 9, 26)); },
    regT2: function (fid) { return JSON.stringify(estado.registros["2026-10-26"] && estado.registros["2026-10-26"][fid]); },
    regT3: function (a, m, d, fid) { const k = a + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"); return k + " -> " + JSON.stringify(estado.registros[k] && estado.registros[k][fid]); },
    regT4: function (a, m, d, fid) { const k = a + "-" + pad(m) + "-" + pad(d); return k + " -> " + JSON.stringify(estado.registros[k] && estado.registros[k][fid]); },
    chaves26: function () { return JSON.stringify(Object.keys(estado.registros["2026-10-26"] || {})); },
    dia26: function () { return JSON.stringify(estado.registros["2026-10-26"]).slice(0, 200); },
    mesmoEstado: function (e) { return e === estado; },
    estadoInterno: estado,
    chaveT: function (a, m, d) { return chaveData(a, m, d); },
    config: function () { return estado.config; },
    dias: function () { return JSON.stringify(Object.keys(estado.registros).slice(0,8)); } };
  if ($("#btnIndTodosPDF")) $("#btnIndTodosPDF").addEventListener("click", gerarPDFTodos);
  window.gerarPDFTodos = gerarPDFTodos;

  /* ---------------- ABA: HORAS EXTRAS ---------------- */
  function renderExtra() {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const carga = cargaDoDia(a, m, d);
    const busca = ($("#exBusca").value || "").trim().toLowerCase();
    const lista = estado.funcionarios.filter((f) =>
      !busca || (f.nome + " " + f.funcao).toLowerCase().includes(busca));
    const tbody = $("#tabelaExtra tbody");
    const tfoot = $("#tabelaExtra tfoot");
    $("#tituloExtra").textContent = `Horas extras — ${pad(d)}/${pad(m + 1)}/${a} (${MESES[m]})`;

    $("#exValorHora").value = estado.config.valorHora || "";
    $("#exDiasUteis").value = estado.config.diasUteis || "";
    $("#exFator").value = String(estado.config.fator || 50);

    let somaExtra = 0, soma50 = 0, soma100 = 0, somaValor = 0;

    tbody.innerHTML = lista.map((f) => {
      const num = estado.funcionarios.findIndex((x) => x.id === f.id) + 1;
      const r = reg(f.id, a, m, d) || {};
      const min = minutosTrabalhados(r, carga);
      const ex = minutosExtras(r, carga);
      const fat = fatorDe(r);
      somaExtra += ex;
      if (fat === 100) soma100 += ex; else soma50 += ex;

      const tm = totaisMes(f.id, a, m);
      somaValor += (ex / 60) * (Number(estado.config.valorHora) || 0) * (fat === 100 ? 2 : 1.5);

      const normal = min === null ? null : Math.min(min, carga);
      const opcoes = [50, 100].map((v) => `<option value="${v}" ${fat === v ? "selected" : ""}>${v}%</option>`).join("");
      return `<tr data-id="${f.id}">
        <td class="c-num">${num}</td>
        <td class="nome">${escapar(f.nome)}</td>
        <td class="func">${escapar(f.funcao)}</td>
        <td><input type="time" data-campo="s" value="${r.s || ""}" aria-label="Saída real"></td>
        <td><input type="text" data-campo="extra" value="${escapar(r.extra || "")}" placeholder="${min !== null && min > carga ? "+" + paraHoras(min - carga) : "+0:00"}" aria-label="Horas extras"></td>
        <td><select data-campo="fator" aria-label="Fator">${opcoes}</select></td>
        <td class="valor">${normal === null ? '<span class="vazio-txt">—</span>' : paraHoras(normal)}</td>
        <td class="valor">${fat === 50 && ex ? paraHoras(ex) : '<span class="vazio-txt">—</span>'}</td>
        <td class="valor">${fat === 100 && ex ? paraHoras(ex) : '<span class="vazio-txt">—</span>'}</td>
        <td class="valor ${ex ? "total-extra" : ""}">${ex ? "R$ " + (((ex / 60) * (Number(estado.config.valorHora) || 0) * (fat === 100 ? 2 : 1.5)).toFixed(2)).replace(".", ",") : '<span class="vazio-txt">—</span>'}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="10" style="padding:24px;text-align:center;color:var(--suave)">Nenhum funcionário encontrado.</td></tr>`;

    tfoot.innerHTML = `<tr>
      <td colspan="4" style="text-align:right">Totais do dia (${lista.length} funcionário${lista.length === 1 ? "" : "s"})</td>
      <td class="valor total-extra">${somaExtra ? "+" + paraHoras(somaExtra) : "0:00"}</td>
      <td></td>
      <td class="valor">${carga ? paraHoras(carga) + " / dia" : ""}</td>
      <td class="valor">${soma50 ? paraHoras(soma50) : "0:00"}</td>
      <td class="valor">${soma100 ? paraHoras(soma100) : "0:00"}</td>
      <td class="valor total-extra">R$ ${somaValor.toFixed(2).replace(".", ",")}</td>
    </tr>`;
  }

  $("#tabelaExtra").addEventListener("change", (ev) => {
    const tr = ev.target.closest("tr[data-id]");
    const campo = ev.target.dataset.campo;
    if (!tr || !campo) return;
    const id = tr.dataset.id;
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const r = garantirReg(id, a, m, d);
    if (campo === "extra") {
      const bruto = ev.target.value.trim();
      const min = lerHoraExtra(bruto);
      if (bruto && min === null) { toast("Use o formato 2:00 ou 1:30."); ev.target.value = r.extra || ""; return; }
      r.extra = min ? paraHoras(min) : "";
    } else {
      r[campo] = ev.target.value;
    }
    if (rVazio(r) && estado.registros[chaveData(a, m, d)]) {
      delete estado.registros[chaveData(a, m, d)][id];
    }
    salvar(true);
    renderExtra(); renderDia(); renderResumo(); renderMes();
  });

  ["#exValorHora", "#exDiasUteis", "#exFator"].forEach((sel) => {
    $(sel).addEventListener("change", () => {
      estado.config.valorHora = Number($("#exValorHora").value) || 0;
      estado.config.diasUteis = Number($("#exDiasUteis").value) || 0;
      estado.config.fator = Number($("#exFator").value) || 50;
      salvar(true); renderExtra(); renderMes();
    });
  });
  $("#exBusca").addEventListener("input", renderExtra);

  $("#btnExtraPadrao").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    const fator = Number($("#exFator").value) || 50;
    const busca = ($("#exBusca").value || "").trim().toLowerCase();
    let n = 0;
    estado.funcionarios.forEach((f) => {
      if (busca && !(f.nome + " " + f.funcao).toLowerCase().includes(busca)) return;
      if (!reg(f.id, a, m, d)) return;
      garantirReg(f.id, a, m, d).fator = String(fator);
      n++;
    });
    salvar(true); renderExtra(); renderMes();
    toast(n ? `Fator ${fator}% aplicado em ${n} funcionário(s).` : "Nenhum lançamento neste dia.");
  });

  $("#btnExtraLimpar").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value), d = diaSelecionado;
    if (!confirm(`Limpar as horas extras de ${pad(d)}/${pad(m + 1)}/${a}?`)) return;
    const dia = estado.registros[chaveData(a, m, d)];
    if (dia) Object.keys(dia).forEach((id) => { dia[id].extra = ""; dia[id].fator = ""; });
    salvar(true); renderExtra(); renderDia(); renderMes();
    toast("Extras do dia limpos.");
  });


  /* ---------------- ABA: FOLHA INDIVIDUAL ---------------- */
  const MESES_EXT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
                     "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  function preencherSelectFunc() {
    const sel = $("#indFunc");
    const atual = sel.value || (estado.funcionarios[0] && estado.funcionarios[0].id) || "";
    sel.disabled = false;
    sel.innerHTML = estado.funcionarios.map((f, i) =>
      `<option value="${f.id}" ${f.id === atual ? "selected" : ""}>${String(i + 1).padStart(2, "0")} — ${escapar(f.nome)}${f.ativo ? "" : " (inativo)"}</option>`
    ).join("");
    return sel.value;
  }

  /* ---------------- folha individual em período (De/Até) ---------------- */
  const isoDeHoje = () => {
    const h = hojeZero();
    return dataISO(h.getFullYear(), h.getMonth() + 1, h.getDate());
  };

  const fmtBR = (iso) => {
    const [a, m, d] = iso.split("-");
    return `${d}/${m}/${a}`;
  };

  /** lista de dias que aparecem na folha: mês inteiro ou período */
  function diasDaFolha(a, m, periodo) {
    if (!periodo || !periodo.de || !periodo.ate) {
      const out = [];
      for (let d = 1; d <= diasNoMes(a, m); d++) out.push(d);
      return out;
    }
    const de = dataDeISO(periodo.de), ate = dataDeISO(periodo.ate);
    const out = [];
    for (let data = new Date(de); data <= ate; data.setDate(data.getDate() + 1)) {
      if (data.getFullYear() === a && data.getMonth() + 1 === m) out.push(data.getDate());
    }
    return out;
  }

  /** totais de um funcionário entre duas datas ISO (inclusive) */
  function totaisPeriodo(fid, deISO, ateISO) {
    const de = dataDeISO(deISO), ate = dataDeISO(ateISO);
    let normais = 0, extras = 0, extras50 = 0, extras100 = 0, presentes = 0;
    for (let data = new Date(de); data <= ate; data.setDate(data.getDate() + 1)) {
      const a = data.getFullYear(), m = data.getMonth() + 1, d = data.getDate();
      const r = reg(fid, a, m, d);
      if (!r) continue;
      const sit = situacao(r);
      if (["F", "AT", "FE", "FO", "FZ", "vazio"].includes(sit)) continue;
      const carga = cargaDoDia(a, m, d);
      const min = minutosTrabalhados(r, carga);
      if (min === null) continue;
      presentes++;
      const ex = minutosExtras(r, carga);
      // sábado: vale só o que foi trabalhado (sem "buracos" da tarde), então não sobra extra
      const usado = Math.min(min, carga);
      normais += usado;
      extras += ex;
      if (fatorDe(r) === 100) extras100 += ex; else extras50 += ex;
    }
    const valorHora = Number(estado.config.valorHora) || 0;
    const valor = (extras50 / 60) * valorHora * 1.5 + (extras100 / 60) * valorHora * 2;
    return { normais, extras, extras50, extras100, valor, presentes };
  }

  /** totais de um funcionário dentro de um mês, limitados ao período De/Até */
  function totaisPeriodoMes(fid, deISO, ateISO, a, m) {
    const de = dataDeISO(deISO), ate = dataDeISO(ateISO);
    const iniMes = new Date(a, m - 1, 1), fimMes = new Date(a, m, 0);
    const de1 = de > iniMes ? de : iniMes;
    const ate1 = ate < fimMes ? ate : fimMes;
    if (de1 > ate1) return { normais: 0, extras: 0, extras50: 0, extras100: 0, valor: 0, presentes: 0 };
    return totaisPeriodo(fid, dataISO(de1.getFullYear(), de1.getMonth() + 1, de1.getDate()),
      dataISO(ate1.getFullYear(), ate1.getMonth() + 1, ate1.getDate()));
  }

  /** uma folha (página A4) por funcionário */
  /** folha individual: mês inteiro (dia 1 ao último dia) ou período De/Até */
  function folhaHTML(f, num, a, m, periodo, periodoTexto) {
    const modoPeriodo = !!(periodo && periodo.de && periodo.ate);
    const carga = cargaDiariaMin();
    let tm, linhas = "", tituloDoc;

    if (modoPeriodo) {
      // numa folha por mês, os totais contam só os dias deste mês
      tm = totaisPeriodoMes(f.id, periodo.de, periodo.ate, a, m);
      tituloDoc = `FOLHA DE PONTO INDIVIDUAL — ${fmtBR(periodo.de)} A ${fmtBR(periodo.ate)}`;
    } else {
      const total = diasNoMes(a, m);
      tm = totaisMes(f.id, a, m, total);
      tituloDoc = `FOLHA DE PONTO INDIVIDUAL — DIA 1 AO ${total}`;
    }

    for (const d of diasDaFolha(a, m, periodo)) {
      const r = reg(f.id, a, m, d);
      const sit = situacao(r);
      const wd = new Date(a, m, d).getDay();   // m é 0..11
      const cls = ["dia-cel"];
      if (wd === 0) cls.push("domingo");
      if (sit === "F") cls.push("falta");
      if (sit === "AT") cls.push("at");
      if (sit === "FE") cls.push("fe");
      if (sit === "FO") cls.push("fo");
      if (sit === "FZ") cls.push("fz");

      const ex = r ? minutosExtras(r, cargaDoDia(a, m, d)) : 0;
      linhas += `<tr class="${wd === 0 ? "linha-dom" : ""}">
        <td class="d-num">${pad(d)}</td>
        <td>${r ? escapar(r.e || "") : ""}</td>
        <td>${r ? escapar(r.sa || "") : ""}</td>
        <td>${r ? escapar(r.r || "") : ""}</td>
        <td>${r ? escapar(r.s || "") : ""}</td>
        <td class="d-tot">${r && r.e && r.s ? paraHoras(minutosTrabalhados(r, cargaDoDia(a, m, d)) || 0) : ""}</td>
        <td class="d-ex">${ex ? "+" + paraHoras(ex) : ""}</td>
        <td class="d-oc">${["F", "AT", "FE", "FO", "FZ"].includes(sit) ? sit + (r && r.obs ? " — " + escapar(r.obs) : "") : (r && r.obs ? escapar(r.obs) : "")}</td>
      </tr>`;
    }

    const valorHora = Number(estado.config.valorHora) || 0;
    const saldo = tm.extras - 0;

    return `<article class="folha-individual">
      <header class="fi-topo">
        <img src="logo-cas.png" alt="CAS">
        <div class="fi-empresa">
          <strong>CAS CONSTRUTORA DE ARMAZÉNS E SILOS</strong>
          <span class="fi-doc">${tituloDoc}</span>
        </div>
        <div class="fi-mes">
          <div class="fi-mes-txt">${modoPeriodo
            ? `${fmtBR(periodo.de)} – ${fmtBR(periodo.ate)}`
            : (String(periodoTexto || "").trim() || `${MESES_EXT[m].toUpperCase()} / ${a}`)}</div>
          <div class="fi-num">Nº ${String(num).padStart(2, "0")}</div>
        </div>
      </header>

      <div class="fi-campos">
        <div class="fi-campo-nome"><span>Funcionário</span><b>${escapar(f.nome)}</b></div>
        <div><span>Função</span><b>${escapar(f.funcao)}</b></div>
        <div><span>Jornada</span><b>${estado.config.horaEntrada}–${estado.config.horaSaida} • ${paraHoras(cargaDiariaMin())}</b></div>
      </div>

      <table class="fi-tabela">
        <thead>
          <tr>
            <th>Dia</th><th>Entrada</th><th>Saída Almoço</th><th>Retorno</th><th>Saída</th>
            <th>Horas</th><th>Extras</th><th>Ocorrência / Obs</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="fi-tot-rot">${modoPeriodo ? "TOTAIS DO PERÍODO (MÊS)" : "TOTAIS DO MÊS"}</td>
            <td class="d-tot">${paraHoras(tm.normais + tm.extras)}</td>
            <td class="d-ex">${tm.extras ? "+" + paraHoras(tm.extras) : "0:00"}</td>
            <td class="d-oc">${tm.presentes} dia(s) trabalhado(s)</td>
          </tr>
        </tfoot>
      </table>

      <div class="fi-resumo">
        <span><i>Normais</i> <b>${paraHoras(tm.normais) || "0:00"}</b></span>
        <span><i>Extra 50%</i> <b>${tm.extras50 ? paraHoras(tm.extras50) : "0:00"}</b></span>
        <span><i>Extra 100%</i> <b>${tm.extras100 ? paraHoras(tm.extras100) : "0:00"}</b></span>
        <span><i>Total extras</i> <b>${tm.extras ? paraHoras(tm.extras) : "0:00"}</b></span>
        ${valorHora ? `<span><i>Valor extras</i> <b>R$ ${tm.valor.toFixed(2).replace(".", ",")}</b></span>` : ""}
        <span class="fi-data"><i>Emitido</i> <b>${fmtDataCurta(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())}</b></span>
      </div>

      <table class="fi-assinaturas"><tr>
        <td class="fi-ass"><span></span>Assinatura do funcionário</td>
        <td class="fi-ass"><span></span>Assinatura do responsável</td>
      </tr></table>
    </article>`;
  }

  /** marcados no Ponto do dia */
  let gerarTodos = false;

  function renderListaSelecao() {
    const sel = idsSelecionados();
    const lista = $("#srLista");
    $("#qtdSel").textContent = sel.size;
    $("#btnIndSel").classList.toggle("ativo", !gerarTodos);
    $("#btnIndTodos").classList.toggle("ativo", gerarTodos);
    if (!lista) return;
    lista.innerHTML = estado.funcionarios.map((f, i) => `
      <label class="sr-item ${sel.has(f.id) ? "on" : ""}">
        <input type="checkbox" data-id="${f.id}" ${sel.has(f.id) ? "checked" : ""}>
        <span class="sr-num">${String(i + 1).padStart(2, "0")}</span>
        <span class="sr-nome">${escapar(f.nome)}</span>
        <span class="sr-func">${escapar(f.funcao)}</span>
      </label>`).join("");
  }

  /** período escolhido na aba Folha individual (null = mês inteiro) */
  let periodoIndividual = null;

  function periodoFolha(a, m) {
    if (!periodoIndividual) return null;
    const p = periodoIndividual;
    const de = dataDeISO(p.de), ate = dataDeISO(p.ate);
    const iniMes = new Date(a, m - 1, 1), fimMes = new Date(a, m, 0);
    if (ate < iniMes || de > fimMes) return null;
    // o período inteiro (pode atravessar meses) — a folha mostra os dias do mês e o total do período
    return { de: p.de, ate: p.ate };
  }

  /** preenche/limpa os campos De/Até da aba */
  function renderPeriodoIndividual() {
    const de = $("#indDe"), ate = $("#indAte");
    if (!de || !ate) return;
    de.value = periodoIndividual ? periodoIndividual.de : "";
    ate.value = periodoIndividual ? periodoIndividual.ate : "";
    if ($("#btnIndMes")) $("#btnIndMes").classList.toggle("ativo", !periodoIndividual);
  }

  function renderIndividual() {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    preencherSelectFunc();
    const cont = $("#folhasIndividuais");
    const sel = idsSelecionados();

    let alvo;
    if (gerarTodos) alvo = estado.funcionarios.slice();
    else alvo = estado.funcionarios.filter((f) => sel.has(f.id));
    if (!alvo.length && !gerarTodos) {
      cont.innerHTML = `<div class="aviso-vazio">
        <b>Nenhum funcionário selecionado.</b>
        <span>Marque quem vai receber folha na lista acima (ou na aba “Ponto do dia”) e a folha de cada um aparece aqui.</span>
      </div>`;
      renderListaSelecao();
      return;
    }
    renderListaSelecao();

    const per = periodoFolha(a, m);
    cont.innerHTML = alvo.map((f) =>
      folhaHTML(f, estado.funcionarios.findIndex((x) => x.id === f.id) + 1, a, m, per)).join("")
      || `<p style="padding:24px;text-align:center;color:var(--suave)">Nenhum funcionário cadastrado.</p>`;
  }

  $("#btnIndPeriodo").addEventListener("click", () => {
    const ate = $("#indAte").value || isoDeHoje();
    const de = $("#indDe").value || INICIO_PADRAO;
    if (de > ate) { toast("A data inicial não pode ser maior que a final."); return; }
    periodoIndividual = { de, ate };
    irParaMesAno(ate);
    renderPeriodoIndividual();
    renderIndividual();
    toast(`Folha de ${fmtBR(de)} a ${fmtBR(ate)}.`);
  });
  $("#btnIndMes").addEventListener("click", () => {
    periodoIndividual = null;
    renderPeriodoIndividual();
    renderIndividual();
  });
  $("#indDe").addEventListener("change", () => {
    if (!$("#indDe").value || !$("#indAte").value) return;
    $("#btnIndPeriodo").click();
  });
  $("#indAte").addEventListener("change", () => {
    if (!$("#indDe").value || !$("#indAte").value) return;
    $("#btnIndPeriodo").click();
  });
  renderPeriodoIndividual();
  $("#btnIndSel").addEventListener("click", () => { gerarTodos = false; renderIndividual(); });
  $("#btnIndTodos").addEventListener("click", () => { gerarTodos = true; renderIndividual(); });

  $("#srLista").addEventListener("change", (ev) => {
    const id = ev.target.dataset.id;
    if (!id) return;
    estado.selecionados = estado.selecionados || [];
    const i = estado.selecionados.indexOf(id);
    if (ev.target.checked && i < 0) estado.selecionados.push(id);
    if (!ev.target.checked && i >= 0) estado.selecionados.splice(i, 1);
    gerarTodos = false;
    salvar(true);
    renderIndividual();
    renderDia(); renderResumo();
  });

  $("#srTodos").addEventListener("click", () => {
    estado.selecionados = estado.funcionarios.map((f) => f.id);
    salvar(true); renderIndividual(); renderDia(); renderResumo();
    toast(`${estado.selecionados.length} funcionário(s) marcado(s).`);
  });
  $("#srNenhum").addEventListener("click", () => {
    estado.selecionados = [];
    salvar(true); renderIndividual(); renderDia(); renderResumo();
  });
  $("#srFiltrados").addEventListener("click", () => {
    const ids = funcionariosFiltrados().map((f) => f.id);
    estado.selecionados = [...new Set([...(estado.selecionados || []), ...ids])];
    salvar(true); renderIndividual(); renderDia(); renderResumo();
    toast(`${ids.length} funcionário(s) do filtro marcado(s).`);
  });

  function moverFuncionario(passo) {
    gerarTodos = false;
    const sel = $("#indFunc");
    const i = estado.funcionarios.findIndex((f) => f.id === sel.value);
    const novo = estado.funcionarios[Math.min(Math.max(i + passo, 0), estado.funcionarios.length - 1)];
    if (novo) {
      sel.value = novo.id;
      estado.selecionados = [novo.id];
      salvar(true);
      renderIndividual(); renderDia(); renderResumo();
    }
  }
  $("#btnIndAnterior").addEventListener("click", () => moverFuncionario(-1));
  $("#btnIndProximo").addEventListener("click", () => moverFuncionario(1));

  /** imprime somente a folha do funcionário escolhido (sempre 1 página A4) */
  $("#btnIndImprimir").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    const id = preencherSelectFunc();
    const f = estado.funcionarios.find((x) => x.id === id);
    if (!f) { toast("Escolha um funcionário."); return; }
    const num = estado.funcionarios.findIndex((x) => x.id === f.id) + 1;

    let quadro = document.getElementById("quadroImpressao");
    if (!quadro) {
      quadro = document.createElement("iframe");
      quadro.id = "quadroImpressao";
      quadro.setAttribute("aria-hidden", "true");
      quadro.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
      document.body.appendChild(quadro);
    }

    const doc = quadro.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html lang="pt-BR" data-tema="claro"><head><meta charset="utf-8">
      <title>Folha de ponto — ${escapar(f.nome).replace(/[<>&]/g, "")}</title>
      <style>${estiloImpressao()}</style></head>
      <body>${folhaHTML(f, num, a, m)}</body></html>`);
    doc.close();

    const disparar = () => {
      try {
        quadro.contentWindow.focus();
        quadro.contentWindow.print();
      } catch (e) { toast("Não foi possível abrir a impressão."); }
    };
    if (doc.readyState === "complete") setTimeout(disparar, 150);
    else quadro.onload = () => setTimeout(disparar, 150);
  });

  /* ---------------- ABA: FUNCIONÁRIOS ---------------- */
  function renderFuncionarios() {
    const tbody = $("#tabelaFunc tbody");
    tbody.innerHTML = estado.funcionarios.map((f, i) => `
      <tr data-id="${f.id}">
        <td class="c-num">${i + 1}</td>
        <td class="c-nome">${escapar(f.nome)}${f.novo ? ' <span class="tag-novo">novo</span>' : ""}</td>
        <td class="c-func">${escapar(f.funcao)}</td>
        <td class="c-h" style="text-align:center">${f.ativo ? "Sim" : "Não"}</td>
        <td class="c-acoes">
          <button class="btn mini ghost" data-acao="editar" type="button">Editar</button>
          <button class="btn mini ghost danger" data-acao="excluir" type="button">Excluir</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="5" style="padding:24px;text-align:center;color:#6b7280">Nenhum funcionário cadastrado.</td></tr>`;
    renderFiltroFuncoes();
    const info = $("#infoFunc");
    if (info) {
      const ativos = estado.funcionarios.filter((f) => f.ativo).length;
      const novos = estado.funcionarios.filter((f) => f.novo).length;
      let quando = "";
      try {
        const b = JSON.parse(localStorage.getItem("cas-ponto-funcionarios") || "null");
        if (b && b.quando) quando = " · backup " + new Date(b.quando).toLocaleString("pt-BR");
      } catch (e) {}
      info.textContent = `${estado.funcionarios.length} cadastrado(s) · ${ativos} ativo(s)${novos ? ` · ${novos} novo(s)` : ""} · salvos automaticamente${quando}`;
    }
  }

  /* ---- manter a lista de funcionários segura ---- */
  $("#btnBaixarLista").addEventListener("click", () => {
    const dados = { funcionarios: estado.funcionarios };
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "funcionarios-CAS.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast("Lista de funcionários baixada.");
  });

  $("#btnRestaurarLista").addEventListener("click", () => {
    const lista = lerBackupFuncionarios();
    if (!lista) { toast("Nenhum backup encontrado."); return; }
    if (!confirm(`Restaurar ${lista.length} funcionário(s) do backup automático? A lista atual será substituída.`)) return;
    estado.funcionarios = normalizar({ funcionarios: lista }).funcionarios;
    salvar(true);
    renderFuncionarios(); renderDia(); renderMes(); renderResumo();
    toast("Lista restaurada do backup.");
  });

  $("#fileLista").addEventListener("change", (ev) => {
    const arq = ev.target.files[0];
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const d = JSON.parse(leitor.result);
        const lista = Array.isArray(d) ? d : (d.funcionarios || (d.lista || null));
        if (!Array.isArray(lista) || !lista.length) throw new Error("sem lista");
        if (!confirm(`Carregar ${lista.length} funcionário(s) deste arquivo? A lista atual será substituída.`)) return;
        estado.funcionarios = normalizar({ funcionarios: lista }).funcionarios;
        salvar(true);
        renderFuncionarios(); renderDia(); renderMes(); renderResumo();
        toast("Lista carregada.");
      } catch (e) { toast("Arquivo inválido."); }
      ev.target.value = "";
    };
    leitor.readAsText(arq);
  });

  function renderFiltroFuncoes() {
    const atual = $("#filtroFuncao").value;
    const funcoes = [...new Set(estado.funcionarios.map((f) => f.funcao).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    $("#filtroFuncao").innerHTML = `<option value="">Todas</option>` +
      funcoes.map((f) => `<option value="${escapar(f)}" ${f === atual ? "selected" : ""}>${escapar(f)}</option>`).join("");
  }

  $("#formFunc").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const nome = $("#fNome").value.trim();
    const funcao = $("#fFuncao").value.trim();
    if (!nome || !funcao) return;

    if (editandoId) {
      const f = estado.funcionarios.find((x) => x.id === editandoId);
      if (f) {
        const ficouAtivo = $("#fAtivo").checked;
        if (f.ativo && !ficouAtivo) f.desativadoEm = Date.now();
        f.nome = nome; f.funcao = funcao; f.ativo = ficouAtivo;
      }
      toast("Funcionário atualizado.");
    } else {
      const mesmoNome = (estado.funcionarios || []).find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      estado.funcionarios.push({
        id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        nome, funcao, ativo: $("#fAtivo").checked, novo: true,
        recriadoEm: mesmoNome ? Date.now() : undefined
      });
      toast(`${nome} adicionado — confira na aba Ponto do dia (fim da lista).`);
    }
    cancelarEdicao();
    salvar(true);
    renderFuncionarios(); renderDia(); renderMes(); renderResumo();
  });

  $("#tabelaFunc").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-acao]");
    if (!btn) return;
    const tr = btn.closest("tr[data-id]");
    const f = estado.funcionarios.find((x) => x.id === tr.dataset.id);
    if (!f) return;

    if (btn.dataset.acao === "editar") {
      editandoId = f.id;
      $("#fNome").value = f.nome;
      $("#fFuncao").value = f.funcao;
      $("#fAtivo").checked = f.ativo;
      $("#btnSalvarFunc").textContent = "Salvar alterações";
      $("#fNome").focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (btn.dataset.acao === "excluir") {
      if (!confirm(`Excluir "${f.nome}"? Os registros de ponto dele também serão removidos.`)) return;
      // fica marcado como excluído para a nuvem não trazer ele de volta de outro aparelho
      estado.excluidos = estado.excluidos || {};
      estado.excluidos[f.id] = { nome: f.nome, em: Date.now() };
      estado.funcionarios = estado.funcionarios.filter((x) => x.id !== f.id);
      Object.values(estado.registros).forEach((dia) => delete dia[f.id]);
      estado.selecionados = (estado.selecionados || []).filter((id) => id !== f.id);
      salvar(true);
      renderFuncionarios(); renderDia(); renderMes(); renderResumo();
      toast("Funcionário excluído.");
    }
  });

  function cancelarEdicao() {
    editandoId = null;
    $("#formFunc").reset();
    $("#fAtivo").checked = true;
    $("#btnSalvarFunc").textContent = "Adicionar";
  }
  $("#btnCancelarEdit").addEventListener("click", cancelarEdicao);

  /* ---------------- tabs ---------------- */
  function trocarTab(nome) {
    $$(".tab").forEach((t) => t.classList.toggle("ativo", t.dataset.tab === nome));
    $$(".painel").forEach((p) => p.classList.toggle("oculto", p.id !== "tab-" + nome));
    if (nome === "extra") renderExtra();
    if (nome === "mes") renderMes();
    if (nome === "dia") renderDia();
    if (nome === "cadastro") renderFuncionarios();
    if (nome === "individual") renderIndividual();
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => trocarTab(t.dataset.tab)));

  /* limpar filtros pela dica de aviso */
  document.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest("#btnLimparFiltros") : null;
    if (!b) return;
    $("#busca").value = "";
    $("#filtroFuncao").value = "";
    if ($("#filtroSel")) $("#filtroSel").value = "todos";
    renderDia(); renderMes(); renderResumo();
    toast("Filtros limpos.");
  });

  /* ---------------- jornada diária ---------------- */
  /* ---------------- tamanho da folha impressa ---------------- */
  function aplicarPapel(v) {
    const papel = ["a4", "a5", "cartao"].includes(v) ? v : "a4";
    document.documentElement.setAttribute("data-papel", papel);
    estado.config.papel = papel;
    try { localStorage.setItem("cas-papel", papel); } catch (e) {}
    const sel = $("#cfgPapel");
    if (sel) sel.value = papel;
    return papel;
  }
  function renderPapel() {
    let v = estado.config.papel;
    try { v = v || localStorage.getItem("cas-papel") || "a4"; } catch (e) { v = v || "a4"; }
    aplicarPapel(v);
  }

  function renderJornada() {
    const v = String(estado.config.cargaDiaria || 7);
    const sel = $("#cfgJornada");
    sel.value = [...sel.options].some((o) => o.value === v) ? v : "7";
  }
  $("#cfgPapel").addEventListener("change", (ev) => {
    const papel = aplicarPapel(ev.target.value);
    salvar(true);
    toast(papel === "cartao" ? "Folha em cartão 3 × 4 cm." : "Folha em " + papel.toUpperCase() + ".");
  });

  $("#cfgJornada").addEventListener("change", (ev) => {
    estado.config.cargaDiaria = Number(ev.target.value) || 7;
    salvar(true);
    renderDia(); renderResumo(); renderMes();
    toast(`Jornada definida em ${paraHoras(cargaDiariaMin())} por dia.`);
  });

  /* ---------------- filtros ---------------- */
  ["#busca", "#filtroFuncao", "#filtroSel", "#ordem"].forEach((s) => {
    $(s).addEventListener("input", () => { renderDia(); renderMes(); renderResumo(); });
    $(s).addEventListener("change", () => { renderDia(); renderMes(); renderResumo(); });
  });

  $("#btnMarcarTodos").addEventListener("click", () => {
    estado.selecionados = funcionariosFiltrados().map((f) => f.id);
    salvar(); renderDia(); renderResumo();
    toast(`${estado.selecionados.length} funcionário(s) selecionado(s).`);
  });
  $("#btnLimparSel").addEventListener("click", () => {
    estado.selecionados = [];
    salvar(); renderDia(); renderResumo();
  });

  /* ---------------- exportar / importar ---------------- */
  $("#btnExportar").addEventListener("click", () => {
    const a = Number($("#ano").value), m = Number($("#mes").value);
    const conteudo = JSON.stringify(estado, null, 2);
    const blob = new Blob([conteudo], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ponto-CAS-${a}-${pad(m + 1)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast("Backup exportado.");
  });

  $("#btnImportar").addEventListener("click", () => $("#fileImport").click());
  $("#fileImport").addEventListener("change", (ev) => {
    const arq = ev.target.files[0];
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const dados = JSON.parse(leitor.result);
        if (!dados.funcionarios) throw new Error("formato inválido");
        if (!confirm("Importar este arquivo? Os dados atuais serão substituídos.")) return;
        estado = normalizar(dados);
        salvar(true);
        montarDias(); renderFuncionarios(); renderDia(); renderMes(); renderResumo(); renderTitulos();
        toast("Dados importados.");
      } catch (e) { toast("Arquivo inválido."); }
      ev.target.value = "";
    };
    leitor.readAsText(arq);
  });

  /* ---------------- imprimir ---------------- */
  $("#btnImprimir").addEventListener("click", () => {
    const abaAtiva = $(".tab.ativo").dataset.tab;
    const alvo = ["mes", "individual", "extra"].includes(abaAtiva) ? abaAtiva : "dia";
    if (alvo === "individual") renderIndividual();
    $$(".painel").forEach((p) => p.classList.toggle("oculto", p.id !== "tab-" + alvo));
    window.print();
    setTimeout(() => trocarTab(abaAtiva), 300);
  });

  /* ---------------- tema claro / escuro ---------------- */
  const raiz = document.documentElement;
  function aplicarTema(t) {
    raiz.setAttribute("data-tema", t);
    const btn = $("#btnTema");
    if (btn) {
      btn.textContent = t === "escuro" ? "☀" : "🌙";
      btn.title = t === "escuro" ? "Mudar para modo claro" : "Mudar para modo escuro";
    }
    try { localStorage.setItem("cas-tema", t); } catch (e) {}
  }
  $("#btnTema").addEventListener("click", () => {
    const atual = raiz.getAttribute("data-tema") === "escuro" ? "claro" : "escuro";
    aplicarTema(atual);
    toast(atual === "escuro" ? "Modo escuro ativado" : "Modo claro ativado");
  });
  aplicarTema(raiz.getAttribute("data-tema") || "claro");

  /* ---------------- início ---------------- */
  function desenharTudo() {
    // o navegador pode restaurar valores antigos nos campos de filtro ao reabrir a página;
    // começamos sempre com "todos", senão a lista aparece vazia ou com 1 pessoa só
    try {
      if ($("#busca")) $("#busca").value = "";
      if ($("#filtroFuncao")) $("#filtroFuncao").value = "";
      if ($("#filtroSel")) $("#filtroSel").value = "todos";
    } catch (e) {}
    estado.selecionados = estado.selecionados || [];
    montarSelectsData();
    garantirConfigPresenca();
    renderJornada();
    renderPapel();
    renderRetorno();
    renderSaidas();
    if ($("#horaPadrao")) $("#horaPadrao").value = estado.config.horaPadrao;
    renderFuncionarios();
    renderTitulos();
    renderDia();
    renderResumo();
    renderMes();
    renderExtra();
    renderIndividual();
  }

  /* ---------------- ponte para a nuvem (nuvem.js) ---------------- */
  let desenhando = false;
  function ligarNuvem() {
    if (!window.CASNuvem) return;
    window.CASPonto = {
      estado: () => estado,
      // troca os dados locais pelos da nuvem e redesenha a tela
      aplicar: (dados, quem) => {
        if (!dados || !Array.isArray(dados.funcionarios) || !dados.funcionarios.length) return;
        desenhando = true;
        // guarda os filtros/busca e a aba aberta para não pular a tela
        const aba = ($(".tab.ativo") && $(".tab.ativo").dataset.tab) || "dia";
        estado = normalizar(dados);
        estado.listaVersao = LISTA_VERSAO;     // não re-sincroniza a lista do arquivo
        estado.registrosImportados = 1;
        salvarLocal();
        desenharTudo();
        if (aba && typeof trocarTab === "function") trocarTab(aba);
        desenhando = false;
        toast(quem ? `Dados recebidos do ${quem}.` : "Dados atualizados da nuvem.");
      },
      dispositivo: () => {
        const u = navigator.userAgent || "";
        if (/iPad|Tablet/i.test(u) || (/Android/i.test(u) && !/Mobi/i.test(u))) return "tablet";
        if (/Mobi/i.test(u)) return "celular";
        return "computador";
      }
    };
    const selo = $("#statusNuvem");
    function pintarSeloNuvem() {
      if (!selo) return;
      const ap = (window.CASNuvem.aparelhos && window.CASNuvem.aparelhos()) || {};
      const nomes = Object.keys(ap);
      if (!window.CASNuvem.ligada()) {
        selo.className = "status nuvem off";
        selo.textContent = "☁️ desligada";
        selo.title = "Sem as chaves do Firebase os dados ficam só neste aparelho. Veja COMO-COLOCAR-NA-NUVEM.md";
        return;
      }
      selo.className = "status nuvem on";
      selo.textContent = nomes.length > 1 ? `☁️ ${nomes.length} aparelhos` : "☁️ nuvem";
      selo.title = nomes.length
        ? "Aparelhos que já gravaram:\n" + nomes.map((n) => "• " + n + " — " + new Date(ap[n]).toLocaleString("pt-BR")).join("\n")
        : "Aguardando a primeira gravação";
    }
    window.CASNuvem.aoMudarStatus((txt, erro) => {
      pintarSeloNuvem();
      const el = $("#statusSalvo");
      if (!el) return;
      el.textContent = txt;
      el.classList.toggle("pendente", !erro);
      if (erro) el.style.color = "#c0392b"; else el.style.color = "";
    });
    window.CASNuvem.iniciar();
    pintarSeloNuvem();
    setInterval(pintarSeloNuvem, 5000);
    if (!window.CASNuvem.configurada()) {
      const el = $("#statusSalvo");
      if (el) { el.textContent = "salvo"; el.classList.remove("pendente"); el.style.color = ""; }
      return;
    }
    // ao abrir: se a nuvem tem a versão mais nova, ela manda
    const localEm = Number(estado.atualizadoEm) || 0;
    window.CASNuvem.baixar().then((dados) => {
      if (!dados || !Array.isArray(dados.funcionarios) || !dados.funcionarios.length) {
        salvar(true);            // primeira vez: manda o que existe aqui para a nuvem
        return;
      }
      const nuvemEm = Number(dados.atualizadoEm) || 0;
      if (nuvemEm > localEm) {
        const quando = nuvemEm ? new Date(nuvemEm).toLocaleString("pt-BR") : "";
        if (localEm && !confirm("A nuvem tem dados mais novos" + (quando ? " (" + quando + ")" : "") + ".\n\n" +
            "OK = usar os dados da NUVEM\nCancelar = manter os dados DESTE aparelho e enviá-los para a nuvem")) {
          salvar(true);          // fica com o deste aparelho e sobe para a nuvem
          return;
        }
        window.CASPonto.aplicar(dados);
      } else {
        salvar(true);
      }
    });
  }

  desenharTudo();
  ligarNuvem();
  salvar(true);
})();
