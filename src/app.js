// Interface: captura de áudio (microfone, arquivo ou tom de teste), espectrograma
// rolante, espectro, pico, afinador e configurações.
import { Anel, quadrosProntos } from './anel.js';
import { MAPAS, tabelaDeCores } from './cores.js';
import * as S from './espectro.js';
import { JANELAS, janela, larguraEquivalente } from './janelas.js';
import { nota } from './notas.js';
import { yin } from './yin.js';

const $ = (id) => document.getElementById(id);
const el = {
  microfone: $('microfone'),
  arquivo: $('arquivo'),
  tom: $('tom'),
  varredura: $('varredura'),
  parar: $('parar'),
  tomFreq: $('tom-freq'),
  tomFreqValor: $('tom-freq-valor'),
  tomForma: $('tom-forma'),
  arquivoControles: $('arquivo-controles'),
  arquivoNome: $('arquivo-nome'),
  tocar: $('tocar'),
  completo: $('completo'),
  status: $('status'),
  congelar: $('congelar'),
  limpar: $('limpar'),
  exportar: $('exportar'),
  eixo: $('eixo'),
  tela: $('espectrograma'),
  modoVisor: $('modo-visor'),
  tempoEsquerda: $('tempo-esquerda'),
  tempoDireita: $('tempo-direita'),
  legendaMin: $('legenda-min'),
  legendaMax: $('legenda-max'),
  barraCores: $('barra-cores'),
  espectro: $('espectro'),
  leituras: $('leituras'),
  pico: $('pico'),
  nota: $('nota'),
  notaDetalhe: $('nota-detalhe'),
  agulha: $('agulha'),
  tamanho: $('tamanho'),
  sobreposicao: $('sobreposicao'),
  janela: $('janela'),
  resolucao: $('resolucao'),
  escalaLog: $('escala-log'),
  dbMin: $('db-min'),
  dbMinValor: $('db-min-valor'),
  dbMax: $('db-max'),
  dbMaxValor: $('db-max-valor'),
  mapa: $('mapa'),
  la4: $('la4'),
};

