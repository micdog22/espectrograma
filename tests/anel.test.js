import test from 'node:test';
import assert from 'node:assert/strict';
import { Anel, quadrosProntos } from '../src/anel.js';

const seq = (inicio, n) => Float32Array.from({ length: n }, (_, i) => inicio + i);

test('o anel guarda as últimas amostras e lê trechos que dão a volta', () => {
  const a = new Anel(10);
  a.escrever(seq(0, 4));
  a.escrever(seq(4, 4));
  a.escrever(seq(8, 5)); // passa do fim e volta para o começo
  assert.equal(a.total, 13);
  const d = new Float32Array(6);
  assert.ok(a.ler(7, 6, d));
  assert.deepEqual([...d], [7, 8, 9, 10, 11, 12]);
  assert.ok(!a.ler(2, 4, d.subarray(0, 4))); // já sobrescrito
  assert.ok(!a.ler(10, 6, d)); // ainda não chegou
  assert.ok(a.ler(3, 10, new Float32Array(10)));
  // bloco maior que o anel: fica só o fim
  a.escrever(seq(13, 25));
  assert.equal(a.total, 38);
  const fim = new Float32Array(10);
  assert.ok(a.ler(28, 10, fim));
  assert.deepEqual([...fim], [...seq(28, 10)]);
  a.limpar();
  assert.equal(a.total, 0);
});

test('fluxo longo em blocos de tamanhos variados', () => {
  const a = new Anel(4096);
  let escrito = 0;
  let s = 7;
  const destino = new Float32Array(1024);
  for (let rodada = 0; rodada < 2000; rodada++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const n = 1 + (s % 700);
    a.escrever(seq(escrito, n));
    escrito += n;
    if (escrito >= 1024) {
      assert.ok(a.ler(escrito - 1024, 1024, destino));
      assert.equal(destino[0], escrito - 1024);
      assert.equal(destino[1023], escrito - 1);
    }
  }
});

test('quadros com sobreposição e recuperação quando a análise atrasa', () => {
  // N = 8, salto 2 (75% de sobreposição), 20 amostras: quadros em 0, 2, ..., 12
  let r = quadrosProntos(0, 20, 8, 2, 1000);
  assert.deepEqual(r.inicios, [0, 2, 4, 6, 8, 10, 12]);
  assert.equal(r.proximo, 14);
  r = quadrosProntos(r.proximo, 23, 8, 2, 1000);
  assert.deepEqual(r.inicios, [14]);
  // Atrasou mais do que o anel guarda: recomeça perto do presente.
  r = quadrosProntos(0, 5000, 8, 4, 1000);
  assert.equal(r.inicios[0], 4992);
  // Limite de quadros por chamada.
  r = quadrosProntos(0, 10000, 8, 1, 100000, 50);
  assert.equal(r.inicios.length, 50);
  assert.equal(r.proximo, 50);
});
