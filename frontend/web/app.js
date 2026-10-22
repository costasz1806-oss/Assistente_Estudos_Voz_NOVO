const DURACAO = 3;
const FRASE_LIVRE = "outro (frase livre)";
const CLASSES = ["anotar", "gravar", "pesquisar", "pausar", "outro"];

const el = (id) => document.getElementById(id);

const refs = {
  estado: el("estado"),
  estadoTexto: el("estadoTexto"),
  orbita: el("orbita"),
  canvas: el("visualizador"),
  orbitaLabel: el("orbitaLabel"),
  orbitaSub: el("orbitaSub"),
  classe: el("classe"),
  campoFrase: el("campoFrase"),
  frase: el("frase"),
  btnGravar: el("btnGravar"),
  btnTreinar: el("btnTreinar"),
  btnReconhecer: el("btnReconhecer"),
  btnMicrofone: el("btnMicrofone"),
  seloClasse: el("seloClasse"),
  predicaoLabel: el("predicaoLabel"),
  predicaoTexto: el("predicaoTexto"),
  predicaoConf: el("predicaoConf"),
  predicaoBarra: el("predicaoBarra"),
  contagens: el("contagens"),
  terminal: el("terminal"),
  btnLimpar: el("btnLimpar"),
  relatorio: el("relatorio"),
  metricas: el("metricas"),
  matriz: el("matriz"),
  relatorioTexto: el("relatorioTexto"),
  btnFecharRelatorio: el("btnFecharRelatorio"),
  rodapeStatus: el("rodapeStatus"),
  toast: el("toast"),
};

const estado = {
  ocupado: false,
  modelo: false,
  classes: [],
};

const viz = {
  nivel: 0,
  alvo: 0,
  tempo: 0,
  gravando: false,
  largura: 0,
  altura: 0,
};

/* ------------------------------- utilidades ------------------------------- */

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(texto, tipo = "info") {
  const linha = document.createElement("div");
  linha.className = `linha ${tipo}`;

  const hora = document.createElement("span");
  hora.className = "hora";
  hora.textContent = new Date().toLocaleTimeString("pt-BR", { hour12: false });

  const corpo = document.createElement("span");
  corpo.className = "texto";
  corpo.textContent = texto;

  linha.append(hora, corpo);
  refs.terminal.appendChild(linha);

  while (refs.terminal.children.length > 250) {
    refs.terminal.removeChild(refs.terminal.firstChild);
  }
  refs.terminal.scrollTop = refs.terminal.scrollHeight;
}

let tempoToast;
function toast(mensagem, tipo = "ok") {
  refs.toast.textContent = mensagem;
  refs.toast.className = `toast visivel ${tipo}`;
  clearTimeout(tempoToast);
  tempoToast = setTimeout(() => {
    refs.toast.className = "toast";
  }, 3400);
}

let tempoOrb;
function definirOrb(titulo, subtitulo, autoReset = true) {
  clearTimeout(tempoOrb);
  refs.orbitaLabel.textContent = titulo;
  refs.orbitaSub.textContent = subtitulo;

  if (autoReset) {
    tempoOrb = setTimeout(() => {
      if (!estado.ocupado && !viz.gravando) {
        definirOrb("PRONTO", "Grave um exemplo para começar", false);
      }
    }, 5000);
  }
}

function definirGravando(ativo) {
  viz.gravando = ativo;
  refs.orbita.classList.toggle("gravando", ativo);
  if (!ativo) viz.alvo = 0;
}

function atualizarBotoes() {
  const botoes = [refs.btnGravar, refs.btnTreinar, refs.btnReconhecer, refs.btnMicrofone];
  botoes.forEach((botao) => {
    botao.disabled = estado.ocupado;
  });
  refs.btnReconhecer.disabled = estado.ocupado || !estado.modelo;
  refs.classe.disabled = estado.ocupado;
}

async function comBloqueio(tarefa) {
  if (estado.ocupado) return;
  estado.ocupado = true;
  atualizarBotoes();
  try {
    await tarefa();
  } catch (erro) {
    const mensagem = erro && erro.message ? erro.message : "Erro inesperado.";
    log(mensagem, "erro");
    toast(mensagem, "erro");
    definirOrb("FALHOU", "Veja o log para mais detalhes");
  } finally {
    estado.ocupado = false;
    atualizarBotoes();
  }
}