const fmt = (v, casas = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

// ---------------------------------------------------------------------------
// Configuração (guardada no navegador)
// ---------------------------------------------------------------------------

const TAMANHOS = [256, 512, 1024, 2048, 4096, 8192, 16384];
const SOBREPOSICOES = [0, 0.5, 0.75, 0.875];
const PADRAO = { n: 4096, sobreposicao: 0.75, janela: 'hann', log: true, dbMin: -100, dbMax: -20, mapa: 'magma', la4: 440 };

function validarConfig(c) {
  const v = { ...PADRAO };
  if (TAMANHOS.includes(c.n)) v.n = c.n;
  if (SOBREPOSICOES.includes(c.sobreposicao)) v.sobreposicao = c.sobreposicao;
  if (JANELAS[c.janela]) v.janela = c.janela;
  if (typeof c.log === 'boolean') v.log = c.log;
  if (Number.isFinite(c.dbMin) && c.dbMin >= -140 && c.dbMin <= -40) v.dbMin = c.dbMin;
  if (Number.isFinite(c.dbMax) && c.dbMax >= -60 && c.dbMax <= 0) v.dbMax = c.dbMax;
  if (v.dbMax - v.dbMin < 10) {
    v.dbMin = PADRAO.dbMin;
    v.dbMax = PADRAO.dbMax;
  }
  if (MAPAS[c.mapa]) v.mapa = c.mapa;
  if (Number.isFinite(c.la4) && c.la4 >= 400 && c.la4 <= 480) v.la4 = c.la4;
  return v;
}

function carregarConfig() {
  try {
    return validarConfig({ ...PADRAO, ...JSON.parse(localStorage.getItem('espectrograma.config') || '{}') });
  } catch {
    return { ...PADRAO };
  }
}

function salvarConfig() {
  try {
    localStorage.setItem('espectrograma.config', JSON.stringify(cfg));
  } catch {
    // sem armazenamento local: a configuração vale só nesta visita
  }
}

let cfg = carregarConfig();
let taxa = 48000; // até o áudio começar, o eixo usa uma taxa típica
const salto = () => Math.max(1, Math.round(cfg.n * (1 - cfg.sobreposicao)));

// ---------------------------------------------------------------------------
// Áudio: AudioWorklet (ou ScriptProcessor) entregando amostras cruas
// ---------------------------------------------------------------------------

const anel = new Anel(1 << 18);
let proximo = 0;
let ctxAudio = null;
let coletor = null;
let modoColeta = '';
let fonte = null;
let bufferArquivo = null;
let nomeArquivo = '';

function mostrarStatus(texto, erro = false) {
  el.status.textContent = texto;
  el.status.classList.toggle('erro', erro);
}

function receberAmostras(bloco) {
  anel.escrever(bloco);
}

// Cria o contexto de áudio e o coletor. retomar = false serve para só decodificar um
// arquivo: o contexto pode ficar suspenso até o usuário mandar tocar.
async function garantirAudio({ retomar = true } = {}) {
  if (!ctxAudio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('este navegador não tem Web Audio');
    ctxAudio = new AC();
    taxa = ctxAudio.sampleRate;
    // O coletor precisa estar ligado ao destino para o navegador processá-lo; o ganho
    // zero garante que ele não toque nada.
    const mudo = ctxAudio.createGain();
    mudo.gain.value = 0;
    mudo.connect(ctxAudio.destination);
    try {
      await ctxAudio.audioWorklet.addModule(new URL('./coletor-worklet.js', import.meta.url));
      const no = new AudioWorkletNode(ctxAudio, 'coletor-de-amostras', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      no.port.onmessage = (ev) => receberAmostras(ev.data);
      coletor = no;
      modoColeta = 'AudioWorklet';
    } catch {
      // Sem AudioWorklet (navegador antigo ou página fora de HTTPS): ScriptProcessor.
      const sp = ctxAudio.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (ev) => receberAmostras(new Float32Array(ev.inputBuffer.getChannelData(0)));
      coletor = sp;
      modoColeta = 'ScriptProcessor';
    }
    coletor.connect(mudo);
    recalcularLinhas();
    desenharEixo();
    atualizarResolucao();
  }
  if (retomar && ctxAudio.state === 'suspended') await ctxAudio.resume();
}

function pararFonte() {
  if (fonte) {
    try {
      fonte.parar();
    } catch {
      // a fonte já tinha terminado
    }
  }
  fonte = null;
  el.parar.disabled = true;
  el.tocar.textContent = 'Tocar';
}

function iniciarFonte(f) {
  pararFonte();
  fonte = f;
  el.parar.disabled = false;
  if (modoCompleto) sairDoModoCompleto();
  proximo = Math.max(0, anel.total - cfg.n);
}

async function ativarMicrofone() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    mostrarStatus('Este navegador não libera o microfone aqui. Abra a página por HTTPS ou em localhost.', true);
    return;
  }
  try {
    await garantirAudio();
  } catch (erro) {
    mostrarStatus('Não foi possível iniciar o áudio: ' + erro.message, true);
    return;
  }
  mostrarStatus('Aguardando a permissão do microfone...');
  try {
    // Sem cancelamento de eco nem controle de ganho: queremos o som como ele é.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const origem = ctxAudio.createMediaStreamSource(stream);
    origem.connect(coletor);
    iniciarFonte({
      tipo: 'microfone',
      parar() {
        origem.disconnect();
        stream.getTracks().forEach((t) => t.stop());
      },
    });
    mostrarStatus(`Microfone ativo (${fmt(taxa / 1000, 1)} kHz, via ${modoColeta}). Faça um som!`);
  } catch (erro) {
    const nome = erro && erro.name;
    if (nome === 'NotAllowedError' || nome === 'SecurityError') {
      mostrarStatus('Permissão negada. Libere o microfone no ícone ao lado do endereço da página e tente de novo.', true);
    } else if (nome === 'NotFoundError' || nome === 'OverconstrainedError') {
      mostrarStatus('Nenhum microfone encontrado neste aparelho.', true);
    } else if (nome === 'NotReadableError') {
      mostrarStatus('O microfone está ocupado por outro programa.', true);
    } else {
      mostrarStatus('Não foi possível abrir o microfone: ' + (erro && erro.message ? erro.message : 'erro desconhecido'), true);
    }
  }
}

