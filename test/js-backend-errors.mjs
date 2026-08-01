// Negative and host-facing parity checks that cannot use the one-value
// Scheme test oracle: both backends must reject the same invalid programs,
// and non-ASCII exports must keep their UTF-8 names.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileToBytes } from '../rt/compile.mjs';
import { runModule } from '../rt/run.mjs';
import { runJsModule } from '../rt/runjs.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goeteia-js-parity-'));
let serial = 0;

async function compile(name, source) {
    const stem = `${++serial}-${name}`;
    const sourceFile = path.join(dir, `${stem}.ss`);
    const jsFile = path.join(dir, `${stem}.mjs`);
    fs.writeFileSync(sourceFile, source, 'utf8');
    const wasm = await compileToBytes(sourceFile, { script: true });
    fs.writeFileSync(
        jsFile,
        await compileToBytes(sourceFile, { script: true, target: 'js' }));
    return { wasm, jsFile };
}

async function bothReject(name, source) {
    const { wasm, jsFile } = await compile(name, source);
    await assert.rejects(() => runModule(wasm), undefined, `${name}: wasm`);
    await assert.rejects(() => runJsModule(jsFile), undefined, `${name}: js`);
}

try {
    await bothReject('quotient-zero', '(quotient 1 0)\n');
    await bothReject('remainder-zero', '(remainder 1 0)\n');
    await bothReject(
        'vector-ref-bounds',
        '(vector-ref (vector 1) 1)\n');
    await bothReject(
        'vector-set-bounds',
        '(define v (vector 1))\n(vector-set! v 2 9)\n');
    await bothReject('memory-bounds', '(%mem-u8-ref 65536)\n');
    await bothReject(
        'fixed-arity',
        '(define h (vector (lambda (x) 42)))\n((vector-ref h 0))\n');
    await bothReject(
        'variadic-arity',
        '(define h (vector (lambda (x . rest) 42)))\n((vector-ref h 0))\n');
    await bothReject('apply-arity', "(apply (lambda (x) 42) '())\n");
    await bothReject(
        'callcc-arity',
        '(call/cc (lambda (k missing) 42))\n');

    const exportName = '\u03bb';
    const { wasm, jsFile } = await compile(
        'unicode-export',
        `(export ${exportName})\n` +
        `(define (${exportName} x) x)\n(${exportName} 1)\n`);
    const wasmNames = WebAssembly.Module.exports(
        new WebAssembly.Module(wasm)).map(e => e.name);
    assert.ok(wasmNames.includes(exportName));
    const js = await import(pathToFileURL(jsFile).href);
    assert.deepEqual(Object.keys(js.xports), [exportName]);
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
