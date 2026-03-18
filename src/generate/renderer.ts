import { Eta } from 'eta';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ResumeDocument } from '../profile/schema.js';
import { generateAsciiName } from '../utils/ascii-name.js';

// TEMPLATES_DIR is only used in dev/npm mode (non-SEA). When bundled to CJS
// for a SEA binary, import.meta.url is empty — guard so startup doesn't throw.
const TEMPLATES_DIR = (() => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
  } catch {
    return '';
  }
})();

async function loadTemplateFile(template: string, filename: string): Promise<string> {
  // When running as a Node.js SEA binary, read embedded assets via the SEA API.
  // In dev / npm-installed mode, isSea() returns false and we fall through to readFile.
  try {
    const { isSea, getAsset } = await import('node:sea');
    if (isSea()) {
      return getAsset(`templates/${template}/${filename}`, 'utf8') as string;
    }
  } catch {
    // node:sea is not available in older Node versions — fall through to readFile
  }
  return readFile(join(TEMPLATES_DIR, template, filename), 'utf-8');
}

export async function renderResumeHtml(doc: ResumeDocument, fitOverrideCss?: string): Promise<string> {
  const templateDir = join(TEMPLATES_DIR, doc.template);

  const [templateSrc, css] = await Promise.all([
    loadTemplateFile(doc.template, 'template.eta'),
    loadTemplateFile(doc.template, 'style.css'),
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