let osciladorAtual = null;
async function tocarTom(varredura) {
  try {
    await garantirAudio();
  } catch (erro) {
    mostrarStatus('Não foi possível iniciar o áudio: ' + erro.message, true);
    return;
  }
  const osc = ctxAudio.createOscillator();
  const ganho = ctxAudio.createGain();
  ganho.gain.value = 0.12;
  osc.connect(ganho);
  ganho.connect(ctxAudio.destination);
  ganho.connect(coletor);
  const t = ctxAudio.currentTime;
  if (varredura) {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(50, t);
    osc.frequency.exponentialRampToValueAtTime(12000, t + 8);
    osc.stop(t + 8);
  } else {
    osc.type = el.tomForma.value;
    osc.frequency.value = Number(el.tomFreq.value);
  }
  osc.start();
  iniciarFonte({
    tipo: varredura ? 'varredura' : 'tom',
    parar() {
      osc.onended = null;
      osc.stop();
      osc.disconnect();
      ganho.disconnect();
    },
  });
  osciladorAtual = varredura ? null : osc;
  osc.onended = () => {
    if (fonte && fonte.tipo === 'varredura') {
      pararFonte();
      mostrarStatus('Varredura concluída: repare na linha subindo e, na escala log, reta.');
    }
  };
  mostrarStatus(
    varredura
      ? 'Varredura de 50 Hz a 12 kHz em 8 segundos (cuidado com o volume).'
      : `Tocando ${el.tomFreq.value} Hz (${el.tomForma.selectedOptions[0].textContent.toLowerCase()}).`,
  );
}

async function abrirArquivo(arquivo) {
  if (!arquivo) return;
  try {
    await garantirAudio({ retomar: false });
    mostrarStatus(`Decodificando ${arquivo.name}...`);
    const dados = await arquivo.arrayBuffer();
    bufferArquivo = await ctxAudio.decodeAudioData(dados);
    nomeArquivo = arquivo.name;
    el.arquivoControles.hidden = false;
    el.arquivoNome.textContent = `${arquivo.name}: ${duracao(bufferArquivo.duration)}, ${bufferArquivo.numberOfChannels} canal(is)`;
    mostrarStatus('Arquivo pronto. Toque para ver ao vivo ou gere o espectrograma completo.');
  } catch (erro) {
    mostrarStatus('Não foi possível ler esse arquivo de áudio: ' + (erro && erro.message ? erro.message : 'formato não suportado'), true);
  }
}

function duracao(s) {
  const m = Math.floor(s / 60);
  const seg = Math.floor(s % 60);
  return `${m}:${String(seg).padStart(2, '0')}`;
}

async function tocarArquivo() {
  if (!bufferArquivo) return;
  if (fonte && fonte.tipo === 'arquivo') {
    pararFonte();
    mostrarStatus('Reprodução parada.');
    return;
  }
  await garantirAudio();
  const src = ctxAudio.createBufferSource();
  src.buffer = bufferArquivo;
  src.connect(ctxAudio.destination);
  src.connect(coletor);
  src.start();
  iniciarFonte({
    tipo: 'arquivo',
    parar() {
      src.onended = null;
      src.stop();
      src.disconnect();
    },
  });
  src.onended = () => {
    if (fonte && fonte.tipo === 'arquivo') pararFonte();
    mostrarStatus('Fim do arquivo.');
  };
  el.tocar.textContent = 'Parar reprodução';
  mostrarStatus(`Tocando ${nomeArquivo}.`);
}

// ---------------------------------------------------------------------------
// Espectrograma rolante, com histórico em dB para repintar na hora
// ---------------------------------------------------------------------------

const ctx = el.tela.getContext('2d', { alpha: false });
let W = 0;
let H = 0;
let historico = new Float32Array(0); // W colunas de H valores em dB, circular
let cabeca = 0; // coluna mais antiga (a próxima a ser sobrescrita)
let validas = 0;
let linhas = [];
let tabela = tabelaDeCores(cfg.mapa);
let congelado = false;
let modoCompleto = false;

function faixa() {
  return { fMin: cfg.log ? 20 : 0, fMax: taxa / 2 };
}

function recalcularLinhas() {
  if (!H) return;
  const { fMin, fMax } = faixa();
  linhas = S.mapaDeLinhas(H, taxa, cfg.n, fMin, fMax, cfg.log);
}

