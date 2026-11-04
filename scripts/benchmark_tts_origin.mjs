// Make an inert, same-origin test document without fetching or running the
// UAG application page. Model/API requests still go to the real operator server.
export async function openInertBenchmarkPage(page, url) {
  const targetUrl = new URL(url).href;
  await page.route(targetUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>ZEN-TTS benchmark</title></head><body></body></html>',
  }));
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
}
