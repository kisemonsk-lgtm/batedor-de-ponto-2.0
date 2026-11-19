/* =========================================================
   Nuvem (Firebase Firestore) — CAS Ponto
   ---------------------------------------------------------
   - Se o firebase-config.js estiver preenchido, o sistema
     salva e lê os dados no Firestore (mesma base em todos
     os aparelhos). Se não estiver, funciona só no navegador.
   - O "salvar" do app continua funcionando igual: ele grava
     no navegador e chama CASNuvem.agendarSalvar(estado).
   ========================================================= */
(function () {
  "use strict";

  const cfg = window.FIREBASE_CONFIG || {};
  const COLECAO = window.FIRESTORE_COLECAO || "ponto-cas";
  const DOC = window.FIRESTORE_DOC || "principal";

  const pronto = !!(cfg && cfg.apiKey && cfg.projectId && String(cfg.apiKey).indexOf("COLE") < 0);

  let db = null;
  let quandoSalvar = null;
  let enviando = false;
  let avisarTela = () => {};

  /* ---- junta duas versões do estado SEM perder o que o outro aparelho lançou ----
     - registros (ponto do dia): cada dia/pessoa é comparado campo a campo; vence o
       carimbo (at) mais novo, então o que foi lançado em outro aparelho não se perde
     - funcionários: vale a lista com o carimbo mais novo, mas ninguém que exista num
       lado desaparece do outro (quem só existe aqui entra no fim) */
  function juntar(a, b) {
    if (!a) return b;
    if (!b) return a;
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa === sb) return a;

    const base = (Number(b.atualizadoEm) || 0) >= (Number(a.atualizadoEm) || 0) ? JSON.parse(sb) : JSON.parse(sa);
    const outro = base === a || sa === sb ? b : a;
    const maisNovo = base;

    // ---- registros ----
    const reg = {};
    const dias = new Set(Object.keys(a.registros || {}).concat(Object.keys(b.registros || {})));
    dias.forEach((dia) => {
      const ra = (a.registros || {})[dia] || {};
      const rb = (b.registros || {})[dia] || {};
      const pessoas = new Set(Object.keys(ra).concat(Object.keys(rb)));
      const saida = {};
      pessoas.forEach((fid) => {
        const x = ra[fid], y = rb[fid];
        if (!x) { saida[fid] = y; return; }
        if (!y) { saida[fid] = x; return; }
        const tx = Number(x.at) || 0, ty = Number(y.at) || 0;
        if (JSON.stringify(semCarimbo(x)) === JSON.stringify(semCarimbo(y))) { saida[fid] = y; return; }
        // quem lançou por último manda; se um dos dois não tem carimbo, vale o que tem
        const vence = tx > ty ? x : y;
        const perde = vence === x ? y : x;
        const junto = Object.assign({}, perde, vence);      // preenche o que faltar
        junto.at = Math.max(tx, ty) || Date.now();
        saida[fid] = junto;
      });
      if (Object.keys(saida).length) reg[dia] = saida;
    });
    maisNovo.registros = reg;

    // ---- funcionários: união das duas listas ----
    const chave = (n) => String(n || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    const listaA = a.funcionarios || [], listaB = b.funcionarios || [];
    const dono = (Number(b.atualizadoEm) || 0) >= (Number(a.atualizadoEm) || 0) ? listaB : listaA;
    const outroLado = dono === listaA ? listaB : listaA;
    const ids = new Set(dono.map((f) => f.id));
    const nomes = new Set(dono.map((f) => chave(f.nome)));
    const lista = dono.map((f) => {
      const par = outroLado.find((g) => g.id === f.id || chave(g.nome) === chave(f.nome));
      if (!par) return f;
      // se o outro lado marcou como excluído (ativo=false) depois, respeita
      const copia = Object.assign({}, f);
      if (par.excluidoEm) {
        // a exclusão vence: ninguém volta para a lista porque outro aparelho ainda tinha
        copia.ativo = false;
        copia.excluidoEm = par.excluidoEm;
      } else if (par.ativo === false && f.ativo !== false && par.desativadoEm && (!f.desativadoEm || par.desativadoEm > f.desativadoEm)) {
        copia.ativo = false;                 // foi desativado (sem excluir) no outro aparelho
      }
      return copia;
    });
    outroLado.forEach((g) => {
      if (ids.has(g.id) || nomes.has(chave(g.nome))) return;
      ids.add(g.id); nomes.add(chave(g.nome));
      lista.push(g);
    });
    maisNovo.funcionarios = lista;

    // ---- excluídos: uma vez excluído num aparelho, não volta de outro ----
    const exc = Object.assign({}, a.excluidos || {}, b.excluidos || {});
    maisNovo.excluidos = exc;
    maisNovo.funcionarios = maisNovo.funcionarios.filter((f) => {
      const e = exc[f.id];
      if (!e) return true;
      // excluído num aparelho: só volta se foi cadastrado de novo DEPOIS da exclusão
      return !!(f.recriadoEm && f.recriadoEm > (e.em || 0));
    });

    // ---- configuração: a mais nova manda, sem perder chaves que só existem no outro ----
    maisNovo.config = Object.assign({}, outro.config || {}, maisNovo.config || {});
    return maisNovo;
  }

  function semCarimbo(r) {
    const c = Object.assign({}, r);
    delete c.at;
    return c;
  }

  window.CASNuvemJuntar = juntar;   // usado pelo app.js também

  function marcarStatus(txt, erro) {
    try { avisarTela(txt, !!erro); } catch (e) {}
  }

  function iniciar() {
    if (!pronto) { marcarStatus("nuvem desligada"); return; }
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      db = firebase.firestore();
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      marcarStatus("nuvem ligada");
      observar();
    } catch (e) {
      console.warn("Firebase não iniciou:", e);
      marcarStatus("nuvem com erro", true);
    }
  }

  /* recebe mudanças feitas em outro aparelho */
  function observar() {
    if (!db) return;
    db.collection(COLECAO).doc(DOC).onSnapshot((doc) => {
      if (!doc.exists) return;
      const d = doc.data() || {};
      const dados = d.dados;
      if (!dados || !Array.isArray(dados.funcionarios)) return;
      if (d.aparelhos) aparelhos = Object.assign({}, aparelhos, d.aparelhos);
      const local = (window.CASPonto && window.CASPonto.estado && window.CASPonto.estado()) || null;
      if (!local) return;
      if (JSON.stringify(dados) === JSON.stringify(local)) return;   // já é o que está na tela
      const misturado = juntar(local, dados);
      if (JSON.stringify(misturado) === JSON.stringify(local)) return; // nada novo para nós
      const quem = d.atualizadoPor && d.atualizadoPor !== (window.CASPonto.dispositivo && window.CASPonto.dispositivo())
        ? d.atualizadoPor : "";
      marcarStatus("recebendo do " + (quem || "outro aparelho") + "…");
      window.CASPonto.aplicar(misturado, quem);
      marcarStatus("nuvem atualizada");
      // o que só existia aqui volta para a nuvem
      if (JSON.stringify(misturado) !== JSON.stringify(dados)) enviar(misturado, true);
    }, (err) => {
      console.warn("Falha ao ler da nuvem:", err);
      marcarStatus("nuvem sem conexão", true);
    });
  }

  let aparelhos = {};   // quem já gravou e quando: { "celular": 1699..., "computador": ... }
  let ultimoEnviado = Number((window.CASPonto && window.CASPonto.estado && window.CASPonto.estado() || {}).atualizadoEm) || 0;

  function agendarSalvar(estado) {
    if (!db) return;
    clearTimeout(quandoSalvar);
    marcarStatus("enviando…");
    quandoSalvar = setTimeout(() => {
      // junta com a última versão conhecida da nuvem antes de mandar
      db.collection(COLECAO).doc(DOC).get()
        .then((doc) => {
          const nuvem = doc.exists ? (doc.data() || {}).dados : null;
          enviar(nuvem ? juntar(estado, nuvem) : estado);
        })
        .catch(() => enviar(estado));
    }, 800);
  }

  function enviar(estado) {
    if (!db) return;
    const agora = Date.now();
    ultimoEnviado = agora;
    enviando = true;
    const copia = JSON.parse(JSON.stringify(estado));
    copia.atualizadoEm = agora;
    const meu = (window.CASPonto && window.CASPonto.dispositivo && window.CASPonto.dispositivo()) || "app";
    db.collection(COLECAO).doc(DOC).set({
      dados: copia,
      atualizadoEm: agora,
      atualizadoPor: meu,
      aparelhos: Object.assign({}, aparelhos, { [meu]: agora })
    }, { merge: true }).then(() => {
      marcarStatus("salvo na nuvem");
    }).catch((e) => {
      console.warn("Falha ao salvar na nuvem:", e);
      marcarStatus("não salvou na nuvem", true);
    }).then(() => { enviando = false; });
  }

  /* baixa a versão da nuvem (usado ao abrir, antes de pintar a tela) */
  function baixar() {
    if (!db) return Promise.resolve(null);
    return db.collection(COLECAO).doc(DOC).get({ source: "server" })
      .then((doc) => (doc.exists ? (doc.data() || {}).dados : null))
      .catch(() => db.collection(COLECAO).doc(DOC).get().then((doc) => (doc.exists ? (doc.data() || {}).dados : null)))
      .catch(() => null);
  }

  window.CASNuvem = {
    iniciar,
    agendarSalvar,
    baixar,
    ligada: () => !!db,
    configurada: pronto,
    quandoFoiSalvo: () => ultimoEnviado,
    aparelhos: () => aparelhos,
    juntar,
    aoMudarStatus: (fn) => { avisarTela = fn; }
  };
})();