function dimensionar() {
  const r = el.tela.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (w !== W || h !== H) {
    W = w;
    H = h;
    el.tela.width = W;
    el.tela.height = H;
    historico = new Float32Array(W * H);
    cabeca = 0;
    validas = 0;
    recalcularLinhas();
    repintar();
  }
  desenharEixo();
  dimensionarEspectro();
  atualizarTempo();
}

function indiceDeCor(v) {
  let t = (v - cfg.dbMin) / (cfg.dbMax - cfg.dbMin);
  if (!(t > 0)) t = 0;
  else if (t > 1) t = 1;
  return Math.round(t * 255) * 3;
}

function pintarColuna(img, x, larguraImg, coluna) {
  const d = img.data;
  const base = coluna * H;
  for (let y = 0; y < H; y++) {
    const c = indiceDeCor(historico[base + y]);
    const k = (y * larguraImg + x) * 4;
    d[k] = tabela[c];
    d[k + 1] = tabela[c + 1];
    d[k + 2] = tabela[c + 2];
    d[k + 3] = 255;
  }
}

function adicionarColunas(lista) {
  const k = Math.min(lista.length, W);
  if (!k) return;
  const img = ctx.createImageData(k, H);
  for (let i = 0; i < k; i++) {
    const db = lista[lista.length - k + i];
    const col = cabeca;
    for (let y = 0; y < H; y++) historico[col * H + y] = S.valorDaLinha(db, linhas[y]);
    cabeca = (cabeca + 1) % W;
    validas = Math.min(W, validas + 1);
    pintarColuna(img, i, k, col);
  }
  if (k < W) ctx.drawImage(el.tela, k, 0, W - k, H, 0, 0, W - k, H);
  ctx.putImageData(img, W - k, 0);
}

function repintar() {
  if (!W || !H) return;
  const img = ctx.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    if (x < W - validas) {
      for (let y = 0; y < H; y++) img.data[(y * W + x) * 4 + 3] = 255;
      continue;
    }
    pintarColuna(img, x, W, (cabeca + x) % W);
  }
  ctx.putImageData(img, 0, 0);
}

function limparHistorico() {
  historico.fill(0);
  cabeca = 0;
  validas = 0;
  repintar();
}

function corCss(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#888';
}

function rotuloFrequencia(f) {
  return f >= 1000 ? `${fmt(f / 1000, f % 1000 ? 1 : 0)} kHz` : `${Math.round(f)} Hz`;
}