async function chamarApi(payload) {
  const resposta = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let dados;
  try {
    dados = await resposta.json();
  } catch (erro) {
    throw new Error("Resposta inválida do servidor.");
  }

  if (!resposta.ok || dados.erro) {
    throw new Error(dados.erro || "Não foi possível concluir a operação.");
  }
  return dados;
}

/* ------------------------------- gravação -------------------------------- */

class GravadorWav {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.origem = null;
    this.processador = null;
    this.mudo = null;
    this.partes = [];
    this.taxa = 44100;
    this.encerrado = false;
  }

  async iniciar(aoNivel) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Seu navegador não suporta captura de microfone.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.taxa = this.ctx.sampleRate;

    this.origem = this.ctx.createMediaStreamSource(this.stream);
    this.processador = this.ctx.createScriptProcessor(4096, 1, 1);
    this.partes = [];

    this.processador.onaudioprocess = (evento) => {
      const canal = evento.inputBuffer.getChannelData(0);
      this.partes.push(new Float32Array(canal));
      if (aoNivel) {
        let soma = 0;
        for (let i = 0; i < canal.length; i += 1) {
          soma += canal[i] * canal[i];
        }
        aoNivel(Math.sqrt(soma / canal.length));
      }
    };

    this.mudo = this.ctx.createGain();
    this.mudo.gain.value = 0;

    this.origem.connect(this.processador);
    this.processador.connect(this.mudo);
    this.mudo.connect(this.ctx.destination);
  }

  async parar() {
    const taxa = this.taxa;
    const total = this.partes.reduce((soma, parte) => soma + parte.length, 0);
    const amostras = new Float32Array(total);

    let deslocamento = 0;
    for (const parte of this.partes) {
      amostras.set(parte, deslocamento);
      deslocamento += parte.length;
    }

    await this.descartar();

    let pico = 0;
    let somaQuadrados = 0;
    for (let i = 0; i < amostras.length; i += 1) {
      const valor = Math.abs(amostras[i]);
      if (valor > pico) pico = valor;
      somaQuadrados += amostras[i] * amostras[i];
    }
    const rms = amostras.length ? Math.sqrt(somaQuadrados / amostras.length) : 0;

    return {
      amostras,
      taxa,
      pico,
      rms,
      wav: codificarWav(amostras, taxa),
    };
  }

  async descartar() {
    if (this.encerrado) return;
    this.encerrado = true;

    try {
      if (this.processador) this.processador.disconnect();
      if (this.origem) this.origem.disconnect();
      if (this.mudo) this.mudo.disconnect();
    } catch (erro) {
      /* conexões já encerradas */
    }

    if (this.stream) {
      this.stream.getTracks().forEach((faixa) => faixa.stop());
    }

    if (this.ctx && this.ctx.state !== "closed") {
      try {
        await this.ctx.close();
      } catch (erro) {
        /* contexto já fechado */
      }
    }
  }
}

function escreverTexto(visao, deslocamento, texto) {
  for (let i = 0; i < texto.length; i += 1) {
    visao.setUint8(deslocamento + i, texto.charCodeAt(i));
  }
}

function codificarWav(amostras, taxa) {
  const buffer = new ArrayBuffer(44 + amostras.length * 2);
  const visao = new DataView(buffer);

  escreverTexto(visao, 0, "RIFF");
  visao.setUint32(4, 36 + amostras.length * 2, true);
  escreverTexto(visao, 8, "WAVE");
  escreverTexto(visao, 12, "fmt ");
  visao.setUint32(16, 16, true);
  visao.setUint16(20, 1, true);
  visao.setUint16(22, 1, true);
  visao.setUint32(24, taxa, true);
  visao.setUint32(28, taxa * 2, true);
  visao.setUint16(32, 2, true);
  visao.setUint16(34, 16, true);
  escreverTexto(visao, 36, "data");
  visao.setUint32(40, amostras.length * 2, true);

  let deslocamento = 44;
  for (let i = 0; i < amostras.length; i += 1) {
    const amostra = Math.max(-1, Math.min(1, amostras[i]));
    const valor = amostra < 0 ? amostra * 0x8000 : amostra * 0x7fff;
    visao.setInt16(deslocamento, valor, true);
    deslocamento += 2;
  }

  return new Blob([new Uint8Array(buffer)], { type: "audio/wav" });
}

