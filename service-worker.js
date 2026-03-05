<<<<<<< HEAD
const CACHE_NAME = 'comanda-v1';

const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
=======
const CACHE_NAME = 'comanda-v1';

const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
>>>>>>> a3c41e4abcda6d5c2116f60e540cc99ee0c705bb