function marcasDeFrequencia() {
  const { fMin, fMax } = faixa();
  if (cfg.log) {
    return [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter((f) => f > fMin && f < fMax);
  }
  const passos = [500, 1000, 2000, 2500, 5000];
  const passo = passos.find((p) => fMax / p <= 10) || 5000;
  const marcas = [];
  for (let f = passo; f < fMax; f += passo) marcas.push(f);
  return marcas;
}

function desenharEixo() {
  const r = el.eixo.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  el.eixo.width = Math.max(1, Math.round(r.width * dpr));
  el.eixo.height = Math.max(1, Math.round(r.height * dpr));
  const c = el.eixo.getContext('2d');
  c.clearRect(0, 0, el.eixo.width, el.eixo.height);
  c.fillStyle = corCss('--muted');
  c.strokeStyle = corCss('--muted');
  c.font = `${11 * dpr}px system-ui, sans-serif`;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  const { fMin, fMax } = faixa();
  for (const f of marcasDeFrequencia()) {
    const y = (S.linhaDaFrequencia(f, el.eixo.height, fMin, fMax, cfg.log));
    c.fillText(rotuloFrequencia(f), el.eixo.width - 8 * dpr, y);
    c.beginPath();
    c.moveTo(el.eixo.width - 5 * dpr, y);
    c.lineTo(el.eixo.width, y);
    c.stroke();
  }
}

function atualizarTempo() {
  if (modoCompleto) return;
  const segundos = (W * salto()) / taxa;
  el.tempoEsquerda.textContent = `há ${fmt(segundos, 1)} s`;
  el.tempoDireita.textContent = 'agora';
}

function atualizarLegenda() {
  const cores = [];
  for (let i = 0; i <= 8; i++) {
    const k = Math.round((i / 8) * 255) * 3;
    cores.push(`rgb(${tabela[k]}, ${tabela[k + 1]}, ${tabela[k + 2]})`);
  }
  el.barraCores.style.background = `linear-gradient(to right, ${cores.join(', ')})`;
  el.legendaMin.textContent = `${cfg.dbMin} dBFS`;
  el.legendaMax.textContent = `${cfg.dbMax} dBFS`;
  el.dbMinValor.textContent = `${cfg.dbMin} dBFS`;
  el.dbMaxValor.textContent = `${cfg.dbMax} dBFS`;
}

function atualizarResolucao() {
  const n = cfg.n;
  const w = janela(cfg.janela, n);
  const enbw = larguraEquivalente(w);
  const itens = [
    ['Resolução em frequência', `${fmt(taxa / n, 2)} Hz por bin`],
    ['Duração de cada quadro', `${fmt((1000 * n) / taxa, 1)} ms`],
    ['Passo entre colunas', `${fmt((1000 * salto()) / taxa, 1)} ms (${fmt(taxa / salto(), 1)} colunas/s)`],
    ['Largura de banda da janela', `${fmt(enbw, 2)} bins (${fmt((enbw * taxa) / n, 1)} Hz)`],
    ['Taxa de amostragem', `${fmt(taxa / 1000, 1)} kHz (Nyquist em ${fmt(taxa / 2000, 1)} kHz)`],
  ];
  el.resolucao.replaceChildren(
    ...itens.flatMap(([t, d]) => {
      const dt = document.createElement('dt');
      dt.textContent = t;
      const dd = document.createElement('dd');
      dd.textContent = d;
      return [dt, dd];
    }),
  );
}

// ---------------------------------------------------------------------------
// Espectro do último quadro
// ---------------------------------------------------------------------------

const ctxEsp = el.espectro.getContext('2d');
let WE = 0;
let HE = 0;
let colunasEspectro = [];
let picoSeguro = null;
let ultimoQuadro = 0;

function dimensionarEspectro() {
  const r = el.espectro.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  WE = Math.max(1, Math.round(r.width * dpr));
  HE = Math.max(1, Math.round(r.height * dpr));
  el.espectro.width = WE;
  el.espectro.height = HE;
  const { fMin, fMax } = faixa();
  // Mesma lógica das linhas do espectrograma, agora na horizontal (grave à esquerda).
  colunasEspectro = S.mapaDeLinhas(WE, taxa, cfg.n, fMin, fMax, cfg.log).reverse();
  picoSeguro = null;
  desenharEspectro(null, null);
}

function desenharEspectro(db, pico) {
  const c = ctxEsp;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.clearRect(0, 0, WE, HE);
  const topo = 0;
  const base = cfg.dbMin;
  const yDe = (v) => ((topo - Math.max(base, Math.min(topo, v))) / (topo - base)) * (HE - 18 * dpr) + 4 * dpr;
  // grade
  c.strokeStyle = corCss('--border');
  c.fillStyle = corCss('--muted');
  c.lineWidth = 1;
  c.font = `${10 * dpr}px system-ui, sans-serif`;
  for (let v = 0; v >= base; v -= 20) {
    const y = Math.round(yDe(v)) + 0.5;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(WE, y);
    c.stroke();
    // a linha de 0 dB fica colada no topo: o rótulo vai embaixo dela
    c.textBaseline = v === 0 ? 'top' : 'bottom';
    c.fillText(`${v} dB`, 4 * dpr, v === 0 ? y + 2 : y - 2);
  }
  const { fMin, fMax } = faixa();
  c.textBaseline = 'alphabetic';
  c.textAlign = 'center';
  for (const f of marcasDeFrequencia()) {
    const x = Math.round(WE - S.linhaDaFrequencia(f, WE, fMin, fMax, cfg.log)) + 0.5;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, HE - 14 * dpr);
    c.stroke();
    c.fillText(rotuloFrequencia(f), x, HE - 2 * dpr);
  }
  c.textAlign = 'left';
  if (!db) return;
  // segura o pico de cada coluna e deixa cair devagar
  const valores = new Float32Array(WE);
  for (let x = 0; x < WE; x++) valores[x] = S.valorDaLinha(db, colunasEspectro[x]);
  const agora = performance.now();
  const queda = ((agora - ultimoQuadro) / 1000) * 12; // dB por segundo
  ultimoQuadro = agora;
  if (!picoSeguro || picoSeguro.length !== WE) picoSeguro = Float32Array.from(valores);
  for (let x = 0; x < WE; x++) picoSeguro[x] = Math.max(valores[x], picoSeguro[x] - queda);
  const acento = corCss('--accent');
  c.beginPath();
  c.moveTo(0, HE);
  for (let x = 0; x < WE; x++) c.lineTo(x, yDe(valores[x]));
  c.lineTo(WE, HE);
  c.closePath();
  c.globalAlpha = 0.25;
  c.fillStyle = acento;
  c.fill();
  c.globalAlpha = 1;
  c.strokeStyle = acento;
  c.lineWidth = 1.5 * dpr;
  c.beginPath();
  for (let x = 0; x < WE; x++) c.lineTo(x, yDe(valores[x]));
  c.stroke();
  c.strokeStyle = corCss('--muted');
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x < WE; x++) c.lineTo(x, yDe(picoSeguro[x]));
  c.stroke();
  if (pico) {
    const x = WE - S.linhaDaFrequencia(pico.frequencia, WE, fMin, fMax, cfg.log);
    const y = yDe(pico.db);
    c.fillStyle = corCss('--text');
    c.beginPath();
    c.arc(x, y, 4 * dpr, 0, 2 * Math.PI);
    c.fill();
    c.font = `${11 * dpr}px system-ui, sans-serif`;
    c.textAlign = x > WE * 0.8 ? 'right' : 'left';
    c.fillText(`${fmt(pico.frequencia, 1)} Hz`, x + (x > WE * 0.8 ? -8 : 8) * dpr, Math.max(14 * dpr, y - 6 * dpr));
  }
}

