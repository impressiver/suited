import { Eta } from 'eta';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ResumeDocument } from '../profile/schema.js';
import { generateAsciiName } from '../utils/ascii-name.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

export async function renderResumeHtml(doc: ResumeDocument, fitOverrideCss?: string): Promise<string> {
  const templateDir = join(TEMPLATES_DIR, doc.template);
  const templatePath = join(templateDir, 'template.eta');
  const cssPath = join(templateDir, 'style.css');

  const [templateSrc, css] = await Promise.all([
    readFile(templatePath, 'utf-8'),
    readFile(cssPath, 'utf-8'),
  ]);

  // autoEscape: true escapes HTML in <%= %> expressions (user data)
  // Raw <%~ %> is used only for the trusted CSS string
  const eta = new Eta({ views: templateDir, autoEscape: true });

  const extraData: Record<string, unknown> = {};

  if (doc.template === 'retro') {
    extraData.nameAscii = generateAsciiName(doc.contact.name);
  }

  // Logo data URIs are pre-fetched interactively before first render (see generate.ts)
  if (doc.template === 'timeline' && doc.logoDataUris) {
    extraData.logoDataUris = doc.logoDataUris;
  }

  let html = eta.renderString(templateSrc, { ...doc, css, ...extraData });

  // Inject fit-override CSS after </head> open tag's style block, before </head>
  if (fitOverrideCss) {
    html = html.replace('</head>', `<style>${fitOverrideCss}</style></head>`);
  }

  return html;
}