async function blobParaBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const bloco = 0x8000;
  let binario = "";
  for (let i = 0; i < bytes.length; i += bloco) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + bloco));
  }
  return btoa(binario);
}

async function capturarAudio(rotulo) {
  const gravador = new GravadorWav();
  try {
    await gravador.iniciar((nivel) => {
      viz.alvo = Math.min(1, nivel * 8);
    });

    definirGravando(true);
    let restante = DURACAO;
    definirOrb(rotulo, `Fale agora · ${restante}s`, false);

    const intervalo = setInterval(() => {
      restante -= 1;
      if (restante > 0) {
        definirOrb(rotulo, `Fale agora · ${restante}s`, false);
      }
    }, 1000);

    await esperar(DURACAO * 1000);
    clearInterval(intervalo);

    definirOrb("PROCESSANDO", "Analisando o áudio...", false);
    return await gravador.parar();
  } finally {
    definirGravando(false);
    await gravador.descartar();
  }
}

/* ------------------------------- fluxos ---------------------------------- */

function classeSelecionada() {
  return refs.classe.value === FRASE_LIVRE ? "outro" : refs.classe.value;
}

function atualizarCampoFrase() {
  const livre = refs.classe.value === FRASE_LIVRE;
  refs.campoFrase.classList.toggle("oculto", !livre);
  if (livre) refs.frase.focus();
}

async function fluxoGravar() {
  const classe = classeSelecionada();
  const livre = refs.classe.value === FRASE_LIVRE;
  const frase = livre ? refs.frase.value.trim() : "";

  if (livre && !frase) {
    toast("Digite a frase que você vai falar.", "erro");
    refs.frase.focus();
    return;
  }

  await comBloqueio(async () => {
    log(`Gravando exemplo da classe "${classe}" por ${DURACAO} segundos...`);
    if (livre) log(`Frase esperada: "${frase}"`);

    const captura = await capturarAudio("GRAVANDO");
    const audio = await blobParaBase64(captura.wav);
    const resposta = await chamarApi({ action: "salvar", label: classe, frase, audio });

    log(resposta.mensagem, "ok");
    aplicarStatus(resposta.status);
    definirOrb("EXEMPLO SALVO", `Classe: ${classe}`);
    toast("Exemplo salvo com sucesso.");
  });
}

async function fluxoReconhecer() {
  if (!estado.modelo) {
    log("Treine a rede neural antes de reconhecer um comando.", "aviso");
    toast("Treine a rede neural primeiro.", "erro");
    return;
  }

  await comBloqueio(async () => {
    log(`Ouvindo comando por ${DURACAO} segundos...`);
    const captura = await capturarAudio("OUVINDO");
    const audio = await blobParaBase64(captura.wav);
    const resposta = await chamarApi({ action: "prever", audio });

    mostrarPredicao(resposta.label, resposta.confianca, resposta.resposta);
    log(`Predição: ${resposta.label.toUpperCase()} · confiança ${(resposta.confianca * 100).toFixed(1)}%`, "destaque");
    log(resposta.resposta, "ok");
    definirOrb(resposta.label.toUpperCase(), "Comando processado");
  });
}

async function fluxoTreinar() {
  await comBloqueio(async () => {
    log("Treinando a rede neural. Isso pode levar alguns segundos...", "aviso");
    definirOrb("TREINANDO", "A rede está aprendendo com seus exemplos...", false);

    const resposta = await chamarApi({ action: "treinar" });
    aplicarStatus(resposta.status);
    mostrarRelatorio(resposta.relatorio, resposta.status.resultado);

    log("Treinamento concluído.", "ok");
    definirOrb("REDE TREINADA", "Modelo pronto para reconhecer sua voz");
    toast("Rede neural treinada.");
  });
}

async function fluxoMicrofone() {
  await comBloqueio(async () => {
    log("Testando o microfone...");
    const captura = await capturarAudio("TESTANDO");
    const nivel = captura.rms > 0.005 ? "ok" : "aviso";

    log(
      `Microfone OK · pico ${captura.pico.toFixed(4)} · RMS ${captura.rms.toFixed(4)} · ${Math.round(captura.taxa)} Hz`,
      nivel,
    );
    if (captura.rms <= 0.005) {
      log("O sinal está muito baixo. Aproxime-se do microfone ou aumente o volume de entrada.", "aviso");
    }
    definirOrb("MICROFONE OK", "Captura de áudio concluída");
  });
}