// ---------------------------------------------------------------------------
// Laço principal
// ---------------------------------------------------------------------------

const bloco = { n: 0, dados: new Float32Array(0) };
const blocoYin = new Float32Array(4096);
let ultimoYin = 0;
let ultimaNotaAnunciada = '';
let notaDesde = 0;
const anuncio = document.createElement('p');
anuncio.className = 'sr-only';
anuncio.setAttribute('aria-live', 'polite');
document.body.append(anuncio);

function analisar() {
  requestAnimationFrame(analisar);
  if (congelado || modoCompleto || !ctxAudio) return;
  const n = cfg.n;
  if (bloco.n !== n) {
    bloco.n = n;
    bloco.dados = new Float32Array(n);
  }
  const { inicios, proximo: p } = quadrosProntos(proximo, anel.total, n, salto(), anel.capacidade, 400);
  proximo = p;
  if (!inicios.length) return;
  const colunas = [];
  let ultimo = null;
  for (const inicio of inicios) {
    if (!anel.ler(inicio, n, bloco.dados)) continue;
    ultimo = S.espectroDb(bloco.dados, cfg.janela);
    colunas.push(ultimo);
  }
  adicionarColunas(colunas);
  if (!ultimo) return;
  const pico = S.picoEspectral(ultimo, taxa, n, 30, taxa / 2);
  const comSinal = pico && pico.db > cfg.dbMin + 10;
  desenharEspectro(ultimo, comSinal ? pico : null);
  el.pico.textContent = comSinal ? `${fmt(pico.frequencia, 1)} Hz · ${fmt(pico.db, 1)} dB` : 'sem sinal';
  const agora = performance.now();
  if (agora - ultimoYin > 60 && anel.ler(anel.total - blocoYin.length, blocoYin.length, blocoYin)) {
    ultimoYin = agora;
    atualizarNota(comSinal ? yin(blocoYin, taxa, { limiar: 0.15, fMin: 50, fMax: 2000 }) : null, agora);
  }
}

