import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNews, classify, pickUser, NEWS_TYPE_CODES } from '../lib/newsparse.js'

// plan4 Фаза C — юнит-тесты разбора ленты уведомлений (news/inbox). Без сети — чистые функции.
// Фикстуры отражают ИЗВЕСТНУЮ структуру Instagram news/inbox; точные story_type-коды
// доуточняются по реальному payload (Фаза B) — тут проверяем СТРУКТУРНУЮ раскладку + эвристику.

// Новый подписчик: story с args.inline_follow + profile_id/profile_name.
const followStory = {
  story_type: 101,
  args: {
    text: 'qkwcsnr started following you.',
    profile_id: 555001, profile_name: 'qkwcsnr',
    timestamp: 1700000000,
    inline_follow: { user_info: { pk: 555001, username: 'qkwcsnr' }, following: false },
  },
}
// Лайк поста: story с args.media, без коммент-признака.
const likeStory = {
  story_type: 44,
  args: {
    text: 'felix.lopez liked your photo.',
    profile_id: 555002, profile_name: 'felix.lopez',
    timestamp: 1700000100,
    media: [{ id: '3200000000000000001_555002', image: 'https://x/y.jpg' }],
  },
}
// Комментарий: story с args.media + коммент-признак в тексте.
const commentStory = {
  story_type: 12,
  args: {
    text: 'undervinii commented: ouu',
    profile_id: 555003, profile_name: 'undervinii',
    timestamp: 1700000200,
    media: [{ id: '3200000000000000002_555003' }],
  },
}
// Агрегированный лайк: «X and 5 others» — актор верхнего уровня всё равно извлекается.
const aggLikeStory = {
  story_type: 44,
  args: {
    text: 'bichuxan and 5 others liked your post.',
    profile_id: 555004, profile_name: 'bichuxan',
    timestamp: 1700000300,
    media: [{ id: '3200000000000000003_555004' }],
  },
}

test('follow: inline_follow → type follow + username/pk', () => {
  const e = classify(followStory)
  assert.equal(e.type, 'follow')
  assert.equal(e.username, 'qkwcsnr')
  assert.equal(e.pk, '555001')
  assert.equal(e.ts, 1700000000)
})

test('like: media без коммент-признака → type like + media_id (левая часть id)', () => {
  const e = classify(likeStory)
  assert.equal(e.type, 'like')
  assert.equal(e.username, 'felix.lopez')
  assert.equal(e.media_id, '3200000000000000001')
})

test('comment: media + «commented» → type comment + текст', () => {
  const e = classify(commentStory)
  assert.equal(e.type, 'comment')
  assert.equal(e.username, 'undervinii')
  assert.equal(e.media_id, '3200000000000000002')
  assert.match(e.text, /ouu/)
})

test('агрегированный лайк → верхний актор извлекается', () => {
  const e = classify(aggLikeStory)
  assert.equal(e.type, 'like')
  assert.equal(e.username, 'bichuxan')
})

test('локализация: украинский «почав стежити» → follow (по тексту, без inline_follow)', () => {
  const e = classify({ story_type: 101, args: { text: 'qkwcsnr почав стежити за вами', profile_id: 7, profile_name: 'qkwcsnr' } })
  assert.equal(e.type, 'follow')
})

test('story_type-код перекрывает эвристику (когда код известен)', () => {
  NEWS_TYPE_CODES.comment.add(999)
  try {
    // media есть, текста-признака нет → эвристика дала бы like; код 999=comment перекрывает.
    const e = classify({ story_type: 999, args: { text: '...', profile_id: 8, profile_name: 'u', media: [{ id: '10_8' }] } })
    assert.equal(e.type, 'comment')
  } finally { NEWS_TYPE_CODES.comment.delete(999) }
})

test('normalizeNews: new_stories + old_stories, битые пропускаются', () => {
  const json = { new_stories: [followStory, null, {}], old_stories: [likeStory, { args: null }] }
  const evs = normalizeNews(json)
  // followStory + likeStory валидны; null/{}/{args:null} без user → отброшены
  assert.equal(evs.length, 2)
  assert.deepEqual(evs.map((e) => e.type).sort(), ['follow', 'like'])
})

test('normalizeNews: пустой/мусорный вход → []', () => {
  assert.deepEqual(normalizeNews(null), [])
  assert.deepEqual(normalizeNews({}), [])
  assert.deepEqual(normalizeNews({ new_stories: 'nope' }), [])
})

test('pickUser: приоритет profile_id/profile_name, фолбэк на inline_follow', () => {
  assert.deepEqual(pickUser({ profile_id: 1, profile_name: 'a' }), { pk: '1', username: 'a' })
  assert.deepEqual(pickUser({ inline_follow: { user_info: { pk: 2, username: 'b' } } }), { pk: '2', username: 'b' })
  assert.deepEqual(pickUser({}), { pk: '', username: '' })
})
