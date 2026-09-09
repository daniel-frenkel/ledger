/**
 * Writes content/references.ts from the sources. See lib/markdown/build-references.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileText } from '../lib/markdown/build-references';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'content', 'references.ts');
fs.writeFileSync(out, fileText(), 'utf8');
console.log(`wrote ${path.relative(process.cwd(), out)}`);