function atualizarNota(r, agora) {
  const n = r && r.confianca > 0.8 ? nota(r.frequencia, cfg.la4) : null;
  if (!n) {
    el.nota.textContent = 'sem nota';
    el.notaDetalhe.textContent = '';
    el.agulha.classList.remove('ativa');
    el.agulha.style.left = '50%';
    return;
  }
  const cents = Math.round(n.cents);
  el.nota.textContent = `${n.nome}${n.oitava}`;
  el.notaDetalhe.textContent = `${n.cifra}${n.oitava} · ${fmt(r.frequencia, 1)} Hz · ${cents > 0 ? '+' : ''}${cents} cents`;
  el.agulha.style.left = `${50 + Math.max(-50, Math.min(50, n.cents))}%`;
  el.agulha.classList.add('ativa');
  // Anuncia para leitores de tela só quando a nota fica estável por um segundo.
  const chave = `${n.nome}${n.oitava}`;
  if (chave !== ultimaNotaAnunciada) {
    if (!notaDesde || el.nota.dataset.chave !== chave) {
      notaDesde = agora;
      el.nota.dataset.chave = chave;
    } else if (agora - notaDesde > 1000) {
      ultimaNotaAnunciada = chave;
      anuncio.textContent = `Nota ${n.nome} ${n.oitava}, ${cents} cents`;
    }
  }
}

// ---------------------------------------------------------------------------
// Arquivo inteiro de uma vez
// ---------------------------------------------------------------------------

function sairDoModoCompleto() {
  modoCompleto = false;
  el.modoVisor.hidden = true;
  limparHistorico();
  atualizarTempo();
}

