import { Eta } from 'eta';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ResumeDocument } from '../profile/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

export async function renderResumeHtml(doc: ResumeDocument): Promise<string> {
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

  const html = eta.renderString(templateSrc, { ...doc, css });
  return html;
}
