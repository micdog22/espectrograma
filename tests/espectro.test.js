import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/espectro.js';
import { JANELAS, ganhoCoerente, janela, larguraEquivalente } from '../src/janelas.js';

const seno = (n, f, taxa, amp = 1, fase = 0) =>
  Float64Array.from({ length: n }, (_, t) => amp * Math.sin((2 * Math.PI * f * t) / taxa + fase));

test('valores das janelas', () => {
  const n = 1024;
  const hann = janela('hann', n);
  assert.equal(hann[0], 0);
  assert.ok(Math.abs(hann[n / 2] - 1) < 1e-15);
  assert.ok(Math.abs(hann[n / 4] - 0.5) < 1e-15);
  const hamming = janela('hamming', n);
  assert.ok(Math.abs(hamming[0] - 0.08) < 1e-15);
  assert.ok(Math.abs(hamming[n / 2] - 1) < 1e-15);
  const blackman = janela('blackman', n);
  assert.equal(blackman[0], 0);
  assert.ok(Math.abs(blackman[n / 2] - 1) < 1e-15);
  assert.ok(janela('retangular', n).every((v) => v === 1));
  // Forma periódica: simétrica em torno de N/2 (w[k] = w[N - k]).
  for (const tipo of Object.keys(JANELAS)) {
    const w = janela(tipo, n);
    for (let k = 1; k < n / 2; k++) assert.ok(Math.abs(w[k] - w[n - k]) < 1e-15, tipo);
  }
  // Ganho coerente (média) e largura equivalente de ruído conhecidos.
  assert.ok(Math.abs(ganhoCoerente(hann) - 0.5) < 1e-12);
  assert.ok(Math.abs(ganhoCoerente(hamming) - 0.54) < 1e-12);
  assert.ok(Math.abs(ganhoCoerente(blackman) - 0.42) < 1e-12);
  assert.ok(Math.abs(larguraEquivalente(hann) - 1.5) < 1e-9);
  assert.ok(Math.abs(larguraEquivalente(janela('retangular', n)) - 1) < 1e-12);
  assert.ok(Math.abs(larguraEquivalente(blackman) - 1.7268) < 1e-3);
  assert.throws(() => janela('triangular', 8));
});

test('conversão para dB', () => {
  assert.equal(S.paraDb(1), 0);
  assert.ok(Math.abs(S.paraDb(0.5) + 6.0206) < 1e-4);
  assert.equal(S.paraDb(10), 20);
  assert.equal(S.paraDb(0), S.PISO_DB);
  assert.equal(S.paraDb(-1), S.PISO_DB);
  assert.equal(S.paraDb(1e-30), S.PISO_DB);
  assert.ok(Math.abs(S.paraDb(1e-30, -1000) + 600) < 1e-9);
  assert.equal(S.paraDb(1e-30, -400), -400);
});

test('seno de amplitude 1 no centro de um bin aparece a 0 dBFS', () => {
  const taxa = 48000;
  const n = 4096;
  const k = 100;
  const f = (k * taxa) / n;
  for (const tipo of Object.keys(JANELAS)) {
    const db = S.espectroDb(seno(n, f, taxa), tipo);
    assert.ok(Math.abs(db[k]) < 0.01, `${tipo}: ${db[k]}`);
  }
  // Amplitude 0,25 dá -12 dB.
  const db = S.espectroDb(seno(n, f, taxa, 0.25), 'hann');
  assert.ok(Math.abs(db[k] + 12.04) < 0.01);
});

test('vazamento espectral: a janela de Blackman isola o seno muito melhor que a retangular', () => {
  const taxa = 44100;
  const n = 4096;
  const x = seno(n, 1234.5, taxa); // 114,6 bins: fora do centro de um bin
  const longe = Math.round((3000 * n) / taxa); // 1,8 kHz de distância
  const ret = S.espectroDb(x, 'retangular');
  const bla = S.espectroDb(x, 'blackman');
  assert.ok(ret[longe] > -70, `retangular ${ret[longe]}`);
  assert.ok(bla[longe] < -100, `blackman ${bla[longe]}`);
});

test('interpolação parabólica acha 440 Hz a 44,1 kHz com erro menor que 0,2 Hz', () => {
  const taxa = 44100;
  const n = 4096; // bins de 10,77 Hz
  const pico = S.picoEspectral(S.espectroDb(seno(n, 440, taxa, 0.8, 0.3), 'hann'), taxa, n);
  // A parábola em dB não é exata para a Hann: sobra um viés de até 2% de um bin.
  assert.ok(Math.abs(pico.frequencia - 440) < 0.2, String(pico.frequencia));
  // Sem interpolação o erro seria até meio bin.
  assert.ok(Math.abs((pico.bin * taxa) / n - 440) > 0.5);
  // A altura também é corrigida (perda de "scalloping" da Hann chega a 1,4 dB).
  assert.ok(Math.abs(pico.db - 20 * Math.log10(0.8)) < 0.1, String(pico.db));
  for (const f of [100.3, 1000.7, 3141.59, 12345.6]) {
    const p = S.picoEspectral(S.espectroDb(seno(n, f, taxa), 'blackman'), taxa, n);
    assert.ok(Math.abs(p.frequencia - f) < 0.1, `${f}: ${p.frequencia}`);
  }
  // Pico fora da faixa pedida é ignorado.
  const p = S.picoEspectral(S.espectroDb(seno(n, 440, taxa), 'hann'), taxa, n, 1000, 5000);
  assert.ok(p.frequencia > 1000);
});

test('eixo de frequência linear e logarítmico', () => {
  const h = 400;
  for (const log of [false, true]) {
    let anterior = Infinity;
    for (let y = 0; y < h; y++) {
      const f = S.frequenciaDaLinha(y, h, 20, 20000, log);
      assert.ok(f < anterior); // do agudo (topo) para o grave
      anterior = f;
      assert.ok(Math.abs(S.linhaDaFrequencia(f, h, 20, 20000, log) - (y + 0.5)) < 1e-9);
    }
  }
  // Na escala log, cada oitava ocupa a mesma altura.
  const y1 = S.linhaDaFrequencia(100, h, 20, 20000, true);
  const y2 = S.linhaDaFrequencia(200, h, 20, 20000, true);
  const y3 = S.linhaDaFrequencia(400, h, 20, 20000, true);
  assert.ok(Math.abs(y1 - y2 - (y2 - y3)) < 1e-9);
});

test('mapa de linhas: máximo nos agudos, interpolação nos graves', () => {
  const taxa = 48000;
  const n = 1024;
  const linhas = S.mapaDeLinhas(200, taxa, n, 30, 24000, true);
  assert.equal(linhas[0].tipo, 'max'); // agudos: muitos bins por linha
  assert.equal(linhas[199].tipo, 'interp'); // graves: menos de um bin por linha
  const db = new Float64Array(n / 2 + 1).fill(-90);
  db[400] = -10;
  const linhaDoPico = Math.floor(S.linhaDaFrequencia((400 * taxa) / n, 200, 30, 24000, true));
  assert.equal(S.valorDaLinha(db, linhas[linhaDoPico]), -10);
  const interp = { tipo: 'interp', pos: 10.25 };
  db[10] = -40;
  db[11] = -20;
  assert.equal(S.valorDaLinha(db, interp), -35);
});
