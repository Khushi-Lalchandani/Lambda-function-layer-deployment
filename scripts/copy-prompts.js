const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(process.cwd(), 'prompts');
const destinationDir = path.resolve(process.cwd(), 'dist', 'prompts');

if (!fs.existsSync(sourceDir)) {
  process.exit(0);
}

fs.mkdirSync(destinationDir, { recursive: true });

const promptFiles = fs
  .readdirSync(sourceDir)
  .filter((fileName) => fileName.endsWith('.txt'));

for (const promptFile of promptFiles) {
  const sourcePath = path.join(sourceDir, promptFile);
  const destinationPath = path.join(destinationDir, promptFile);
  fs.copyFileSync(sourcePath, destinationPath);
}
