// sablon + adat -> egyetlen önálló HTML (index.html, ezt szolgálja ki a GitHub Pages)
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../src');
const head = fs.readFileSync(path.join(dir, 'head.html'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const data = fs.readFileSync(path.join(dir, 'data.json'), 'utf8').trim();
const out = head.replace('__DATA__', () => data) + '\n<script type="module">\n' + app + '\n</script>\n</body>\n</html>\n';
fs.writeFileSync(path.join(__dirname, '../index.html'), out);
console.log('index.html', (out.length / 1024).toFixed(0), 'kB');