/* ------------------------------- interface -------------------------------- */

function aplicarStatus(status) {
  estado.modelo = Boolean(status.modelo);
  estado.classes = status.classes || [];

  refs.estado.className = `estado ${estado.modelo ? "pronto" : "vazio"}`;
  refs.estadoTexto.textContent = estado.modelo
    ? `Modelo pronto · ${estado.classes.length} classes`
    : "Sem modelo treinado";
  refs.rodapeStatus.textContent = estado.modelo
    ? "Modelo carregado do backend"
    : "Grave exemplos e treine a rede";

  renderContagens(status.contagens || {});
  atualizarBotoes();

  if (status.resultado && typeof status.resultado.acuracia === "number") {
    log(`Último treinamento: acurácia de ${formatarPct(status.resultado.acuracia)} no teste.`, "destaque");
  }
}

function renderContagens(contagens) {
  refs.contagens.replaceChildren();

  CLASSES.forEach((classe) => {
    const total = contagens[classe] || 0;
    const cartao = document.createElement("div");
    cartao.className = `contagem${total === 0 ? " vazia" : ""}`;

    const numero = document.createElement("strong");
    numero.textContent = String(total).padStart(2, "0");

    const nome = document.createElement("span");
    nome.textContent = classe;

    cartao.append(numero, nome);
    refs.contagens.appendChild(cartao);
  });
}

function mostrarPredicao(label, confianca, texto) {
  refs.predicaoLabel.textContent = label.toUpperCase();
  refs.predicaoTexto.textContent = texto;
  refs.predicaoConf.textContent = formatarPct(confianca);
  refs.predicaoBarra.style.width = `${Math.max(4, Math.min(100, confianca * 100))}%`;
  refs.seloClasse.textContent = label;
}

function formatarPct(valor) {
  return `${(valor * 100).toFixed(1)}%`;
}

