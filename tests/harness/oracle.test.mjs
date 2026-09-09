import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluate } from '../../dist/oracle.js';
import { datasetEquals, parseRdf, extractMemberDataset } from '../../dist/rdf.js';
import { discoverTests } from '../../dist/discovery.js';

async function fixture(expected, group='UnorderedTraversal') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ldes-oracle-'));
  const expectedPath = path.join(directory, 'events.ndjson');
  await writeFile(expectedPath, expected.map(e=>JSON.stringify(e)).join('\n'));
  return {id:'test', iri:'https://example.test/test', directory, scenarioPath:path.join(directory,'scenario.yaml'), expectedPath, requirements:[], requiredCapabilities:[], group};
}
const m = id => ({type:'member', id, runId:'r'});
const end = {type:'run-end', status:'completed', runId:'r'};

test('unordered permutations preserve membership and terminal boundaries', async()=>{
  const f=await fixture([m('a'),m('b'),end]);
  assert.equal((await evaluate(f,[m('b'),m('a'),end],[])).outcome,'passed');
  for(const trace of [[m('a'),m('a'),end],[m('a'),end],[end,m('a'),m('b')],[m('a'),{...m('b'),runId:'other'},end]]) {
    assert.equal((await evaluate(f,trace,[])).outcome,'failed');
  }
});
test('ordered ties are explicit and cannot move past a finalizer',async()=>{
  const f=await fixture([{...m('a'),tieGroup:'k'},{...m('b'),tieGroup:'k'},m('final'),end],'OrderedTraversal');
  assert.equal((await evaluate(f,[m('b'),m('a'),m('final'),end],[])).outcome,'passed');
  assert.equal((await evaluate(f,[m('final'),m('a'),m('b'),end],[])).outcome,'failed');
  const ordered=await fixture([m('a'),m('b'),end],'OrderedTraversal');
  assert.equal((await evaluate(ordered,[m('b'),m('a'),end],[])).outcome,'failed');
});
test('dataset mismatches fail even when unordered IDs match',async()=>{
  const f=await fixture([{...m('a'),datasetFile:'a.nq'},end]);
  await writeFile(path.join(f.directory,'a.nq'),'<https://e/a> <https://e/p> "right" .');
  assert.equal((await evaluate(f,[{...m('a'),dataset:'<https://e/a> <https://e/p> "wrong" .'},end],[])).outcome,'failed');
});
test('context sets ignore array order but statistics remain observable',async()=>{
  const f=await fixture([{type:'context',shapes:['a','b']},{type:'statistics',membersEmitted:0,dateTime:['lastRun']},end]);
  const context={type:'context',shapes:['b','a']};
  const stat={type:'statistics',membersEmitted:0,lastRun:'2026-09-09T00:00:00Z'};
  assert.equal((await evaluate(f,[context,stat,end],[])).outcome,'passed');
  assert.equal((await evaluate(f,[context,end],[])).outcome,'failed');
  assert.equal((await evaluate(f,[context,{...stat,lastRun:'invalid'},end],[])).outcome,'failed');
});
test('Accept presence accepts any nonempty value and rejects absence',async()=>{
  const f=await fixture([end]);
  await writeFile(path.join(f.directory,'requests.json'),JSON.stringify([{path:'/root',presentHeaders:['Accept']}]));
  assert.equal((await evaluate(f,[end],[{path:'/root',headers:{accept:'text/turtle'}}])).outcome,'passed');
  assert.equal((await evaluate(f,[end],[{path:'/root',headers:{}}])).outcome,'failed');
});
test('RDF comparison uses sets, graph positions, and more than eight blank nodes',()=>{
  const q='<https://e/a> <https://e/p> "v" .\n';
  assert.equal(datasetEquals(q,q+q),true);
  const chain=prefix=>Array.from({length:12},(_,i)=>`_:${prefix}${i} <https://e/p> ${i===11?'"end"':`_:${prefix}${i+1}`} .`).join('\n');
  assert.equal(datasetEquals(chain('a'),chain('z')),true);
  assert.equal(datasetEquals(chain('a'),chain('z').replace('"end"','"wrong"')),false);
  assert.equal(datasetEquals('_:a <https://e/p> _:b _:c .','_:x <https://e/p> _:y _:z .'),true);
});
test('recursive blank-node graph payload is retained and cycles terminate',async()=>{
  const q=await parseRdf('@prefix e:<https://e/>. e:m e:p _:a . _:a { e:s e:p _:b . } _:b e:p _:a .','application/trig','https://e/');
  assert.equal(extractMemberDataset(q,q[0].subject).length,3);
});
test('scenario discovery does not silently swallow invalid artifacts',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ldes-discovery-'));
  await writeFile(path.join(dir,'scenario.yaml'),'version: 0');
  await assert.rejects(discoverTests(dir));
});
