import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNews, classify, pickUser } from '../lib/newsparse.js'

// plan4 Фаза C — юнит-тесты разбора ленты news/inbox. Без сети — чистые функции.
// Фикстуры — по РЕАЛЬНОМУ payload с живого аккаунта (2026-07-11): follow = story_type 101 /
// notif_name "user_followed"; comment_like = story_type 13 / notif_name "comment_like" (лайк
// МОЕГО коммента — НЕ наш триггер, отбрасывается). like/comment на пост — по notif_name.

// Новый подписчик (реальная структура).
const followStory = {
  story_type: 101, notif_name: 'user_followed', type: 3,
  args: {
    text: 'qkwcsnr started following you.',
    profile_id: '78214499770', profile_name: 'qkwcsnr',
    timestamp: 1783785846.58,
    inline_follow: { user_info: { pk: '78214499770', username: 'qkwcsnr' }, following: true },
  },
}
// Лайк МОЕГО КОММЕНТА — НЕ триггер (должен отбрасываться).
const commentLikeStory = {
  story_type: 13, notif_name: 'comment_like', type: 1,
  args: {
    text: 'felix.lopezz liked your comment: ouu',
    profile_id: '53055913540', profile_name: 'felix.lopezz',
    media: [{ id: '3928366199058626902_242066770' }],
    timestamp: 1783649789.65,
  },
}
// Комментарий к МОЕМУ посту (реальный триггер NEW_COMMENT) — по notif_name.
const postCommentStory = {
  notif_name: 'comment',
  args: { text: 'undervinii: nice post', profile_id: '43732579145', profile_name: 'undervinii', media: [{ id: '3200000000000000002_43732579145' }], timestamp: 1783700000 },
}
// Лайк МОЕГО поста (реальный триггер NEW_LIKE) — по notif_name.
const postLikeStory = {
  notif_name: 'like',
  args: { text: 'felix.lopezz liked your photo.', profile_id: '53055913540', profile_name: 'felix.lopezz', media: [{ id: '3200000000000000003_53055913540' }], timestamp: 1783700100 },
}

test('follow: notif_name user_followed → follow + username/pk из inline_follow', () => {
  const e = classify(followStory)
  assert.equal(e.type, 'follow')
  assert.equal(e.username, 'qkwcsnr')
  assert.equal(e.pk, '78214499770')
  assert.equal(e.ts, 1783785847)   // округление
})

test('comment_like (лайкнули МОЙ коммент) → отбрасывается (null)', () => {
  assert.equal(classify(commentLikeStory), null)
})

test('comment на пост: notif_name comment → type comment + media_id (левая часть)', () => {
  const e = classify(postCommentStory)
  assert.equal(e.type, 'comment')
  assert.equal(e.username, 'undervinii')
  assert.equal(e.media_id, '3200000000000000002')
})

test('like поста: notif_name like → type like', () => {
  const e = classify(postLikeStory)
  assert.equal(e.type, 'like')
  assert.equal(e.username, 'felix.lopezz')
})

test('follow по СТРУКТУРЕ (нет notif_name, но inline_follow) → follow', () => {
  const e = classify({ args: { text: 'x почав стежити за вами', profile_id: '7', profile_name: 'x', inline_follow: { user_info: { pk: '7', username: 'x' } } } })
  assert.equal(e.type, 'follow')
})

test('story_type 101 без notif_name → follow (код-подстраховка)', () => {
  const e = classify({ story_type: 101, args: { profile_id: '9', profile_name: 'u' } })
  assert.equal(e.type, 'follow')
})

test('normalizeNews на РЕАЛЬНОМ наборе: 2 follow + comment_like(отброшен) = 2 события', () => {
  const json = { new_stories: [], old_stories: [followStory, commentLikeStory, { ...followStory, args: { ...followStory.args, profile_id: '111', profile_name: 'two' } }] }
  const evs = normalizeNews(json)
  assert.equal(evs.length, 2)
  assert.ok(evs.every((e) => e.type === 'follow'))
})

test('normalizeNews: пустой/мусор → []', () => {
  assert.deepEqual(normalizeNews(null), [])
  assert.deepEqual(normalizeNews({}), [])
  assert.deepEqual(normalizeNews({ old_stories: 'nope' }), [])
})

test('pickUser: profile_id/profile_name → фолбэк inline_follow', () => {
  assert.deepEqual(pickUser({ profile_id: '1', profile_name: 'a' }), { pk: '1', username: 'a' })
  assert.deepEqual(pickUser({ inline_follow: { user_info: { pk: '2', username: 'b' } } }), { pk: '2', username: 'b' })
  assert.deepEqual(pickUser({}), { pk: '', username: '' })
})