function espectrogramaCompleto() {
  if (!bufferArquivo) return;
  pararFonte();
  modoCompleto = true;
  limparHistorico();
  const canais = bufferArquivo.numberOfChannels;
  const total = bufferArquivo.length;
  const mono = new Float32Array(total);
  for (let c = 0; c < canais; c++) {
    const d = bufferArquivo.getChannelData(c);
    for (let i = 0; i < total; i++) mono[i] += d[i] / canais;
  }
  const n = cfg.n;
  const quadro = new Float32Array(n);
  let x = 0;
  el.modoVisor.hidden = false;
  el.tempoEsquerda.textContent = '0:00';
  el.tempoDireita.textContent = duracao(bufferArquivo.duration);
  const passo = () => {
    if (!modoCompleto) return;
    const lote = [];
    for (let k = 0; k < 48 && x < W; k++, x++) {
      const inicio = total <= n ? 0 : Math.round((x * (total - n)) / Math.max(1, W - 1));
      quadro.fill(0);
      quadro.set(mono.subarray(inicio, Math.min(total, inicio + n)));
      lote.push(S.espectroDb(quadro, cfg.janela));
    }
    adicionarColunas(lote);
    el.modoVisor.textContent = `Arquivo inteiro: ${Math.round((100 * x) / W)}%`;
    if (x < W) setTimeout(passo, 0);
    else {
      el.modoVisor.textContent = `Arquivo inteiro (${duracao(bufferArquivo.duration)}). Toque ou use outra entrada para voltar ao vivo.`;
      mostrarStatus('Espectrograma completo pronto.');
    }
  };
  passo();
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

function exportarPng() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const eixoW = el.eixo.width;
  const rodape = Math.round(28 * dpr);
  const c = document.createElement('canvas');
  c.width = eixoW + W;
  c.height = H + rodape;
  const g = c.getContext('2d');
  g.fillStyle = '#111';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(el.eixo, 0, 0, eixoW, H);
  g.drawImage(el.tela, eixoW, 0);
  g.fillStyle = '#ddd';
  g.font = `${12 * dpr}px system-ui, sans-serif`;
  g.textBaseline = 'middle';
  const info = `Espectrograma · N = ${cfg.n} · janela ${JANELAS[cfg.janela].nome} · ${fmt(taxa / 1000, 1)} kHz · ${cfg.dbMin} a ${cfg.dbMax} dBFS`;
  g.fillText(info, eixoW, H + rodape / 2);
  c.toBlob((blob) => {
    if (!blob) {
      mostrarStatus('Não foi possível gerar o PNG.', true);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'espectrograma.png';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    mostrarStatus('PNG exportado.');
  }, 'image/png');
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

function preencherSelects() {
  for (const n of TAMANHOS) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = n.toLocaleString('pt-BR');
    el.tamanho.append(o);
  }
  for (const [id, j] of Object.entries(JANELAS)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = j.nome;
    el.janela.append(o);
  }
  for (const [id, m] of Object.entries(MAPAS)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = m.nome;
    el.mapa.append(o);
  }
}

function refletirConfig() {
  el.tamanho.value = String(cfg.n);
  el.sobreposicao.value = String(cfg.sobreposicao);
  el.janela.value = cfg.janela;
  el.escalaLog.checked = cfg.log;
  el.dbMin.value = String(cfg.dbMin);
  el.dbMax.value = String(cfg.dbMax);
  el.mapa.value = cfg.mapa;
  el.la4.value = String(cfg.la4);
  atualizarLegenda();
  atualizarResolucao();
}

// refazerLinhas: a escala do eixo mudou e o histórico perde o sentido (é apagado).
// novoTamanho: N mudou; as linhas apontam para outros bins, mas o histórico continua valendo.
function mudarConfig(mudancas, { refazerLinhas = false, novoTamanho = false, repintarTudo = false } = {}) {
  cfg = validarConfig({ ...cfg, ...mudancas });
  salvarConfig();
  if (refazerLinhas || novoTamanho) {
    recalcularLinhas();
    if (refazerLinhas) limparHistorico();
    desenharEixo();
    dimensionarEspectro();
  }
  if (repintarTudo) {
    tabela = tabelaDeCores(cfg.mapa);
    repintar();
  }
  refletirConfig();
  atualizarTempo();
}

el.microfone.addEventListener('click', ativarMicrofone);
el.arquivo.addEventListener('change', () => abrirArquivo(el.arquivo.files[0]));
el.tom.addEventListener('click', () => tocarTom(false));
el.varredura.addEventListener('click', () => tocarTom(true));
el.parar.addEventListener('click', () => {
  pararFonte();
  mostrarStatus('Entrada parada. O espectrograma fica na tela.');
});
el.tocar.addEventListener('click', tocarArquivo);
el.completo.addEventListener('click', espectrogramaCompleto);
el.tomFreq.addEventListener('input', () => {
  el.tomFreqValor.textContent = `${el.tomFreq.value} Hz`;
  if (fonte && fonte.tipo === 'tom' && osciladorAtual) {
    osciladorAtual.frequency.setTargetAtTime(Number(el.tomFreq.value), ctxAudio.currentTime, 0.02);
    mostrarStatus(`Tocando ${el.tomFreq.value} Hz.`);
  }
});
el.tomForma.addEventListener('change', () => {
  if (fonte && fonte.tipo === 'tom' && osciladorAtual) osciladorAtual.type = el.tomForma.value;
});
el.congelar.addEventListener('click', () => {
  congelado = !congelado;
  el.congelar.setAttribute('aria-pressed', String(congelado));
  el.congelar.textContent = congelado ? 'Continuar' : 'Congelar';
  if (!congelado) proximo = Math.max(0, anel.total - cfg.n);
});
el.limpar.addEventListener('click', () => {
  if (modoCompleto) sairDoModoCompleto();
  else limparHistorico();
});
el.exportar.addEventListener('click', exportarPng);
el.tamanho.addEventListener('change', () => mudarConfig({ n: Number(el.tamanho.value) }, { novoTamanho: true }));
el.sobreposicao.addEventListener('change', () => mudarConfig({ sobreposicao: Number(el.sobreposicao.value) }));
el.janela.addEventListener('change', () => mudarConfig({ janela: el.janela.value }));
el.escalaLog.addEventListener('change', () => mudarConfig({ log: el.escalaLog.checked }, { refazerLinhas: true }));
el.dbMin.addEventListener('input', () => {
  const v = Math.min(Number(el.dbMin.value), cfg.dbMax - 10);
  mudarConfig({ dbMin: v }, { repintarTudo: true });
});
el.dbMax.addEventListener('input', () => {
  const v = Math.max(Number(el.dbMax.value), cfg.dbMin + 10);
  mudarConfig({ dbMax: v }, { repintarTudo: true });
});
el.mapa.addEventListener('change', () => mudarConfig({ mapa: el.mapa.value }, { repintarTudo: true }));
el.la4.addEventListener('change', () => {
  const v = Number(el.la4.value);
  if (!(v >= 400 && v <= 480)) {
    mostrarStatus('Use um Lá4 entre 400 e 480 Hz.', true);
    el.la4.value = String(cfg.la4);
    return;
  }
  mudarConfig({ la4: v });
});

function iniciar() {
  preencherSelects();
  refletirConfig();
  dimensionar();
  new ResizeObserver(() => dimensionar()).observe(el.tela);
  requestAnimationFrame(analisar);
}

iniciar();
