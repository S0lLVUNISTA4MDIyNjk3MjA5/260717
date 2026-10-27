/* Renders a guide.html source to a PDF. Portable: takes an optional input HTML path as argv[2]
 * (defaulting to guide.html in this same directory) and an optional output PDF path as argv[3]
 * (defaulting to a file named KMS_L3-1_Human_Evaluation_Guide_JA.pdf next to this script).
 * Used standalone or invoked by build_human_evaluation_package.js, which passes a
 * template-substituted scratch copy of guide.html as the input path.
 *
 * Usage: node render_guide.js [input_html_path] [output_pdf_path]
 */
const path = require('path');
const { chromium } = require('playwright');

const HERE = __dirname;
const GUIDE_HTML = process.argv[2] || path.join(HERE, 'guide.html');
const OUT_PDF = process.argv[3] || path.join(HERE, 'KMS_L3-1_Human_Evaluation_Guide_JA.pdf');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  await page.goto('file://' + GUIDE_HTML, { waitUntil: 'networkidle' });

  // Check all images loaded (not broken)
  const brokenImages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).filter(img => !img.complete || img.naturalWidth === 0).map(img => img.getAttribute('src'));
  });
  const allImages = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map(img => img.getAttribute('src')));

  console.log('Total images:', allImages.length);
  console.log('Broken images:', JSON.stringify(brokenImages));
  console.log('Errors:', JSON.stringify(errors));
  if (brokenImages.length) { console.error('FATAL: broken images in guide.html'); process.exit(1); }
  if (errors.length) { console.error('FATAL: page errors while rendering guide.html'); process.exit(1); }

  await page.pdf({
    path: OUT_PDF,
    format: 'A4',
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    printBackground: true,
  });

  await browser.close();
  console.log('PDF_DONE:', OUT_PDF);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
