import test from 'node:test';
import assert from 'node:assert/strict';
import { previewAudioAt, previewAudioGain } from '../src/core/preview-audio';
test('seeking during a music fade retains its source; past fade does not restart it',()=>{
 const events=[{id:'bgm',channel:'music' as const,at:1000,fade:2000},{channel:'music' as const,at:2000,fade:2000}];
 assert.deepEqual(previewAudioAt(events,3000),[{source:events[0],stop:events[1],stopGain:.5}]);
 assert.equal(previewAudioGain(3000,1000,2000,2000,2000),.25);
 assert.deepEqual(previewAudioAt(events,4000),[]);
 assert.equal(previewAudioGain(1500,1000,2000),.25);
});
test('seeking selects only the latest sound and music source, replacing an earlier stop',()=>{
 const events=[{id:'old',channel:'sound' as const,at:0},{id:'latest',channel:'sound' as const,at:1000},{channel:'music' as const,at:1000},{id:'bgm',channel:'music' as const,at:2000}];
 assert.deepEqual(previewAudioAt(events,2500).map(item=>item.source.id),['latest','bgm']);
});

test('a later stop must not revive music whose earlier fade already ended',()=>{
 const events=[{id:'bgm',channel:'music' as const,at:0,loop:true},{channel:'music' as const,at:1000,fade:500},{channel:'music' as const,at:2000,fade:3000}];
 assert.deepEqual(previewAudioAt(events,2500),[]);
});

test('repeated stops continue from the current fade volume, while a new source resets it',()=>{
 const events=[{id:'bgm',channel:'music' as const,at:0},{channel:'music' as const,at:1000,fade:2000},{channel:'music' as const,at:2000,fade:2000}];
 const active=previewAudioAt(events,2500)[0];
 assert.equal(active.stopGain,.5);
 assert.equal(previewAudioGain(2500,0,0,active.stop?.at,active.stop?.fade,active.stopGain),.375);
 assert.deepEqual(previewAudioAt(events,4000),[]);
 const replacement={id:'new',channel:'music' as const,at:3000};
 assert.deepEqual(previewAudioAt([...events,replacement],3500),[{source:replacement}]);
});
