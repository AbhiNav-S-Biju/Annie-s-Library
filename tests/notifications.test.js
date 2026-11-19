import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/storage.js';
import { syncNewBooks, markSeen, listNotices, unreadCount, markRead, markAllRead, timeAgo } from '../js/notifications.js';

const book = (key, extra = {}) => ({ key, title: `Book ${key}`, author: 'A', state: 'READ', ...extra });

beforeEach(() => store.remove('notifications'));

test('first run seeds everything as seen: no flood of notifications', () => {
  assert.deepEqual(syncNewBooks([book('a'), book('b')]), []);
  assert.equal(unreadCount(), 0);
});

test('a book that appears later becomes a notification, once', () => {
  syncNewBooks([book('a')]);
  const fresh = syncNewBooks([book('a'), book('b', { added: Date.now() - 60000 })]);
  assert.deepEqual(fresh.map((n) => n.key), ['b']);
  assert.equal(unreadCount(), 1);
  assert.deepEqual(syncNewBooks([book('a'), book('b')]), [], 'not notified twice');
  assert.equal(listNotices()[0].book.title, 'Book b', 'keeps enough of the book to open it');
});

test('books you published yourself do not notify you', () => {
  syncNewBooks([book('a')]);
  markSeen(['mine']);
  assert.deepEqual(syncNewBooks([book('a'), book('mine')]), []);
});

test('read state', () => {
  syncNewBooks([]);
  syncNewBooks([book('x'), book('y')]);
  assert.equal(unreadCount(), 2);
  markRead('x');
  assert.equal(unreadCount(), 1);
  markAllRead();
  assert.equal(unreadCount(), 0);
  assert.equal(listNotices().length, 2, 'read notices stay in the list');
});

test('timeAgo labels', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  assert.equal(timeAgo(now - 20 * 1000, now), 'just now');
  assert.equal(timeAgo(now - 5 * 60000, now), '5 min ago');
  assert.equal(timeAgo(now - 3 * 3600000, now), '3 h ago');
  assert.equal(timeAgo(now - 2 * 86400000, now), '2 days ago');
});
