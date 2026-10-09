import test from 'node:test';
import assert from 'node:assert/strict';
import { dftIngenua, ehPotenciaDe2, fft, fftReal } from '../src/fft.js';

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

function maiorDiferenca(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

test('FFT complexa bate com a DFT direta (erro abaixo de 1e-9)', () => {
  const r = gerador(42);
  for (let bits = 0; bits <= 12; bits++) {
    const n = 2 ** bits;
    const re = Float64Array.from({ length: n }, () => r() * 2 - 1);
    const im = Float64Array.from({ length: n }, () => r() * 2 - 1);
    const ref = dftIngenua(re, im);
    const fr = Float64Array.from(re);
    const fi = Float64Array.from(im);
    fft(fr, fi);
    const erro = Math.max(maiorDiferenca(fr, ref.re), maiorDiferenca(fi, ref.im));
    assert.ok(erro < 1e-9, `N = ${n}: erro ${erro}`);
  }
});

test('FFT de sinal real (truque de N/2) bate com a DFT direta', () => {
  const r = gerador(7);
  for (let bits = 0; bits <= 12; bits++) {
    const n = 2 ** bits;
    const x = Float64Array.from({ length: n }, () => r() * 2 - 1);
    const ref = dftIngenua(x, new Float64Array(n));
    const { re, im } = fftReal(x);
    assert.equal(re.length, n === 1 ? 1 : n / 2 + 1);
    let erro = 0;
    for (let k = 0; k < re.length; k++) {
      erro = Math.max(erro, Math.abs(re[k] - ref.re[k]), Math.abs(im[k] - ref.im[k]));
    }
    assert.ok(erro < 1e-9, `N = ${n}: erro ${erro}`);
  }
});

test('tamanhos grandes (até 16384): real contra complexa, ida e volta', () => {
  const r = gerador(3);
  for (const n of [256, 1024, 4096, 16384]) {
    const x = Float64Array.from({ length: n }, () => r() * 2 - 1);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    const real = fftReal(x);
    for (let k = 0; k <= n / 2; k++) {
      assert.ok(Math.abs(real.re[k] - re[k]) < 1e-9 && Math.abs(real.im[k] - im[k]) < 1e-9);
    }
    // simetria conjugada do sinal real: X[N - k] = conj(X[k])
    for (let k = 1; k < n / 2; k++) {
      assert.ok(Math.abs(re[n - k] - re[k]) < 1e-9 && Math.abs(im[n - k] + im[k]) < 1e-9);
    }
    // inversa devolve o sinal
    fft(re, im, true);
    assert.ok(maiorDiferenca(re, x) < 1e-12);
    assert.ok(maiorDiferenca(im, new Float64Array(n)) < 1e-12);
  }
});

test('Parseval: a energia no tempo é a energia na frequência dividida por N', () => {
  const r = gerador(99);
  for (const n of [8, 512, 8192]) {
    const re = Float64Array.from({ length: n }, () => r() * 2 - 1);
    const im = Float64Array.from({ length: n }, () => r() * 2 - 1);
    let tempo = 0;
    for (let i = 0; i < n; i++) tempo += re[i] ** 2 + im[i] ** 2;
    fft(re, im);
    let freq = 0;
    for (let i = 0; i < n; i++) freq += re[i] ** 2 + im[i] ** 2;
    assert.ok(Math.abs(freq / n - tempo) / tempo < 1e-12, `N = ${n}`);
  }
});

test('casos de referência: impulso, constante e seno exato', () => {
  const n = 16;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re[0] = 1;
  fft(re, im);
  assert.ok(re.every((v) => Math.abs(v - 1) < 1e-15) && im.every((v) => Math.abs(v) < 1e-15));
  const c = fftReal(new Float64Array(n).fill(2));
  assert.ok(Math.abs(c.re[0] - 32) < 1e-12);
  assert.ok(c.re.slice(1).every((v) => Math.abs(v) < 1e-12));
  // cos(2·pi·3·t/N): energia só nos bins 3 e N - 3, com altura N/2
  const x = Float64Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * 3 * t) / n));
  const s = fftReal(x);
  for (let k = 0; k <= n / 2; k++) {
    const mag = Math.hypot(s.re[k], s.im[k]);
    assert.ok(Math.abs(mag - (k === 3 ? n / 2 : 0)) < 1e-12, `bin ${k}`);
  }
});

test('rejeita tamanhos que não são potência de 2', () => {
  assert.equal(ehPotenciaDe2(1024), true);
  assert.equal(ehPotenciaDe2(1000), false);
  assert.equal(ehPotenciaDe2(0), false);
  assert.throws(() => fft(new Float64Array(12), new Float64Array(12)), /potência de 2/);
  assert.throws(() => fft(new Float64Array(8), new Float64Array(4)), /mesmo tamanho/);
  assert.throws(() => fftReal(new Float64Array(6)), /potência de 2/);
});