function mostrarRelatorio(relatorio, resultado) {
  refs.relatorio.classList.remove("oculto");
  refs.relatorioTexto.textContent = relatorio;
  refs.metricas.replaceChildren();
  refs.matriz.replaceChildren();

  if (resultado) {
    const itens = [
      ["Acurácia (teste)", formatarPct(resultado.acuracia)],
      [
        "Validação cruzada",
        typeof resultado.acuracia_validacao_cruzada === "number"
          ? `${formatarPct(resultado.acuracia_validacao_cruzada)} · ${resultado.folds} dobras`
          : "—",
      ],
      ["Amostras", String(resultado.amostras ?? "—")],
    ];

    itens.forEach(([rotulo, valor]) => {
      const cartao = document.createElement("div");
      cartao.className = "metrica";

      const nome = document.createElement("span");
      nome.textContent = rotulo;

      const numero = document.createElement("strong");
      numero.textContent = valor;

      cartao.append(nome, numero);
      refs.metricas.appendChild(cartao);
    });

    renderMatriz(resultado);
  }

  refs.relatorio.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderMatriz(resultado) {
  if (!resultado || !Array.isArray(resultado.matriz_confusao) || !Array.isArray(resultado.classes)) {
    return;
  }

  const classes = resultado.classes;
  const matriz = resultado.matriz_confusao;

  const tabela = document.createElement("table");
  const cabecalho = document.createElement("thead");
  const linhaCabecalho = document.createElement("tr");

  const canto = document.createElement("th");
  canto.textContent = "real \\ previsto";
  linhaCabecalho.appendChild(canto);

  classes.forEach((classe) => {
    const th = document.createElement("th");
    th.textContent = classe;
    linhaCabecalho.appendChild(th);
  });

  cabecalho.appendChild(linhaCabecalho);
  tabela.appendChild(cabecalho);

  const corpo = document.createElement("tbody");
  matriz.forEach((linha, indice) => {
    const tr = document.createElement("tr");

    const th = document.createElement("th");
    th.textContent = classes[indice];
    tr.appendChild(th);

    linha.forEach((valor) => {
      const td = document.createElement("td");
      td.textContent = valor;
      tr.appendChild(td);
    });

    corpo.appendChild(tr);
  });

  tabela.appendChild(corpo);
  refs.matriz.appendChild(tabela);
}

async function carregarStatus() {
  try {
    const resposta = await fetch("/api/status");
    const dados = await resposta.json();
    if (!resposta.ok || dados.erro) {
      throw new Error(dados.erro || "Falha ao consultar o backend.");
    }
    aplicarStatus(dados);
    log("Backend conectado. Pronto para gravar exemplos.", "ok");
  } catch (erro) {
    const mensagem = erro && erro.message ? erro.message : "Falha ao consultar o backend.";
    log(mensagem, "erro");
    refs.estado.className = "estado vazio";
    refs.estadoTexto.textContent = "Backend indisponível";
    refs.rodapeStatus.textContent = "Verifique o servidor Node.js";
    toast("Não foi possível falar com o backend Python.", "erro");
  }
}

/* ------------------------------ visualizador ------------------------------ */

function ajustarCanvas() {
  const canvas = refs.canvas;
  const tamanho = canvas.clientWidth || 360;
  const densidade = window.devicePixelRatio || 1;

  viz.largura = tamanho;
  viz.altura = tamanho;
  canvas.width = Math.round(tamanho * densidade);
  canvas.height = Math.round(tamanho * densidade);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(densidade, 0, 0, densidade, 0, 0);
}

function desenhar() {
  const canvas = refs.canvas;
  const ctx = canvas.getContext("2d");
  const largura = viz.largura || canvas.clientWidth;
  const altura = viz.altura || canvas.clientHeight;

  if (!largura || !altura) {
    requestAnimationFrame(desenhar);
    return;
  }

  ctx.clearRect(0, 0, largura, altura);

  const centroX = largura / 2;
  const centroY = altura / 2;
  const raio = Math.min(largura, altura) * 0.31;
  const barras = 76;

  viz.tempo += 0.022;
  viz.nivel += (viz.alvo - viz.nivel) * 0.16;
  if (viz.nivel < 0.001) viz.nivel = 0;

  for (let i = 0; i < barras; i += 1) {
    const angulo = (i / barras) * Math.PI * 2 - Math.PI / 2;
    const onda = 0.5 + 0.5 * Math.sin(viz.tempo * 1.4 + i * 0.34);
    const base = viz.gravando
      ? 0.1 + viz.nivel * 7
      : 0.05 + 0.028 * Math.sin(viz.tempo * 0.5 + i * 0.22);
    const comprimento = Math.max(2, base * (0.45 + onda) * 30);

    const raioInicial = raio + 9;
    const raioFinal = raioInicial + comprimento;
    const x1 = centroX + Math.cos(angulo) * raioInicial;
    const y1 = centroY + Math.sin(angulo) * raioInicial;
    const x2 = centroX + Math.cos(angulo) * raioFinal;
    const y2 = centroY + Math.sin(angulo) * raioFinal;

    const gradiente = ctx.createLinearGradient(x1, y1, x2, y2);
    gradiente.addColorStop(0, "rgba(224, 164, 94, 0.14)");
    gradiente.addColorStop(1, `rgba(232, 176, 106, ${0.28 + Math.min(0.6, viz.nivel * 4)})`);

    ctx.strokeStyle = gradiente;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(centroX, centroY, raio + 5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(201, 135, 63, 0.13)";
  ctx.lineWidth = 1;
  ctx.stroke();

  requestAnimationFrame(desenhar);
}

/* -------------------------------- eventos --------------------------------- */

function ligarEventos() {
  refs.classe.addEventListener("change", atualizarCampoFrase);
  refs.btnGravar.addEventListener("click", fluxoGravar);
  refs.btnTreinar.addEventListener("click", fluxoTreinar);
  refs.btnReconhecer.addEventListener("click", fluxoReconhecer);
  refs.btnMicrofone.addEventListener("click", fluxoMicrofone);

  refs.frase.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      refs.btnGravar.click();
    }
  });

  refs.btnLimpar.addEventListener("click", () => {
    refs.terminal.replaceChildren();
    log("Log limpo.", "info");
  });

  refs.btnFecharRelatorio.addEventListener("click", () => {
    refs.relatorio.classList.add("oculto");
  });

  window.addEventListener("resize", ajustarCanvas);
}

document.addEventListener("DOMContentLoaded", () => {
  ligarEventos();
  ajustarCanvas();
  requestAnimationFrame(desenhar);
  renderContagens({});
  atualizarCampoFrase();
  atualizarBotoes();
  log("Interface iniciada. Permita o microfone quando o navegador solicitar.", "info");
  carregarStatus();
});
