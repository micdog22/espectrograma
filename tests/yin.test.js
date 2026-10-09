import test from 'node:test';
import assert from 'node:assert/strict';
import { yin } from '../src/yin.js';
import { centsEntre, nota } from '../src/notas.js';

function gerador(semente) {
  let s = semente >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// Tom com harmônicos de amplitudes decrescentes e fases aleatórias, como uma corda.
function tom(f0, taxa, n, { harmonicos = [1, 0.6, 0.4, 0.3, 0.2, 0.1], ruido = 0, semente = 1 } = {}) {
  const r = gerador(semente);
  const fases = harmonicos.map(() => r() * 2 * Math.PI);
  const x = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    let s = 0;
    harmonicos.forEach((a, h) => {
      s += a * Math.sin((2 * Math.PI * (h + 1) * f0 * t) / taxa + fases[h]);
    });
    x[t] = s + ruido * (r() * 2 - 1);
  }
  return x;
}

test('YIN acerta tons com harmônicos com erro de poucos cents', () => {
  const taxa = 44100;
  const n = 4096;
  for (const f0 of [82.41, 110, 146.83, 196, 261.63, 440, 659.25, 880, 1318.5]) {
    const r = yin(tom(f0, taxa, n, { semente: Math.round(f0) }), taxa);
    assert.ok(r, `sem resposta em ${f0}`);
    const erro = centsEntre(r.frequencia, f0);
    assert.ok(Math.abs(erro) < 2, `${f0} Hz: ${r.frequencia} (${erro} cents)`);
    assert.ok(r.confianca > 0.9);
  }
});

test('YIN acha a fundamental mesmo quando o segundo harmônico é mais forte', () => {
  const taxa = 48000;
  const x = tom(196, taxa, 4096, { harmonicos: [0.3, 1, 0.5, 0.3] });
  const r = yin(x, taxa);
  assert.ok(Math.abs(centsEntre(r.frequencia, 196)) < 2, String(r.frequencia));
});

test('YIN ouve a fundamental ausente (só harmônicos 2 a 6)', () => {
  const taxa = 44100;
  const x = tom(220, taxa, 4096, { harmonicos: [0, 1, 0.8, 0.6, 0.4, 0.3] });
  const r = yin(x, taxa);
  assert.ok(Math.abs(centsEntre(r.frequencia, 220)) < 2, String(r.frequencia));
});

test('YIN tolera ruído e recusa silêncio e ruído puro', () => {
  const taxa = 44100;
  const comRuido = yin(tom(330, taxa, 4096, { ruido: 0.15, semente: 9 }), taxa);
  assert.ok(Math.abs(centsEntre(comRuido.frequencia, 330)) < 10, String(comRuido.frequencia));
  assert.equal(yin(new Float64Array(4096), taxa), null);
  const r = gerador(5);
  const ruido = Float64Array.from({ length: 4096 }, () => r() * 2 - 1);
  assert.equal(yin(ruido, taxa), null);
});

test('nome da nota e cents', () => {
  const la = nota(440);
  assert.equal(la.nome, 'Lá');
  assert.equal(la.cifra, 'A');
  assert.equal(la.oitava, 4);
  assert.ok(Math.abs(la.cents) < 1e-9);
  const doCentral = nota(261.6256);
  assert.equal(doCentral.nome, 'Dó');
  assert.equal(doCentral.oitava, 4);
  assert.equal(doCentral.midi, 60);
  assert.equal(nota(466.16).nome, 'Lá#');
  assert.equal(nota(27.5).oitava, 0); // a nota mais grave do piano
  assert.equal(nota(4186.01).nome, 'Dó'); // e a mais aguda
  assert.equal(nota(4186.01).oitava, 8);
  const desafinado = nota(445);
  assert.equal(desafinado.nome, 'Lá');
  assert.ok(Math.abs(desafinado.cents - 19.56) < 0.01);
  const quaseSi = nota(480); // mais perto do Si do que do Lá#
  assert.equal(quaseSi.nome, 'Si');
  assert.ok(quaseSi.cents < 0);
  assert.equal(nota(432, 432).nome, 'Lá'); // afinação alternativa
  assert.ok(Math.abs(nota(440, 432).cents - 31.77) < 0.01);
  assert.equal(nota(0), null);
  assert.ok(Math.abs(centsEntre(880, 440) - 1200) < 1e-9);
});
