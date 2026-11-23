import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postLink, toAdPosts } from './adCreatives.ts';

test('post link only for a real page post id', () => {
  assert.equal(postLink('123_456'), 'https://www.facebook.com/123_456');
  assert.equal(postLink('abc'), null);
  assert.equal(postLink(undefined), null);
});

test('ads sharing one post are shown once, active first', () => {
  const posts = toAdPosts([
    { id: '1', name: 'a', effective_status: 'PAUSED', creative: { thumbnail_url: 't1', effective_object_story_id: '9_8' } },
    { id: '2', name: 'b', effective_status: 'ACTIVE', creative: { image_url: 'i2', effective_object_story_id: '9_8', body: 'hi' } },
    { id: '3', name: 'c', effective_status: 'ACTIVE', creative: {} },
  ]);
  assert.deepEqual(posts.map((p) => p.ad_id), ['2', '3']);
  assert.equal(posts[0].image, 'i2');
  assert.equal(posts[1].link, null);
});
