'use strict';
// Tests de analyse.js — transcription synthétique, aucun fichier réel lu.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { analyser, formater, slugProjet, cheminTranscription } = require('./analyse');

const lignes = [
  JSON.stringify({ type: 'user', message: { content: 'Tu incarnes l\'instance concepteur…' } }),
  JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: 39373, cache_creation_input_tokens: 87057, output_tokens: 3543 }, content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/x/ckpt.txt', content: 'a' } }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'The file /x/ckpt.txt has been updated successfully.' }] } }),
  JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: 126430, cache_creation_input_tokens: 3656, output_tokens: 203 }, content: [{ type: 'text', text: 'ok' }] } }),
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 148416, postTokens: 12459 } }),
  'ligne illisible {',
  JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: 39373, cache_creation_input_tokens: 27412, output_tokens: 10 }, content: [] } }),
];

test('analyser : contexte par tour, résultats d\'outils rattachés, compaction datée, lignes illisibles ignorées', () => {
  const a = analyser(lignes);
  assert.equal(a.promptInitialChars, 'Tu incarnes l\'instance concepteur…'.length);
  assert.equal(a.tours.length, 3);
  assert.equal(a.tours[0].contexte, 2 + 39373 + 87057);
  assert.deepEqual(a.tours[0].outils, ['Write(/x/ckpt.txt)']);
  assert.equal(a.tours[1].resultats.length, 1);
  assert.equal(a.tours[1].resultats[0].outil, 'Write(/x/ckpt.txt)');
  assert.equal(a.tours[1].contexte, 130088);
  assert.equal(a.tours[2].contexte, 66787);
  assert.deepEqual(a.compactions, [{ apresTour: 2, declencheur: 'auto', avant: 148416, apres: 12459 }]);
});

test('formater : une ligne par tour, la compaction sous le tour qui la précède, pic de contexte', () => {
  const t = formater('abc', analyser(lignes));
  assert.match(t, /^### session abc/);
  assert.match(t, /tour  1  contexte= 126432/);
  assert.match(t, /← résultat\s+51 c\s+Write\(\/x\/ckpt\.txt\)/);
  assert.match(t, /⟲ compaction auto : 148416 → 12459 tokens/);
  assert.match(t, /pic de contexte : 130088 tokens · 3 tour\(s\) · 1 compaction\(s\)/);
});

test('slugProjet et cheminTranscription : convention de Claude Code', () => {
  assert.equal(slugProjet('/workspaces/holon'), '-workspaces-holon');
  assert.equal(cheminTranscription('abc', { slug: '-workspaces-holon', projets: '/p' }), path.join('/p', '-workspaces-holon', 'abc.jsonl'));
  assert.equal(cheminTranscription('/tmp/x.jsonl'), '/tmp/x.jsonl');
});
