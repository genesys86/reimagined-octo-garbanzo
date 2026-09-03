/**
 * Copies every catalogue image onto the site itself, so the shop no longer
 * depends on the old Shopify CDN staying online.
 *
 *   node scripts/download-images.mjs            # primary image of each product
 *   node scripts/download-images.mjs --all      # every image (~1400 files)
 *   node scripts/download-images.mjs --dry-run
 *
 * Files land in public/media/<handle>-<n>.<ext> and catalog.json is rewritten to
 * point at them. Roughly 30 MB for the primaries, 170 MB for everything — check
 * that against your host's limits (and Git LFS) before running with --all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogFile = path.join(root, 'src/data/catalog.json');
const mediaDir = path.join(root, 'public/media');

const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
const concurrency = Number(process.env.DOWNLOAD_CONCURRENCY || 6);

const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));

const extensionOf = (url) => {
  const clean = url.split('?')[0];
  const ext = path.extname(clean).toLowerCase();
  return ['.webp', '.jpg', '.jpeg', '.png', '.avif', '.gif'].includes(ext) ? ext : '.jpg';
};

const jobs = [];
for (const product of catalog.products) {
  const images = all ? product.images : product.images.slice(0, 1);
  images.forEach((image, index) => {
    if (!image.src.startsWith('http')) return;
    const file = `${product.handle}-${index}${extensionOf(image.src)}`;
    jobs.push({ image, url: image.src, file, dest: path.join(mediaDir, file) });
  });
}

console.log(`${jobs.length} image(s) to mirror${dryRun ? ' (dry run)' : ''}`);
if (dryRun) {
  console.log(jobs.slice(0, 5).map((j) => `  ${j.file} <- ${j.url}`).join('\n'));
  process.exit(0);
}

fs.mkdirSync(mediaDir, { recursive: true });

let done = 0;
let failed = 0;
let bytes = 0;

async function run(job) {
  try {
    if (fs.existsSync(job.dest) && fs.statSync(job.dest).size > 0) {
      bytes += fs.statSync(job.dest).size;
    } else {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(45000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) throw new Error('empty body');
      fs.writeFileSync(job.dest, buffer);
      bytes += buffer.length;
    }
    job.image.src = `/media/${job.file}`;
    done++;
  } catch (err) {
    failed++;
    console.warn(`  failed ${job.file}: ${err.message}`);
  }
  if ((done + failed) % 25 === 0) process.stdout.write(`  ${done + failed}/${jobs.length}\r`);
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (queue.length) await run(queue.shift());
  }),
);

// Collection covers point at the same URLs, so refresh them from the products.
const firstImage = new Map(catalog.products.map((p) => [p.collections[0], p.images[0]?.src]));
for (const collection of catalog.collections) {
  const match = catalog.products.find((p) => p.collections.includes(collection.slug) && p.images.length);
  collection.cover = match ? match.images[0].src : firstImage.get(collection.slug) || collection.cover;
}

fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 0));

console.log(`\nmirrored ${done} image(s), ${failed} failed, ${(bytes / 1024 / 1024).toFixed(1)} MB in public/media`);
console.log('catalog.json now points at the local copies — commit public/media and rebuild.');
